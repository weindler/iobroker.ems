import { isAddonGovernanceEnabledFromState } from "../governance";
import { GLOBAL } from "../../tree_paths";
import { parseMode } from "../../execution_mode";
import { ensureAddonMappingStates, syncNativeMappingToStates } from "../../mapping_sync";
import { batteryConfigFromAdapter, type BatteryConfig } from "./config";
import { isChargingAction } from "./core/intent";
import { validateBatteryIntent } from "./core/validation";
import type { BatteryAction, BatteryDeviceIntent, BatteryOperatingMode } from "./core/types";
import { assembleBatterySnapshot, type BatterySnapshot } from "./diagnostics";
import { BAT, ensureBatteryArchitectureStates } from "./ensure_states";
import { ensureBatteryEmsMirrorStates, EMS_MIRROR_BATTERY, EMS_MIRROR_BATTERY_IDS } from "./ems_mirror";
import { computeGridBalanceTarget, resolveController } from "./grid_balance";
import {
	BATTERY_MAPPING_ROLES,
	batteryMappingFromConfig,
	batteryMappingNativeFromConfig,
	type BatteryMappingTable,
} from "./mapping";
import { getBatteryProfile } from "./profiles/registry";
import {
	clearBatteryFault,
	initialSonnenRuntime,
	stepSonnenFsm,
	type SonnenFsmContext,
	type SonnenRuntime,
} from "./runtime/fsm";
import { executeBatteryWrite, type BatteryWriteHost, type FinalWriteGate } from "./runtime/execute";
import { isForeignManualControl } from "./runtime/ownership";
import { evaluateStopCondition } from "./runtime/safety";
import type { RawBatteryReading } from "./core/telemetry";

export const BATTERY_ADDON_ID = "battery";

const CONTROL_INTERVAL_MS = 5000;

type Host = ioBroker.Adapter & { config: unknown };

let controlTimer: NodeJS.Timeout | null = null;
let runtime: SonnenRuntime = initialSonnenRuntime(Date.now());
let gridBalancePausedByFsm = false;
let ownershipLive = false;
let ticking = false;

/** Nur für Tests: internen Laufzeitzustand zurücksetzen. */
export function __resetBatteryRuntimeForTest(now = Date.now()): void {
	runtime = initialSonnenRuntime(now);
	gridBalancePausedByFsm = false;
	ownershipLive = false;
}

export async function initBatteryModule(adapter: ioBroker.Adapter): Promise<null> {
	await ensureAddonMappingStates(adapter, BATTERY_ADDON_ID, BATTERY_MAPPING_ROLES);
	await syncNativeMappingToStates(adapter, BATTERY_ADDON_ID, batteryMappingNativeFromConfig);
	await ensureBatteryEmsMirrorStates(adapter);
	await ensureBatteryArchitectureStates(adapter);

	runtime = initialSonnenRuntime(Date.now());
	gridBalancePausedByFsm = false;
	ownershipLive = false;

	const host = adapter as Host;
	for (const relId of EMS_MIRROR_BATTERY_IDS) {
		await adapter.subscribeStatesAsync(relId);
	}
	await adapter.subscribeStatesAsync(BAT.control.faultReset);

	await detectForeignOwnershipOnStart(host);

	controlTimer = setInterval(() => {
		void runBatteryControlTick(host).catch((e) => adapter.log.error(`battery tick: ${e}`));
	}, CONTROL_INTERVAL_MS);

	void runBatteryControlTick(host).catch((e) => adapter.log.error(`battery tick (startup): ${e}`));
	return null;
}

export function stopBatteryModule(_timer: NodeJS.Timeout | null): void {
	if (controlTimer) {
		clearInterval(controlTimer);
		controlTimer = null;
	}
}

export function handleBatteryAdapterStateChange(adapter: ioBroker.Adapter, stateId: string): void {
	const ns = `${adapter.namespace}.`;
	const rel = stateId.startsWith(ns) ? stateId.slice(ns.length) : stateId;
	if (rel === BAT.control.faultReset || (EMS_MIRROR_BATTERY_IDS as readonly string[]).includes(rel)) {
		void runBatteryControlTick(adapter as Host).catch((e) =>
			adapter.log.error(`battery state change tick: ${e}`),
		);
	}
}

