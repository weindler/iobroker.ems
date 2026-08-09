import {
	configuredEvccTelemetryStateIds,
	configuredWallboxHoldSignalStateIds,
	wallboxEvccTelemetryConfigFromAdapter,
	wallboxHoldSignalConfigFromAdapter,
} from "./evcc_config";
import { ensureWallboxEvccStates, WALLBOX_EVCC_STATES } from "./ensure_evcc_states";
import { readEvccTelemetrySnapshot, type EvccTelemetryReadHost, type EvccTelemetrySnapshot } from "./evcc_telemetry";
import { normalizeOptionalBool, type TelemetryField } from "./normalize";
import { resolveWallboxBatteryHold } from "./charge_hold";
import { setStateIfChanged } from "../../policy/core/state_write";
import { isAddonGovernanceEnabledFromState, addonGovernanceEnabledState } from "../governance";
import {
	plannerStatusFromDailyPlan,
	publishAddonRuntimeSurface,
	type ExecutionStatus,
	type IntentStatus,
} from "../runtime_surface";
import { isAddonExecutionOff, isLiveWriteAllowed } from "../../execution_mode";
import { addonEnabled, GLOBAL, addonMode } from "../../tree_paths";
import {
	ALLOCATION_ADDON_STATE_IDS,
	DAILY_PLAN_STATE_IDS,
} from "../../operator/daily_plan/states";
import {
	buildWallboxDispatchIntent,
	ensureWallboxRuntimeStates,
	publishWallboxDispatchStates,
	publishWallboxLiveFoundationStates,
	publishWallboxRuntimeStates,
	publishWallboxSafetyStates,
	resetWallboxDailyPlanCache,
	resetWallboxDispatchCache,
	resolveWallboxDailyPlanDecision,
	runWallboxDryrunDispatch,
	runWallboxLiveFoundation,
	buildWallboxControlMappingSnapshot,
	collectConfiguredControlTargetStateIds,
	telemetryInputFromSnapshot,
	emptyWallboxOwnership,
	grantWallboxOwnership,
	emptyWallboxFault,
	raiseWallboxFault,
	faultCodeForFeedbackStatus,
	planWallboxSafeRestore,
	tickWallboxFeedback,
	isWallboxFeedbackStatusTerminal,
	type WallboxOwnershipState,
	type WallboxFaultState,
} from "./runtime";
import type { WallboxFeedbackContract } from "./runtime/feedback";
import type { WallboxLiveFoundationResult } from "./runtime/execute";
import { writeForeignIfChanged } from "../../device_write";
import { WALLBOX_RUNTIME_STATES } from "./runtime/states";
import { intentEvccConfigFromAdapter } from "../../intent/config";
import { evccModeChargeValue } from "./evcc_control_config";
import { resolveWallboxControlObjectMetas } from "./runtime/control_object_meta";
type WallboxHost = EvccTelemetryReadHost &
	ioBroker.Adapter & {
		subscribeForeignStatesAsync?: (id: string) => Promise<void>;
		unsubscribeForeignStatesAsync?: (id: string) => Promise<void>;
	};

let activeHost: WallboxHost | null = null;
const subscribedIds: string[] = [];
let debounceTimer: ReturnType<typeof setTimeout> | null = null;
let periodicTimer: ReturnType<typeof setInterval> | null = null;

/** EMS-Ownership über die aktive EVCC-Steuerung — Safe-Restore-Pflicht bis geklärt. */
let wallboxOwnership: WallboxOwnershipState = emptyWallboxOwnership();
/** Fault/Lockout aus Write-Fehlern oder Feedback-Mismatch/Timeout — sperrt weitere Live-Writes. */
let wallboxFault: WallboxFaultState = emptyWallboxFault();
/** Feedback-Contract eines zuletzt ausgeführten Writes, wartet auf Rücklese-Bestätigung. */
let pendingWallboxFeedback: { contract: WallboxFeedbackContract; writeTimestampMs: number } | null = null;

const DEBOUNCE_MS = 300;
/** Deterministischer Sicherheits-Tick (Feedback-Timeout/Safe-Restore) unabhängig von EVCC-Telemetrie-Events. */
const SAFETY_TICK_MS = 10_000;

async function writeField(
	host: WallboxHost,
	stateId: string,
	field: TelemetryField<boolean | number | string>,
): Promise<void> {
	if (field.status === "missing" || field.value === null) {
		return;
	}
	const val = field.value;
	await host.setStateAsync(stateId, { val, ack: true });
}

