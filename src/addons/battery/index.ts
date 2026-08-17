import { isAddonGovernanceEnabledFromState } from "../governance";
import {
	plannerStatusFromDailyPlan,
	publishAddonRuntimeSurface,
	type ExecutionStatus,
	type IntentStatus,
} from "../runtime_surface";
import { touchEmsActivity } from "../../ems_activity";
import {
	isAddonExecutionOff,
	isLiveWriteAllowed,
	isExecutionModeStateRelativeId,
	parseAddonMode,
	parseGlobalMode,
} from "../../execution_mode";
import { addonMode, GLOBAL } from "../../tree_paths";
import { ensureAddonMappingStates, syncNativeMappingToStates } from "../../mapping_sync";
import { batteryConfigFromAdapter, type BatteryConfig } from "./config";
import { isChargingAction } from "./core/intent";
import { validateBatteryIntent } from "./core/validation";
import type { BatteryAction, BatteryDeviceIntent, BatteryOperatingMode } from "./core/types";
import { assembleBatterySnapshot, type BatterySnapshot } from "./diagnostics";
import { BAT, ensureBatteryArchitectureStates } from "./ensure_states";
import { ensureBatteryEmsMirrorStates, EMS_MIRROR_BATTERY, EMS_MIRROR_BATTERY_IDS } from "./ems_mirror";
import { computeGridBalanceTarget, medianCtFromPriceSlots, resolveController } from "./grid_balance";
import {
	GRID_BALANCE_EXECUTION_ENABLED,
	classifyGridBalanceEvConflict,
	type GridBalanceSafetyInput,
	type GridBalanceSafetyResult,
} from "./grid_balance_contract";
import {
	applyGridBalanceLiveTestPulse,
	consumeGridBalanceLiveTest,
	emptyGridBalanceLiveTest,
	emptyStabilization,
	evaluateGridBalanceTick,
	type GridBalanceLiveTestState,
	type GridBalanceTickDecision,
	type StabilizationState,
} from "./grid_balance_power";
import { isRestoreInProgress } from "../../restore/barrier";
import { WALLBOX_EVCC_STATES } from "../wallbox/ensure_evcc_states";
import { WALLBOX_RUNTIME_STATES } from "../wallbox/runtime/states";
import { WALLBOX_EV_FOUNDATION_STATES } from "../wallbox/ev_foundation/ensure_states";
import { readTibber15MinPriceSlots } from "../../planner/battery_winter_price_inputs";
import {
	batteryMappingFromConfig,
	batteryMappingCommandsForEnsure,
	batteryMappingNativeFromConfig,
	type BatteryMappingTable,
} from "./mapping";
import { getBatteryProfile } from "./profiles/registry";
import {
	clearBatteryFault,
	initialSonnenRuntime,
	isBatterySafetyWriteState,
	isBatterySimulatedProgressState,
	stepSonnenFsm,
	type SonnenFsmContext,
	type SonnenRuntime,
} from "./runtime/fsm";
import { executeBatteryWrite, type BatteryWriteHost, type FinalWriteGate } from "./runtime/execute";
import { emptyOwnership, isForeignManualControl } from "./runtime/ownership";
import { evaluateStopCondition } from "./runtime/safety";
import {
	applyHandover,
	applyZeroRelease,
	consumeFailsafeSetpointTakeover,
	getBatterySetpointSession,
	markReleasePending,
	notePositiveSetpointWrite,
	resetBatterySetpointSession,
	resolveBatterySetpointHandover,
	setBatterySetpointSession,
	setpointOwnerFromAction,
} from "./runtime/setpoint_session";
import {
	deviceIntentFromResolvedBattery,
	parseResolvedBatteryIntentJson,
	resolvedIntentHasManualPriority,
} from "./runtime/intent_read";
import {
	clearGridBalanceWatch,
	isGridBalanceWatchState,
	scheduleGridBalanceTick,
	setupGridBalanceWatch,
} from "./runtime/grid_balance_watch";
import {
	ALLOCATION_ADDON_STATE_IDS,
	DAILY_PLAN_STATE_IDS,
} from "../../operator/daily_plan/states";
import {
	deviceIntentFromDailyPlan,
	isBatteryDailyPlanAuthoritative,
	resetBatteryDailyPlanCache,
	resolveBatteryDailyPlanAllocation,
	type BatteryDailyPlanRuntimeContext,
	type BatteryDecisionSource,
} from "./runtime/daily_plan";
import { setStateIfChanged } from "../../policy/core/state_write";
import type { RawBatteryReading } from "./core/telemetry";

export const BATTERY_ADDON_ID = "battery";

function batteryControlIntervalMs(config: BatteryConfig): number {
	const sec = config.gridBalance.updateIntervalSec;
	return Math.min(15_000, Math.max(3000, sec * 1000));
}

type Host = ioBroker.Adapter & { config: unknown };

let controlTimer: NodeJS.Timeout | null = null;
let runtime: SonnenRuntime = initialSonnenRuntime(Date.now());
let gridBalancePausedByFsm = false;
let ownershipLive = false;
let prevLiveWriteAllowed = false;
let ticking = false;
let lastGridBalanceWriteW: number | null = null;
let lastGridBalanceAction = "";
let lastGridBalanceActionAt = "";
let gridBalanceOwnsSetpoint = false;
let gridBalanceStabilization: StabilizationState = emptyStabilization();
let gridBalanceLiveTest: GridBalanceLiveTestState = emptyGridBalanceLiveTest();

const DAILY_PLAN_TRIGGER_IDS = new Set<string>([
	DAILY_PLAN_STATE_IDS.revision,
	DAILY_PLAN_STATE_IDS.status,
	ALLOCATION_ADDON_STATE_IDS.battery.planJson,
]);

/** Nur für Tests: internen Laufzeitzustand zurücksetzen. */
export function __resetBatteryRuntimeForTest(now = Date.now()): void {
	runtime = initialSonnenRuntime(now);
	gridBalancePausedByFsm = false;
	ownershipLive = false;
	prevLiveWriteAllowed = false;
	lastGridBalanceWriteW = null;
	lastGridBalanceAction = "";
	lastGridBalanceActionAt = "";
	gridBalanceOwnsSetpoint = false;
	gridBalanceStabilization = emptyStabilization();
	gridBalanceLiveTest = emptyGridBalanceLiveTest();
	resetBatteryDailyPlanCache();
	resetBatterySetpointSession();
}

