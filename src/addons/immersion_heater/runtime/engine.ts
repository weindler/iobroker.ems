import { touchEmsActivity } from "../../../ems_activity";
import { isLiveWriteAllowed } from "../../../execution_mode";
import { writeForeignIfChanged } from "../../../device_write";
import { isAddonGovernanceEnabledFromState } from "../../../addons/governance";
import { setOptionalNumberIfChanged, setStateIfChanged } from "../../../policy/core/state_write";
import { INTENT_SCHEMA_VERSION, IOBROKER_THERMAL_REQUEST_STATE } from "../../../intent/core/constants";
import { addonAvailable, addonEnabled } from "../../../tree_paths";
import { immersionDeviceConfigFromAdapter } from "../device_config";
import { validateImmersionDeviceConfig } from "../validate_config";
import { IMMERSION_STATUS_STATES } from "../status";
import { ensureImmersionRuntimeStates } from "./ensure_states";
import { runImmersionFsm, evaluateTemperature, controlModeToOperatingRequest } from "./fsm";
import { resolveThermalForecastTarget } from "../../../operator/planning/thermal_forecast";
import { addonGovernanceAiAllowedState } from "../../governance";
import { asNum } from "../../../ems_light/state_util";
import {
	canResetFault,
	checkPowerFault,
	isRelayChatter,
	recordChatterEvent,
	type ChatterTracker,
} from "./safety";
import type { ImmersionDeviceConfig, RuntimePersistData, RuntimeSnapshot } from "./types";
import {
	IMMERSION_RUNTIME_STATES,
} from "./types";
import {
	emptyPersist,
	isForceExpired,
	readRuntimePersist,
	writeRuntimePersist,
} from "./persist";
import {
	resolveImmersionDailyPlanAllocation,
	resolveImmersionDecisionSource,
	resetImmersionDailyPlanCache,
	type ImmersionDailyPlanResolution,
	type ImmersionDecisionSource,
} from "./daily_plan";
import { DAILY_PLAN_STATE_IDS, ALLOCATION_ADDON_STATE_IDS } from "../../../operator/daily_plan/states";
import {
	forceTargetFromIntent,
	forceUntilFromIntent,
	parseResolvedIntentJson,
	resolvedModeFromIntent,
} from "./intent_read";
import {
	externalOnStatus,
	feedbackStageFromReadings,
	normalizeFeedbackActive,
	type StageFeedbackReading,
} from "./feedback";
import {
	flushConsumerStatsPersist,
	initConsumerStatsForAddon,
	resetConsumerStatsCache,
	tickConsumerStats,
} from "../../../learning/consumer_stats";

export type ImmersionRuntimeHost = {
	config?: unknown;
	namespace?: string;
	getAbsolutePath?: (category?: string) => string;
	log: {
		info: (msg: string) => void;
		warn: (msg: string) => void;
		debug?: (msg: string) => void;
		error?: (msg: string) => void;
	};
	setObjectNotExistsAsync: (id: string, obj: ioBroker.Object) => Promise<unknown>;
	getStateAsync: (id: string) => Promise<ioBroker.State | null | undefined>;
	getForeignStateAsync?: (id: string) => Promise<ioBroker.State | null | undefined>;
	setStateAsync: (id: string, state: ioBroker.SettableState) => Promise<unknown>;
	setForeignStateAsync?: (id: string, state: ioBroker.SettableState) => Promise<unknown>;
	subscribeStatesAsync?: (pattern: string) => Promise<void>;
	subscribeForeignStatesAsync?: (pattern: string) => Promise<void>;
	unsubscribeStatesAsync?: (pattern: string) => Promise<void>;
	unsubscribeForeignStatesAsync?: (pattern: string) => Promise<void>;
};

let engineActive = false;
let hostRef: ImmersionRuntimeHost | null = null;
let persist: RuntimePersistData = emptyPersist();
let tickTimer: ReturnType<typeof setTimeout> | null = null;
let mismatchSinceMs: number | null = null;
/** Zeitpunkte, zu denen EMS im Live-Modus selbst EIN/AUS auf das Relais geschrieben hat. */
let emsOnWriteAtMs: number | null = null;
let emsOffWriteAtMs: number | null = null;
let chatter: ChatterTracker = { timestampsMs: [] };
/** -1 = noch nie geschrieben → erster Tick stellt EMS-Besitz her (Live schreibt aktuellen Stand). */
let lastCommandedStage = -1;
let lastDailyPlanContext: ImmersionDailyPlanResolution | null = null;
/** Nach Upgrade einmalig Ensure nachziehen (plan_target_*), danach nicht jeden Tick. */
let runtimeStatesEnsuredThisProcess = false;
const subscribedIds: string[] = [];
const TICK_MS = 5_000;

