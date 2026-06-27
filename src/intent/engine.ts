import type { StateHost } from "../ems_light/state_util";
import { setStateIfChanged } from "../policy/core/state_write";
import { semanticIntentChanged } from "./core/revision";
import {
	EVCC_INTENT_DEBOUNCE_MS,
	INTENT_ENGINE_VERSION,
	IOBROKER_WALLBOX_REQUEST_STATE,
	IOBROKER_WALLBOX_RESULT_STATE,
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
	snapshotToManualOverride,
	type IobrokerWallboxRequest,
} from "./sources/iobroker";
import { resolveWallboxIntent } from "./wallbox/resolve";
import { lastChangedAt } from "./wallbox/validation";
import type { IobrokerIntentSnapshot, ResolvedWallboxIntent } from "./wallbox/types";
import { emptyResolvedWallboxIntent } from "./wallbox/types";

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

let engineActive = false;
let patternSubscribed = false;
let subscribedHost: IntentEngineHost | null = null;
let lastResolved: ResolvedWallboxIntent | null = null;
let iobrokerSnapshot: IobrokerIntentSnapshot | null = null;
let lastRequestId: string | null = null;
let evccDebounceTimer: ReturnType<typeof setTimeout> | null = null;
const subscribedPatterns: string[] = [];
const subscribedForeignIds: string[] = [];