/** @deprecated use handleBatteryAdapterStateChange */
export function handleBatteryForeignStateChange(adapter: ioBroker.Adapter, stateId: string): void {
	handleBatteryAdapterStateChange(adapter, stateId);
}

// ---------------------------------------------------------------------------

async function readForeign(
	host: Host,
	id: string,
): Promise<{ val: ioBroker.StateValue; ts: number } | null> {
	const t = id.trim();
	if (!t) return null;
	try {
		const st = await host.getForeignStateAsync(t);
		if (!st || st.val === undefined || st.val === null) return null;
		return { val: st.val, ts: typeof st.ts === "number" ? st.ts : Date.now() };
	} catch {
		return null;
	}
}

async function readMappedNumber(host: Host, table: BatteryMappingTable, role: keyof BatteryMappingTable): Promise<{ val: number | null; ts: number | null }> {
	const slot = table[role];
	if (!slot || !slot.enabled || !slot.targetState) return { val: null, ts: null };
	const r = await readForeign(host, slot.targetState);
	if (!r) return { val: null, ts: null };
	const n = Number(r.val);
	return { val: Number.isFinite(n) ? n : null, ts: r.ts };
}

async function readMappedBool(host: Host, table: BatteryMappingTable, role: keyof BatteryMappingTable): Promise<boolean | null> {
	const slot = table[role];
	if (!slot || !slot.enabled || !slot.targetState) return null;
	const r = await readForeign(host, slot.targetState);
	if (!r) return null;
	return r.val === true || r.val === 1 || r.val === "true";
}

async function readRelNumber(host: Host, id: string): Promise<number | null> {
	const st = await host.getStateAsync(id);
	if (st?.val == null) return null;
	const n = Number(st.val);
	return Number.isFinite(n) ? n : null;
}

async function readRelBool(host: Host, id: string): Promise<boolean> {
	const st = await host.getStateAsync(id);
	return st?.val === true;
}

async function detectForeignOwnershipOnStart(host: Host): Promise<void> {
	const config = batteryConfigFromAdapter(host.config);
	if (config.profile !== "sonnen_em") return;
	const table = batteryMappingFromConfig(host.config);
	const mode = await readMappedNumber(host, table, "operating_mode_read");
	if (
		isForeignManualControl({
			currentMode: mode.val,
			manualModeValue: config.sonnenModeValues.manual,
			ownership: runtime.ownership,
		})
	) {
		host.log.warn(
			"battery: device already in manual mode at startup without EMS ownership — live control degraded, awaiting user decision",
		);
		runtime.faultCode = "foreign_manual_control";
		runtime.faultReason = "manual_mode_without_ownership";
		runtime.faultSinceMs = Date.now();
	}
}

function buildReading(
	host: Host,
	table: BatteryMappingTable,
	config: BatteryConfig,
	profileNormalizeMode: (raw: unknown) => BatteryOperatingMode,
	raw: {
		soc: { val: number | null; ts: number | null };
		power: { val: number | null; ts: number | null };
		charging: { val: number | null };
		discharging: { val: number | null };
		capacity: { val: number | null };
		mode: { val: number | null };
		online: boolean | null;
	},
): RawBatteryReading {
	void host;
	void table;
	void config;
	const ts = [raw.soc.ts, raw.power.ts].filter((t): t is number => t !== null);
	return {
		socPct: raw.soc.val,
		powerW: raw.power.val,
		chargingPowerW: raw.charging.val,
		dischargingPowerW: raw.discharging.val,
		capacityNetKwh: raw.capacity.val,
		operatingMode: profileNormalizeMode(raw.mode.val),
		online: raw.online,
		updatedAtMs: ts.length ? Math.max(...ts) : null,
	};
}

export async function runBatteryControlTick(host: Host): Promise<void> {
	if (ticking) return;
	ticking = true;
	try {
		await controlTickInner(host);
	} finally {
		ticking = false;
	}
}

