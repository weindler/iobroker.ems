import { ensurePvBiasStates } from "./ensure_states";
import { runPvBiasLearning, type PvBiasRunHost } from "./run";
import { pvBiasConfigFromAdapter } from "./config";
import { ensurePriceLearningStates, runPriceLearning } from "../price_learning";
import { ensurePriceForecastLearningStates, runPriceForecastLearning } from "../price_forecast";
import { ensurePvHorizonLearningStates, runPvHorizon } from "../pv_horizon";
import { withLearningDataPath } from "../data_dir";
import type { StateHost } from "../../ems_light/state_util";

let pvBiasTimer: NodeJS.Timeout | null = null;

async function runLearningTick(host: PvBiasRunHost & StateHost): Promise<void> {
	await runPvBiasLearning(host);
	await runPvHorizon(host);
	await runPriceLearning(host);
	await runPriceForecastLearning(host);
}

export async function initPvBiasLearning(adapter: ioBroker.Adapter): Promise<void> {
	const host = withLearningDataPath(adapter, adapter as unknown as PvBiasRunHost & StateHost);
	await ensurePvBiasStates(host);
	await ensurePvHorizonLearningStates(host);
	await ensurePriceLearningStates(host);
	await ensurePriceForecastLearningStates(host);

	const cfg = pvBiasConfigFromAdapter(adapter.config);
	stopPvBiasLearning();

	void runLearningTick(host).catch((e) => {
		adapter.log.error(`PV-Bias/Horizon initial run: ${e}`);
	});

	pvBiasTimer = setInterval(() => {
		void runLearningTick(host).catch((e) => {
			adapter.log.error(`PV-Bias/Horizon tick: ${e}`);
		});
	}, cfg.intervalSec * 1000);

	adapter.log.info(
		`EMS-Light PV-Bias + PV-Horizon + Price-Learning + Price-Forecast ready (read-only, interval ${cfg.intervalSec}s)`,
	);
}

export function stopPvBiasLearning(): void {
	if (pvBiasTimer) {
		clearInterval(pvBiasTimer);
		pvBiasTimer = null;
	}
}