function clearTick(): void {
	if (tickTimer) {
		clearTimeout(tickTimer);
		tickTimer = null;
	}
}

function scheduleTick(): void {
	clearTick();
	if (!engineActive) return;
	tickTimer = setTimeout(() => {
		tickTimer = null;
		if (!engineActive || !hostRef) return;
		void runImmersionRuntimeTick(hostRef).catch((e) => hostRef?.log.warn(`immersion runtime tick: ${e}`));
	}, TICK_MS);
}

async function readForeignNum(host: ImmersionRuntimeHost, id: string): Promise<{ value: number | null; tsMs: number | null }> {
	try {
		const reader = host.getForeignStateAsync ?? host.getStateAsync;
		const st = await reader(id);
		if (!st) return { value: null, tsMs: null };
		const n = typeof st.val === "number" ? st.val : parseFloat(String(st.val ?? ""));
		const tsMs = st.ts ? new Date(st.ts).getTime() : Date.now();
		return { value: Number.isFinite(n) ? n : null, tsMs };
	} catch {
		return { value: null, tsMs: null };
	}
}

async function readForeignRaw(host: ImmersionRuntimeHost, id: string): Promise<unknown> {
	try {
		const reader = host.getForeignStateAsync ?? host.getStateAsync;
		const st = await reader(id);
		return st ? st.val : null;
	} catch {
		return null;
	}
}

/** Liest die konfigurierten Stage-Feedback-States aktiv und normalisiert sie. */
async function readFeedbackReadings(
	host: ImmersionRuntimeHost,
	config: ReturnType<typeof immersionDeviceConfigFromAdapter>,
): Promise<StageFeedbackReading[]> {
	const readings: StageFeedbackReading[] = [];
	for (const stage of config.stages) {
		if (!stage.feedbackStateId) continue;
		const raw = await readForeignRaw(host, stage.feedbackStateId);
		readings.push({ index: stage.index, active: normalizeFeedbackActive(raw) });
	}
	return readings;
}

/** Konfigurierte Fremd-States, deren Änderung einen Runtime-Tick auslösen soll. */
export function immersionRuntimeWatchedForeignIds(
	config: ReturnType<typeof immersionDeviceConfigFromAdapter>,
): string[] {
	const ids = new Set<string>();
	if (config.bufferTempStateId) ids.add(config.bufferTempStateId);
	if (config.actualPowerStateId) ids.add(config.actualPowerStateId);
	for (const stage of config.stages) {
		if (stage.feedbackStateId) ids.add(stage.feedbackStateId);
	}
	return [...ids];
}

/**
 * Lokaler Sicherheits-Default für den Auto-Modus, wenn der Daily Plan nicht verwendbar ist
 * (Roadmap Block 3.1) — bewusst kein Rückgriff auf den alten Realtime-Planner
 * (`planner.intent.thermal.*`). Ziel ist nur die Pflicht-Untergrenze (`planningMinTempC`,
 * gleiche Schwelle wie die Operator-Pflicht-Contribution), nicht der volle Komfortbereich.
 * Die Stufe nutzt die bereits vorhandene, admin-konfigurierte `forceDefaultStage`.
 */
function safeDefaultAutoTarget(config: ImmersionDeviceConfig): { stage: number; targetTempC: number } {
	return { stage: config.forceDefaultStage, targetTempC: config.planningMinTempC };
}

async function submitAutoRevertToAuto(host: ImmersionRuntimeHost, now: Date): Promise<void> {
	const issuedAt = now.toISOString();
	const raw = {
		schema_version: INTENT_SCHEMA_VERSION,
		request_id: `auto-revert-${issuedAt}`,
		issued_at: issuedAt,
		owner: { type: "ems_ui" as const, id: "immersion_runtime" },
		values: { operating_request: controlModeToOperatingRequest("auto") },
		clear_fields: ["target_temperature_c", "ready_at"],
	};
	await host.setStateAsync(IOBROKER_THERMAL_REQUEST_STATE, { val: JSON.stringify(raw), ack: false });
}