async function controlTickInner(host: Host): Promise<void> {
	const nowMs = Date.now();
	const config = batteryConfigFromAdapter(host.config);
	const profile = getBatteryProfile(config.profile);
	const table = batteryMappingFromConfig(host.config);

	const governanceEnabled = await isAddonGovernanceEnabledFromState(
		(id) => host.getStateAsync(id),
		BATTERY_ADDON_ID,
	);
	const globalStateRaw = await host.getStateAsync(GLOBAL.executionMode);
	const globalLive = parseMode(globalStateRaw?.val) === "live";

	// Fault reset button.
	if (await readRelBool(host, BAT.control.faultReset)) {
		runtime = clearBatteryFault(runtime, nowMs);
		await host.setStateAsync(BAT.control.faultReset, { val: false, ack: true });
	}

	// Telemetry.
	const soc = await readMappedNumber(host, table, "soc_pct");
	const power = await readMappedNumber(host, table, "power_w");
	const charging = await readMappedNumber(host, table, "charging_power_w");
	const discharging = await readMappedNumber(host, table, "discharging_power_w");
	const capacityMapped = await readMappedNumber(host, table, "capacity_kwh");
	const modeRead = await readMappedNumber(host, table, "operating_mode_read");
	const online = await readMappedBool(host, table, "online");

	const reading = buildReading(
		host,
		table,
		config,
		(raw) => profile.normalizeOperatingMode(raw, { config, mapping: table, limits: config.limits }),
		{ soc, power, charging, discharging, capacity: capacityMapped, mode: modeRead, online },
	);

	const snapshot = assembleBatterySnapshot({
		config,
		mapping: table,
		profile,
		reading,
		mappedCapacityKwh: capacityMapped.val,
		nowMs,
		globalLive,
		governanceEnabled,
		requiredValues: ["soc", "power"],
	});

	// EMS-mirror device intent.
	const intentActive = await readRelBool(host, EMS_MIRROR_BATTERY.batteryIntentActive);
	const modeTarget = await readRelNumber(host, EMS_MIRROR_BATTERY.operatingModeTarget);
	const chargeReq = await readRelNumber(host, EMS_MIRROR_BATTERY.chargePowerWRequest);
	const wantsCharge = intentActive && modeTarget === 1 && (chargeReq ?? 0) > 0;
	const action: BatteryAction = wantsCharge ? "charge" : "self_consumption";
	const requestId = `bat-${(await readRelNumber(host, EMS_MIRROR_BATTERY.modeRequestId)) ?? 0}`;

	const deviceIntent: BatteryDeviceIntent = {
		requestId,
		action,
		targetSocPct: null,
		maxChargeW: chargeReq,
		maxDischargeW: null,
		energySource: "any",
		validFrom: null,
		validUntil: null,
		issuedAt: new Date(nowMs).toISOString(),
		reason: `mirror intent_active=${intentActive} mode=${modeTarget}`,
		source: "ems_mirror",
	};

	const telemetryFresh = !snapshot.telemetry.stale && snapshot.quality.socValid && snapshot.quality.powerValid;
	const validation = validateBatteryIntent({
		intent: deviceIntent,
		limits: snapshot.limits,
		capabilities: snapshot.capabilities,
		governanceEnabled,
		telemetrySocValid: snapshot.quality.socValid,
		telemetryFreshForAction: telemetryFresh,
		fault: runtime.faultCode !== null,
		lockout: runtime.lockout,
	});

	const intentValid = validation.accepted && wantsCharge && profile.supportsLive;
	const effectiveChargeW = validation.effectiveChargeW ?? 0;

	// Grid balance controller.
	const adapterFeature = snapshot.capabilities.control_grid_balance.available;
	const emsGb = await readRelBool(host, EMS_MIRROR_BATTERY.gridBalanceEnabled);
	const controller = resolveController({
		emsBatteryIntentActive: intentActive,
		emsGridBalanceEnabled: emsGb,
		adapterFeatureEnabled: adapterFeature,
		batteryAddonEnabled: governanceEnabled,
		gridBalancePaused: gridBalancePausedByFsm || runtime.ownership.active,
	});

	const safetyOverride = ownershipLive && !globalLive;
	const effectiveLive = globalLive || safetyOverride;

	const targetSocReached =
		deviceIntent.targetSocPct != null &&
		snapshot.telemetry.socPct != null &&
		snapshot.telemetry.socPct >= deviceIntent.targetSocPct;

	const stopReason = evaluateStopCondition({
		targetSocReached,
		intentExpired: false,
		intentRevoked: runtime.ownership.active && !wantsCharge,
		addonDisabled: !governanceEnabled,
		globalLeftLive: ownershipLive && !globalLive,
		safetyBlocked: false,
		telemetryStale: runtime.ownership.active && snapshot.telemetry.stale,
		communicationLost: runtime.ownership.active && online === false,
		fault: false,
		unloading: false,
		higherPriorityIntent: false,
	});

	const ctx: SonnenFsmContext = {
		nowMs,
		intentValid,
		chargingActionRequested: wantsCharge,
		action: deviceIntent.action,
		requestId,
		effectiveChargeW,
		targetSocPct: deviceIntent.targetSocPct,
		stopReason,
		actualMode: modeRead.val,
		actualChargingW: snapshot.telemetry.chargingPowerW,
		socPct: snapshot.telemetry.socPct,
		modeValues: config.sonnenModeValues,
		sequence: config.sequence,
		tolerance: config.feedbackTolerance,
		gridBalanceActive: controller === "grid_balance",
		simulateFeedback: !effectiveLive,
	};

	const step = profile.supportsLive ? stepSonnenFsm(runtime, ctx) : { runtime, writes: [], gridBalance: null, log: null, transitioned: false };
	runtime = step.runtime;

	if (step.gridBalance === "pause") gridBalancePausedByFsm = true;
	if (step.gridBalance === "restore") gridBalancePausedByFsm = false;
	if (step.log) host.log[step.log.level](step.log.msg);

	// Apply FSM writes through the single central write function.
	const gate: FinalWriteGate = {
		globalLive: effectiveLive,
		governanceEnabled,
		profileId: config.profile,
		profileLiveControlAvailable: snapshot.capabilities.live_control.available,
		profileReady: snapshot.readiness.liveReady,
		intentValid: intentValid || safetyOverride,
		telemetryReady: snapshot.readiness.telemetryReady,
		fault: false,
		lockout: false,
		targetMappingConfigured: true,
		ownershipValid: true,
	};

	let lastWrite: { state: string; value: number; success: boolean; expected: number | null } | null = null;
	for (const w of step.writes) {
		const stateId =
			w.kind === "operating_mode" ? table.set_operating_mode.targetState : table.set_charge_power.targetState;
		const result = await executeBatteryWrite(host as unknown as BatteryWriteHost, {
			kind: w.kind,
			stateId,
			value: w.value,
			requestId,
			reason: `fsm:${runtime.state}`,
			expectedFeedback: w.expectedFeedback,
			dryrun: !effectiveLive,
			gate: { ...gate, targetMappingConfigured: stateId.length > 0 },
		});
		lastWrite = { state: stateId, value: w.value, success: result.executed, expected: result.expectedFeedback };
		if (result.executed && w.kind === "operating_mode" && w.value === config.sonnenModeValues.manual) {
			ownershipLive = true;
		}
	}
	if (!runtime.ownership.active) {
		ownershipLive = false;
	}

	// Grid balance write path (only when EMS-FSM not owning the battery).
	let gbWouldWrite = false;
	let gbTarget = 0;
	let gbState = "";
	if (controller === "grid_balance" && !runtime.ownership.active && !gridBalancePausedByFsm) {
		const consumption = (await readMappedNumber(host, table, "consumption_w")).val ?? 0;
		const pv = (await readMappedNumber(host, table, "pv_ac_power_w")).val ?? 0;
		const capacityWh = (snapshot.capacity.effectiveKwh ?? 0) * 1000;
		const restKwh = (await readRelNumber(host, EMS_MIRROR_BATTERY.effectivePvRestOfDayKwh)) ?? 0;
		const snow = await readRelBool(host, EMS_MIRROR_BATTERY.snowCoverSuspected);
		const result = computeGridBalanceTarget({
			effectiveRestOfDayKwh: restKwh,
			capacityWh,
			snowCoverSuspected: snow,
			consumptionW: consumption,
			pvAcPowerW: pv,
			socPct: snapshot.telemetry.socPct,
			emsGridBalanceEnabled: emsGb,
			adapterFeatureEnabled: adapterFeature,
			controller,
			offsetHighSocW: config.gridBalance.offsetHighSocW,
			offsetLowSocW: config.gridBalance.offsetLowSocW,
			socThresholdPct: config.gridBalance.socThresholdPct,
		});
		if (result.gatePassed) {
			gbTarget = Math.min(config.gridBalance.maxTargetW, result.targetBatteryChargingW);
			gbState = table.set_charge_power.targetState;
			gbWouldWrite = gbState.length > 0;
			await executeBatteryWrite(host as unknown as BatteryWriteHost, {
				kind: "charge_power",
				stateId: gbState,
				value: gbTarget,
				requestId: "grid_balance",
				reason: "grid_balance",
				expectedFeedback: gbTarget,
				dryrun: !globalLive,
				gate: { ...gate, targetMappingConfigured: gbWouldWrite },
			});
		}
	}

	await persist(host, snapshot, {
		nowMs,
		globalLive,
		controller,
		lastWrite,
		gb: { wouldWrite: gbWouldWrite, target: gbTarget, state: gbState },
		clamps: validation.clamps,
		requestedPowerW: chargeReq ?? 0,
		effectiveChargeW,
		action,
		actualMode: modeRead.val,
		actualChargingW: snapshot.telemetry.chargingPowerW,
	});
}