/**
 * Spiegelt einen Planzeit-Feld in einen String-State (role: date).
 * Anders als writeField wird der State bei null/ungültig ausdrücklich auf ""
 * gesetzt, damit kein alter EVCC-Deadline-Zeitstempel stale stehen bleibt.
 */
async function writeTimeField(
	host: WallboxHost,
	stateId: string,
	field: TelemetryField<string>,
): Promise<void> {
	const val = field.status === "valid" && typeof field.value === "string" ? field.value : "";
	await host.setStateAsync(stateId, { val, ack: true });
}

const WALLBOX_ADDON_ID = "wallbox";

async function resolveChargeModeActive(
	host: WallboxHost,
	config: Record<string, unknown>,
): Promise<boolean | null> {
	const chargeValue = evccModeChargeValue(config);
	const intentCfg = intentEvccConfigFromAdapter(config);
	if (!chargeValue || !intentCfg.modeStateId) return null;
	try {
		const read =
			typeof host.getForeignStateAsync === "function"
				? host.getForeignStateAsync.bind(host)
				: host.getStateAsync.bind(host);
		const st = await read(intentCfg.modeStateId);
		if (st?.val === undefined || st.val === null) return null;
		return String(st.val) === chargeValue;
	} catch {
		return null;
	}
}

async function refreshWallboxDailyPlanRuntime(host: WallboxHost, snap: Awaited<ReturnType<typeof readEvccTelemetrySnapshot>>): Promise<void> {
	const cfg = wallboxEvccTelemetryConfigFromAdapter(host.config);
	const addonOn = await host.getStateAsync(addonEnabled(WALLBOX_ADDON_ID));
	const addonEnabledVal = addonOn?.val !== false;
	const governanceEnabled = await isAddonGovernanceEnabledFromState(
		(id) => host.getStateAsync(id),
		WALLBOX_ADDON_ID,
	);
	const now = new Date();
	const decision = await resolveWallboxDailyPlanDecision(host, snap, cfg, now, {
		governanceEnabled,
		addonEnabled: addonEnabledVal,
	});
	await publishWallboxRuntimeStates(host, decision, governanceEnabled);

	const telemetry = telemetryInputFromSnapshot(snap, cfg);
	const phases = telemetry.activePhases ?? telemetry.configuredPhases;
	const intent = buildWallboxDispatchIntent({
		decision,
		governanceEnabled,
		addonEnabled: addonEnabledVal,
		phases,
		now,
	});
	const chargingEnabled =
		snap.enabled.status === "valid" && typeof snap.enabled.value === "boolean" ? snap.enabled.value : null;
	const dispatch = runWallboxDryrunDispatch({
		intent,
		decision,
		telemetry,
		config: host.config,
		chargingEnabled,
		governanceEnabled,
	});
	await publishWallboxDispatchStates(host, decision, dispatch);

	const liveRequested = await isLiveWriteAllowed((id) => host.getStateAsync(id), WALLBOX_ADDON_ID);
	const modeSt = await host.getStateAsync(addonMode(WALLBOX_ADDON_ID));
	const addonExecutionOff = isAddonExecutionOff(modeSt?.val);
	const configRecord =
		host.config && typeof host.config === "object" ? (host.config as Record<string, unknown>) : {};
	const intentCfg = intentEvccConfigFromAdapter(configRecord);
	const targetStateIds = collectConfiguredControlTargetStateIds(configRecord);
	const objectMetas = await resolveWallboxControlObjectMetas(
		typeof host.getObjectAsync === "function" ? host.getObjectAsync.bind(host) : undefined,
		targetStateIds,
	);
	const mappingSnapshot = buildWallboxControlMappingSnapshot({
		config: configRecord,
		telemetryCfg: {
			enabledStateId: cfg.enabledStateId,
			maxCurrentAStateId: cfg.maxCurrentAStateId,
			modeReadbackStateId: intentCfg.modeStateId,
		},
		objectMetas,
	});
	const chargeModeActive = await resolveChargeModeActive(host, configRecord);
	const foundation = await runWallboxLiveFoundation(host, {
		dispatch,
		decision,
		mappingSnapshot,
		chargingEnabled,
		chargeModeActive,
		config: configRecord,
		addonEnabled: addonEnabledVal,
		governanceEnabled,
		liveRequested,
		addonExecutionOff,
		now,
		faultActive: wallboxFault.active,
	});
	await publishWallboxLiveFoundationStates(host, foundation);
	await runWallboxSafetyTick(host, foundation, now);
	await publishWallboxSafetyStates(host, wallboxOwnership, wallboxFault);

	const plannerStatus = plannerStatusFromDailyPlan({
		governanceEnabled,
		addonEnabled: addonEnabledVal,
		dailyPlanValid: decision.planValid,
		dailyPlanStatus: decision.dailyPlanStatus,
	});
	let intentStatus: IntentStatus = "idle";
	if (
		decision.decisionSource === "mapping_incomplete" ||
		decision.decisionSource === "missing_telemetry" ||
		wallboxFault.active
	) {
		intentStatus = "blocked";
	} else if ((decision.allocatedPowerW ?? 0) > 0 || decision.chargingAllowedByPlan) {
		intentStatus = "active";
	} else if (!decision.connected) {
		intentStatus = "none";
	}
	let executionStatus: ExecutionStatus = "idle";
	if (wallboxFault.active) {
		executionStatus = "fault";
	} else if (foundation.phase === "live" && foundation.writeAllowed) {
		executionStatus = "live";
	} else if (foundation.phase === "dryrun" || !liveRequested) {
		executionStatus = "dryrun";
	} else if (!foundation.writeAllowed) {
		executionStatus = "blocked";
	}
	await publishAddonRuntimeSurface(host, WALLBOX_ADDON_ID, {
		decisionDetail: decision.decisionSource,
		decisionReason: decision.reasonDe,
		nowIso: now.toISOString(),
		plannerStatus,
		intentStatus,
		executionStatus,
		profileReady: foundation.mappingSnapshot.validationIssues.length === 0,
		telemetryReady: decision.decisionSource !== "missing_telemetry",
		fault: wallboxFault.active,
		lockout: false,
	});
}

