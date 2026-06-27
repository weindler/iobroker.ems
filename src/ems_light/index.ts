import { initPvBiasLearning, stopPvBiasLearning } from "../learning/pv_bias";
import { initWeatherLearning, stopWeatherLearning } from "../learning/weather";
import { withLearningDataPath } from "../learning/data_dir";
import { initPolicyEngine, stopPolicyEngine, type PolicyEngineHost } from "../policy";
import { resetGlobalModesRuntime } from "../global_modes";
import { ensureEmsLightStates } from "./ensure_states";
import { runEmsLightPhase1Tick } from "./tick";
import type { LiveCacheHost } from "./live_cache";

const DEFAULT_TICK_SEC = 60;
let tickTimer: NodeJS.Timeout | null = null;

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

	await ensureEmsLightStates(host, version);
	await initPvBiasLearning(adapter);
	await initWeatherLearning(adapter);
	const policyHost = withLearningDataPath(adapter, adapter as unknown as LiveCacheHost & PolicyEngineHost);
	await initPolicyEngine(policyHost);
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
	stopPolicyEngine();
	resetGlobalModesRuntime();
	stopPvBiasLearning();
	stopWeatherLearning();
	stopEmsLightTick();
}
