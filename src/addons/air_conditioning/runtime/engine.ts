import { touchEmsActivity } from "../../../ems_activity";
import { isLiveWriteAllowed } from "../../../execution_mode";
import { asNum } from "../../../ems_light/state_util";
import { setStateIfChanged } from "../../../policy/core/state_write";
import { addonEnabled, addonAvailable } from "../../../tree_paths";
import {
	tickConsumerStats,
	initConsumerStatsForKey,
	flushConsumerStatsPersist,
	resetConsumerStatsCache,
} from "../../../learning/consumer_stats";
import type { DeviceWriteHost } from "../../../device_write";
import { acUnitConsumerKey, AC_ADDON_ID, AC_CLEANING_REFRESH_MS, AC_FEEDBACK_POLL_ATTEMPTS, AC_FEEDBACK_POLL_MS, AC_START_RETRY_MS, AC_STOP_RETRY_MS, AC_TICK_MS, AC_WATCH_MAPPING_ROLES } from "../constants";
import { acGlobalConfigFromAdapter } from "../config";
import type { AcUnitConfig } from "../types";
import { getAcProfile } from "../profiles/registry";
import type { AcUnitModePurpose } from "../types";
import { acUnitRuntimeStates, AC_RUNTIME_BASE, ensureAcRuntimeStates } from "./ensure_states";
import { evaluateAcUnitFsm } from "./fsm";
import { emptyUnitPersist, type AcRuntimePersist, type AcUnitPersist } from "./persist";
import { readAcRuntimePersist, writeAcRuntimePersist } from "./persist_io";
import {
	buildAcMappingTableFromConfig,
	executeAcWriteSteps,
	resolveAcMappingTarget,
	type AcMappingTable,
} from "./sequences";
import { acStatsDeviceActive } from "./stats_active";
import {
	isCleaningFinishedByFeedback,
	isCleaningFinishedByProgress,
	shouldMarkCleaningOperatingActive,
	shouldMarkCleaningProgressActive,
} from "./cleaning";
import { switchIsOff, switchIsOn } from "./time";

export type AcRuntimeHost = DeviceWriteHost & {
	config?: unknown;
	namespace?: string;
	getAbsolutePath?: (category?: string) => string;
	log: { info: (m: string) => void; warn: (m: string) => void; debug?: (m: string) => void; error?: (m: string) => void };
	setObjectNotExistsAsync: (id: string, obj: ioBroker.Object) => Promise<unknown>;
	getStateAsync: (id: string) => Promise<ioBroker.State | null | undefined>;
	getForeignStateAsync?: (id: string) => Promise<ioBroker.State | null | undefined>;
	setStateAsync: (id: string, state: ioBroker.SettableState) => Promise<unknown>;
	subscribeStatesAsync?: (pattern: string) => Promise<void>;
	subscribeForeignStatesAsync?: (pattern: string) => Promise<void>;
	unsubscribeForeignStatesAsync?: (pattern: string) => Promise<void>;
};

let engineActive = false;
let hostRef: AcRuntimeHost | null = null;
let persist: AcRuntimePersist = { version: 1, units: {} };
let tickTimer: ReturnType<typeof setTimeout> | null = null;
let tickRunning = false;
const subscribedIds: string[] = [];

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
		void runAcRuntimeTick(hostRef).catch((e) => hostRef?.log.warn(`ac runtime tick: ${e}`));
	}, AC_TICK_MS);
}

async function readForeign(host: AcRuntimeHost, id: string): Promise<{ value: unknown; num: number | null }> {
	if (!id) return { value: null, num: null };
	try {
		const reader = host.getForeignStateAsync ?? host.getStateAsync;
		const st = await reader(id);
		return { value: st?.val ?? null, num: asNum(st?.val) };
	} catch {
		return { value: null, num: null };
	}
}

function unitPersist(index: number): AcUnitPersist {
	if (!persist.units[index]) {
		persist.units[index] = emptyUnitPersist(index);
	}
	return persist.units[index];
}

function allocatedPowerW(runningCount: number, outdoorMax: number, unitEstimated: number): number {
	if (runningCount <= 0) return 0;
	if (runningCount === 1) return unitEstimated;
	return Math.min(unitEstimated, Math.round(outdoorMax / runningCount));
}

function stopRetryReady(up: AcUnitPersist, nowMs: number): boolean {
	return !up.lastStopAtMs || nowMs - up.lastStopAtMs >= AC_STOP_RETRY_MS;
}