/**
 * Ownership/Fault/Safe-Restore-Verdrahtung nach jedem Foundation-Lauf:
 * - erfolgreicher Write → Ownership übernehmen, Feedback-Contract zur Prüfung vormerken
 * - Write fehlgeschlagen → Fault/Lockout auslösen
 * - anstehendes Feedback → auswerten; Mismatch/Timeout/Invalid → Fault/Lockout
 * - Kontrolle verlassen (nicht mehr live) während Ownership aktiv → Safe-Restore versuchen
 */
async function runWallboxSafetyTick(
	host: WallboxHost,
	foundation: WallboxLiveFoundationResult,
	now: Date,
): Promise<void> {
	const writeResult = foundation.writeResult;
	if (writeResult?.executed && writeResult.ownershipGranted) {
		wallboxOwnership = grantWallboxOwnership(
			foundation.mappingSnapshot.controlModel,
			foundation.writePlan?.writeScenario ?? null,
			now.toISOString(),
		);
		if (foundation.feedbackContract?.required && writeResult.writeTimestampMs !== null) {
			pendingWallboxFeedback = {
				contract: foundation.feedbackContract,
				writeTimestampMs: writeResult.writeTimestampMs,
			};
		}
	} else if (writeResult?.blocked && writeResult.reason === "write_failed") {
		wallboxFault = raiseWallboxFault("write_failed", "wallbox live write failed", now.toISOString());
		host.log.error("wallbox: Live-Write fehlgeschlagen — Fault/Lockout aktiv, fault_reset zum Zurücksetzen");
	}

	if (pendingWallboxFeedback) {
		const evaluated = await tickWallboxFeedback(
			host,
			pendingWallboxFeedback.contract,
			pendingWallboxFeedback.writeTimestampMs,
			now.getTime(),
		);
		if (isWallboxFeedbackStatusTerminal(evaluated.status)) {
			const code = faultCodeForFeedbackStatus(evaluated.status);
			if (code) {
				wallboxFault = raiseWallboxFault(code, evaluated.blockReason ?? evaluated.status, now.toISOString());
				host.log.warn(
					`wallbox: Feedback ${evaluated.status} (${evaluated.blockReason ?? "n/a"}) — Fault/Lockout aktiv`,
				);
			}
			pendingWallboxFeedback = null;
		} else {
			pendingWallboxFeedback = { ...pendingWallboxFeedback, contract: evaluated };
		}
	}

	if (foundation.phase !== "live" && wallboxOwnership.active) {
		/*
		 * Befund 005: mode=off → Steuerhoheit abgeben ohne künstlichen EVCC-Sollzustand.
		 * Dryrun-/Enabled-Wechsel behalten Safe-Restore.
		 */
		if (foundation.addonExecutionOff) {
			host.log.info("wallbox: Add-on Aus — Ownership ohne EVCC-Restore freigegeben (EVCC autonom)");
			wallboxOwnership = emptyWallboxOwnership();
			pendingWallboxFeedback = null;
			return;
		}
		const restorePlan = planWallboxSafeRestore(wallboxOwnership, foundation.mappingSnapshot);
		if (restorePlan.required) {
			if (restorePlan.possible && restorePlan.operation) {
				try {
					const r = await writeForeignIfChanged(host, {
						stateId: restorePlan.operation.targetStateId,
						value: restorePlan.operation.targetValue,
						reason: "wallbox safe_restore",
					});
					host.log.info(
						`wallbox: Safe-Restore → ${restorePlan.operation.targetValue} (${r.skipped ? "bereits gesetzt" : "geschrieben"})`,
					);
				} catch (e) {
					host.log.error(`wallbox: Safe-Restore-Write fehlgeschlagen: ${String(e)}`);
				}
			} else {
				host.log.warn(
					`wallbox: Safe-Restore nicht möglich (${restorePlan.reason}) — Ownership bleibt bis Mapping korrigiert oder manuell zurückgesetzt`,
				);
				return;
			}
		}
		wallboxOwnership = emptyWallboxOwnership();
		pendingWallboxFeedback = null;
	}
}