async function readBool(host: ImmersionRuntimeHost, id: string): Promise<boolean> {
	const st = await host.getStateAsync(id);
	return st?.val === true;
}

async function readLocalNum(host: ImmersionRuntimeHost, id: string): Promise<number | null> {
	try {
		const st = await host.getStateAsync(id);
		return asNum(st?.val);
	} catch {
		return null;
	}
}

async function readLocalStr(host: ImmersionRuntimeHost, id: string): Promise<string | null> {
	try {
		const st = await host.getStateAsync(id);
		if (st?.val === null || st?.val === undefined || st.val === "") return null;
		return String(st.val);
	} catch {
		return null;
	}
}

/** Forecast-/Force-Tagesziel für VIS und FSM-Ceiling (nicht die harte Planungsobergrenze allein). */
async function resolveImmersionPlanTarget(
	host: ImmersionRuntimeHost,
	config: ImmersionDeviceConfig,
	bufferTempC: number | null,
	resolvedMode: "off" | "auto" | "force",
	forceTarget: number | null,
): Promise<{ targetTempC: number | null; reasonDe: string }> {
	if (resolvedMode === "off") {
		return { targetTempC: null, reasonDe: "Modus off — kein Heiz-Tagesziel." };
	}
	if (resolvedMode === "force") {
		const t = forceTarget ?? config.planningMaxTempC;
		return { targetTempC: t, reasonDe: `Force-Ziel ${t} °C.` };
	}
	const [pvToday, pvTomorrow, pvStatus, aiAllowed] = await Promise.all([
		readLocalNum(host, "learning.pv_bias.corrected_today_kwh"),
		readLocalNum(host, "learning.pv_bias.corrected_tomorrow_kwh"),
		readLocalStr(host, "learning.pv_bias.status"),
		readBool(host, addonGovernanceAiAllowedState("immersion_heater")),
	]);
	const forecast = resolveThermalForecastTarget({
		config,
		bufferTempC,
		pvTodayKwh: pvToday,
		pvTomorrowKwh: pvTomorrow,
		pvBiasStatus: pvStatus,
		forecastModeEnabled: config.forecastModeEnabled,
		aiOptimizationAllowed: aiAllowed,
	});
	return { targetTempC: forecast.targetTempC, reasonDe: forecast.targetReasonDe };
}

async function applyStageWrites(host: ImmersionRuntimeHost, stageIndex: number, live: boolean): Promise<void> {
	// Dryrun: EMS besitzt das Relais nicht — keine physischen Writes.
	if (!live) return;
	const governanceEnabled = await isAddonGovernanceEnabledFromState(
		(id) => host.getStateAsync(id),
		"immersion_heater",
	);
	if (!governanceEnabled) return;
	const config = immersionDeviceConfigFromAdapter(host.config);
	for (const stage of config.stages) {
		if (!stage.setStateId) continue;
		const on = stage.index === stageIndex;
		if (!host.setForeignStateAsync) continue;
		try {
			const writeResult = await writeForeignIfChanged(
				{
					getForeignStateAsync: (id) => host.getForeignStateAsync!(id),
					setForeignStateAsync: async (id, state) => {
						if (state && typeof state === "object" && "val" in state) {
							await host.setForeignStateAsync!(id, state as ioBroker.SettableState);
							return;
						}
						await host.setForeignStateAsync!(id, { val: (state as ioBroker.StateValue) ?? null, ack: false });
					},
					log: {
						info: (m) => host.log.debug?.(m),
						warn: (m) => host.log.warn?.(m),
						error: (m) => host.log.error?.(m),
						debug: (m) => host.log.debug?.(m),
					},
				},
				{
					stateId: stage.setStateId,
					value: on,
					reason: `immersion stage ${stage.index}`,
				},
			);
			if (writeResult.skipped) {
				host.log.debug?.(`immersion stage ${stage.index} already ${on ? "ON" : "OFF"} — skip`);
			}
		} catch (e) {
			host.log.error?.(`immersion write stage ${stage.index}: ${e}`);
			persist.faultLockout = true;
			persist.faultCode = "write_failed";
			persist.faultSince = new Date().toISOString();
		}
	}
}