export async function ensureBatteryStateTree(adapter: ioBroker.Adapter): Promise<void> {
	await ensureAddonMappingStates(adapter, BATTERY_ADDON_ID, batteryMappingCommandsForEnsure(adapter.config));
	await ensureBatteryEmsMirrorStates(adapter);
	await ensureBatteryArchitectureStates(adapter);
}

export async function startBatteryModuleRuntime(adapter: ioBroker.Adapter): Promise<null> {
	await syncNativeMappingToStates(adapter, BATTERY_ADDON_ID, batteryMappingNativeFromConfig);

	runtime = initialSonnenRuntime(Date.now());
	gridBalancePausedByFsm = false;
	ownershipLive = false;
	prevLiveWriteAllowed = false;
	lastGridBalanceWriteW = null;
	lastGridBalanceAction = "";
	lastGridBalanceActionAt = "";
	gridBalanceOwnsSetpoint = false;
	gridBalanceStabilization = emptyStabilization();
	gridBalanceLiveTest = emptyGridBalanceLiveTest();
	resetBatterySetpointSession();

	const host = adapter as Host;
	for (const relId of EMS_MIRROR_BATTERY_IDS) {
		await adapter.subscribeStatesAsync(relId);
	}
	await adapter.subscribeStatesAsync(BAT.control.faultReset);
	await adapter.subscribeStatesAsync(BAT.gridBalance.liveTestArmed);
	for (const id of DAILY_PLAN_TRIGGER_IDS) {
		await adapter.subscribeStatesAsync(id);
	}

	await detectForeignOwnershipOnStart(host);

	const config = batteryConfigFromAdapter(host.config);
	const table = batteryMappingFromConfig(host.config);
	if (config.gridBalance.enabled) {
		await setupGridBalanceWatch(adapter, table);
	}

	const intervalMs = batteryControlIntervalMs(config);
	controlTimer = setInterval(() => {
		void runBatteryControlTick(host).catch((e) => adapter.log.error(`battery tick: ${e}`));
	}, intervalMs);

	void runBatteryControlTick(host).catch((e) => adapter.log.error(`battery tick (startup): ${e}`));
	return null;
}

export async function initBatteryModule(adapter: ioBroker.Adapter): Promise<null> {
	await ensureBatteryStateTree(adapter);
	return startBatteryModuleRuntime(adapter);
}

export function stopBatteryModule(_timer: NodeJS.Timeout | null): void {
	if (controlTimer) {
		clearInterval(controlTimer);
		controlTimer = null;
	}
	clearGridBalanceWatch();
	lastGridBalanceWriteW = null;
	resetBatteryDailyPlanCache();
}

export function handleBatteryAdapterStateChange(adapter: ioBroker.Adapter, stateId: string): void {
	const ns = `${adapter.namespace}.`;
	const rel = stateId.startsWith(ns) ? stateId.slice(ns.length) : stateId;
	if (
		rel === BAT.control.faultReset ||
		rel === BAT.gridBalance.liveTestArmed ||
		isExecutionModeStateRelativeId(rel) ||
		(EMS_MIRROR_BATTERY_IDS as readonly string[]).includes(rel) ||
		DAILY_PLAN_TRIGGER_IDS.has(rel)
	) {
		void runBatteryControlTick(adapter as Host).catch((e) =>
			adapter.log.error(`battery state change tick: ${e}`),
		);
	}
}