function handleWallboxFaultReset(host: WallboxHost): void {
	if (!wallboxFault.active) return;
	wallboxFault = emptyWallboxFault();
	pendingWallboxFeedback = null;
	host.log.info("wallbox: Fault/Lockout manuell zurückgesetzt");
	void publishWallboxSafetyStates(host, wallboxOwnership, wallboxFault).catch(() => undefined);
}

async function readForeignRaw(
	host: WallboxHost,
	objectId: string,
): Promise<unknown | null> {
	if (!objectId.trim()) return null;
	try {
		const st = host.getForeignStateAsync
			? await host.getForeignStateAsync(objectId)
			: await host.getStateAsync(objectId);
		if (!st || st.val === undefined) return null;
		return st.val;
	} catch {
		return null;
	}
}

async function publishWallboxBatteryHoldRuntime(
	host: WallboxHost,
	snap: EvccTelemetrySnapshot,
): Promise<void> {
	const holdCfg = wallboxHoldSignalConfigFromAdapter(host.config);
	const externalRaw = await readForeignRaw(host, holdCfg.externalVehicleChargeStateId);
	const tibberRaw = await readForeignRaw(host, holdCfg.tibberGridRewardsActiveStateId);
	const tibberField = holdCfg.tibberGridRewardsActiveStateId
		? normalizeOptionalBool(tibberRaw)
		: { value: null as boolean | null, status: "missing" as const, raw: null };
	const tibberActive =
		tibberField.status === "valid" && tibberField.value === true
			? true
			: tibberField.status === "valid" && tibberField.value === false
				? false
				: null;

	const hold = resolveWallboxBatteryHold({
		batteryBoost: snap.battery_boost.status === "valid" ? snap.battery_boost.value : null,
		loadpointMode: snap.loadpoint_mode.status === "valid" ? snap.loadpoint_mode.value : null,
		externalVehicleChargeRaw:
			externalRaw === null || externalRaw === undefined
				? null
				: typeof externalRaw === "boolean"
					? externalRaw
					: String(externalRaw),
		tibberGridRewardsActive: tibberActive,
	});

	await setStateIfChanged(host, WALLBOX_RUNTIME_STATES.batteryHoldForEvCharge, hold.hold);
	await setStateIfChanged(host, WALLBOX_RUNTIME_STATES.batteryHoldReasonDe, hold.reasonDe);
	await setStateIfChanged(host, WALLBOX_RUNTIME_STATES.chargeBoostActive, hold.boostActive);
	await setStateIfChanged(host, WALLBOX_RUNTIME_STATES.externalVehicleChargeActive, hold.externalActive);
	await setStateIfChanged(host, WALLBOX_RUNTIME_STATES.tibberGridRewardsActive, hold.tibberRewardsActive);
}