export async function runImmersionRuntimeTick(host: ImmersionRuntimeHost): Promise<void> {
	touchEmsActivity();
	if (!runtimeStatesEnsuredThisProcess) {
		await ensureImmersionRuntimeStates(host);
		runtimeStatesEnsuredThisProcess = true;
	}
	const now = new Date();
	const nowMs = now.getTime();
	const config = immersionDeviceConfigFromAdapter(host.config);
	const validation = validateImmersionDeviceConfig(config);
	const enabled = await readBool(host, addonEnabled("immersion_heater"));
	const available = await readBool(host, addonAvailable("immersion_heater"));
	const live = await isLiveWriteAllowed((id) => host.getStateAsync(id), "immersion_heater");
	const failsafeActive = await readBool(host, IMMERSION_STATUS_STATES.failsafeActive);

	const intentRaw = await host.getStateAsync("user_intent.thermal.resolved_json");
	const intent = parseResolvedIntentJson(intentRaw?.val);
	let resolvedMode = resolvedModeFromIntent(intent);
	let forceTarget = forceTargetFromIntent(intent);
	let forceUntil = forceUntilFromIntent(intent);

	if (forceUntil && isForceExpired(forceUntil, nowMs)) {
		forceUntil = null;
	}

	let tempVal: number | null = null;
	let tempObsMs: number | null = null;
	if (config.bufferTempEnabled && config.bufferTempStateId) {
		const tr = await readForeignNum(host, config.bufferTempStateId);
		tempVal = tr.value;
		tempObsMs = tr.tsMs;
	}

	const temperature = evaluateTemperature(tempVal, tempObsMs, nowMs, config);
	const powerRead = config.actualPowerStateId ? await readForeignNum(host, config.actualPowerStateId) : { value: null, tsMs: null };
	const measuredPower = powerRead.value;
	const hasPower = Boolean(config.actualPowerStateId);
	let powerObservedAtMs: number | null = null;
	if (config.actualPowerStateId) {
		try {
			const reader = host.getForeignStateAsync ?? host.getStateAsync;
			const powerSt = await reader(config.actualPowerStateId);
			powerObservedAtMs = powerSt?.ts ? new Date(powerSt.ts).getTime() : null;
		} catch {
			powerObservedAtMs = null;
		}
	}
	let autoDecisionSource: ImmersionDecisionSource = "thermal_fallback";
	let dailyPlanContext: ImmersionDailyPlanResolution | null = null;
	let plannerCommandedStage = 0;
	const planTarget = await resolveImmersionPlanTarget(
		host,
		config,
		temperature.valueC,
		resolvedMode,
		forceTarget,
	);
	let plannerTargetTempC: number | null = planTarget.targetTempC;

	if (resolvedMode === "auto") {
		dailyPlanContext = await resolveImmersionDailyPlanAllocation(host, config, now);
		lastDailyPlanContext = dailyPlanContext;
		if (dailyPlanContext.useDailyPlan) {
			// Daily Plan besitzt den Slot: Stufe aus Allocation (0 = absichtlich aus).
			// FSM-Ceiling = Forecast-Tagesziel (nicht pauschal planningMax).
			plannerCommandedStage = dailyPlanContext.commandedStage;
			plannerTargetTempC = planTarget.targetTempC;
			autoDecisionSource = "daily_plan";
		} else {
			// Daily Plan nicht verwendbar (missing/expired/wrong_date/…) — lokaler
			// Sicherheits-Default: nur die Pflicht-Untergrenze halten.
			const safeDefault = safeDefaultAutoTarget(config);
			plannerCommandedStage = safeDefault.stage;
			plannerTargetTempC = safeDefault.targetTempC;
			autoDecisionSource = "thermal_fallback";
		}
	} else if (resolvedMode === "force") {
		plannerTargetTempC = planTarget.targetTempC;
	}

	const fsm = runImmersionFsm({
		nowMs,
		addonEnabled: enabled,
		addonAvailable: available,
		configValid: validation.valid,
		executionLive: live,
		failsafeActive,
		resolvedMode,
		forceTargetTempC: forceTarget,
		forceUntilMs: forceUntil ? Date.parse(forceUntil) : null,
		plannerCommandedStage,
		plannerTargetTempC,
		temperature,
		measuredPowerW: measuredPower,
		hasPowerMeasurement: hasPower,
		persist,
		config,
		faultLockout: persist.faultLockout,
		faultCode: persist.faultCode,
	});

	if (fsm.autoRevertToAuto) {
		resolvedMode = "auto";
		await submitAutoRevertToAuto(host, now);
	}

	const commandedStage = fsm.faultLockout ? 0 : fsm.commandedStage;
	const effectiveStage = persist.faultLockout || failsafeActive || resolvedMode === "off" ? 0 : commandedStage;
	const commandedOn = effectiveStage > 0;

	// Realer Relais-Übergang → Buchhaltung, Chatter, physischer Write (nur Live) + Write-Zeitstempel.
	if (effectiveStage !== lastCommandedStage) {
		if (effectiveStage === 0) {
			persist.lastOffAtMs = nowMs;
			persist.pauseUntilMs = nowMs + config.minimumPauseSec * 1000;
		} else {
			persist.lastSwitchAtMs = nowMs;
		}
		chatter = recordChatterEvent(chatter, nowMs, config.relayChatterWindowSec);
		await applyStageWrites(host, effectiveStage, live);
		if (live) {
			if (effectiveStage === 0) emsOffWriteAtMs = nowMs;
			else emsOnWriteAtMs = nowMs;
		}
		lastCommandedStage = effectiveStage;
	}

	if (isRelayChatter(chatter, config.relayChatterMaxChanges)) {
		persist.faultLockout = true;
		persist.faultCode = "relay_chatter";
		persist.faultSince = now.toISOString();
	}

	const feedbackReadings = await readFeedbackReadings(host, config);
	const hasFeedbackConfig = config.stages.some((s) => Boolean(s.feedbackStateId));
	const feedbackStage = hasFeedbackConfig ? feedbackStageFromReadings(feedbackReadings) : effectiveStage;
	const feedbackActive = feedbackStage > 0;
	const powerActive = hasPower && measuredPower !== null && measuredPower > config.powerOnThresholdW;

	const powerCheck = checkPowerFault({
		nowMs,
		executionLive: live,
		commandedOn,
		commandedStage: effectiveStage,
		nominalPowerW: fsm.commandedPowerW,
		measuredPowerW: measuredPower,
		hasPowerMeasurement: hasPower,
		feedbackActive,
		emsOnWriteAtMs,
		emsOffWriteAtMs,
		powerObservedAtMs,
		mismatchSinceMs,
		config,
	});
	mismatchSinceMs = powerCheck.mismatchSinceMs;
	if (powerCheck.lockout) {
		persist.faultLockout = true;
		persist.faultCode = powerCheck.faultCode;
		persist.faultSince = now.toISOString();
	}

	let powerVerificationStatus = persist.faultLockout ? "fault" : fsm.powerVerificationStatus;
	const externalStatus = externalOnStatus({ commandedStage: effectiveStage, feedbackActive, powerActive });
	if (externalStatus && !persist.faultLockout) {
		powerVerificationStatus = externalStatus;
	}

	persist.commandedStage = effectiveStage;
	persist.resolvedMode = resolvedMode;
	persist.forceTargetTempC = forceTarget;
	persist.forceUntil = forceUntil;
	persist.minRuntimeUntilMs = fsm.minRuntimeUntilMs;
	persist.pauseUntilMs = fsm.pauseUntilMs;
	persist.autoTargetReached = fsm.autoTargetReached;

	const minRuntimeRem = persist.minRuntimeUntilMs ? Math.max(0, Math.ceil((persist.minRuntimeUntilMs - nowMs) / 1000)) : 0;
	const minPauseRem = persist.pauseUntilMs ? Math.max(0, Math.ceil((persist.pauseUntilMs - nowMs) / 1000)) : 0;

	const decisionSource = resolveImmersionDecisionSource(
		resolvedMode,
		failsafeActive,
		persist.faultLockout,
		fsm.state,
		autoDecisionSource,
	);

	const snapshot: RuntimeSnapshot = {
		schema_version: 1,
		available: fsm.available && !persist.faultLockout,
		state: persist.faultLockout ? "fault_lockout" : fsm.state,
		requested_mode: resolvedMode,
		resolved_mode: resolvedMode,
		buffer_temperature_c: temperature.valueC,
		temperature_status: temperature.status,
		planning_min_temp_c: config.planningMinTempC,
		planning_max_temp_c: config.planningMaxTempC,
		plan_target_temp_c:
			resolvedMode === "auto" && autoDecisionSource === "thermal_fallback"
				? plannerTargetTempC
				: planTarget.targetTempC,
		plan_target_reason_de:
			resolvedMode === "auto" && autoDecisionSource === "thermal_fallback"
				? `Sicherheits-Default ${plannerTargetTempC ?? config.planningMinTempC} °C (Daily Plan nicht nutzbar).`
				: planTarget.reasonDe,
		force_target_temp_c: forceTarget,
		force_until: forceUntil,
		commanded_stage: persist.faultLockout ? 0 : effectiveStage,
		commanded_power_w: !persist.faultLockout && effectiveStage > 0 ? fsm.commandedPowerW : 0,
		feedback_stage: feedbackStage,
		measured_power_w: measuredPower,
		power_verification_status: powerVerificationStatus,
		minimum_runtime_remaining_sec: minRuntimeRem,
		minimum_pause_remaining_sec: minPauseRem,
		last_switch_at: persist.lastSwitchAtMs ? new Date(persist.lastSwitchAtMs).toISOString() : null,
		fault_active: persist.faultLockout,
		fault_code: persist.faultCode,
		fault_since: persist.faultSince,
		fault_message: persist.faultLockout ? persist.faultCode : "",
		reason: fsm.reason,
		execution_mode: live ? "live" : "dryrun",
		updated_at: now.toISOString(),
	};

	await publishRuntime(host, snapshot, decisionSource, dailyPlanContext);

	await tickConsumerStats(host, {
		consumerKey: "immersion_heater",
		nowMs,
		deviceActive: effectiveStage > 0 && !persist.faultLockout,
		countable: effectiveStage > 0 && !persist.faultLockout,
		measuredPowerW: measuredPower,
		commandedPowerW: !persist.faultLockout && effectiveStage > 0 ? fsm.commandedPowerW : 0,
		powerOnThresholdW: config.powerOnThresholdW,
	});

	const dataDir = host.getAbsolutePath?.("immersion_heater");
	if (dataDir) {
		await writeRuntimePersist(dataDir, persist);
	}

	scheduleTick();
}

