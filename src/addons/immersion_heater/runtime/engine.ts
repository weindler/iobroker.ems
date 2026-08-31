import { touchEmsActivity } from "../../../ems_activity";
import { isAddonExecutionOff, isLiveWriteAllowed } from "../../../execution_mode";
import { deviceValuesMatch, writeForeignIfChanged } from "../../../device_write";
import { assertDeviceActionAllowed } from "../../../restore/barrier";
import { isAddonGovernanceEnabledFromState } from "../../../addons/governance";
import {
	plannerStatusFromDailyPlan,
	publishAddonRuntimeSurface,
	type ExecutionStatus,
	type IntentStatus,
} from "../../../addons/runtime_surface";
import { setOptionalNumberIfChanged, setStateIfChanged } from "../../../policy/core/state_write";
import { INTENT_SCHEMA_VERSION, IOBROKER_THERMAL_REQUEST_STATE } from "../../../intent/core/constants";
import { addonAvailable, addonEnabled, addonMode } from "../../../tree_paths";
import { immersionDeviceConfigFromAdapter } from "../device_config";
import { validateImmersionDeviceConfig } from "../validate_config";
import { IMMERSION_STATUS_STATES } from "../status";
import { ensureImmersionRuntimeStates } from "./ensure_states";
import { runImmersionFsm, evaluateTemperature, controlModeToOperatingRequest } from "./fsm";
import { resolveThermalForecastTarget } from "../../../operator/planning/thermal_forecast";
import { addonGovernanceAiAllowedState } from "../../governance";
import { asNum } from "../../../ems_light/state_util";
import {
	emptyHygienePersist,
	evaluateHygieneDuty,
	recordBoilerHygieneIfMet,
	type HygienePersist,
} from "../hygiene";
import { IMMERSION_DEFAULT_KWH_PER_DEGREE_C } from "../../../operator/contributions/flexible/flex_demand";
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
import { resolveAuthoritativeThermalTarget } from "./thermal_target_authority";
import { computeImmersionLiveSurplusHold } from "./live_surplus_hold";
import { DAILY_PLAN_STATE_IDS, ALLOCATION_ADDON_STATE_IDS } from "../../../operator/daily_plan/states";
import {
	forceTargetFromIntent,
	forceUntilFromIntent,
	parseResolvedIntentJson,
	resolvedModeFromIntent,
} from "./intent_read";
import {
	detectImmersionManualMismatch,
	externalOnStatus,
	feedbackStageFromReadings,
	IMMERSION_MANUAL_OVERRIDE_DURATION_MS_DEFAULT,
	IMMERSION_OWNERSHIP_SETTLE_MS,
	normalizeFeedbackActive,
	type StageFeedbackReading,
} from "./feedback";
import {
	emptyDeviceOwnershipState,
	evaluateDeviceOwnership,
	isOwnershipOverrideActive,
} from "../../../ems_light/device_ownership";
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
/**
 * Vorherige effektive Write-Authority (global∧addon live).
 * Edge false→true erzwingt Hardware-Reconcile (auch bei unveränderter Sollstufe).
 */
let prevImmersionLiveWriteAllowed = false;
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
	if (config.boilerTempStateId) ids.add(config.boilerTempStateId);
	if (config.actualPowerStateId) ids.add(config.actualPowerStateId);
	for (const stage of config.stages) {
		if (stage.feedbackStateId) ids.add(stage.feedbackStateId);
	}
	return [...ids];
}