function scheduleCleaningAfterStop(
	host: AcRuntimeHost,
	unit: AcUnitConfig,
	up: AcUnitPersist,
	nowMs: number,
): void {
	if (!unit.cleaningAfterRun || up.cleaningActive) {
		return;
	}
	if (up.cleaningPendingUntilMs && up.cleaningPendingUntilMs > nowMs) {
		return;
	}
	up.cleaningPendingUntilMs = nowMs + unit.cleaningDelayMin * 60_000;
	const at = new Date(up.cleaningPendingUntilMs).toLocaleTimeString("de-AT", { hour: "2-digit", minute: "2-digit" });
	host.log.info(`ac unit ${unit.index}: cleaning scheduled in ${unit.cleaningDelayMin} min (at ~${at})`);
}

async function stopUnit(
	host: AcRuntimeHost,
	unit: AcUnitConfig,
	table: AcMappingTable,
	live: boolean,
	up: AcUnitPersist,
): Promise<void> {
	const offId = resolveAcMappingTarget(table, unit.index, "cmd_switch_off");
	const refreshId = resolveAcMappingTarget(table, unit.index, "cmd_refresh");
	if (live && offId) {
		await executeAcWriteSteps(host, unit.index, table, [{ kind: "toggle", role: "cmd_switch_off" }], true, host.log);
		if (refreshId) {
			await executeAcWriteSteps(host, unit.index, table, [{ kind: "toggle", role: "cmd_refresh" }], true, host.log);
		}
		host.log.info(`ac unit ${unit.index}: stop (live)`);
	} else if (!live) {
		host.log.debug?.(`ac dryrun unit ${unit.index}: stop`);
	}
	up.running = false;
	up.lastStopAtMs = Date.now();
	scheduleCleaningAfterStop(host, unit, up, up.lastStopAtMs);
}

async function waitForFeedbackOn(
	host: AcRuntimeHost,
	fbId: string,
): Promise<{ on: boolean; value: unknown }> {
	if (!fbId) {
		return { on: false, value: null };
	}
	for (let attempt = 0; attempt < AC_FEEDBACK_POLL_ATTEMPTS; attempt++) {
		await new Promise((resolve) => setTimeout(resolve, AC_FEEDBACK_POLL_MS));
		const fb = await readForeign(host, fbId);
		if (switchIsOn(fb.value)) {
			return { on: true, value: fb.value };
		}
	}
	const fb = await readForeign(host, fbId);
	return { on: switchIsOn(fb.value), value: fb.value };
}

async function startUnit(
	host: AcRuntimeHost,
	unit: AcUnitConfig,
	table: AcMappingTable,
	live: boolean,
	up: AcUnitPersist,
	modePurpose: AcUnitModePurpose,
): Promise<void> {
	const profile = getAcProfile(unit.profileId);
	const steps = profile.coolingStartSequence(unit, modePurpose);
	await executeAcWriteSteps(host, unit.index, table, steps, live, host.log);
	up.lastStartAtMs = Date.now();
	if (!live) {
		up.running = true;
		return;
	}
	const fbId = resolveAcMappingTarget(table, unit.index, "feedback_switch");
	const fb = await waitForFeedbackOn(host, fbId);
	if (fb.on) {
		up.running = true;
		host.log.info(`ac unit ${unit.index}: started — feedback on`);
	} else {
		up.running = false;
		host.log.warn(
			`ac unit ${unit.index}: start sequence sent but feedback still off after ${Math.round((AC_FEEDBACK_POLL_MS * AC_FEEDBACK_POLL_ATTEMPTS) / 1000)}s (last=${String(fb.value ?? "")})`,
		);
	}
}

async function finishCleaning(
	host: AcRuntimeHost,
	unit: AcUnitConfig,
	table: AcMappingTable,
	live: boolean,
	up: AcUnitPersist,
	reason: string,
	sendStop: boolean,
): Promise<void> {
	if (sendStop && live) {
		const profile = getAcProfile(unit.profileId);
		await executeAcWriteSteps(host, unit.index, table, profile.cleaningStopSequence(), true, host.log);
	}
	up.cleaningActive = false;
	up.cleaningStartedAtMs = null;
	up.cleaningSawOperatingActive = false;
	up.cleaningSawProgressActive = false;
	up.cleaningStartProgressPct = null;
	up.cleaningLastRefreshAtMs = null;
	host.log.info(`ac unit ${unit.index}: cleaning finished — ${reason}`);
}