async function publishRuntime(
	host: ImmersionRuntimeHost,
	s: RuntimeSnapshot,
	decisionSource: ImmersionDecisionSource,
	dailyPlan: ImmersionDailyPlanResolution | null,
): Promise<void> {
	await setStateIfChanged(host, IMMERSION_RUNTIME_STATES.available, s.available);
	await setStateIfChanged(host, IMMERSION_RUNTIME_STATES.state, s.state);
	await setStateIfChanged(host, IMMERSION_RUNTIME_STATES.requestedMode, s.requested_mode);
	await setStateIfChanged(host, IMMERSION_RUNTIME_STATES.resolvedMode, s.resolved_mode);
	await setStateIfChanged(host, IMMERSION_RUNTIME_STATES.bufferTemperatureC, s.buffer_temperature_c ?? null);
	await setStateIfChanged(host, IMMERSION_RUNTIME_STATES.temperatureStatus, s.temperature_status);
	await setStateIfChanged(host, IMMERSION_RUNTIME_STATES.planningMinTempC, s.planning_min_temp_c);
	await setStateIfChanged(host, IMMERSION_RUNTIME_STATES.planningMaxTempC, s.planning_max_temp_c);
	await setOptionalNumberIfChanged(host, IMMERSION_RUNTIME_STATES.planTargetTempC, s.plan_target_temp_c);
	await setStateIfChanged(host, IMMERSION_RUNTIME_STATES.planTargetReasonDe, s.plan_target_reason_de || "");
	await setStateIfChanged(host, IMMERSION_RUNTIME_STATES.forceTargetTempC, s.force_target_temp_c ?? null);
	await setStateIfChanged(host, IMMERSION_RUNTIME_STATES.forceUntil, s.force_until ?? "");
	await setStateIfChanged(host, IMMERSION_RUNTIME_STATES.commandedStage, s.commanded_stage);
	await setStateIfChanged(host, IMMERSION_RUNTIME_STATES.commandedPowerW, s.commanded_power_w);
	await setStateIfChanged(host, IMMERSION_RUNTIME_STATES.feedbackStage, s.feedback_stage);
	await setStateIfChanged(host, IMMERSION_RUNTIME_STATES.measuredPowerW, s.measured_power_w ?? null);
	await setStateIfChanged(host, IMMERSION_RUNTIME_STATES.powerVerificationStatus, s.power_verification_status);
	await setStateIfChanged(host, IMMERSION_RUNTIME_STATES.minRuntimeRemainingSec, s.minimum_runtime_remaining_sec);
	await setStateIfChanged(host, IMMERSION_RUNTIME_STATES.minPauseRemainingSec, s.minimum_pause_remaining_sec);
	await setStateIfChanged(host, IMMERSION_RUNTIME_STATES.lastSwitchAt, s.last_switch_at ?? "");
	await setStateIfChanged(host, IMMERSION_RUNTIME_STATES.faultActive, s.fault_active);
	await setStateIfChanged(host, IMMERSION_RUNTIME_STATES.faultCode, s.fault_code);
	await setStateIfChanged(host, IMMERSION_RUNTIME_STATES.faultSince, s.fault_since ?? "");
	await setStateIfChanged(host, IMMERSION_RUNTIME_STATES.faultMessage, s.fault_message);
	await setStateIfChanged(host, IMMERSION_RUNTIME_STATES.reason, s.reason);
	await setStateIfChanged(host, IMMERSION_RUNTIME_STATES.snapshotJson, JSON.stringify(s));
	await setStateIfChanged(host, IMMERSION_RUNTIME_STATES.decisionSource, decisionSource);
	await setStateIfChanged(
		host,
		IMMERSION_RUNTIME_STATES.dailyPlanStatus,
		dailyPlan?.dailyPlanStatus ?? "daily_plan_missing",
	);
	await setStateIfChanged(host, IMMERSION_RUNTIME_STATES.dailyPlanRevision, dailyPlan?.dailyPlanRevision ?? 0);
	await setStateIfChanged(host, IMMERSION_RUNTIME_STATES.dailyPlanSlotStart, dailyPlan?.slotStartIso ?? "");
	await setStateIfChanged(host, IMMERSION_RUNTIME_STATES.dailyPlanSlotEnd, dailyPlan?.slotEndIso ?? "");
	await setStateIfChanged(
		host,
		IMMERSION_RUNTIME_STATES.allocatedPowerW,
		dailyPlan?.allocatedPowerW ?? null,
	);
	await setStateIfChanged(
		host,
		IMMERSION_RUNTIME_STATES.mandatoryAllocatedPowerW,
		dailyPlan?.mandatoryAllocatedPowerW ?? null,
	);
	await setStateIfChanged(
		host,
		IMMERSION_RUNTIME_STATES.flexibleAllocatedPowerW,
		dailyPlan?.flexibleAllocatedPowerW ?? null,
	);
	await setStateIfChanged(
		host,
		IMMERSION_RUNTIME_STATES.allocationStatus,
		dailyPlan?.allocationStatus ?? "unknown",
	);
	await setStateIfChanged(
		host,
		IMMERSION_RUNTIME_STATES.allocationReasonDe,
		dailyPlan?.allocationReasonDe ?? "",
	);
}

