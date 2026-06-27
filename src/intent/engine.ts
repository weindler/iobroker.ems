import type { StateHost } from "../ems_light/state_util";
import { setStateIfChanged } from "../policy/core/state_write";
import { isAddonIntentActive } from "./core/addon_active";
import { buildResolvedAllIntent, type ResolvedAllIntent } from "./core/aggregate";
import { collectExpiryTimes, nextExpiryDelayMs } from "./core/expiry";
import { semanticIntentChanged } from "./core/revision";
import {
	EVCC_INTENT_DEBOUNCE_MS,
	INTENT_ENGINE_VERSION,
	IOBROKER_BATTERY_REQUEST_STATE,
	IOBROKER_BATTERY_RESULT_STATE,
	IOBROKER_THERMAL_REQUEST_STATE,
	IOBROKER_THERMAL_RESULT_STATE,
	IOBROKER_WALLBOX_REQUEST_STATE,
	IOBROKER_WALLBOX_RESULT_STATE,
	THERMAL_TARGET_ID,
} from "./core/constants";
import {
	configuredEvccStateIds,
	intentAdminConfigFromAdapter,
	intentEvccConfigFromAdapter,
} from "./config";
import { ensureIntentStates } from "./ensure_states";
import { readIntentPersist, writeIntentPersist } from "./persist";
import { readEvccIntentSnapshot, type EvccReadHost } from "./sources/evcc";
import { buildAdminIntentSnapshot } from "./sources/admin";
import {
	processIobrokerWallboxRequest,
	snapshotToManualOverride as snapshotToWallboxManualOverride,
} from "./sources/iobroker";
import {
	processIobrokerThermalRequest,
	snapshotToThermalManualOverride,
} from "./sources/iobroker_thermal";
import {
	processIobrokerBatteryRequest,
	snapshotToBatteryManualOverride,
} from "./sources/iobroker_battery";
import { resolveWallboxIntent } from "./wallbox/resolve";
import { lastChangedAt } from "./wallbox/validation";
import type { IobrokerIntentSnapshot, ResolvedWallboxIntent } from "./wallbox/types";
import { emptyResolvedWallboxIntent } from "./wallbox/types";
import { resolveThermalIntent } from "./thermal/resolve";
import { lastThermalChangedAt } from "./thermal/validation";
import type { IobrokerThermalSnapshot, ResolvedThermalIntent } from "./thermal/types";
import { emptyResolvedThermalIntent } from "./thermal/types";
import { resolveBatteryIntent } from "./battery/resolve";
import { lastBatteryChangedAt } from "./battery/validation";
import type { IobrokerBatterySnapshot, ResolvedBatteryIntent } from "./battery/types";
import { emptyResolvedBatteryIntent } from "./battery/types";
import { IMMERSION_ADDON_ID } from "../addons/immersion_heater/index";

export type IntentEngineHost = StateHost &
	EvccReadHost & {
		config?: unknown;
		namespace?: string;
		getAbsolutePath?: (category?: string) => string;
		log: {
			info: (msg: string) => void;
			warn: (msg: string) => void;
			error?: (msg: string) => void;
			debug?: (msg: string) => void;
		};
		subscribeStatesAsync?: (pattern: string, callback?: () => void) => Promise<void>;
		unsubscribeStatesAsync?: (pattern: string) => Promise<void>;
		subscribeForeignStatesAsync?: (pattern: string, callback?: () => void) => Promise<void>;
		unsubscribeForeignStatesAsync?: (pattern: string) => Promise<void>;
	};

interface DomainRequestIds {
	wallbox: string | null;
	thermal: string | null;
	battery: string | null;
}