export async function refreshWallboxEvccTelemetry(host: WallboxHost): Promise<void> {
	const cfg = wallboxEvccTelemetryConfigFromAdapter(host.config);
	const snap = await readEvccTelemetrySnapshot(host, cfg, new Date());

	await host.setStateAsync(WALLBOX_EVCC_STATES.snapshotJson, {
		val: JSON.stringify(snap),
		ack: true,
	});
	await host.setStateAsync(WALLBOX_EVCC_STATES.updatedAt, { val: snap.observed_at, ack: true });

	await writeField(host, WALLBOX_EVCC_STATES.enabled, snap.enabled);
	await writeField(host, WALLBOX_EVCC_STATES.connected, snap.connected);
	await writeField(host, WALLBOX_EVCC_STATES.charging, snap.charging);
	await writeField(host, WALLBOX_EVCC_STATES.chargePowerW, snap.charge_power_w);
	await writeField(host, WALLBOX_EVCC_STATES.sessionEnergyKwh, snap.session_energy_kwh);
	await writeField(host, WALLBOX_EVCC_STATES.chargeRemainingEnergyKwh, snap.charge_remaining_energy_kwh);
	await writeField(host, WALLBOX_EVCC_STATES.vehicleSocPct, snap.vehicle_soc_pct);
	await writeField(host, WALLBOX_EVCC_STATES.vehicleName, snap.vehicle_name);
	await writeField(host, WALLBOX_EVCC_STATES.vehicleTitle, snap.vehicle_title);
	await writeField(host, WALLBOX_EVCC_STATES.planActive, snap.plan_active);
	await writeField(host, WALLBOX_EVCC_STATES.planSocPct, snap.plan_soc_pct);
	await writeTimeField(host, WALLBOX_EVCC_STATES.planTime, snap.plan_time);
	await writeTimeField(host, WALLBOX_EVCC_STATES.effectivePlanTime, snap.effective_plan_time);
	await writeField(host, WALLBOX_EVCC_STATES.effectiveLimitSocPct, snap.effective_limit_soc_pct);
	await writeField(host, WALLBOX_EVCC_STATES.batteryBoost, snap.battery_boost);
	await writeField(host, WALLBOX_EVCC_STATES.loadpointMode, snap.loadpoint_mode);
	await writeField(host, WALLBOX_EVCC_STATES.activePhases, snap.active_phases);
	await writeField(host, WALLBOX_EVCC_STATES.configuredPhases, snap.configured_phases);
	await writeField(host, WALLBOX_EVCC_STATES.minCurrentA, snap.min_current_a);
	await writeField(host, WALLBOX_EVCC_STATES.maxCurrentA, snap.max_current_a);
	await writeField(host, WALLBOX_EVCC_STATES.batteryMode, snap.battery_mode);
	await writeField(host, WALLBOX_EVCC_STATES.batteryDischargeControl, snap.battery_discharge_control);

	await publishWallboxBatteryHoldRuntime(host, snap);
	await refreshWallboxDailyPlanRuntime(host, snap);
}

function scheduleRefresh(host: WallboxHost): void {
	if (debounceTimer) clearTimeout(debounceTimer);
	debounceTimer = setTimeout(() => {
		debounceTimer = null;
		void refreshWallboxEvccTelemetry(host).catch((e) =>
			host.log.debug?.(`wallbox evcc refresh: ${e}`),
		);
	}, DEBOUNCE_MS);
}

export async function ensureWallboxStaticStateTree(host: WallboxHost): Promise<void> {
	await ensureWallboxEvccStates(host);
	await ensureWallboxRuntimeStates(host);
}

/**
 * Phase C (v0.1.227+) — no-op: fat `addons.wallbox.vehicles.*` trees are no longer created.
 * Orphan folders are purged by surface cleanup. Optional capacity/maxW live in `wb_vehicle_map`.
 */
export async function ensureWallboxDynamicVehicleProfiles(_host: WallboxHost): Promise<void> {
	void _host;
}

export async function ensureWallboxStateTree(host: WallboxHost): Promise<void> {
	await ensureWallboxStaticStateTree(host);
	await ensureWallboxDynamicVehicleProfiles(host);
}