interface PersistExtra {
	nowMs: number;
	globalLive: boolean;
	controller: string;
	lastWrite: { state: string; value: number; success: boolean; expected: number | null } | null;
	gb: { wouldWrite: boolean; target: number; state: string };
	clamps: Array<{ field: string; from: number; to: number; reason: string }>;
	requestedPowerW: number;
	effectiveChargeW: number;
	action: BatteryAction;
	actualMode: number | null;
	actualChargingW: number | null;
}

async function persist(host: Host, s: BatterySnapshot, x: PersistExtra): Promise<void> {
	const iso = new Date(x.nowMs).toISOString();
	const set = (id: string, val: ioBroker.StateValue): Promise<unknown> =>
		host.setStateAsync(id, { val, ack: true });

	await set(BAT.identity.manufacturer, s.identity.manufacturer);
	await set(BAT.identity.model, s.identity.model);
	await set(BAT.identity.controllerProfile, s.identity.controllerProfile);
	await set(BAT.identity.capacityNetKwh, s.identity.capacityNetKwh);
	await set(BAT.identity.capacitySource, s.identity.capacitySource);

	await set(BAT.telemetry.socPct, s.telemetry.socPct);
	await set(BAT.telemetry.powerW, s.telemetry.powerW);
	await set(BAT.telemetry.chargingPowerW, s.telemetry.chargingPowerW);
	await set(BAT.telemetry.dischargingPowerW, s.telemetry.dischargingPowerW);
	await set(BAT.telemetry.capacityEffectiveKwh, s.capacity.effectiveKwh);
	await set(BAT.telemetry.operatingMode, s.telemetry.operatingMode);
	await set(BAT.telemetry.online, s.telemetry.online);
	await set(BAT.telemetry.valid, s.telemetry.valid);
	await set(BAT.telemetry.stale, s.telemetry.stale);
	if (s.telemetry.updatedAt) await set(BAT.telemetry.lastUpdate, s.telemetry.updatedAt);

	await set(BAT.status.profile, s.profileId);
	await set(BAT.status.profileLoaded, true);
	await set(BAT.status.telemetryReady, s.readiness.telemetryReady);
	await set(BAT.status.controlReady, s.readiness.controlReady);
	await set(BAT.status.dryrunReady, s.readiness.dryrunReady);
	await set(BAT.status.liveReady, s.readiness.liveReady);
	await set(BAT.status.effectiveExecutionMode, s.effectiveExecutionMode);
	await set(BAT.status.state, runtime.state);
	await set(BAT.status.reason, s.readiness.reason);
	await set(BAT.status.fault, runtime.faultCode !== null);
	await set(BAT.status.lockout, runtime.lockout);

	await set(BAT.capabilities.readSoc, s.capabilities.read_soc.available);
	await set(BAT.capabilities.readPower, s.capabilities.read_power.available);
	await set(BAT.capabilities.setOperatingMode, s.capabilities.set_operating_mode.available);
	await set(BAT.capabilities.setChargePower, s.capabilities.set_charge_power.available);
	await set(BAT.capabilities.setDischargePower, s.capabilities.set_discharge_power.available);
	await set(BAT.capabilities.controlGridBalance, s.capabilities.control_grid_balance.available);
	await set(BAT.capabilities.safeRestore, s.capabilities.safe_restore.available);
	await set(BAT.capabilities.liveControl, s.capabilities.live_control.available);

	await set(BAT.limits.hardwareMaxChargeW, s.limits.maxChargeW);
	await set(BAT.limits.hardwareMaxDischargeW, s.limits.maxDischargeW);
	await set(BAT.limits.hardwareMinSocPct, s.limits.minSocPct);
	await set(BAT.limits.hardwareMaxSocPct, s.limits.maxSocPct);
	await set(BAT.limits.effectiveMaxChargeW, x.effectiveChargeW);
	await set(BAT.limits.effectiveMaxDischargeW, 0);
	await set(BAT.limits.effectiveReason, x.clamps.map((c) => `${c.field}:${c.reason}`).join(",") || "ok");

	await set(BAT.runtime.requestId, runtime.requestId ?? "");
	await set(BAT.runtime.action, runtime.action ?? "");
	await set(BAT.runtime.state, runtime.state);
	await set(BAT.runtime.step, runtime.state);
	await set(BAT.runtime.requestedPowerW, x.requestedPowerW);
	await set(BAT.runtime.effectivePowerW, runtime.effectivePowerW);
	await set(BAT.runtime.targetSocPct, runtime.targetSocPct);
	await set(BAT.runtime.startedAt, runtime.ownership.startedAt ?? "");
	await set(BAT.runtime.lastTransitionAt, iso);
	await set(BAT.runtime.reason, runtime.faultReason ?? s.readiness.reason);
	await set(BAT.runtime.ownershipActive, runtime.ownership.active);

	const wouldWrite = !x.globalLive && (isChargingAction(x.action) || x.gb.wouldWrite);
	await set(BAT.dryrun.wouldWrite, wouldWrite);
	await set(BAT.dryrun.wouldWriteState, x.gb.state || x.lastWrite?.state || "");
	await set(BAT.dryrun.wouldWriteValue, x.gb.wouldWrite ? x.gb.target : x.lastWrite?.value ?? null);
	await set(BAT.dryrun.sequenceStep, runtime.state);
	await set(BAT.dryrun.requestedAction, x.action);
	await set(BAT.dryrun.requestedPowerW, x.requestedPowerW);
	await set(BAT.dryrun.effectivePowerW, x.effectiveChargeW);
	await set(BAT.dryrun.wouldRestore, !x.globalLive && runtime.ownership.active);
	await set(BAT.dryrun.reason, `controller=${x.controller}`);
	await set(BAT.dryrun.updatedAt, iso);

	await set(BAT.diagnostics.missingMappings, s.missingMappings.join(",") || "");
	if (x.lastWrite) {
		await set(BAT.diagnostics.lastWriteState, x.lastWrite.state);
		await set(BAT.diagnostics.lastWriteValue, x.lastWrite.value);
		await set(BAT.diagnostics.lastWriteAt, iso);
		await set(BAT.diagnostics.lastWriteSuccess, x.lastWrite.success);
		await set(BAT.diagnostics.expectedFeedback, x.lastWrite.expected);
	}
	await set(BAT.diagnostics.actualFeedback, x.actualChargingW);
	await set(BAT.diagnostics.lastFeedbackAt, iso);
	await set(BAT.diagnostics.faultCode, runtime.faultCode ?? "");
	await set(BAT.diagnostics.faultReason, runtime.faultReason ?? "");
}

