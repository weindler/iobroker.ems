import {
	ensureLearningStateTree,
	startPvBiasLearningRuntime,
	stopPvBiasLearning,
	type LearningStateTreeHost,
} from "../learning/pv_bias";
import { initWeatherLearning, stopWeatherLearning } from "../learning/weather";
import { withLearningDataPath } from "../learning/data_dir";
import {
	initEnergyDailyRollup,
	stopEnergyDailyRollup,
	tickEnergyDailyRollup,
	type EnergyDailyRollupHost,
} from "../learning/energy_daily_rollup";
import {
	initPowerRollup,
	stopPowerRollup,
	tickPowerRollup,
	type PowerRollupHost,
} from "../learning/power_rollup";
import { ensurePolicyStateTree, initPolicyEngine, stopPolicyEngine, type PolicyEngineHost } from "../policy";
import { ensureIntentStates, initIntentEngine, stopIntentEngine, type IntentEngineHost } from "../intent";
import { ensurePlannerStateTree, stopPlanner, type PlannerHost } from "../planner";
import { resetGlobalModesRuntime } from "../global_modes";
import { setAddonModeReplanHook } from "../execution_mode";
import {
	invalidatePublishedPlanForAddonOff,
	requestForcedUnifiedReplan,
} from "../operator/daily_plan/tick";
import { ensureEmsLightStates } from "./ensure_states";
import { runEmsLightPhase1Tick } from "./tick";
import type { LiveCacheHost } from "./live_cache";

const DEFAULT_TICK_SEC = 60;
const GLOBAL_MODES_REQUESTED_STATE = "global_modes.requested";
const INTENT_WALLBOX_REQUEST_STATE = "user_intent.inputs.iobroker.wallbox.request_json";
const POLICY_STARTUP_TIMEOUT_MS = 8000;
let tickTimer: NodeJS.Timeout | null = null;
let policyAdapter: ioBroker.Adapter | null = null;
let powerRollupHost: PowerRollupHost | null = null;
let energyDailyRollupHost: EnergyDailyRollupHost | null = null;

function buildRollupHost(adapter: ioBroker.Adapter): PowerRollupHost & EnergyDailyRollupHost {
	const adapterAny = adapter as unknown as Record<string, unknown>;
	const base = withLearningDataPath(adapter, adapter as unknown as LiveCacheHost) as unknown as PowerRollupHost &
		EnergyDailyRollupHost;
	Object.assign(base, {
		namespace: adapter.namespace,
		config: adapter.config,
		log: adapter.log,
		getHistoryAsync: adapter.getHistoryAsync.bind(adapter),
		getStateAsync: adapter.getStateAsync.bind(adapter),
		setStateAsync: adapter.setStateAsync.bind(adapter),
		getForeignStateAsync: adapter.getForeignStateAsync.bind(adapter),
		getObjectAsync: adapter.getObjectAsync.bind(adapter),
		subscribeForeignStatesAsync:
			typeof adapterAny.subscribeForeignStatesAsync === "function"
				? adapterAny.subscribeForeignStatesAsync.bind(adapter)
				: undefined,
		unsubscribeForeignStatesAsync:
			typeof adapterAny.unsubscribeForeignStatesAsync === "function"
				? adapterAny.unsubscribeForeignStatesAsync.bind(adapter)
				: undefined,
	});
	return base;
}

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

async function waitWithStartupTimeout(
	promise: Promise<void>,
	timeoutMs: number,
	onTimeout: () => void,
): Promise<void> {
	let timer: NodeJS.Timeout | null = null;
	try {
		await Promise.race([
			promise,
			new Promise<void>((resolve) => {
				timer = setTimeout(() => {
					onTimeout();
					resolve();
				}, timeoutMs);
			}),
		]);
	} finally {
		if (timer) {
			clearTimeout(timer);
		}
	}
}

let learningHost: LearningStateTreeHost | null = null;

function buildIntentHost(adapter: ioBroker.Adapter): IntentEngineHost {
	const adapterAny = adapter as unknown as Record<string, unknown>;
	const base = withLearningDataPath(adapter, adapter as unknown as LiveCacheHost & IntentEngineHost);
	Object.assign(base, {
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
	});
	return base;
}

/** Referenz auf den in Phase B erzeugten Learning-Host (für Phase D). */
export function getLearningStateTreeHost(): LearningStateTreeHost | null {
	return learningHost;
}

/** Phase B — EMS-Light-, Planner-, Policy-, Intent- und Learning-Objekte. */
export async function ensureEmsLightStateTree(adapter: ioBroker.Adapter): Promise<void> {
	const version = String(adapter.common?.version ?? "0.0.0");
	const host = adapter as unknown as LiveCacheHost;
	await ensureEmsLightStates(host, version);
	await ensurePlannerStateTree(host as unknown as PlannerHost & LiveCacheHost);
	const policyHost = withLearningDataPath(adapter, adapter as unknown as LiveCacheHost & PolicyEngineHost);
	await ensurePolicyStateTree(policyHost);
	await ensureIntentStates(buildIntentHost(adapter));
	const { ensureAiStateTree } = await import("../ai/index.js");
	await ensureAiStateTree(host);
	const { ensureCompareStateTree } = await import("../ai/compare/index.js");
	await ensureCompareStateTree(host);
	learningHost = await ensureLearningStateTree(adapter);
}