async function tickCleaning(
	host: AcRuntimeHost,
	unit: AcUnitConfig,
	table: AcMappingTable,
	live: boolean,
	up: AcUnitPersist,
	nowMs: number,
	cleaningStateRaw: unknown,
	cleaningModeRaw: unknown,
	cleaningProgressPct: number | null,
): Promise<void> {
	const pending = up.cleaningPendingUntilMs;
	if (pending && nowMs >= pending && !up.cleaningActive) {
		up.cleaningPendingUntilMs = null;
		const profile = getAcProfile(unit.profileId);
		if (live) {
			await executeAcWriteSteps(host, unit.index, table, profile.cleaningStartSequence(), true, host.log);
			const refreshId = resolveAcMappingTarget(table, unit.index, "cmd_refresh");
			if (refreshId) {
				await executeAcWriteSteps(host, unit.index, table, [{ kind: "toggle", role: "cmd_refresh" }], true, host.log);
			}
			host.log.info(`ac unit ${unit.index}: cleaning started (live)`);
		} else {
			host.log.info(`ac unit ${unit.index}: cleaning started (dryrun)`);
		}
		up.cleaningActive = true;
		up.cleaningStartedAtMs = nowMs;
		up.cleaningSawOperatingActive = false;
		up.cleaningSawProgressActive = false;
		up.cleaningStartProgressPct = null;
		up.cleaningLastRefreshAtMs = nowMs;
	}

	if (!up.cleaningActive || !up.cleaningStartedAtMs) {
		return;
	}

	const stateFbId = resolveAcMappingTarget(table, unit.index, "feedback_cleaning_state");
	const modeFbId = resolveAcMappingTarget(table, unit.index, "feedback_cleaning_mode");
	const progressFbId = resolveAcMappingTarget(table, unit.index, "feedback_cleaning_progress");
	const hasCleaningFeedback = Boolean(stateFbId || modeFbId || progressFbId);
	const refreshId = resolveAcMappingTarget(table, unit.index, "cmd_refresh");
	const lastRefresh = up.cleaningLastRefreshAtMs ?? up.cleaningStartedAtMs;
	if (live && refreshId && nowMs - lastRefresh >= AC_CLEANING_REFRESH_MS) {
		await executeAcWriteSteps(host, unit.index, table, [{ kind: "toggle", role: "cmd_refresh" }], true, host.log);
		up.cleaningLastRefreshAtMs = nowMs;
	}

	if (hasCleaningFeedback) {
		const elapsedSec = Math.round((nowMs - up.cleaningStartedAtMs) / 1000);
		if (up.cleaningStartProgressPct == null && cleaningProgressPct != null) {
			up.cleaningStartProgressPct = cleaningProgressPct;
		}
		if (shouldMarkCleaningOperatingActive(cleaningStateRaw, elapsedSec)) {
			up.cleaningSawOperatingActive = true;
		}
		if (shouldMarkCleaningProgressActive(cleaningProgressPct)) {
			up.cleaningSawProgressActive = true;
		}

		if (
			progressFbId &&
			isCleaningFinishedByProgress({
				progressPct: cleaningProgressPct,
				sawProgressActive: up.cleaningSawProgressActive,
				sawOperatingActive: up.cleaningSawOperatingActive,
				startProgressPct: up.cleaningStartProgressPct,
				elapsedSec,
			})
		) {
			await finishCleaning(
				host,
				unit,
				table,
				live,
				up,
				`feedback (progress=${cleaningProgressPct ?? "?"}%, ${elapsedSec}s)`,
				true,
			);
			return;
		}

		if (
			isCleaningFinishedByFeedback({
				operatingStateRaw: cleaningStateRaw,
				modeRaw: cleaningModeRaw,
				sawOperatingActive: up.cleaningSawOperatingActive,
				elapsedSec,
			})
		) {
			const op = String(cleaningStateRaw ?? "");
			const mode = String(cleaningModeRaw ?? "");
			await finishCleaning(
				host,
				unit,
				table,
				live,
				up,
				`feedback (operatingState=${op || "?"}, mode=${mode || "?"}, ${elapsedSec}s)`,
				true,
			);
			return;
		}
	}

	const timeoutMs = unit.cleaningDurationMin * 60_000;
	if (unit.cleaningDurationMin > 0 && nowMs >= up.cleaningStartedAtMs + timeoutMs) {
		await finishCleaning(
			host,
			unit,
			table,
			live,
			up,
			`timeout (${unit.cleaningDurationMin} min)`,
			true,
		);
	}
}