let engineActive = false;
let subscribedHost: IntentEngineHost | null = null;
let lastWallbox: ResolvedWallboxIntent | null = null;
let lastThermal: ResolvedThermalIntent | null = null;
let lastBattery: ResolvedBatteryIntent | null = null;
let lastResolvedAll: ResolvedAllIntent | null = null;
let wallboxSnapshot: IobrokerIntentSnapshot | null = null;
let thermalSnapshot: IobrokerThermalSnapshot | null = null;
let batterySnapshot: IobrokerBatterySnapshot | null = null;
let lastRequestIds: DomainRequestIds = { wallbox: null, thermal: null, battery: null };
let evccDebounceTimer: ReturnType<typeof setTimeout> | null = null;
let expiryTimer: ReturnType<typeof setTimeout> | null = null;
const subscribedPatterns: string[] = [];
const subscribedForeignIds: string[] = [];

function clearEvccDebounce(): void {
	if (evccDebounceTimer) {
		clearTimeout(evccDebounceTimer);
		evccDebounceTimer = null;
	}
}

function clearExpiryTimer(): void {
	if (expiryTimer) {
		clearTimeout(expiryTimer);
		expiryTimer = null;
	}
}

function scheduleEvccRerun(host: IntentEngineHost): void {
	if (!engineActive) return;
	clearEvccDebounce();
	evccDebounceTimer = setTimeout(() => {
		evccDebounceTimer = null;
		if (!engineActive) return;
		void runIntentEngine(host).catch((e) => host.log.warn(`Intent Engine EVCC re-run: ${e}`));
	}, EVCC_INTENT_DEBOUNCE_MS);
}

function scheduleExpiryRerun(host: IntentEngineHost, now: Date): void {
	clearExpiryTimer();
	if (!engineActive) return;
	const times = collectExpiryTimes(now, [
		snapshotToWallboxManualOverride(wallboxSnapshot),
		snapshotToThermalManualOverride(thermalSnapshot),
		snapshotToBatteryManualOverride(batterySnapshot),
	]);
	const delay = nextExpiryDelayMs(now, times);
	if (delay === null) return;
	expiryTimer = setTimeout(() => {
		expiryTimer = null;
		if (!engineActive) return;
		void runIntentEngine(host).catch((e) => host.log.warn(`Intent Engine expiry re-run: ${e}`));
	}, delay);
}

async function writeWallboxMirror(host: IntentEngineHost, intent: ResolvedWallboxIntent): Promise<void> {
	await setStateIfChanged(host, "user_intent.wallbox.resolved_json", JSON.stringify(intent));
	await setStateIfChanged(host, "user_intent.wallbox.revision", intent.revision);
	await setStateIfChanged(host, "user_intent.wallbox.intent_state", intent.intent_state);
	await setStateIfChanged(host, "user_intent.wallbox.last_changed", lastChangedAt(intent));
	await setStateIfChanged(host, "user_intent.wallbox.manual_override_active", intent.manual_override.active);
	await setStateIfChanged(host, "user_intent.wallbox.source_summary", JSON.stringify(intent.source_summary));
}

async function writeThermalMirror(host: IntentEngineHost, intent: ResolvedThermalIntent): Promise<void> {
	await setStateIfChanged(host, "user_intent.thermal.resolved_json", JSON.stringify(intent));
	await setStateIfChanged(host, "user_intent.thermal.revision", intent.revision);
	await setStateIfChanged(host, "user_intent.thermal.intent_state", intent.intent_state);
	await setStateIfChanged(host, "user_intent.thermal.last_changed", lastThermalChangedAt(intent));
	await setStateIfChanged(host, "user_intent.thermal.manual_override_active", intent.manual_override.active);
	await setStateIfChanged(host, "user_intent.thermal.source_summary", JSON.stringify(intent.source_summary));
}

async function writeBatteryMirror(host: IntentEngineHost, intent: ResolvedBatteryIntent): Promise<void> {
	await setStateIfChanged(host, "user_intent.battery.resolved_json", JSON.stringify(intent));
	await setStateIfChanged(host, "user_intent.battery.revision", intent.revision);
	await setStateIfChanged(host, "user_intent.battery.intent_state", intent.intent_state);
	await setStateIfChanged(host, "user_intent.battery.last_changed", lastBatteryChangedAt(intent));
	await setStateIfChanged(host, "user_intent.battery.manual_override_active", intent.manual_override.active);
	await setStateIfChanged(host, "user_intent.battery.source_summary", JSON.stringify(intent.source_summary));
}

