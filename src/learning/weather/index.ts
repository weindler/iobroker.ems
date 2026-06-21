import { weatherConfigFromAdapter } from "./config";
import { ensureWeatherLearningStates } from "./ensure_states";
import { runWeatherLearning, type WeatherRunHost } from "./run";
import { withLearningDataPath } from "../data_dir";
import type { StateHost } from "../../ems_light/state_util";

let weatherTimer: NodeJS.Timeout | null = null;

export async function initWeatherLearning(adapter: ioBroker.Adapter): Promise<void> {
	const host = withLearningDataPath(adapter, adapter as unknown as WeatherRunHost & StateHost);
	await ensureWeatherLearningStates(host);

	const cfg = weatherConfigFromAdapter(adapter.config);
	stopWeatherLearning();

	void runWeatherLearning(host).catch((e) => {
		adapter.log.error(`Weather-Learning initial run: ${e}`);
	});

	weatherTimer = setInterval(() => {
		void runWeatherLearning(host).catch((e) => {
			adapter.log.error(`Weather-Learning tick: ${e}`);
		});
	}, cfg.intervalSec * 1000);

	adapter.log.info(
		`EMS-Light Weather-Learning ready (read-only, interval ${cfg.intervalSec}s)`,
	);
}

export function stopWeatherLearning(): void {
	if (weatherTimer) {
		clearInterval(weatherTimer);
		weatherTimer = null;
	}
}

export { runWeatherLearning, type WeatherRunHost } from "./run";
export { computeWeatherLearning, isValidMetricValue, confidenceFromValidHours, healthFromValidHours } from "./math";
export { writeWeatherDayPersist, dayResultToPersist } from "./persist";