export async function runAcRuntimeTick(host: AcRuntimeHost): Promise<void> {
	if (tickRunning) return;
	tickRunning = true;
	try {
		await runAcRuntimeTickBody(host);
	} finally {
		tickRunning = false;
	}
}

async function runAcRuntimeTickBody(host: AcRuntimeHost): Promise<void> {
	touchEmsActivity();
	const now = new Date();
	const nowMs = now.getTime();
	const config = acGlobalConfigFromAdapter(host.config);
	const configRecord = host.config && typeof host.config === "object" ? (host.config as Record<string, unknown>) : {};
	const mappingTable = buildAcMappingTableFromConfig(configRecord);
	const addonOn = await host.getStateAsync(addonEnabled(AC_ADDON_ID));
	const addonEnabledVal = addonOn?.val !== false;
	const live = await isLiveWriteAllowed((id) => host.getStateAsync(id), AC_ADDON_ID);

	const activeUnits = config.units.filter((u) => u.enabled);
	let runningCount = 0;

	for (const unit of activeUnits) {
		const tempId = resolveAcMappingTarget(mappingTable, unit.index, "room_temp");
		const humId = resolveAcMappingTarget(mappingTable, unit.index, "room_humidity");
		const fbId = resolveAcMappingTarget(mappingTable, unit.index, "feedback_switch");
		const cleaningStateId = resolveAcMappingTarget(mappingTable, unit.index, "feedback_cleaning_state");
		const cleaningModeId = resolveAcMappingTarget(mappingTable, unit.index, "feedback_cleaning_mode");
		const cleaningProgressId = resolveAcMappingTarget(mappingTable, unit.index, "feedback_cleaning_progress");
		const temp = await readForeign(host, tempId);
		const hum = await readForeign(host, humId);
		const fb = await readForeign(host, fbId);
		const cleaningState = await readForeign(host, cleaningStateId);
		const cleaningMode = await readForeign(host, cleaningModeId);
		const cleaningProgress = await readForeign(host, cleaningProgressId);
		const up = unitPersist(unit.index);
		if (switchIsOn(fb.value)) runningCount += 1;

		await tickCleaning(
			host,
			unit,
			mappingTable,
			live,
			up,
			nowMs,
			cleaningState.value,
			cleaningMode.value,
			cleaningProgress.num,
		);

		if (!addonEnabledVal && switchIsOn(fb.value) && stopRetryReady(up, nowMs)) {
			await stopUnit(host, unit, mappingTable, live, up);
		}

		const fsm = evaluateAcUnitFsm({
			now,
			addonEnabled: addonEnabledVal,
			unit,
			roomTempC: temp.num,
			roomHumidityPct: hum.num,
			feedbackSwitchRaw: fb.value,
			cleaningActive: up.cleaningActive,
		});

		if (fsm.demandStop) {
			if (switchIsOn(fb.value)) {
				if (stopRetryReady(up, nowMs)) {
					if (up.lastStopAtMs) {
						host.log.info(
							`ac unit ${unit.index}: retry stop (${Math.round((nowMs - up.lastStopAtMs) / 1000)}s since last attempt)`,
						);
					}
					await stopUnit(host, unit, mappingTable, live, up);
				}
			} else {
				up.running = false;
			}
		} else if (fsm.demandStart && switchIsOff(fb.value)) {
			if (live) {
				const cooledDown = !up.lastStartAtMs || nowMs - up.lastStartAtMs >= AC_START_RETRY_MS;
				if (cooledDown) {
					if (up.lastStartAtMs) {
						host.log.info(
							`ac unit ${unit.index}: retry start (${Math.round((nowMs - up.lastStartAtMs) / 1000)}s since last attempt)`,
						);
					}
					await startUnit(host, unit, mappingTable, live, up, fsm.modePurpose);
				}
			} else if (!up.running) {
				await startUnit(host, unit, mappingTable, live, up, fsm.modePurpose);
			}
		}

		if (switchIsOn(fb.value)) {
			up.running = true;
		} else if (live && switchIsOff(fb.value)) {
			up.running = false;
		}

		const ids = acUnitRuntimeStates(unit.index);
		const fbOn = switchIsOn(fb.value);
		const deviceActive = acStatsDeviceActive(up, fbOn, up.running);
		const estPower = deviceActive
			? allocatedPowerW(runningCount || 1, config.outdoorMaxPowerW, unit.estimatedPowerW)
			: 0;
		await setStateIfChanged(host, ids.state, fsm.state);
		await setStateIfChanged(host, ids.reasonDe, fsm.reasonDe);
		await setStateIfChanged(host, ids.roomTempC, temp.num ?? "");
		await setStateIfChanged(host, ids.roomHumidityPct, hum.num ?? "");
		await setStateIfChanged(host, ids.feedbackSwitch, fb.value == null ? "" : String(fb.value));
		await setStateIfChanged(host, ids.running, fbOn);
		await setStateIfChanged(host, ids.cleaningActive, up.cleaningActive);
		await setStateIfChanged(host, ids.feedbackCleaningState, cleaningState.value == null ? "" : String(cleaningState.value));
		await setStateIfChanged(host, ids.feedbackCleaningMode, cleaningMode.value == null ? "" : String(cleaningMode.value));
		await setStateIfChanged(host, ids.feedbackCleaningProgressPct, cleaningProgress.num ?? "");
		await setStateIfChanged(host, ids.modePurpose, fsm.modePurpose);
		await setStateIfChanged(host, ids.estimatedPowerW, estPower);

		await tickConsumerStats(host, {
			consumerKey: acUnitConsumerKey(unit.index),
			nowMs,
			deviceActive,
			countable: deviceActive,
			measuredPowerW: null,
			commandedPowerW: estPower,
		});
	}

	await setStateIfChanged(host, `${AC_RUNTIME_BASE}.outdoor_allocated_power_w`, config.outdoorMaxPowerW);

	const dataDir = host.getAbsolutePath?.("air_conditioning");
	if (dataDir) {
		await writeAcRuntimePersist(dataDir, persist);
	}
	scheduleTick();
}