/** Adapter-Unload: best-effort Safe Restore nur bei aktiver Live-Ownership. */
export async function batteryUnloadRestore(host: Host): Promise<void> {
	if (!runtime.ownership.active || !ownershipLive) {
		return;
	}
	const config = batteryConfigFromAdapter(host.config);
	const table = batteryMappingFromConfig(host.config);
	const gate: FinalWriteGate = {
		globalLive: true,
		governanceEnabled: true,
		profileId: config.profile,
		profileLiveControlAvailable: true,
		profileReady: true,
		intentValid: true,
		telemetryReady: true,
		fault: false,
		lockout: false,
		targetMappingConfigured: true,
		ownershipValid: true,
	};
	try {
		await executeBatteryWrite(host as unknown as BatteryWriteHost, {
			kind: "charge_power",
			stateId: table.set_charge_power.targetState,
			value: 0,
			requestId: "unload",
			reason: "unload_stop",
			dryrun: false,
			gate,
		});
		await executeBatteryWrite(host as unknown as BatteryWriteHost, {
			kind: "operating_mode",
			stateId: table.set_operating_mode.targetState,
			value: config.sonnenModeValues.selfConsumption,
			requestId: "unload",
			reason: "unload_restore",
			dryrun: false,
			gate,
		});
	} catch (e) {
		host.log.warn(`battery unload restore best-effort failed: ${String(e)}`);
	}
}
