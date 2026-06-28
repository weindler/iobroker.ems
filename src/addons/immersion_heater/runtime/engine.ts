import { isLiveWriteAllowed } from "../../../execution_mode";
import { isAddonGovernanceEnabledFromState } from "../../../addons/governance";
import { setStateIfChanged } from "../../../policy/core/state_write";
import { INTENT_SCHEMA_VERSION, IOBROKER_THERMAL_REQUEST_STATE } from "../../../intent/core/constants";
import { addonAvailable, addonEnabled } from "../../../tree_paths";
import { immersionDeviceConfigFromAdapter } from "../device_config";
import { validateImmersionDeviceConfig } from "../validate_config";
import { IMMERSION_STATUS_STATES } from "../status";
import { ensureImmersionRuntimeStates } from "./ensure_states";
import { runImmersionFsm, evaluateTemperature, controlModeToOperatingRequest } from "./fsm";
import {
	canResetFault,
	checkPowerFault,
	isRelayChatter,
	recordChatterEvent,
	type ChatterTracker,
} from "./safety";
import type { RuntimePersistData, RuntimeSnapshot } from "./types";
import {
	IMMERSION_RUNTIME_STATES,
} from "./types";
import {
	emptyPersist,
	isForceExpired,
	readRuntimePersist,
	writeRuntimePersist,
} from "./persist";
import { forceTargetFromIntent, forceUntilFromIntent, parseResolvedIntentJson, resolvedModeFromIntent } from "./intent_read";
import {
	externalOnStatus,
	feedbackStageFromReadings,
	normalizeFeedbackActive,
	type StageFeedbackReading,
} from "./feedback";

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
			await host.setForeignStateAsync(stage.setStateId, { val: on, ack: true });
		} catch (e) {
			host.log.error?.(`immersion write stage ${stage.index}: ${e}`);
			persist.faultLockout = true;
			persist.faultCode = "write_failed";
			persist.faultSince = new Date().toISOString();
		}
	}
}

export async function runImmersionRuntimeTick(host: ImmersionRuntimeHost): Promise<void> {
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

	const minRuntimeRem = persist.minRuntimeUntilMs ? Math.max(0, Math.ceil((persist.minRuntimeUntilMs - nowMs) / 1000)) : 0;
	const minPauseRem = persist.pauseUntilMs ? Math.max(0, Math.ceil((persist.pauseUntilMs - nowMs) / 1000)) : 0;

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

	await publishRuntime(host, snapshot);

	const dataDir = host.getAbsolutePath?.("immersion_heater");
	if (dataDir) {
		await writeRuntimePersist(dataDir, persist);
	}

	scheduleTick();
}

async function publishRuntime(host: ImmersionRuntimeHost, s: RuntimeSnapshot): Promise<void> {
	await setStateIfChanged(host, IMMERSION_RUNTIME_STATES.available, s.available);
	await setStateIfChanged(host, IMMERSION_RUNTIME_STATES.state, s.state);
	await setStateIfChanged(host, IMMERSION_RUNTIME_STATES.requestedMode, s.requested_mode);
	await setStateIfChanged(host, IMMERSION_RUNTIME_STATES.resolvedMode, s.resolved_mode);
	await setStateIfChanged(host, IMMERSION_RUNTIME_STATES.bufferTemperatureC, s.buffer_temperature_c ?? "");
	await setStateIfChanged(host, IMMERSION_RUNTIME_STATES.temperatureStatus, s.temperature_status);
	await setStateIfChanged(host, IMMERSION_RUNTIME_STATES.planningMinTempC, s.planning_min_temp_c);
	await setStateIfChanged(host, IMMERSION_RUNTIME_STATES.planningMaxTempC, s.planning_max_temp_c);
	await setStateIfChanged(host, IMMERSION_RUNTIME_STATES.forceTargetTempC, s.force_target_temp_c ?? "");
	await setStateIfChanged(host, IMMERSION_RUNTIME_STATES.forceUntil, s.force_until ?? "");
	await setStateIfChanged(host, IMMERSION_RUNTIME_STATES.commandedStage, s.commanded_stage);
	await setStateIfChanged(host, IMMERSION_RUNTIME_STATES.commandedPowerW, s.commanded_power_w);
	await setStateIfChanged(host, IMMERSION_RUNTIME_STATES.feedbackStage, s.feedback_stage);
	await setStateIfChanged(host, IMMERSION_RUNTIME_STATES.measuredPowerW, s.measured_power_w ?? "");
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
}

export async function handleImmersionFaultReset(host: ImmersionRuntimeHost, ack: boolean | undefined): Promise<void> {
	if (ack === true) return;
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

export async function initImmersionRuntimeEngine(host: ImmersionRuntimeHost): Promise<void> {
	if (engineActive && hostRef === host) return;
	engineActive = true;
	hostRef = host;
	await ensureImmersionRuntimeStates(host);
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

	const config = immersionDeviceConfigFromAdapter(host.config);
	const subs = new Set<string>([
		"user_intent.thermal.resolved_json",
		IMMERSION_RUNTIME_STATES.faultReset,
		addonEnabled("immersion_heater"),
		addonAvailable("immersion_heater"),
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
	host.log.info("immersion_heater: runtime engine initialized");
}

export function stopImmersionRuntimeEngine(): void {
	const host = hostRef;
	clearTick();
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
	persist = emptyPersist();
	lastCommandedStage = -1;
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