export async function handleImmersionFaultReset(
	host: ImmersionRuntimeHost,
	state: ioBroker.State | null | undefined,
): Promise<void> {
	if (!state || state.val !== true) return;
	const config = immersionDeviceConfigFromAdapter(host.config);
	const validation = validateImmersionDeviceConfig(config);
	const measured = config.actualPowerStateId ? (await readForeignNum(host, config.actualPowerStateId)).value : null;
	const reset = canResetFault({
		allStagesOff: lastCommandedStage <= 0,
		measuredPowerW: measured,
		hasPowerMeasurement: Boolean(config.actualPowerStateId),
		powerOffThresholdW: config.powerOffThresholdW,
		configValid: validation.valid,
		temperatureValid: true,
		chatterActive: isRelayChatter(chatter, config.relayChatterMaxChanges),
		faultCode: persist.faultCode,
	});
	if (reset.ok) {
		persist.faultLockout = false;
		persist.faultCode = "none";
		persist.faultSince = null;
		chatter = { timestampsMs: [] };
		host.log.info("immersion_heater: fault reset accepted");
	} else {
		host.log.warn(`immersion_heater: fault reset rejected: ${reset.reason}`);
	}
	await host.setStateAsync(IMMERSION_RUNTIME_STATES.faultReset, { val: false, ack: true });
	await runImmersionRuntimeTick(host);
}