/** Reagiert auf Änderungen an gemapptem consumption_w / pv_ac_power_w (Netzausgleich on-change). */
export function handleBatteryGridBalanceForeignStateChange(adapter: ioBroker.Adapter, stateId: string): void {
	if (!isGridBalanceWatchState(stateId)) {
		return;
	}
	scheduleGridBalanceTick(adapter as Host, runBatteryControlTick);
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

async function readRelNumberTs(
	host: Host,
	id: string,
	nowMs: number,
): Promise<{ val: number | null; ageMs: number | null }> {
	const st = await host.getStateAsync(id);
	if (st?.val == null) return { val: null, ageMs: null };
	const n = Number(st.val);
	const val = Number.isFinite(n) ? n : null;
	const ts = typeof st.ts === "number" && Number.isFinite(st.ts) ? st.ts : null;
	const ageMs = ts != null ? Math.max(0, nowMs - ts) : null;
	return { val, ageMs };
}

async function readRelString(host: Host, id: string): Promise<string | null> {
	const st = await host.getStateAsync(id);
	if (st?.val == null) return null;
	const s = String(st.val).trim();
	return s.length > 0 ? s : null;
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
	touchEmsActivity();
	if (consumeFailsafeSetpointTakeover()) {
		runtime = {
			...runtime,
			state: "completed",
			ownership: emptyOwnership(),
			effectivePowerW: 0,
		};
		ownershipLive = false;
		gridBalanceOwnsSetpoint = false;
		lastGridBalanceWriteW = null;
		gridBalancePausedByFsm = false;
	}
	const nowMs = Date.now();
	const config = batteryConfigFromAdapter(host.config);
	const profile = getBatteryProfile(config.profile);
	const table = batteryMappingFromConfig(host.config);

	const governanceEnabled = await isAddonGovernanceEnabledFromState(
		(id) => host.getStateAsync(id),
		BATTERY_ADDON_ID,
	);
	const liveWriteAllowed = await isLiveWriteAllowed((id) => host.getStateAsync(id), BATTERY_ADDON_ID);
	const executionOff = isAddonExecutionOff((await host.getStateAsync(addonMode(BATTERY_ADDON_ID)))?.val);

	if (
		liveWriteAllowed &&
		!prevLiveWriteAllowed &&
		!ownershipLive &&
		isBatterySimulatedProgressState(runtime.state)
	) {
		host.log.info("battery: live write enabled — restarting charge sequence (prior dryrun progress discarded)");
		runtime = initialSonnenRuntime(nowMs);
		gridBalancePausedByFsm = false;
		resetBatterySetpointSession();
	}
	prevLiveWriteAllowed = liveWriteAllowed;

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
		globalLive: liveWriteAllowed,
		governanceEnabled,
		requiredValues: ["soc", "power"],
	});

	// Device intent: manual user intent → daily plan → EMS mirror / safe default (Block 5: no winter/legacy planner).
	const resolvedRaw = await host.getStateAsync("user_intent.battery.resolved_json");
	const resolvedIntent = parseResolvedBatteryIntentJson(resolvedRaw?.val);
	const fromManual =
		resolvedIntent && resolvedIntentHasManualPriority(resolvedIntent)
			? deviceIntentFromResolvedBattery(resolvedIntent)
			: null;

	const topOffActive =
		resolvedIntent?.top_off_requested.status === "valid" && resolvedIntent.top_off_requested.value === true;
	const targetSocFromIntent =
		resolvedIntent?.target_soc_pct.status === "valid" ? resolvedIntent.target_soc_pct.value : null;

	const dailyPlanContext = await resolveBatteryDailyPlanAllocation(host, profile, snapshot.limits, {
		now: new Date(nowMs),
		socPct: snapshot.telemetry.socPct,
		topOffActive,
		targetSocFromIntent,
		governanceEnabled,
	});

	let deviceIntent: BatteryDeviceIntent;
	let wantsCharge: boolean;
	let requestId: string;
	let runtimeDecisionSource: BatteryDecisionSource = dailyPlanContext.decisionSource;

	if (fromManual?.intent) {
		deviceIntent = fromManual.intent;
		wantsCharge = fromManual.wantsCharge;
		requestId = deviceIntent.requestId;
		runtimeDecisionSource = "manual_user_intent";
		if (wantsCharge && (deviceIntent.maxChargeW ?? 0) <= 0) {
			const mirrorW = await readRelNumber(host, EMS_MIRROR_BATTERY.chargePowerWRequest);
			if (mirrorW != null && mirrorW > 0) {
				deviceIntent = { ...deviceIntent, maxChargeW: mirrorW };
			}
		}
	} else if (!executionOff && dailyPlanContext.useDailyPlan) {
		deviceIntent = deviceIntentFromDailyPlan(dailyPlanContext, nowMs);
		wantsCharge = dailyPlanContext.chargingAllowed && (dailyPlanContext.effectiveChargePowerW ?? 0) > 0;
		requestId = deviceIntent.requestId;
		runtimeDecisionSource = dailyPlanContext.decisionSource;
	} else if (runtime.ownership.active && runtime.requestId?.startsWith("winter-planner")) {
		// Cleanup ownership from pre-Block-5 installs that still hold a winter-planner request.
		requestId = runtime.requestId ?? `winter-planner-${nowMs}`;
		wantsCharge = false;
		runtimeDecisionSource = "restore";
		deviceIntent = {
			requestId,
			action: "self_consumption",
			targetSocPct: null,
			maxChargeW: null,
			maxDischargeW: null,
			energySource: "any",
			validFrom: null,
			validUntil: null,
			issuedAt: new Date(nowMs).toISOString(),
			reason: "Legacy Winter-Ownership beendet — Rückkehr Mode 2",
			source: "winter_planner",
		};
	} else {
		const intentActive = await readRelBool(host, EMS_MIRROR_BATTERY.batteryIntentActive);
		const modeTarget = await readRelNumber(host, EMS_MIRROR_BATTERY.operatingModeTarget);
		const chargeReq = await readRelNumber(host, EMS_MIRROR_BATTERY.chargePowerWRequest);
		wantsCharge = intentActive && modeTarget === 1 && (chargeReq ?? 0) > 0;
		requestId = `bat-${(await readRelNumber(host, EMS_MIRROR_BATTERY.modeRequestId)) ?? 0}`;
		deviceIntent = {
			requestId,
			action: wantsCharge ? "charge" : "self_consumption",
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
		runtimeDecisionSource = wantsCharge ? "legacy_planner_fallback" : "safe_default";
		dailyPlanContext.legacyFallbackActive = !dailyPlanContext.useDailyPlan;
		dailyPlanContext.legacyFallbackSource = wantsCharge ? "ems_mirror" : "safe_default";
		dailyPlanContext.legacyFallbackReasonDe = dailyPlanContext.allocationReasonDe;
	}

	/*
	 * Befund 005: mode=off — keine neue Lade-Strategie.
	 * Nur wenn EMS-Ownership noch aktiv: einmalige Steuerungsübergabe (Restore).
	 */
	if (executionOff) {
		wantsCharge = false;
		if (runtime.ownership.active || ownershipLive) {
			runtimeDecisionSource = "restore";
			deviceIntent = {
				...deviceIntent,
				action: "self_consumption",
				maxChargeW: null,
				reason: "Add-on Aus — Ownership-Steuerungsübergabe an Self-Consumption",
			};
		} else {
			runtimeDecisionSource = "safe_default";
		}
	}

	if (runtime.faultCode !== null) runtimeDecisionSource = "fault";
	if (runtime.lockout) runtimeDecisionSource = "lockout";

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

	const emsMirrorIntentActive = await readRelBool(host, EMS_MIRROR_BATTERY.batteryIntentActive);
	const dailyPlanDriven = deviceIntent.source === "daily_plan";
	const dailyPlanAuthoritative = isBatteryDailyPlanAuthoritative(dailyPlanContext);
	const [
		batteryHoldActive,
		wallboxBatteryHold,
		priceNowCt,
		evccLoadpointMode,
		evccChargingFlag,
		evccChargePowerW,
		evccBatteryMode,
		evccDischargeControl,
		evccBatteryBoost,
		evccSmartCostActive,
		evAuthority,
		wallboxEnergySource,
		wallboxAllocatedGridW,
		globalModeRaw,
		addonModeRaw,
	] = await Promise.all([
		readRelBool(host, "planner.constraints.battery_hold_active"),
		readRelBool(host, WALLBOX_RUNTIME_STATES.batteryHoldForEvCharge),
		readRelNumber(host, "live.price.now_ct_per_kwh"),
		readRelString(host, WALLBOX_EVCC_STATES.loadpointMode),
		readRelBool(host, WALLBOX_EVCC_STATES.charging),
		readRelNumber(host, WALLBOX_EVCC_STATES.chargePowerW),
		readRelString(host, WALLBOX_EVCC_STATES.batteryMode),
		readRelBool(host, WALLBOX_EVCC_STATES.batteryDischargeControl),
		readRelBool(host, WALLBOX_EVCC_STATES.batteryBoost),
		readRelBool(host, WALLBOX_EVCC_STATES.smartCostActive),
		readRelString(host, WALLBOX_EV_FOUNDATION_STATES.evExecutionAuthority),
		readRelString(host, WALLBOX_RUNTIME_STATES.energySource),
		readRelNumber(host, WALLBOX_RUNTIME_STATES.allocatedGridPowerW),
		host.getStateAsync(GLOBAL.executionMode),
		host.getStateAsync(addonMode(BATTERY_ADDON_ID)),
	]);
	const globalLive = parseGlobalMode(globalModeRaw?.val) === "live";
	const addonLive = parseAddonMode(addonModeRaw?.val) === "live";
	const evccBatteryModeHold = (evccBatteryMode ?? "").toLowerCase() === "hold";
	const holdPlanned = deviceIntent.action === "hold";
	const holdActive = batteryHoldActive || wallboxBatteryHold || evccBatteryModeHold || evccDischargeControl;
	if (holdPlanned || holdActive || (evAuthority ?? "").toLowerCase() === "external") {
		wantsCharge = false;
	}
	const evConflict = classifyGridBalanceEvConflict({
		loadpointMode: evccLoadpointMode,
		charging: evccChargingFlag,
		chargePowerW: evccChargePowerW,
		wallboxHold: wallboxBatteryHold,
		batteryBoost: evccBatteryBoost,
		externalAuthority: (evAuthority ?? "").toLowerCase() === "external",
		tibberRewardsActive: evccSmartCostActive,
		wallboxEnergySource,
		wallboxAllocatedGridW,
	});
	const gridBalanceSuppressed =
		holdActive ||
		holdPlanned ||
		evConflict.conflict ||
		runtime.ownership.active ||
		dailyPlanAuthoritative;
	const emsBatteryIntentActive = Boolean(
		fromManual
			? wantsCharge
			: dailyPlanDriven
				? wantsCharge || (runtime.ownership.active && runtime.requestId?.startsWith("daily-plan"))
				: deviceIntent.source === "winter_planner"
					? wantsCharge || runtime.ownership.active
					: emsMirrorIntentActive && wantsCharge,
	);

	// Grid balance controller — Admin-Schalter ist die einzige Feature-Freigabe.
	const adapterFeature = snapshot.capabilities.control_grid_balance.available;
	await setStateIfChanged(host, EMS_MIRROR_BATTERY.gridBalanceEnabled, config.gridBalance.enabled);
	const controller = resolveController({
		emsBatteryIntentActive,
		emsGridBalanceEnabled: config.gridBalance.enabled,
		adapterFeatureEnabled: adapterFeature,
		batteryAddonEnabled: governanceEnabled,
		gridBalancePaused: gridBalancePausedByFsm || runtime.ownership.active,
		gridBalanceSuppressed,
	});

	/*
	 * Leave-Live / LIVE→OFF: Restore nur wenn EMS zuvor real Ownership hatte (`ownershipLive`).
	 * Dryrun-Ownership allein darf nie safetyOverride öffnen (sonst Dryrun→echte Writes).
	 */
	const safetyOverride = ownershipLive && !liveWriteAllowed;
	const effectiveLive = liveWriteAllowed || safetyOverride;
	if (executionOff && safetyOverride) {
		host.log.info("battery: Add-on Aus — einmalige Ownership-Steuerungsübergabe (Restore)");
	}

	const targetSocReached =
		deviceIntent.targetSocPct != null &&
		snapshot.telemetry.socPct != null &&
		snapshot.telemetry.socPct >= deviceIntent.targetSocPct;

	// Hardware-Sicherheitsdecke unabhängig vom Intent-Ziel: nie über den konfigurierten
	// HW-Max-SOC hinaus laden, auch wenn der Intent kein (oder ein höheres) Ziel setzt.
	const safetyBlocked =
		runtime.ownership.active &&
		snapshot.limits.maxSocPct != null &&
		snapshot.telemetry.socPct != null &&
		snapshot.telemetry.socPct >= snapshot.limits.maxSocPct;

	const stopReasonRaw = evaluateStopCondition({
		targetSocReached,
		intentExpired:
			deviceIntent.validUntil != null && Date.parse(deviceIntent.validUntil) <= nowMs,
		intentRevoked: runtime.ownership.active && !wantsCharge,
		addonDisabled: !governanceEnabled,
		globalLeftLive: ownershipLive && !liveWriteAllowed,
		safetyBlocked,
		telemetryStale: runtime.ownership.active && snapshot.telemetry.stale,
		communicationLost: runtime.ownership.active && online === false,
		fault: runtime.faultCode !== null,
		unloading: false,
		higherPriorityIntent: false,
	});
	const setpointHandover = resolveBatterySetpointHandover({
		hold: holdPlanned || holdActive,
		external: (evAuthority ?? "").toLowerCase() === "external",
		restoreOrFault: isRestoreInProgress(),
		higherPriority: false,
	});
	const sessionNow = getBatterySetpointSession();
	const fsmOwnsSetpoint =
		sessionNow.wrotePositive &&
		(sessionNow.owner === "grid_charge" || sessionNow.owner === "planned_charge");
	let stopReason = stopReasonRaw;
	let stopDisposition: "release_zero" | "drop_ownership" | undefined;
	const inChargeSequence =
		runtime.state !== "idle" &&
		runtime.state !== "completed" &&
		runtime.state !== "rejected" &&
		runtime.state !== "lockout" &&
		runtime.state !== "fault";
	if (
		setpointHandover !== "none" &&
		(runtime.ownership.active || fsmOwnsSetpoint || inChargeSequence)
	) {
		stopDisposition = "drop_ownership";
		if (!stopReason) stopReason = `authority_${setpointHandover}`;
	} else if (stopReason) {
		stopDisposition = "release_zero";
	}
	const forceZeroSetpointWrite =
		stopDisposition === "release_zero" && fsmOwnsSetpoint && sessionNow.setpointW > 0;
	if (forceZeroSetpointWrite) {
		setBatterySetpointSession(markReleasePending(getBatterySetpointSession(), stopReason ?? "regular_end"));
	}

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
		stopDisposition,
		forceZeroSetpointWrite: stopDisposition === "release_zero" ? forceZeroSetpointWrite : undefined,
	};

	const fsmStateBefore = runtime.state;
	const step = profile.supportsLive ? stepSonnenFsm(runtime, ctx) : { runtime, writes: [], gridBalance: null, log: null, transitioned: false };
	runtime = step.runtime;

	if (step.gridBalance === "pause") gridBalancePausedByFsm = true;
	if (step.gridBalance === "restore") gridBalancePausedByFsm = false;
	if (step.log) host.log[step.log.level](step.log.msg);

	// Apply FSM writes through the single central write function.
	// Sicherheits-/Restore-Writes (stop_charge…restore_grid_balance) müssen auch bei
	// aktivem Fault/Lockout durchkommen — sonst bleibt die Batterie im unsicheren
	// Zustand hängen, weil genau diese Writes den Fault erst kontrolliert beenden.
	const safetyWrite = isBatterySafetyWriteState(runtime.state) && runtime.ownership.active;
	const foreignOwnershipConflict = isForeignManualControl({
		currentMode: modeRead.val,
		manualModeValue: config.sonnenModeValues.manual,
		ownership: runtime.ownership,
	});
	const gate: FinalWriteGate = {
		globalLive: effectiveLive,
		governanceEnabled,
		profileId: config.profile,
		profileLiveControlAvailable: snapshot.capabilities.live_control.available,
		profileReady: snapshot.readiness.liveReady,
		intentValid: intentValid || safetyOverride || safetyWrite,
		telemetryReady: snapshot.readiness.telemetryReady,
		fault: runtime.faultCode !== null && !safetyWrite,
		lockout: runtime.lockout && !safetyWrite,
		targetMappingConfigured: true,
		ownershipValid: !foreignOwnershipConflict,
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
			numericTolerance: w.kind === "charge_power" ? config.feedbackTolerance.absoluteW : 0,
			gate: { ...gate, targetMappingConfigured: stateId.length > 0 },
		});
		lastWrite = { state: stateId, value: w.value, success: result.executed, expected: result.expectedFeedback };
		if (result.executed && w.kind === "operating_mode" && w.value === config.sonnenModeValues.manual) {
			ownershipLive = true;
		}
		if (w.kind === "charge_power") {
			const accepted = result.executed || result.written || result.simulated;
			const owner =
				setpointOwnerFromAction(runtime.action) === "none"
					? "planned_charge"
					: setpointOwnerFromAction(runtime.action);
			if (accepted && w.value > 0) {
				setBatterySetpointSession(
					notePositiveSetpointWrite(
						getBatterySetpointSession(),
						owner,
						w.value,
						Boolean(result.executed || result.written),
					),
				);
			}
			if (accepted && w.value === 0) {
				setBatterySetpointSession(
					applyZeroRelease(
						getBatterySetpointSession(),
						new Date(nowMs).toISOString(),
						stopReason ?? "regular_end",
					),
				);
			}
		}
	}
	if (
		fsmStateBefore === "set_charge_power" &&
		runtime.state === "active" &&
		runtime.effectivePowerW > 0 &&
		!step.writes.some((w) => w.kind === "charge_power" && w.value > 0)
	) {
		const owner =
			setpointOwnerFromAction(runtime.action) === "none"
				? "planned_charge"
				: setpointOwnerFromAction(runtime.action);
		setBatterySetpointSession(
			notePositiveSetpointWrite(getBatterySetpointSession(), owner, runtime.effectivePowerW, effectiveLive),
		);
	}
	if (stopDisposition === "drop_ownership" && getBatterySetpointSession().owner !== "none") {
		setBatterySetpointSession(applyHandover(getBatterySetpointSession(), `handover_${setpointHandover}`));
	}
	if (!runtime.ownership.active) {
		ownershipLive = false;
	}

	// Grid balance: safety + EV-Abzug + Deadband; Writes nur One-Shot oder EXECUTION-Flag.
	const consumption = (await readMappedNumber(host, table, "consumption_w")).val ?? 0;
	const pv = (await readMappedNumber(host, table, "pv_ac_power_w")).val ?? 0;
	const evPower = await readRelNumberTs(host, WALLBOX_EVCC_STATES.chargePowerW, nowMs);
	const armedSt = await host.getStateAsync(BAT.gridBalance.liveTestArmed);
	gridBalanceLiveTest = applyGridBalanceLiveTestPulse(
		gridBalanceLiveTest,
		armedSt?.val,
		armedSt?.ack,
		nowMs,
	);
	if (armedSt?.ack === false) {
		await host.setStateAsync(BAT.gridBalance.liveTestArmed, {
			val: gridBalanceLiveTest.armed,
			ack: true,
		});
	}

	const capacityWh = (snapshot.capacity.effectiveKwh ?? 0) * 1000;
	const restKwh = (await readRelNumber(host, EMS_MIRROR_BATTERY.effectivePvRestOfDayKwh)) ?? 0;
	const snow = await readRelBool(host, EMS_MIRROR_BATTERY.snowCoverSuspected);
	const priceSlots =
		config.gridBalance.priceGateEnabled && config.gridBalance.priceMedianFactor > 0
			? await readTibber15MinPriceSlots(
					{ ...host, config: host.config, getForeignStateAsync: (id) => host.getForeignStateAsync(id) },
					new Date(nowMs),
				)
			: [];
	const offset =
		snapshot.telemetry.socPct != null && snapshot.telemetry.socPct > config.gridBalance.socThresholdPct
			? config.gridBalance.offsetHighSocW
			: config.gridBalance.offsetLowSocW;
	const forecastProbe = computeGridBalanceTarget({
		effectiveRestOfDayKwh: restKwh,
		capacityWh,
		snowCoverSuspected: snow,
		consumptionW: consumption,
		adjustedConsumptionW: consumption,
		pvAcPowerW: pv,
		socPct: snapshot.telemetry.socPct,
		emsGridBalanceEnabled: config.gridBalance.enabled,
		adapterFeatureEnabled: adapterFeature,
		controller: "grid_balance",
		offsetHighSocW: config.gridBalance.offsetHighSocW,
		offsetLowSocW: config.gridBalance.offsetLowSocW,
		socThresholdPct: config.gridBalance.socThresholdPct,
		evccCharging: false,
		batteryHoldActive: false,
		winterGridPlanActive: false,
		mode1Active: false,
		dailyPlanAuthoritative: false,
		priceNowCt,
		priceMedianCt: medianCtFromPriceSlots(priceSlots),
		priceGate: { enabled: false, maxPriceCtPerKwh: null, medianFactor: 0 },
	});
	let forecastBlockReason = "";
	if (forecastProbe.checksFailed.includes("snow_cover_suspected")) forecastBlockReason = "snow_cover_suspected";
	else if (forecastProbe.checksFailed.includes("capacity_missing")) forecastBlockReason = "capacity_missing";
	else if (forecastProbe.checksFailed.includes("pv_forecast_below_capacity")) {
		forecastBlockReason = "pv_forecast_below_capacity";
	}

	const safetyInput: GridBalanceSafetyInput = {
		adminEnabled: config.gridBalance.enabled,
		emsMirrorEnabled: config.gridBalance.enabled,
		globalLive,
		addonLive,
		addonEnabled: !executionOff,
		governanceEnabled,
		faultActive: runtime.faultCode !== null,
		lockoutActive: runtime.lockout,
		restoreInProgress: isRestoreInProgress(),
		sourceStale: snapshot.telemetry.stale,
		sourceOffline: online === false,
		holdPlanned,
		holdActive,
		evccBatteryModeHold,
		plannedBatteryAction: emsBatteryIntentActive,
		ownershipActive: runtime.ownership.active,
		dailyPlanAuthoritative,
		mode1Active: runtime.ownership.active,
		priceNowCt,
		priceLimitCt: config.gridBalance.maxPriceCtPerKwh,
		priceGateEnabled: config.gridBalance.priceGateEnabled,
		evConflictKind: evConflict.kind,
		externalEvAuthority: (evAuthority ?? "").toLowerCase() === "external",
	};
	const gbSession = getBatterySetpointSession();
	const leavingLiveWithOwnership =
		gridBalanceOwnsSetpoint &&
		gbSession.owner === "grid_balance" &&
		gbSession.wroteLive &&
		!liveWriteAllowed;
	const gbDecision = evaluateGridBalanceTick({
		nowMs,
		safety: safetyInput,
		consumptionW: consumption,
		pvAcPowerW: pv,
		charging: evccChargingFlag,
		chargePowerW: evPower.val ?? evccChargePowerW,
		chargePowerAgeMs: evPower.ageMs,
		deadbandW: config.gridBalance.deadbandW,
		minDurationMs: config.gridBalance.minDurationSec * 1000,
		offsetW: offset,
		configuredMaxW: config.gridBalance.maxTargetW,
		hardwareMaxChargeW: snapshot.limits.maxChargeW,
		hardwareMaxDischargeW: snapshot.limits.maxDischargeW,
		minChangeW: config.gridBalance.minChangeW,
		lastWrittenW: lastGridBalanceWriteW,
		ownsSetpoint: gridBalanceOwnsSetpoint,
		stabilization: gridBalanceStabilization,
		liveTest: gridBalanceLiveTest,
		controllerIsGridBalance: controller === "grid_balance" && !gridBalancePausedByFsm && !executionOff,
		forecastBlockReason,
		leavingLiveWithOwnership,
	});
	gridBalanceStabilization = gbDecision.stabilizationNext;
	gridBalanceLiveTest = gbDecision.liveTestNext;

	const gbState = table.set_charge_power.targetState;
	let gbWouldWrite = false;
	let gbEffective = gbDecision.effectivePowerW;
	if ((gbDecision.shouldWrite || gbDecision.shouldRelease) && gbState.length > 0) {
		if (gbDecision.shouldRelease && getBatterySetpointSession().owner === "grid_balance") {
			setBatterySetpointSession(
				markReleasePending(getBatterySetpointSession(), "grid_balance_idle"),
			);
		}
		const gbReleaseLive = gbDecision.shouldRelease && getBatterySetpointSession().wroteLive;
		const gbWriteLive = liveWriteAllowed || gbReleaseLive;
		const wr = await executeBatteryWrite(host as unknown as BatteryWriteHost, {
			kind: "charge_power",
			stateId: gbState,
			value: gbDecision.writePowerW,
			requestId: "grid_balance",
			reason: gbDecision.shouldRelease ? "grid_balance_release" : "grid_balance",
			expectedFeedback: gbDecision.writePowerW,
			dryrun: !gbWriteLive,
			gate: {
				...gate,
				globalLive: gbWriteLive,
				intentValid: true,
				fault: false,
				lockout: false,
				targetMappingConfigured: true,
			},
		});
		if (wr.executed || wr.written || wr.simulated) {
			gbWouldWrite = gbDecision.shouldWrite;
			lastGridBalanceWriteW = gbDecision.shouldRelease ? null : gbDecision.writePowerW;
			gbEffective = gbDecision.shouldRelease ? 0 : gbDecision.writePowerW;
			if (gbDecision.shouldWrite) {
				gridBalanceOwnsSetpoint = true;
				setBatterySetpointSession(
					notePositiveSetpointWrite(
						getBatterySetpointSession(),
						"grid_balance",
						gbDecision.writePowerW,
						Boolean(wr.executed || wr.written),
					),
				);
				if (!GRID_BALANCE_EXECUTION_ENABLED) {
					gridBalanceLiveTest = consumeGridBalanceLiveTest(gridBalanceLiveTest, nowMs);
				}
			}
			if (gbDecision.shouldRelease) {
				gridBalanceOwnsSetpoint = false;
				setBatterySetpointSession(
					applyZeroRelease(
						getBatterySetpointSession(),
						new Date(nowMs).toISOString(),
						"grid_balance_idle",
					),
				);
			}
		} else if (gbDecision.shouldWrite) {
			gridBalanceOwnsSetpoint = false;
		} else if (gbDecision.shouldRelease) {
			gridBalanceOwnsSetpoint = true;
		}
	} else if (gbDecision.shouldWrite || gbDecision.shouldRelease) {
		lastGridBalanceWriteW = null;
	} else {
		gridBalanceOwnsSetpoint = gbDecision.ownsSetpointNext;
		if (!gbDecision.ownsSetpointNext && getBatterySetpointSession().owner === "grid_balance") {
			const gbHandover = resolveBatterySetpointHandover({
				hold: gbDecision.holdDetected,
				external: gbDecision.authority === "external_ev",
				restoreOrFault:
					gbDecision.authority === "safety" &&
					(safetyInput.restoreInProgress || safetyInput.faultActive || safetyInput.lockoutActive),
				higherPriority: gbDecision.authority === "planned_battery",
			});
			const reason = gbHandover === "none" ? "grid_balance_drop" : `handover_${gbHandover}`;
			setBatterySetpointSession(applyHandover(getBatterySetpointSession(), reason));
		}
	}

	const isoNow = new Date(nowMs).toISOString();
	lastGridBalanceAction = gbDecision.lastAction;
	lastGridBalanceActionAt = isoNow;
	const gbSafety: GridBalanceSafetyResult = {
		...gbDecision.safety,
		ready: gbDecision.ready,
		active: gbDecision.active,
		blockReason: gbDecision.blockReason,
		explain: gbDecision.explain,
	};

	await persist(host, snapshot, {
		nowMs,
		globalLive: liveWriteAllowed,
		governanceEnabled,
		controller,
		lastWrite,
		gb: {
			wouldWrite: gbWouldWrite,
			target: gbDecision.requestedPowerW,
			state: gbState,
			effective: gbEffective,
			importW: gbDecision.rawGridDeltaW,
			safety: gbSafety,
			decision: gbDecision,
		},
		clamps: validation.clamps,
		requestedPowerW: deviceIntent.maxChargeW ?? 0,
		effectiveChargeW,
		action: deviceIntent.action,
		actualMode: modeRead.val,
		actualChargingW: snapshot.telemetry.chargingPowerW,
		dailyPlan: dailyPlanContext,
		decisionSource: runtimeDecisionSource,
		priceNowCt,
		priceLimitCt: config.gridBalance.maxPriceCtPerKwh,
	});
}