export async function startWallboxModuleRuntime(host: WallboxHost): Promise<void> {
	if (activeHost === host) return;
	activeHost = host;

	await refreshWallboxEvccTelemetry(host);

	const cfg = wallboxEvccTelemetryConfigFromAdapter(host.config);
	const ids = new Set(configuredEvccTelemetryStateIds(cfg));
	for (const id of configuredWallboxHoldSignalStateIds(wallboxHoldSignalConfigFromAdapter(host.config))) {
		ids.add(id);
	}
	ids.add(addonEnabled(WALLBOX_ADDON_ID));
	ids.add(addonGovernanceEnabledState(WALLBOX_ADDON_ID));
	ids.add(GLOBAL.executionMode);
	ids.add(addonMode(WALLBOX_ADDON_ID));
	ids.add(DAILY_PLAN_STATE_IDS.revision);
	ids.add(DAILY_PLAN_STATE_IDS.status);
	ids.add(ALLOCATION_ADDON_STATE_IDS.wallbox.planJson);
	ids.add(WALLBOX_RUNTIME_STATES.faultReset);

	for (const id of ids) {
		if (subscribedIds.includes(id)) continue;
		const isForeign = !id.startsWith("addons.") && !id.startsWith("planner.");
		if (isForeign) {
			if (typeof host.subscribeForeignStatesAsync === "function") {
				try {
					await host.subscribeForeignStatesAsync(id);
					subscribedIds.push(id);
				} catch (e) {
					host.log.debug?.(`wallbox evcc subscribe ${id}: ${e}`);
				}
			}
		} else if (typeof host.subscribeStatesAsync === "function") {
			try {
				await host.subscribeStatesAsync(id);
				subscribedIds.push(id);
			} catch (e) {
				host.log.debug?.(`wallbox subscribe ${id}: ${e}`);
			}
		}
	}
	if (periodicTimer) clearInterval(periodicTimer);
	periodicTimer = setInterval(() => {
		if (!activeHost) return;
		void refreshWallboxEvccTelemetry(activeHost).catch((e) =>
			activeHost?.log.debug?.(`wallbox safety tick: ${e}`),
		);
	}, SAFETY_TICK_MS);

	host.log.debug("Wallbox EVCC telemetry module initialized (EVCC-Live-Foundation aktiv)");
}

export async function initWallboxModule(host: WallboxHost): Promise<void> {
	await ensureWallboxStateTree(host);
	await startWallboxModuleRuntime(host);
}

export function stopWallboxModule(): void {
	if (debounceTimer) {
		clearTimeout(debounceTimer);
		debounceTimer = null;
	}
	if (periodicTimer) {
		clearInterval(periodicTimer);
		periodicTimer = null;
	}
	const host = activeHost;
	if (host) {
		if (typeof host.unsubscribeStatesAsync === "function") {
			for (const id of subscribedIds) {
				if (id.startsWith("addons.") || id.startsWith("planner.")) {
					void Promise.resolve(host.unsubscribeStatesAsync!(id)).catch(() => undefined);
				}
			}
		}
		if (typeof host.unsubscribeForeignStatesAsync === "function") {
			for (const id of subscribedIds) {
				if (!id.startsWith("addons.") && !id.startsWith("planner.")) {
					void Promise.resolve(host.unsubscribeForeignStatesAsync!(id)).catch(() => undefined);
				}
			}
		}
	}
	subscribedIds.length = 0;
	activeHost = null;
	resetWallboxDailyPlanCache();
	resetWallboxDispatchCache();
	wallboxOwnership = emptyWallboxOwnership();
	wallboxFault = emptyWallboxFault();
	pendingWallboxFeedback = null;
}

const DAILY_PLAN_TRIGGER_IDS = new Set([
	DAILY_PLAN_STATE_IDS.revision,
	DAILY_PLAN_STATE_IDS.status,
	ALLOCATION_ADDON_STATE_IDS.wallbox.planJson,
	addonEnabled(WALLBOX_ADDON_ID),
	addonGovernanceEnabledState(WALLBOX_ADDON_ID),
	GLOBAL.executionMode,
	addonMode(WALLBOX_ADDON_ID),
]);

export function handleWallboxForeignStateChange(namespace: string, id: string): void {
	if (!activeHost) return;
	const cfg = wallboxEvccTelemetryConfigFromAdapter(activeHost.config);
	const ids = configuredEvccTelemetryStateIds(cfg);
	if (ids.includes(id)) {
		scheduleRefresh(activeHost);
		return;
	}
	void namespace;
}

export function handleWallboxStateChange(namespace: string, id: string): void {
	if (!activeHost) return;
	const ns = `${namespace}.`;
	const bareId = id.startsWith(ns) ? id.slice(ns.length) : id;
	if (bareId === WALLBOX_RUNTIME_STATES.faultReset) {
		void activeHost.getStateAsync(WALLBOX_RUNTIME_STATES.faultReset).then((st) => {
			if (st?.val === true && activeHost) {
				handleWallboxFaultReset(activeHost);
				void activeHost.setStateAsync(WALLBOX_RUNTIME_STATES.faultReset, { val: false, ack: true });
			}
		});
		return;
	}
	if (DAILY_PLAN_TRIGGER_IDS.has(bareId)) {
		scheduleRefresh(activeHost);
	}
}