function clearEvccDebounce(): void {
	if (evccDebounceTimer) {
		clearTimeout(evccDebounceTimer);
		evccDebounceTimer = null;
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

async function writeMirrorStates(host: IntentEngineHost, intent: ResolvedWallboxIntent): Promise<void> {
	const summaryJson = JSON.stringify(intent.source_summary);
	await setStateIfChanged(host, "user_intent.wallbox.resolved_json", JSON.stringify(intent));
	await setStateIfChanged(host, "user_intent.wallbox.revision", intent.revision);
	await setStateIfChanged(host, "user_intent.wallbox.intent_state", intent.intent_state);
	await setStateIfChanged(host, "user_intent.wallbox.last_changed", lastChangedAt(intent));
	await setStateIfChanged(host, "user_intent.wallbox.manual_override_active", intent.manual_override.active);
	await setStateIfChanged(host, "user_intent.wallbox.source_summary", summaryJson);
	await setStateIfChanged(host, "user_intent.status", "ready");
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

export async function runIntentEngine(host: IntentEngineHost): Promise<ResolvedWallboxIntent> {
	const now = new Date();
	await ensureIntentStates(host);

	const adminCfg = intentAdminConfigFromAdapter(host.config);
	const evccCfg = intentEvccConfigFromAdapter(host.config);

	const evcc = await readEvccIntentSnapshot(host, evccCfg, adminCfg.timezone, now);
	const admin = buildAdminIntentSnapshot(adminCfg, now);
	const override = snapshotToManualOverride(iobrokerSnapshot);

	const resolved = resolveWallboxIntent({
		now,
		previous: lastResolved,
		evcc,
		iobroker: iobrokerSnapshot,
		admin,
		override,
	});

	const changed = semanticIntentChanged(lastResolved, resolved);
	if (changed) {
		host.log.info(`User Intent revision: ${lastResolved?.revision ?? 0} -> ${resolved.revision} (${resolved.intent_state})`);
	}

	lastResolved = resolved;
	await writeMirrorStates(host, resolved);
	await writeSourceSnapshots(host, evcc, admin);
	await setStateIfChanged(
		host,
		"user_intent.wallbox.diagnostics.last_resolution_json",
		JSON.stringify({ revision: resolved.revision, intent_state: resolved.intent_state, at: now.toISOString() }),
	);

	const dataDir = host.getAbsolutePath?.("intent");
	if (dataDir && changed) {
		await writeIntentPersist(dataDir, {
			revision: resolved.revision,
			resolved,
			lastRequestId,
			iobrokerSnapshot,
		});
	}

	return resolved;
}

async function processPendingIobrokerRequest(host: IntentEngineHost, state: ioBroker.State | null): Promise<void> {
	if (!state || state.ack === true) {
		return;
	}
	const adminCfg = intentAdminConfigFromAdapter(host.config);
	const out = processIobrokerWallboxRequest({
		raw: state.val,
		ack: state.ack,
		now: new Date(),
		admin: adminCfg,
		lastRequestId,
		currentRevision: lastResolved?.revision ?? 0,
		existingSnapshot: iobrokerSnapshot,
	});

	await setStateIfChanged(host, IOBROKER_WALLBOX_RESULT_STATE, JSON.stringify(out.result));

	if (out.accepted && out.snapshot) {
		iobrokerSnapshot = out.snapshot;
		lastRequestId = out.result.request_id;
		host.log.info(`User Intent request ${out.result.status}: ${out.result.request_id}`);
		await host.setStateAsync(IOBROKER_WALLBOX_REQUEST_STATE, { val: state.val as ioBroker.StateValue, ack: true });
		await runIntentEngine(host);
	} else if (out.result.status === "duplicate") {
		await host.setStateAsync(IOBROKER_WALLBOX_REQUEST_STATE, { val: state.val as ioBroker.StateValue, ack: true });
		host.log.debug?.(`User Intent duplicate request: ${out.result.request_id}`);
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

	// Schritt 1 (verbindlich): States anlegen. Muss als Erstes und unabhängig von
	// allem Weiteren passieren, damit der user_intent-Baum immer existiert.
	await ensureIntentStates(host);
	host.log.info("User Intent states ensured");

	// Schritt 2: persistierten Zustand laden (Fehler nicht fatal).
	try {
		const dataDir = host.getAbsolutePath?.("intent");
		if (dataDir) {
			const persisted = await readIntentPersist(dataDir);
			if (persisted) {
				lastResolved = persisted.resolved;
				lastRequestId = persisted.lastRequestId;
				iobrokerSnapshot = persisted.iobrokerSnapshot;
			}
		}
	} catch (e) {
		host.log.warn(`Intent persist load failed: ${e}`);
	}

	if (!lastResolved) {
		lastResolved = emptyResolvedWallboxIntent(now);
	}

	// Schritt 3: erste Auflösung (Fehler nicht fatal — States existieren bereits).
	try {
		await runIntentEngine(host);
	} catch (e) {
		(host.log.error ?? host.log.warn)(`User Intent first resolution failed: ${e}`);
	}

	// Schritt 4: Subscriptions (jede isoliert; Fehler dürfen den Init nicht abbrechen).
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

		const requestPattern = IOBROKER_WALLBOX_REQUEST_STATE;
		if (!subscribedPatterns.includes(requestPattern) && typeof host.subscribeStatesAsync === "function") {
			patternSubscribed = true;
			await host.subscribeStatesAsync(requestPattern);
			subscribedPatterns.push(requestPattern);
		}
	} catch (e) {
		host.log.warn(`Intent subscriptions failed: ${e}`);
	}

	// Schritt 5: evtl. anstehenden Request verarbeiten (Fehler nicht fatal).
	try {
		const pending = await host.getStateAsync(IOBROKER_WALLBOX_REQUEST_STATE);
		await processPendingIobrokerRequest(host, pending ?? null);
	} catch (e) {
		host.log.warn(`Intent pending request handling failed: ${e}`);
	}

	host.log.info("User Intent Engine initialized");
}

export function handleIntentStateChange(namespace: string, id: string, state: ioBroker.State | null): void {
	if (!engineActive || !subscribedHost) {
		return;
	}
	const host = subscribedHost;
	const fullRequest = `${namespace}.${IOBROKER_WALLBOX_REQUEST_STATE}`;
	if (id === fullRequest) {
		void processPendingIobrokerRequest(host, state).catch((e) => host.log.warn(`Intent request: ${e}`));
		return;
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

	patternSubscribed = false;
	engineActive = false;
	subscribedHost = null;
	lastResolved = null;
	iobrokerSnapshot = null;
	lastRequestId = null;
	subscribedPatterns.length = 0;
	subscribedForeignIds.length = 0;
}

export function getLastResolvedWallboxIntentForTest(): ResolvedWallboxIntent | null {
	return lastResolved;
}

export function resetIntentEngineForTest(): void {
	stopIntentEngine();
}