interface PersistExtra {
	nowMs: number;
	globalLive: boolean;
	governanceEnabled: boolean;
	controller: string;
	lastWrite: { state: string; value: number; success: boolean; expected: number | null } | null;
	gb: {
		wouldWrite: boolean;
		target: number;
		state: string;
		effective: number;
		importW: number;
		safety: GridBalanceSafetyResult;
		decision: GridBalanceTickDecision;
	};
	clamps: Array<{ field: string; from: number; to: number; reason: string }>;
	requestedPowerW: number;
	effectiveChargeW: number;
	action: BatteryAction;
	actualMode: number | null;
	actualChargingW: number | null;
	dailyPlan: BatteryDailyPlanRuntimeContext;
	decisionSource: BatteryDecisionSource;
	priceNowCt: number | null;
	priceLimitCt: number;
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
	const sp = getBatterySetpointSession();
	await set(BAT.runtime.batterySetpointOwner, sp.owner);
	await set(BAT.runtime.batterySetpointW, sp.setpointW);
	await set(BAT.runtime.batteryReleasePending, sp.releasePending);
	await set(BAT.runtime.batteryReleaseReason, sp.releaseReason);
	await set(BAT.runtime.batteryLastReleaseAt, sp.lastReleaseAt ?? "");

	const dp = x.dailyPlan;
	await setStateIfChanged(host, BAT.runtime.decisionSource, x.decisionSource);
	await setStateIfChanged(host, BAT.runtime.reasonDe, dp.allocationReasonDe || "");
	await setStateIfChanged(host, BAT.runtime.dailyPlanStatus, dp.dailyPlanStatus);
	await setStateIfChanged(host, BAT.runtime.dailyPlanAuthoritative, dp.dailyPlanAuthoritative);
	await setStateIfChanged(host, BAT.runtime.dailyPlanValid, dp.useDailyPlan);
	await setStateIfChanged(host, BAT.runtime.dailyPlanRevision, dp.dailyPlanRevision ?? 0);
	await setStateIfChanged(host, BAT.runtime.dailyPlanSlotStart, dp.slotStartIso ?? "");
	await setStateIfChanged(host, BAT.runtime.dailyPlanSlotEnd, dp.slotEndIso ?? "");
	await setStateIfChanged(host, BAT.runtime.allocationStatus, dp.allocationStatus);
	await setStateIfChanged(host, BAT.runtime.allocatedChargePowerW, dp.allocatedChargePowerW ?? null);
	await setStateIfChanged(host, BAT.runtime.allocatedEnergyKwh, dp.allocatedEnergyKwh ?? null);
	await setStateIfChanged(host, BAT.runtime.allocatedPvPowerW, dp.pvPowerW ?? null);
	await setStateIfChanged(host, BAT.runtime.allocatedGridPowerW, dp.gridPowerW ?? null);
	await setStateIfChanged(host, BAT.runtime.energySource, dp.energySource);
	await setStateIfChanged(host, BAT.runtime.estimatedCostCt, dp.estimatedCostCt ?? null);
	await setStateIfChanged(host, BAT.runtime.requestedChargePowerW, dp.requestedChargePowerW ?? null);
	await setStateIfChanged(host, BAT.runtime.effectiveChargePowerW, dp.effectiveChargePowerW ?? null);
	await setStateIfChanged(host, BAT.runtime.chargePowerCapped, dp.chargePowerCapped);
	await setStateIfChanged(host, BAT.runtime.topOffActive, dp.topOffActive);
	await setStateIfChanged(host, BAT.runtime.legacyFallbackActive, dp.legacyFallbackActive);
	await setStateIfChanged(host, BAT.runtime.legacyFallbackSource, dp.legacyFallbackSource);
	await setStateIfChanged(host, BAT.runtime.legacyFallbackReasonDe, dp.legacyFallbackReasonDe);
	await setStateIfChanged(host, BAT.runtime.dailyPlanBlocksGridBalance, dp.dailyPlanBlocksGridBalance);
	await setStateIfChanged(host, BAT.runtime.runtimeControlAvailable, dp.runtimeControlAvailable);