function readHygienePersist(raw: string | null): HygienePersist {
	if (!raw) return emptyHygienePersist();
	try {
		const j = JSON.parse(raw) as { lastBoilerHygieneAtIso?: unknown };
		return {
			lastBoilerHygieneAtIso:
				typeof j.lastBoilerHygieneAtIso === "string" ? j.lastBoilerHygieneAtIso : null,
		};
	} catch {
		return emptyHygienePersist();
	}
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

/** Ergebnis eines Hardware-Apply: nur bei Write-Erfolg oder bestätigtem Readback „angewandt“. */
export type ApplyStageWriteResult = {
	applied: boolean;
	/** Gewünschte Stufe > 0 und Apply bestätigt (Write oder Readback ON). */
	confirmedOn: boolean;
};

async function readbackMatchesDesired(
	host: ImmersionRuntimeHost,
	stateId: string,
	desiredOn: boolean,
): Promise<boolean> {
	if (!host.getForeignStateAsync) return false;
	try {
		const st = await host.getForeignStateAsync(stateId);
		if (!st) return false;
		return deviceValuesMatch(st.val ?? null, desiredOn);
	} catch {
		return false;
	}
}

/**
 * Schreibt Stufen-Relais. Rückgabe applied=false bei Governance-/Restore-Block,
 * fehlgeschlagenem Write oder Skip ohne bestätigtes Readback — Caller darf dann
 * lastCommandedStage / emsOnWriteAtMs nicht fortschreiben (Retry im nächsten Tick).
 */
async function applyStageWrites(
	host: ImmersionRuntimeHost,
	stageIndex: number,
	live: boolean,
): Promise<ApplyStageWriteResult> {
	const notApplied: ApplyStageWriteResult = { applied: false, confirmedOn: false };
	// Dryrun: EMS besitzt das Relais nicht — keine physischen Writes.
	if (!live) return notApplied;

	const governanceEnabled = await isAddonGovernanceEnabledFromState(
		(id) => host.getStateAsync(id),
		"immersion_heater",
	);
	if (!governanceEnabled) {
		host.log.debug?.("immersion apply skipped: governance disabled");
		return notApplied;
	}

	const gate = assertDeviceActionAllowed();
	if (!gate.ok) {
		host.log.debug?.(`immersion apply skipped: ${gate.reason}`);
		return notApplied;
	}

	if (!host.setForeignStateAsync || !host.getForeignStateAsync) {
		host.log.debug?.("immersion apply skipped: foreign state API unavailable");
		return notApplied;
	}

	const config = immersionDeviceConfigFromAdapter(host.config);
	const stages = config.stages.filter((s) => Boolean(s.setStateId));
	if (stages.length === 0) {
		return notApplied;
	}

	const writeHost = {
		getForeignStateAsync: (id: string) => host.getForeignStateAsync!(id),
		setForeignStateAsync: async (id: string, state: ioBroker.SettableState | ioBroker.StateValue) => {
			if (state && typeof state === "object" && "val" in state) {
				await host.setForeignStateAsync!(id, state as ioBroker.SettableState);
				return;
			}
			await host.setForeignStateAsync!(id, { val: (state as ioBroker.StateValue) ?? null, ack: false });
		},
		log: {
			info: (m: string) => host.log.debug?.(m),
			warn: (m: string) => host.log.warn?.(m),
			error: (m: string) => host.log.error?.(m),
			debug: (m: string) => host.log.debug?.(m),
		},
	};

	for (const stage of stages) {
		const on = stage.index === stageIndex;
		try {
			const writeResult = await writeForeignIfChanged(writeHost, {
				stateId: stage.setStateId,
				value: on,
				reason: `immersion stage ${stage.index}`,
			});
			if (writeResult.blocked) {
				host.log.debug?.(
					`immersion stage ${stage.index} blocked (${writeResult.blockReason ?? "blocked"}) — not applied`,
				);
				return notApplied;
			}
			if (writeResult.written) {
				continue;
			}
			if (writeResult.skipped) {
				// Skip allein reicht nicht — frisches Readback muss Soll bestätigen (TOCTOU / unklar).
				const confirmed = await readbackMatchesDesired(host, stage.setStateId, on);
				if (!confirmed) {
					host.log.debug?.(
						`immersion stage ${stage.index} skip without confirmed readback — not applied`,
					);
					return notApplied;
				}
				host.log.debug?.(`immersion stage ${stage.index} already ${on ? "ON" : "OFF"} — confirmed`);
				continue;
			}
			host.log.debug?.(`immersion stage ${stage.index} write neither written nor confirmed skip — not applied`);
			return notApplied;
		} catch (e) {
			host.log.error?.(`immersion write stage ${stage.index}: ${e}`);
			persist.faultLockout = true;
			persist.faultCode = "write_failed";
			persist.faultSince = new Date().toISOString();
			return notApplied;
		}
	}

	return { applied: true, confirmedOn: stageIndex > 0 };
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
	const executionOff = isAddonExecutionOff((await host.getStateAsync(addonMode("immersion_heater")))?.val);
	/** Off = keine EMS-Steuerung (auch kein Fallback); Telemetrie bleibt. */
	const controlEnabled = enabled && !executionOff;
	const live = await isLiveWriteAllowed((id) => host.getStateAsync(id), "immersion_heater");
	const liveEdge = live && !prevImmersionLiveWriteAllowed;
	prevImmersionLiveWriteAllowed = live;
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

	let boilerTempC: number | null = null;
	if (config.boilerTempEnabled && config.boilerTempStateId) {
		const br = await readForeignNum(host, config.boilerTempStateId);
		const boilerReading = evaluateTemperature(br.value, br.tsMs, nowMs, config);
		boilerTempC = boilerReading.status === "valid" ? boilerReading.valueC : null;
	} else {
		boilerTempC = await readLocalNum(host, "live.thermal.boiler_temp_c");
	}

	let hygienePersist = readHygienePersist(await readLocalStr(host, IMMERSION_RUNTIME_STATES.hygieneJson));
	hygienePersist = recordBoilerHygieneIfMet({
		boilerTempC,
		hygieneTargetTempC: config.hygieneTargetTempC,
		nowIso: now.toISOString(),
		persist: hygienePersist,
	});
	const hygiene = evaluateHygieneDuty({
		nowMs,
		boilerTempC,
		hygieneTargetTempC: config.hygieneTargetTempC,
		bufferTempC: temperature.valueC,
		bufferMaxTempC: config.planningMaxTempC,
		lastBoilerHygieneAtIso: hygienePersist.lastBoilerHygieneAtIso,
		kwhPerDegreeC: IMMERSION_DEFAULT_KWH_PER_DEGREE_C,
	});

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
	let liveSurplusHoldActive = false;
	const forecastPlanTarget = await resolveImmersionPlanTarget(
		host,
		config,
		temperature.valueC,
		resolvedMode,
		forceTarget,
	);

	if (executionOff) {
		plannerCommandedStage = 0;
		autoDecisionSource = "safe_default";
	} else if (resolvedMode === "auto") {
		const continueHeating = persist.commandedStage > 0 || lastCommandedStage > 0;
		const pvPowerW =
			(await readLocalNum(host, "live.pv.power_w")) ??
			(await readLocalNum(host, "live.battery.pv_ac_power_w"));
		const houseLoadW = await readLocalNum(host, "live.battery.house_load_w");
		const activeStageNominalW =
			config.stages.find((s) => s.index === persist.commandedStage && s.enabled)?.nominalPowerW ??
			config.stages.find((s) => s.index === lastCommandedStage && s.enabled)?.nominalPowerW ??
			0;
		const ihOnPowerW =
			measuredPower !== null && measuredPower > config.powerOnThresholdW
				? measuredPower
				: continueHeating && activeStageNominalW > 0
					? activeStageNominalW
					: null;
		const liveSurplusHold = computeImmersionLiveSurplusHold({
			pvPowerW,
			houseLoadW,
			immersionOnPowerW: ihOnPowerW,
			bufferTempC: temperature.valueC,
			targetTempC: forecastPlanTarget.targetTempC,
			planningMaxTempC: config.planningMaxTempC,
			continueHeating,
			config,
		});
		if (liveSurplusHold.active && persist.pauseUntilMs !== null) {
			persist.pauseUntilMs = null;
		}

		dailyPlanContext = await resolveImmersionDailyPlanAllocation(host, config, now, {
			continueHeating,
			liveSurplusHold,
		});
		lastDailyPlanContext = dailyPlanContext;
		if (dailyPlanContext.useDailyPlan) {
			// Daily Plan besitzt den Slot: Stufe aus Allocation (0 = absichtlich aus).
			plannerCommandedStage = dailyPlanContext.commandedStage;
			autoDecisionSource = "daily_plan";
			liveSurplusHoldActive =
				liveSurplusHold.active && liveSurplusHold.stageIndex === dailyPlanContext.commandedStage;
		} else {
			// One-Plan: ohne gültigen Daily Plan kein lokales Heizen.
			plannerCommandedStage = 0;
			autoDecisionSource = "thermal_fallback";
		}
	}

	const authority = resolveAuthoritativeThermalTarget({
		useDailyPlan: dailyPlanContext?.useDailyPlan === true,
		dailyPlanRevision: dailyPlanContext?.dailyPlanRevision ?? null,
		planEffectiveTargetTempC: dailyPlanContext?.effectiveTargetTempC ?? null,
		planTargetRevision: dailyPlanContext?.targetRevision ?? null,
		forecastTargetTempC: forecastPlanTarget.targetTempC,
		forceTargetTempC: forceTarget,
		resolvedMode,
		planningMinTempC: config.planningMinTempC,
		planningMaxTempC: config.planningMaxTempC,
		planTargetReasonDe: dailyPlanContext?.targetReasonDe ?? null,
		forecastReasonDe: forecastPlanTarget.reasonDe,
	});

	const plannerTargetTempC = authority.authoritativeTargetTempC;

	const fsm = runImmersionFsm({
		nowMs,
		addonEnabled: controlEnabled,
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
		liveSurplusHoldActive,
	});

	if (fsm.autoRevertToAuto) {
		resolvedMode = "auto";
		await submitAutoRevertToAuto(host, now);
	}

	const commandedStage = fsm.faultLockout ? 0 : fsm.commandedStage;
	const effectiveStage = persist.faultLockout || failsafeActive || resolvedMode === "off" ? 0 : commandedStage;
	const commandedOn = effectiveStage > 0;

	/*
	 * Klima-/Ownership-Block: Manual-Override erkennen, BEVOR der heutige Write erfolgt.
	 * Nutzt bewusst persist.commandedStage/lastFeedbackActive VOM VORTAKT (noch nicht
	 * überschrieben) — kein Reordering der Feedback-I/O nötig. Dadurch reagiert die
	 * Erkennung mit einem Takt Verzögerung (ein manueller Eingriff muss einen vollen Tick
	 * überstehen, bevor EMS pausiert) — bewusst konservativ, kein Overreacting auf
	 * kurzzeitige Ausreißer. Safety/Fault übersteuert einen laufenden Override sofort
	 * (siehe evaluateDeviceOwnership).
	 *
	 * Event = Flanke OFF→ON / ON→OFF, die EMS nicht selbst geschrieben hat (Settle-Fenster).
	 * Unverändertes Feedback verlängert den Timer nicht; nach Ablauf kein Sofort-Retrigger.
	 */
	const emsRecentlyActedImmersion =
		(persist.lastSwitchAtMs != null && nowMs - persist.lastSwitchAtMs < IMMERSION_OWNERSHIP_SETTLE_MS) ||
		(persist.lastOffAtMs != null && nowMs - persist.lastOffAtMs < IMMERSION_OWNERSHIP_SETTLE_MS);
	const immersionMismatchKind = emsRecentlyActedImmersion
		? ""
		: detectImmersionManualMismatch({
				prevCommandedStage: persist.commandedStage,
				prevFeedbackActive: persist.lastFeedbackActive,
				feedbackActiveBeforePrev: persist.lastFeedbackActiveBeforePrev,
			});
	const previousOwnership = persist.ownership ?? emptyDeviceOwnershipState();
	const prevOverrideActive = isOwnershipOverrideActive(previousOwnership, nowMs);
	const prevHadUserOverride = previousOwnership.owner === "user" && previousOwnership.overrideUntilIso != null;
	const ownership = evaluateDeviceOwnership({
		nowMs,
		mismatchDetected: immersionMismatchKind !== "",
		mismatchKind: immersionMismatchKind,
		previous: previousOwnership,
		overrideDurationMs: IMMERSION_MANUAL_OVERRIDE_DURATION_MS_DEFAULT,
		safetyOverride: persist.faultLockout || failsafeActive,
	});
	persist.ownership = ownership;
	const ownershipOverrideActive = isOwnershipOverrideActive(ownership, nowMs);
	const overrideJustExpired = prevHadUserOverride && !ownershipOverrideActive;

	if (ownershipOverrideActive && !prevOverrideActive) {
		host.log.info?.(`immersion: manual override detected (${ownership.reasonDe})`);
	} else if (overrideJustExpired && !persist.faultLockout && !failsafeActive) {
		host.log.info?.("immersion: manual override expired — EMS control resumed");
	}

	// Stage-Wechsel, Live-Kante oder Override-Ablauf: gewünschten Soll physisch anwenden.
	// Solange nicht (global∧addon) live, besitzt EMS keine Hardware-Authority.
	// lastCommandedStage / emsOnWriteAtMs nur nach bestätigtem Apply (Write oder Readback),
	// sonst Retry im nächsten normalen Runtime-Tick (kein Spam-Loop).
	const stageChanged = effectiveStage !== lastCommandedStage;
	/** Admin-Mindestpause (`ih_minimum_pause_sec`) — nicht vom FSM-Persist-Altzustand überschreiben. */
	let pauseSetOnOffMs: number | null = null;
	if (!ownershipOverrideActive && (stageChanged || liveEdge || overrideJustExpired)) {
		if (liveEdge && !stageChanged && !overrideJustExpired) {
			host.log.info?.(
				`immersion: effective live authority gained — reconcile stage ${effectiveStage} (desired unchanged)`,
			);
		}
		const applyResult = await applyStageWrites(host, effectiveStage, live);
		if (applyResult.applied) {
			if (stageChanged) {
				if (effectiveStage === 0) {
					persist.lastOffAtMs = nowMs;
					if (!liveSurplusHoldActive) {
						pauseSetOnOffMs = nowMs + Math.max(0, config.minimumPauseSec) * 1000;
						persist.pauseUntilMs = pauseSetOnOffMs;
					} else {
						persist.pauseUntilMs = null;
					}
				} else {
					persist.lastSwitchAtMs = nowMs;
				}
				chatter = recordChatterEvent(chatter, nowMs, config.relayChatterWindowSec);
			} else if (overrideJustExpired) {
				if (effectiveStage === 0) persist.lastOffAtMs = nowMs;
				else persist.lastSwitchAtMs = nowMs;
			}
			if (effectiveStage === 0) {
				emsOffWriteAtMs = nowMs;
			} else if (applyResult.confirmedOn) {
				emsOnWriteAtMs = nowMs;
			}
			lastCommandedStage = effectiveStage;
		} else if (live) {
			host.log.debug?.(
				`immersion: stage ${effectiveStage} apply not confirmed — retry next tick (lastApplied=${lastCommandedStage})`,
			);
		}
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
	persist.lastFeedbackActiveBeforePrev = persist.lastFeedbackActive;
	persist.lastFeedbackActive = feedbackActive;
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
	persist.pauseUntilMs = pauseSetOnOffMs !== null ? pauseSetOnOffMs : fsm.pauseUntilMs;
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
		plan_target_temp_c: plannerTargetTempC,
		plan_target_reason_de:
			resolvedMode === "auto" && autoDecisionSource === "thermal_fallback"
				? "One-Plan-Fallback: Daily Plan nicht nutzbar, daher kein lokaler Heiz-Start."
				: authority.reasonDe,
		forecast_target_temp_c: authority.forecastTargetTempC,
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
	await setStateIfChanged(host, IMMERSION_RUNTIME_STATES.configMinimumRuntimeSec, config.minimumRuntimeSec);
	await setStateIfChanged(host, IMMERSION_RUNTIME_STATES.configMinimumPauseSec, config.minimumPauseSec);
	await setStateIfChanged(host, IMMERSION_RUNTIME_STATES.boilerTemperatureC, boilerTempC);
	await setStateIfChanged(host, IMMERSION_RUNTIME_STATES.boilerMinTempC, config.boilerMinTempC);
	await setStateIfChanged(host, IMMERSION_RUNTIME_STATES.hygieneJson, JSON.stringify(hygienePersist));
	await setStateIfChanged(
		host,
		IMMERSION_RUNTIME_STATES.hygieneStatusDe,
		hygiene.reasonDe + (hygiene.blockedByBufferMax ? " [Puffer-Max]" : ""),
	);
	await setStateIfChanged(host, "live.thermal.boiler_temp_c", boilerTempC);

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
	await setStateIfChanged(host, IMMERSION_RUNTIME_STATES.faultActive, s.fault_active);
	await setStateIfChanged(host, IMMERSION_RUNTIME_STATES.faultCode, s.fault_code);
	await setStateIfChanged(host, IMMERSION_RUNTIME_STATES.faultSince, s.fault_since ?? "");
	await setStateIfChanged(host, IMMERSION_RUNTIME_STATES.faultMessage, s.fault_message);
	await setStateIfChanged(host, IMMERSION_RUNTIME_STATES.reason, s.reason);
	await setStateIfChanged(host, IMMERSION_RUNTIME_STATES.decisionSource, decisionSource);
	await setStateIfChanged(
		host,
		IMMERSION_RUNTIME_STATES.dailyPlanStatus,
		dailyPlan?.dailyPlanStatus ?? "daily_plan_missing",
	);
	await setStateIfChanged(
		host,
		IMMERSION_RUNTIME_STATES.allocatedPowerW,
		dailyPlan?.allocatedPowerW ?? null,
	);
	await setStateIfChanged(host, IMMERSION_RUNTIME_STATES.allocationReasonDe, dailyPlan?.allocationReasonDe ?? "");
	await setStateIfChanged(host, IMMERSION_RUNTIME_STATES.autoTargetReached, persist.autoTargetReached);
	await setStateIfChanged(host, IMMERSION_RUNTIME_STATES.ownershipOwner, persist.ownership.owner);
	await setStateIfChanged(
		host,
		IMMERSION_RUNTIME_STATES.ownershipOverrideUntilIso,
		persist.ownership.overrideUntilIso ?? "",
	);
	await setStateIfChanged(host, IMMERSION_RUNTIME_STATES.ownershipReasonDe, persist.ownership.reasonDe);

	const governanceOn = await isAddonGovernanceEnabledFromState(
		(id) => host.getStateAsync(id),
		"immersion_heater",
	);
	const lockout = s.state === "fault_lockout" || decisionSource === "lockout";
	let intentStatus: IntentStatus = "idle";
	if (s.fault_active || lockout || decisionSource === "safety") {
		intentStatus = "blocked";
	} else if (s.commanded_stage > 0) {
		intentStatus = "active";
	} else if (s.resolved_mode === "off") {
		intentStatus = "none";
	}
	let executionStatus: ExecutionStatus = s.execution_mode === "live" ? "live" : "dryrun";
	if (s.fault_active) {
		executionStatus = "fault";
	} else if (lockout) {
		executionStatus = "lockout";
	}
	await publishAddonRuntimeSurface(host, "immersion_heater", {
		decisionDetail: decisionSource,
		decisionReason: s.reason || dailyPlan?.allocationReasonDe || "",
		nowIso: s.updated_at,
		plannerStatus: plannerStatusFromDailyPlan({
			governanceEnabled: governanceOn,
			useDailyPlan: dailyPlan?.useDailyPlan === true,
			dailyPlanStatus: dailyPlan?.dailyPlanStatus ?? null,
		}),
		intentStatus,
		executionStatus,
		profileReady: s.available === true,
		telemetryReady: s.temperature_status === "valid",
		fault: s.fault_active,
		lockout,
	});
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
	if (config.boilerTempStateId) subs.add(config.boilerTempStateId);
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
	prevImmersionLiveWriteAllowed = false;
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

/** Test-Hook: zuletzt erfolgreich angewandte Stufe (−1 = noch nie bestätigt). */
export function getImmersionLastCommandedStageForTest(): number {
	return lastCommandedStage;
}

/** Test-Hook: Zeitpunkt des letzten bestätigten EMS-ON-Writes / ON-Readbacks. */
export function getImmersionEmsOnWriteAtMsForTest(): number | null {
	return emsOnWriteAtMs;
}