async function writeSourceSnapshots(
	host: IntentEngineHost,
	evcc: Awaited<ReturnType<typeof readEvccIntentSnapshot>>,
	admin: ReturnType<typeof buildAdminIntentSnapshot>,
): Promise<void> {
	await setStateIfChanged(host, "user_intent.wallbox.sources.evcc.snapshot_json", JSON.stringify(evcc));
	await setStateIfChanged(host, "user_intent.wallbox.sources.evcc.status", evcc.status);
	await setStateIfChanged(host, "user_intent.wallbox.sources.evcc.last_observed", evcc.observed_at);
	await setStateIfChanged(host, "user_intent.wallbox.sources.admin.snapshot_json", JSON.stringify(admin));
}

export interface IntentEngineResult {
	wallbox: ResolvedWallboxIntent;
	thermal: ResolvedThermalIntent;
	battery: ResolvedBatteryIntent;
	resolvedAll: ResolvedAllIntent;
}

export async function runIntentEngine(host: IntentEngineHost): Promise<IntentEngineResult> {
	const now = new Date();
	await ensureIntentStates(host);

	const adminCfg = intentAdminConfigFromAdapter(host.config);
	const evccCfg = intentEvccConfigFromAdapter(host.config);

	const [evcc, thermalActive, batteryActive] = await Promise.all([
		readEvccIntentSnapshot(host, evccCfg, adminCfg.timezone, now),
		isAddonIntentActive(host, IMMERSION_ADDON_ID),
		isAddonIntentActive(host, "battery"),
	]);

	const admin = buildAdminIntentSnapshot(adminCfg, now);
	const wallboxOverride = snapshotToWallboxManualOverride(wallboxSnapshot);
	const thermalOverride = snapshotToThermalManualOverride(thermalSnapshot);
	const batteryOverride = snapshotToBatteryManualOverride(batterySnapshot);

	const wallbox = resolveWallboxIntent({
		now,
		previous: lastWallbox,
		evcc,
		iobroker: wallboxSnapshot,
		admin,
		override: wallboxOverride,
	});

	const thermal = resolveThermalIntent({
		now,
		previous: lastThermal,
		iobroker: thermalSnapshot,
		override: thermalOverride,
		active: thermalActive,
	});

	const battery = resolveBatteryIntent({
		now,
		previous: lastBattery,
		iobroker: batterySnapshot,
		override: batteryOverride,
		active: batteryActive,
	});

	const domains: ResolvedAllIntent["domains"] = {
		wallbox,
		thermal,
		battery,
	};
	const resolvedAll = buildResolvedAllIntent(lastResolvedAll, domains, now);

	const wallboxChanged = semanticIntentChanged(lastWallbox, wallbox);
	const thermalChanged = lastThermal?.revision !== thermal.revision;
	const batteryChanged = lastBattery?.revision !== battery.revision;
	const aggregateChanged = lastResolvedAll?.revision !== resolvedAll.revision;

	if (wallboxChanged) {
		host.log.info(`User Intent wallbox revision: ${lastWallbox?.revision ?? 0} -> ${wallbox.revision} (${wallbox.intent_state})`);
	}
	if (thermalChanged) {
		host.log.info(`User Intent thermal revision: ${lastThermal?.revision ?? 0} -> ${thermal.revision} (${thermal.intent_state})`);
	}
	if (batteryChanged) {
		host.log.info(`User Intent battery revision: ${lastBattery?.revision ?? 0} -> ${battery.revision} (${battery.intent_state})`);
	}
	if (aggregateChanged && !wallboxChanged && !thermalChanged && !batteryChanged) {
		host.log.debug?.(`User Intent aggregate revision: ${lastResolvedAll?.revision ?? 0} -> ${resolvedAll.revision}`);
	}

	lastWallbox = wallbox;
	lastThermal = thermal;
	lastBattery = battery;
	lastResolvedAll = resolvedAll;

	await writeWallboxMirror(host, wallbox);
	await writeThermalMirror(host, thermal);
	await writeBatteryMirror(host, battery);
	await setStateIfChanged(host, "user_intent.resolved_all_json", JSON.stringify(resolvedAll));
	await setStateIfChanged(host, "user_intent.resolved_all.revision", resolvedAll.revision);
	await writeSourceSnapshots(host, evcc, admin);
	await setStateIfChanged(host, "user_intent.status", "ready");

	const diag = {
		revision: resolvedAll.revision,
		wallbox: wallbox.intent_state,
		thermal: thermal.intent_state,
		battery: battery.intent_state,
		at: now.toISOString(),
	};
	await setStateIfChanged(host, "user_intent.wallbox.diagnostics.last_resolution_json", JSON.stringify(diag));

	const dataDir = host.getAbsolutePath?.("intent");
	const anyChanged = wallboxChanged || thermalChanged || batteryChanged || aggregateChanged;
	if (dataDir && anyChanged) {
		await writeIntentPersist(dataDir, {
			wallbox,
			thermal,
			battery,
			resolvedAll,
			lastRequestIds,
			wallboxSnapshot,
			thermalSnapshot,
			batterySnapshot,
		});
	}

	scheduleExpiryRerun(host, now);
	return { wallbox, thermal, battery, resolvedAll };
}