	const fault = runtime.faultCode !== null;
	const lockout = runtime.lockout === true;
	let intentStatus: IntentStatus = "idle";
	if (fault || lockout || x.decisionSource === "safety") {
		intentStatus = "blocked";
	} else if (isChargingAction(x.action) || (x.requestedPowerW ?? 0) > 0) {
		intentStatus = "active";
	} else if (x.decisionSource === "addon_disabled" || x.decisionSource === "governance_disabled") {
		intentStatus = "none";
	}
	let executionStatus: ExecutionStatus = x.globalLive ? "live" : "dryrun";
	if (fault) {
		executionStatus = "fault";
	} else if (lockout) {
		executionStatus = "lockout";
	}
	await publishAddonRuntimeSurface(host, "battery", {
		decisionDetail: x.decisionSource,
		decisionReason: dp.allocationReasonDe || s.readiness.reason || "",
		nowIso: iso,
		plannerStatus: plannerStatusFromDailyPlan({
			governanceEnabled: x.governanceEnabled,
			useDailyPlan: dp.useDailyPlan,
			dailyPlanValid: dp.useDailyPlan,
			dailyPlanStatus: dp.dailyPlanStatus,
		}),
		intentStatus,
		executionStatus,
		profileReady: s.readiness.dryrunReady || s.readiness.liveReady || s.readiness.controlReady,
		telemetryReady: s.readiness.telemetryReady,
		fault,
		lockout,
	});

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