export async function initAcRuntimeEngine(host: AcRuntimeHost): Promise<void> {
	if (engineActive && hostRef === host) return;
	engineActive = true;
	hostRef = host;
	await ensureAcRuntimeStates(host);
	for (let i = 1; i <= 5; i++) {
		await initConsumerStatsForKey(host, acUnitConsumerKey(i));
	}
	const dataDir = host.getAbsolutePath?.("air_conditioning");
	if (dataDir) {
		persist = await readAcRuntimePersist(dataDir);
	}
	const cfg = acGlobalConfigFromAdapter(host.config);
	const configRecord = host.config && typeof host.config === "object" ? (host.config as Record<string, unknown>) : {};
	const mappingTable = buildAcMappingTableFromConfig(configRecord);
	const subs = new Set<string>([addonEnabled(AC_ADDON_ID), addonAvailable(AC_ADDON_ID)]);
	if (host.subscribeStatesAsync) {
		for (const id of subs) {
			if (subscribedIds.includes(id)) continue;
			await host.subscribeStatesAsync(id);
			subscribedIds.push(id);
		}
	}
	for (const unit of cfg.units.filter((u) => u.enabled)) {
		for (const role of AC_WATCH_MAPPING_ROLES) {
			const id = resolveAcMappingTarget(mappingTable, unit.index, role);
			if (id) subs.add(id);
		}
	}
	if (host.subscribeForeignStatesAsync) {
		for (const id of subs) {
			if (id.startsWith("addons.")) continue;
			if (subscribedIds.includes(id)) continue;
			await host.subscribeForeignStatesAsync(id);
			subscribedIds.push(id);
		}
	}
	await runAcRuntimeTick(host);
	host.log.info("air_conditioning: runtime engine initialized");
}

export function stopAcRuntimeEngine(): void {
	const host = hostRef;
	clearTick();
	if (host) {
		void flushConsumerStatsPersist(host).catch((e) => host.log.debug?.(`ac stats flush: ${e}`));
	}
	resetConsumerStatsCache();
	if (host?.unsubscribeForeignStatesAsync) {
		for (const id of subscribedIds) {
			if (!id.startsWith("addons.")) {
				void host.unsubscribeForeignStatesAsync(id).catch(() => undefined);
			}
		}
	}
	engineActive = false;
	hostRef = null;
	persist = { version: 1, units: {} };
	subscribedIds.length = 0;
}

export function acRuntimeWatchedForeignIds(config: unknown): string[] {
	const configRecord = config && typeof config === "object" ? (config as Record<string, unknown>) : {};
	const mappingTable = buildAcMappingTableFromConfig(configRecord);
	const cfg = acGlobalConfigFromAdapter(config);
	const ids: string[] = [];
	for (const unit of cfg.units.filter((u) => u.enabled)) {
		for (const role of AC_WATCH_MAPPING_ROLES) {
			const id = resolveAcMappingTarget(mappingTable, unit.index, role);
			if (id) ids.push(id);
		}
	}
	return ids;
}
