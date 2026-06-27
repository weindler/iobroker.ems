import { initPvBiasLearning, stopPvBiasLearning } from "../learning/pv_bias";
import { initWeatherLearning, stopWeatherLearning } from "../learning/weather";
import { withLearningDataPath } from "../learning/data_dir";
import { initPolicyEngine, stopPolicyEngine, type PolicyEngineHost } from "../policy";
import { initIntentEngine, stopIntentEngine, type IntentEngineHost } from "../intent";
import { resetGlobalModesRuntime } from "../global_modes";
import { ensureEmsLightStates } from "./ensure_states";
import { runEmsLightPhase1Tick } from "./tick";
import type { LiveCacheHost } from "./live_cache";

const DEFAULT_TICK_SEC = 60;
const GLOBAL_MODES_REQUESTED_STATE = "global_modes.requested";
const INTENT_WALLBOX_REQUEST_STATE = "user_intent.inputs.iobroker.wallbox.request_json";
let tickTimer: NodeJS.Timeout | null = null;
let policyAdapter: ioBroker.Adapter | null = null;

function tickIntervalSec(config: unknown): number {
	if (!config || typeof config !== "object") {
		return DEFAULT_TICK_SEC;
	}
	const raw = (config as Record<string, unknown>).ems_light_tick_interval_sec;
	const n = typeof raw === "number" ? raw : parseInt(String(raw ?? ""), 10);
	if (!Number.isFinite(n) || n < 15 || n > 600) {
		return DEFAULT_TICK_SEC;
	}
	return Math.round(n);
}

export async function initEmsLightPhase1(adapter: ioBroker.Adapter): Promise<void> {
	const version = String(adapter.common?.version ?? "0.0.0");
	const host = adapter as unknown as LiveCacheHost;
	const adapterAny = adapter as unknown as Record<string, unknown>;

	await ensureEmsLightStates(host, version);
	await initPvBiasLearning(adapter);
	await initWeatherLearning(adapter);
	const policyHost = withLearningDataPath(adapter, adapter as unknown as LiveCacheHost & PolicyEngineHost);
	await initPolicyEngine(policyHost);
	const intentHost = {
		...withLearningDataPath(adapter, adapter as unknown as LiveCacheHost & IntentEngineHost),
		namespace: adapter.namespace,
		config: adapter.config,
		log: adapter.log,
		setObjectNotExistsAsync: adapter.setObjectNotExistsAsync.bind(adapter),
		getStateAsync: adapter.getStateAsync.bind(adapter),
		setStateAsync: adapter.setStateAsync.bind(adapter),
		extendObjectAsync: adapter.extendObjectAsync?.bind(adapter),
		getForeignStateAsync: adapter.getForeignStateAsync.bind(adapter),
		subscribeStatesAsync: adapter.subscribeStatesAsync.bind(adapter),
		unsubscribeStatesAsync: adapter.unsubscribeStatesAsync.bind(adapter),
		subscribeForeignStatesAsync:
			typeof adapterAny.subscribeForeignStatesAsync === "function"
				? adapterAny.subscribeForeignStatesAsync.bind(adapter)
				: undefined,
		unsubscribeForeignStatesAsync:
			typeof adapterAny.unsubscribeForeignStatesAsync === "function"
				? adapterAny.unsubscribeForeignStatesAsync.bind(adapter)
				: undefined,
	};
	await initIntentEngine(intentHost);
	// Verbindliche ioBroker-Subscription auf dem echten Adapter (stateChange-Routing
	// erfolgt in main.ts onStateChange -> handleGlobalModesStateChange).
	policyAdapter = adapter;
	try {
		await adapter.subscribeStatesAsync(GLOBAL_MODES_REQUESTED_STATE);
		await adapter.subscribeStatesAsync(INTENT_WALLBOX_REQUEST_STATE);
	} catch (e) {
		adapter.log.warn(`EMS-Light state subscribe: ${e}`);
	}
	await runEmsLightPhase1Tick(host);

	const sec = tickIntervalSec(adapter.config);
	stopEmsLightTick();
	tickTimer = setInterval(() => {
		void runEmsLightPhase1Tick(host).catch((e) => {
			adapter.log.error(`EMS-Light tick: ${e}`);
		});
	}, sec * 1000);

	adapter.log.info(`EMS-Light Phase 1 ready (read-only, tick ${sec}s)`);
}

/** Nur Live-Tick-Timer stoppen (Learning-Intervalle laufen weiter). */
function stopEmsLightTick(): void {
	if (tickTimer) {
		clearInterval(tickTimer);
		tickTimer = null;
	}
}

export function stopEmsLightPhase1(): void {
	if (policyAdapter) {
		const adapter = policyAdapter;
		policyAdapter = null;
		void Promise.resolve(adapter.unsubscribeStatesAsync(GLOBAL_MODES_REQUESTED_STATE)).catch((e) =>
			adapter.log.debug?.(`global_modes.requested unsubscribe: ${e}`),
		);
		void Promise.resolve(adapter.unsubscribeStatesAsync(INTENT_WALLBOX_REQUEST_STATE)).catch((e) =>
			adapter.log.debug?.(`intent wallbox request unsubscribe: ${e}`),
		);
	}
	stopIntentEngine();
	stopPolicyEngine();
	resetGlobalModesRuntime();
	stopPvBiasLearning();
	stopWeatherLearning();
	stopEmsLightTick();
}