let immersionPersistHydrated = false;

/** Phase D — Heizstab-Runtime-Persistenz von Disk laden (ohne Subscriptions/Ticks). */
export async function hydrateImmersionRuntimePersist(host: ImmersionRuntimeHost): Promise<void> {
	if (immersionPersistHydrated) {
		return;
	}
	const dataDir = host.getAbsolutePath?.("immersion_heater");
	if (dataDir) {
		const loaded = await readRuntimePersist(dataDir);
		if (loaded) {
			persist = loaded;
			if (persist.forceUntil && isForceExpired(persist.forceUntil, Date.now())) {
				persist.forceUntil = null;
				persist.resolvedMode = "auto";
			}
		}
	}
	immersionPersistHydrated = true;
}

export async function initImmersionRuntimeEngine(host: ImmersionRuntimeHost): Promise<void> {
	// Ensure immer — auch bei erneutem Init nach Adapter-Update (neue States wie plan_target_*).
	await ensureImmersionRuntimeStates(host);
	runtimeStatesEnsuredThisProcess = true;
	if (engineActive && hostRef === host) return;
	engineActive = true;
	hostRef = host;
	await initConsumerStatsForAddon(host, "immersion_heater");
	await hydrateImmersionRuntimePersist(host);

	const config = immersionDeviceConfigFromAdapter(host.config);
	const subs = new Set<string>([
		"user_intent.thermal.resolved_json",
		IMMERSION_RUNTIME_STATES.faultReset,
		addonEnabled("immersion_heater"),
		addonAvailable("immersion_heater"),
		DAILY_PLAN_STATE_IDS.revision,
		DAILY_PLAN_STATE_IDS.status,
		ALLOCATION_ADDON_STATE_IDS.immersion_heater.planJson,
	]);
	if (config.bufferTempStateId) subs.add(config.bufferTempStateId);
	if (config.actualPowerStateId) subs.add(config.actualPowerStateId);
	for (const s of config.stages) {
		if (s.feedbackStateId) subs.add(s.feedbackStateId);
	}

	if (host.subscribeStatesAsync) {
		for (const id of subs) {
			if (!id.startsWith("user_intent") && !id.startsWith("addons.")) continue;
			if (subscribedIds.includes(id)) continue;
			await host.subscribeStatesAsync(id);
			subscribedIds.push(id);
		}
	}
	if (host.subscribeForeignStatesAsync) {
		for (const id of subs) {
			if (id.startsWith("user_intent") || id.startsWith("addons.")) continue;
			if (subscribedIds.includes(id)) continue;
			await host.subscribeForeignStatesAsync(id);
			subscribedIds.push(id);
		}
	}

	await runImmersionRuntimeTick(host);
	host.log.debug?.("immersion_heater: runtime engine initialized");
}