async function processDomainRequest(
	host: IntentEngineHost,
	domain: keyof DomainRequestIds,
	state: ioBroker.State | null,
	requestState: string,
	resultState: string,
): Promise<void> {
	if (!state || state.ack === true) return;
	const adminCfg = intentAdminConfigFromAdapter(host.config);
	const now = new Date();

	if (domain === "wallbox") {
		const out = processIobrokerWallboxRequest({
			raw: state.val,
			ack: state.ack,
			now,
			admin: adminCfg,
			lastRequestId: lastRequestIds.wallbox,
			currentRevision: lastWallbox?.revision ?? 0,
			existingSnapshot: wallboxSnapshot,
		});
		await setStateIfChanged(host, resultState, JSON.stringify(out.result));
		if (out.accepted && out.snapshot) {
			wallboxSnapshot = out.snapshot;
			lastRequestIds.wallbox = out.result.request_id;
			host.log.info(`User Intent wallbox request ${out.result.status}: ${out.result.request_id}`);
			await host.setStateAsync(requestState, { val: state.val as ioBroker.StateValue, ack: true });
			await runIntentEngine(host);
		} else if (out.result.status === "duplicate") {
			await host.setStateAsync(requestState, { val: state.val as ioBroker.StateValue, ack: true });
			host.log.debug?.(`User Intent wallbox duplicate: ${out.result.request_id}`);
		}
		return;
	}

	if (domain === "thermal") {
		const out = processIobrokerThermalRequest({
			raw: state.val,
			ack: state.ack,
			now,
			admin: adminCfg,
			lastRequestId: lastRequestIds.thermal,
			currentRevision: lastThermal?.revision ?? 0,
			existingSnapshot: thermalSnapshot,
		});
		await setStateIfChanged(host, resultState, JSON.stringify(out.result));
		if (out.accepted && out.snapshot) {
			thermalSnapshot = out.snapshot;
			lastRequestIds.thermal = out.result.request_id;
			host.log.info(`User Intent thermal request ${out.result.status}: ${out.result.request_id}`);
			await host.setStateAsync(requestState, { val: state.val as ioBroker.StateValue, ack: true });
			await runIntentEngine(host);
		} else if (out.result.status === "duplicate") {
			await host.setStateAsync(requestState, { val: state.val as ioBroker.StateValue, ack: true });
			host.log.debug?.(`User Intent thermal duplicate: ${out.result.request_id}`);
		}
		return;
	}

	if (domain === "battery") {
		const out = processIobrokerBatteryRequest({
			raw: state.val,
			ack: state.ack,
			now,
			admin: adminCfg,
			lastRequestId: lastRequestIds.battery,
			currentRevision: lastBattery?.revision ?? 0,
			existingSnapshot: batterySnapshot,
		});
		await setStateIfChanged(host, resultState, JSON.stringify(out.result));
		if (out.accepted && out.snapshot) {
			batterySnapshot = out.snapshot;
			lastRequestIds.battery = out.result.request_id;
			host.log.info(`User Intent battery request ${out.result.status}: ${out.result.request_id}`);
			await host.setStateAsync(requestState, { val: state.val as ioBroker.StateValue, ack: true });
			await runIntentEngine(host);
		} else if (out.result.status === "duplicate") {
			await host.setStateAsync(requestState, { val: state.val as ioBroker.StateValue, ack: true });
			host.log.debug?.(`User Intent battery duplicate: ${out.result.request_id}`);
		}
	}
}