	const d = x.gb.decision;
	await setStateIfChanged(host, BAT.gridBalance.enabled, d.enabled);
	await setStateIfChanged(host, BAT.gridBalance.active, d.active);
	await setStateIfChanged(host, BAT.gridBalance.ready, d.ready);
	await setStateIfChanged(host, BAT.gridBalance.blockReason, d.blockReason);
	await setStateIfChanged(host, BAT.gridBalance.currentPriceCtKwh, x.priceNowCt);
	await setStateIfChanged(host, BAT.gridBalance.priceLimitCtKwh, x.priceLimitCt);
	await setStateIfChanged(host, BAT.gridBalance.priceAllowed, d.priceAllowed);
	await setStateIfChanged(host, BAT.gridBalance.gridPowerW, d.rawGridDeltaW);
	await setStateIfChanged(host, BAT.gridBalance.rawConsumptionW, d.rawConsumptionW);
	await setStateIfChanged(host, BAT.gridBalance.evChargePowerW, d.evChargePowerW);
	await setStateIfChanged(host, BAT.gridBalance.adjustedConsumptionW, d.adjustedConsumptionW);
	await setStateIfChanged(host, BAT.gridBalance.pvPowerW, d.pvPowerW);
	await setStateIfChanged(host, BAT.gridBalance.rawGridDeltaW, d.rawGridDeltaW);
	await setStateIfChanged(host, BAT.gridBalance.deadbandW, d.deadbandW);
	await setStateIfChanged(host, BAT.gridBalance.requestedPowerW, d.requestedPowerW);
	await setStateIfChanged(host, BAT.gridBalance.configuredMaxW, d.configuredMaxW);
	await setStateIfChanged(host, BAT.gridBalance.hardwareMaxW, d.hardwareMaxW);
	await setStateIfChanged(host, BAT.gridBalance.effectiveMaxW, d.effectiveMaxW);
	await setStateIfChanged(host, BAT.gridBalance.effectivePowerW, d.effectivePowerW);
	await setStateIfChanged(host, BAT.gridBalance.authority, d.authority);
	await setStateIfChanged(host, BAT.gridBalance.holdDetected, d.holdDetected);
	await setStateIfChanged(host, BAT.gridBalance.evConflict, d.evConflict);
	await setStateIfChanged(host, BAT.gridBalance.ownership, d.ownership);
	await setStateIfChanged(host, BAT.gridBalance.lastAction, lastGridBalanceAction);
	await setStateIfChanged(host, BAT.gridBalance.lastActionAt, lastGridBalanceActionAt);
	await setStateIfChanged(host, BAT.gridBalance.explain, d.explain);
	await setStateIfChanged(host, BAT.gridBalance.liveTestArmed, gridBalanceLiveTest.armed);
	await setStateIfChanged(
		host,
		BAT.gridBalance.liveTestArmedAt,
		gridBalanceLiveTest.armedAtMs != null ? new Date(gridBalanceLiveTest.armedAtMs).toISOString() : "",
	);
	await setStateIfChanged(host, BAT.gridBalance.liveTestResult, gridBalanceLiveTest.result);
	await setStateIfChanged(host, BAT.gridBalance.mirrorFollowsAdmin, true);
}