export function stopImmersionRuntimeEngine(): void {
	const host = hostRef;
	clearTick();
	if (host) {
		void flushConsumerStatsPersist(host).catch((e) => host.log.debug?.(`immersion stats flush: ${e}`));
	}
	resetConsumerStatsCache();
	if (host?.unsubscribeStatesAsync) {
		for (const id of subscribedIds) {
			if (id.startsWith("user_intent") || id.startsWith("addons.")) {
				void host.unsubscribeStatesAsync(id).catch((e) => host.log.debug?.(`immersion unsub ${id}: ${e}`));
			}
		}
	}
	if (host?.unsubscribeForeignStatesAsync) {
		for (const id of subscribedIds) {
			if (!id.startsWith("user_intent") && !id.startsWith("addons.")) {
				void host.unsubscribeForeignStatesAsync(id).catch((e) => host.log.debug?.(`immersion foreign unsub ${id}: ${e}`));
			}
		}
	}
	engineActive = false;
	hostRef = null;
	immersionPersistHydrated = false;
	runtimeStatesEnsuredThisProcess = false;
	persist = emptyPersist();
	lastCommandedStage = -1;
	lastDailyPlanContext = null;
	resetImmersionDailyPlanCache();
	emsOnWriteAtMs = null;
	emsOffWriteAtMs = null;
	mismatchSinceMs = null;
	subscribedIds.length = 0;
	chatter = { timestampsMs: [] };
}

export function resetImmersionRuntimeForTest(): void {
	stopImmersionRuntimeEngine();
}

export function getImmersionPersistForTest(): RuntimePersistData {
	return persist;
}

export function getImmersionDailyPlanContextForTest(): ImmersionDailyPlanResolution | null {
	return lastDailyPlanContext;
}