export async function initIntentEngine(host: IntentEngineHost): Promise<void> {
	if (engineActive && subscribedHost === host) {
		return;
	}

	host.log.info(`User Intent Engine init start (${INTENT_ENGINE_VERSION})`);
	engineActive = true;
	subscribedHost = host;

	const now = new Date();

	await ensureIntentStates(host);
	host.log.info("User Intent states ensured");

	try {
		const dataDir = host.getAbsolutePath?.("intent");
		if (dataDir) {
			const persisted = await readIntentPersist(dataDir);
			if (persisted) {
				lastWallbox = persisted.wallbox;
				lastThermal = persisted.thermal;
				lastBattery = persisted.battery;
				lastResolvedAll = persisted.resolvedAll;
				lastRequestIds = persisted.lastRequestIds;
				wallboxSnapshot = persisted.wallboxSnapshot;
				thermalSnapshot = persisted.thermalSnapshot;
				batterySnapshot = persisted.batterySnapshot;
			}
		}
	} catch (e) {
		host.log.warn(`Intent persist load failed: ${e}`);
	}

	if (!lastWallbox) lastWallbox = emptyResolvedWallboxIntent(now);
	if (!lastThermal) lastThermal = emptyResolvedThermalIntent(now, THERMAL_TARGET_ID);
	if (!lastBattery) lastBattery = emptyResolvedBatteryIntent(now, "main");

	try {
		await runIntentEngine(host);
	} catch (e) {
		(host.log.error ?? host.log.warn)(`User Intent first resolution failed: ${e}`);
	}

	try {
		const evccCfg = intentEvccConfigFromAdapter(host.config);
		const foreignIds = configuredEvccStateIds(evccCfg);
		for (const id of foreignIds) {
			if (subscribedForeignIds.includes(id)) continue;
			if (typeof host.subscribeForeignStatesAsync === "function") {
				try {
					await host.subscribeForeignStatesAsync(id, () => scheduleEvccRerun(host));
					subscribedForeignIds.push(id);
				} catch (e) {
					host.log.debug?.(`Intent EVCC subscribe ${id}: ${e}`);
				}
			}
		}

		const requestPatterns = [
			IOBROKER_WALLBOX_REQUEST_STATE,
			IOBROKER_THERMAL_REQUEST_STATE,
			IOBROKER_BATTERY_REQUEST_STATE,
		];
		if (typeof host.subscribeStatesAsync === "function") {
			for (const pattern of requestPatterns) {
				if (subscribedPatterns.includes(pattern)) continue;
				await host.subscribeStatesAsync(pattern);
				subscribedPatterns.push(pattern);
			}
		}
	} catch (e) {
		host.log.warn(`Intent subscriptions failed: ${e}`);
	}

	try {
		await processDomainRequest(host, "wallbox", (await host.getStateAsync(IOBROKER_WALLBOX_REQUEST_STATE)) ?? null, IOBROKER_WALLBOX_REQUEST_STATE, IOBROKER_WALLBOX_RESULT_STATE);
		await processDomainRequest(host, "thermal", (await host.getStateAsync(IOBROKER_THERMAL_REQUEST_STATE)) ?? null, IOBROKER_THERMAL_REQUEST_STATE, IOBROKER_THERMAL_RESULT_STATE);
		await processDomainRequest(host, "battery", (await host.getStateAsync(IOBROKER_BATTERY_REQUEST_STATE)) ?? null, IOBROKER_BATTERY_REQUEST_STATE, IOBROKER_BATTERY_RESULT_STATE);
	} catch (e) {
		host.log.warn(`Intent pending request handling failed: ${e}`);
	}

	host.log.info("User Intent Engine initialized");
}