/** Adapter-Unload: best-effort Safe Restore nur bei aktiver Live-Ownership. */
export async function batteryUnloadRestore(host: Host): Promise<void> {
	const session = getBatterySetpointSession();
	const fsmLive = runtime.ownership.active && ownershipLive;
	const setpointLive = session.wroteLive && session.owner !== "none";
	if (!fsmLive && !setpointLive) {
		return;
	}
	const config = batteryConfigFromAdapter(host.config);
	const table = batteryMappingFromConfig(host.config);
	// Unload-Restore ist selbst der Safety-Write-Pfad (Gegenstück zu safetyWrite im Tick) —
	// Fault/Lockout darf ihn nicht blockieren, sonst bleibt die Batterie beim Adapter-Stop
	// im unsicheren Zustand hängen. Ownership ist durch die Precondition oben bereits belegt.
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
		ownershipValid: runtime.ownership.active || setpointLive,
	};
	try {
		if (setpointLive || fsmLive) {
			await executeBatteryWrite(host as unknown as BatteryWriteHost, {
				kind: "charge_power",
				stateId: table.set_charge_power.targetState,
				value: 0,
				requestId: "unload",
				reason: "unload_stop",
				dryrun: false,
				gate,
			});
			setBatterySetpointSession(applyZeroRelease(session, new Date().toISOString(), "unload_stop"));
		}
		if (fsmLive) {
			await executeBatteryWrite(host as unknown as BatteryWriteHost, {
				kind: "operating_mode",
				stateId: table.set_operating_mode.targetState,
				value: config.sonnenModeValues.selfConsumption,
				requestId: "unload",
				reason: "unload_restore",
				dryrun: false,
				gate,
			});
		}
	} catch (e) {
		host.log.warn(`battery unload restore best-effort failed: ${String(e)}`);
	}
}