/** Phase F — Runtime, Ticks und initiale Auswertung (nach Bootstrap-Barriere). */
export async function startEmsLightPhase1Runtime(adapter: ioBroker.Adapter): Promise<void> {
	setAddonModeReplanHook((info) => {
		const reason = `replan_addon_execution_mode:${info.addonId}:${info.previous ?? "?"}→${info.next}`;
		if (info.next === "off" && info.addonId !== "global") {
			// Zuerst publizierte Plan-Darstellung leeren, dann Cache für frischen Replan verwerfen.
			void invalidatePublishedPlanForAddonOff(
				adapter as unknown as Parameters<typeof invalidatePublishedPlanForAddonOff>[0],
				info.addonId,
			)
				.then(() => requestForcedUnifiedReplan(reason))
				.catch((e) => {
					adapter.log.warn(`invalidate plan on addon off: ${e}`);
					requestForcedUnifiedReplan(reason);
				});
			return;
		}
		requestForcedUnifiedReplan(reason);
	});
	const host = adapter as unknown as LiveCacheHost;
	energyDailyRollupHost = buildRollupHost(adapter);
	powerRollupHost = energyDailyRollupHost;
	await initEnergyDailyRollup(energyDailyRollupHost);
	await initPowerRollup(powerRollupHost);
	if (learningHost) {
		await startPvBiasLearningRuntime(adapter, learningHost);
	} else {
		learningHost = await ensureLearningStateTree(adapter);
		await startPvBiasLearningRuntime(adapter, learningHost);
	}
	await initWeatherLearning(adapter);
	const policyHost = withLearningDataPath(adapter, adapter as unknown as LiveCacheHost & PolicyEngineHost);
	const policyInit = initPolicyEngine(policyHost).catch((e) => {
		adapter.log.error(`Policy Engine init failed: ${e instanceof Error ? e.stack ?? e.message : e}`);
	});
	await waitWithStartupTimeout(policyInit, POLICY_STARTUP_TIMEOUT_MS, () => {
		adapter.log.warn(
			`Policy Engine init still running after ${POLICY_STARTUP_TIMEOUT_MS}ms; continuing adapter startup`,
		);
	});
	const intentHost = buildIntentHost(adapter);
	try {
		await initIntentEngine(intentHost);
	} catch (e) {
		adapter.log.error(`User Intent Engine init failed: ${e instanceof Error ? e.stack ?? e.message : e}`);
	}
	policyAdapter = adapter;
	try {
		await adapter.subscribeStatesAsync(GLOBAL_MODES_REQUESTED_STATE);
		await adapter.subscribeStatesAsync(INTENT_WALLBOX_REQUEST_STATE);
	} catch (e) {
		adapter.log.warn(`EMS-Light state subscribe: ${e}`);
	}
	await runEmsLightPhase1Tick(host);
	if (energyDailyRollupHost) {
		await tickEnergyDailyRollup(energyDailyRollupHost);
	}
	if (powerRollupHost) {
		await tickPowerRollup(powerRollupHost);
	}

	const sec = tickIntervalSec(adapter.config);
	stopEmsLightTick();
	const dailyHostForTick = energyDailyRollupHost;
	const powerHostForTick = powerRollupHost;
	tickTimer = setInterval(() => {
		void runEmsLightPhase1Tick(host).catch((e) => {
			adapter.log.error(`EMS-Light tick: ${e}`);
		});
		if (dailyHostForTick) {
			void tickEnergyDailyRollup(dailyHostForTick).catch((e) => {
				adapter.log.error(`Energy-Daily-Rollup tick: ${e}`);
			});
		}
		if (powerHostForTick) {
			void tickPowerRollup(powerHostForTick).catch((e) => {
				adapter.log.error(`Power-Rollup tick: ${e}`);
			});
		}
	}, sec * 1000);

	adapter.log.debug(`EMS-Light Phase 1 ready (read-only, tick ${sec}s)`);
}

export async function initEmsLightPhase1(adapter: ioBroker.Adapter): Promise<void> {
	await ensureEmsLightStateTree(adapter);
	await startEmsLightPhase1Runtime(adapter);
}

/** Nur Live-Tick-Timer stoppen (Learning-Intervalle laufen weiter). */
function stopEmsLightTick(): void {
	if (tickTimer) {
		clearInterval(tickTimer);
		tickTimer = null;
	}
}

export async function stopEmsLightPhase1(): Promise<void> {
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
	stopPowerRollup();
	stopEnergyDailyRollup();
	stopPlanner();
	powerRollupHost = null;
	energyDailyRollupHost = null;
	learningHost = null;
	stopEmsLightTick();
}