const REQUEST_HANDLERS: Record<string, { domain: keyof DomainRequestIds; request: string; result: string }> = {
	[IOBROKER_WALLBOX_REQUEST_STATE]: {
		domain: "wallbox",
		request: IOBROKER_WALLBOX_REQUEST_STATE,
		result: IOBROKER_WALLBOX_RESULT_STATE,
	},
	[IOBROKER_THERMAL_REQUEST_STATE]: {
		domain: "thermal",
		request: IOBROKER_THERMAL_REQUEST_STATE,
		result: IOBROKER_THERMAL_RESULT_STATE,
	},
	[IOBROKER_BATTERY_REQUEST_STATE]: {
		domain: "battery",
		request: IOBROKER_BATTERY_REQUEST_STATE,
		result: IOBROKER_BATTERY_RESULT_STATE,
	},
};

export function handleIntentStateChange(namespace: string, id: string, state: ioBroker.State | null): void {
	if (!engineActive || !subscribedHost) return;
	const host = subscribedHost;

	for (const [suffix, cfg] of Object.entries(REQUEST_HANDLERS)) {
		if (id === `${namespace}.${suffix}`) {
			void processDomainRequest(host, cfg.domain, state, cfg.request, cfg.result).catch((e) =>
				host.log.warn(`Intent request ${cfg.domain}: ${e}`),
			);
			return;
		}
	}

	const evccCfg = intentEvccConfigFromAdapter(host.config);
	const foreignIds = configuredEvccStateIds(evccCfg);
	if (foreignIds.includes(id)) {
		scheduleEvccRerun(host);
	}
}

export function stopIntentEngine(): void {
	const host = subscribedHost;
	clearEvccDebounce();
	clearExpiryTimer();

	if (host?.unsubscribeStatesAsync) {
		for (const pattern of subscribedPatterns) {
			void host.unsubscribeStatesAsync(pattern).catch((e) => host.log.debug?.(`Intent unsubscribe ${pattern}: ${e}`));
		}
	}
	if (host?.unsubscribeForeignStatesAsync) {
		for (const id of subscribedForeignIds) {
			void host.unsubscribeForeignStatesAsync(id).catch((e) => host.log.debug?.(`Intent foreign unsubscribe ${id}: ${e}`));
		}
	}

	engineActive = false;
	subscribedHost = null;
	lastWallbox = null;
	lastThermal = null;
	lastBattery = null;
	lastResolvedAll = null;
	wallboxSnapshot = null;
	thermalSnapshot = null;
	batterySnapshot = null;
	lastRequestIds = { wallbox: null, thermal: null, battery: null };
	subscribedPatterns.length = 0;
	subscribedForeignIds.length = 0;
}

export function getLastResolvedWallboxIntentForTest(): ResolvedWallboxIntent | null {
	return lastWallbox;
}

export function resetIntentEngineForTest(): void {
	stopIntentEngine();
}
