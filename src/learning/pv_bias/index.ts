import { ensurePvBiasStates } from "./ensure_states";
import { runPvBiasLearning, type PvBiasRunHost } from "./run";
import { pvBiasConfigFromAdapter } from "./config";
import type { StateHost } from "../../ems_light/state_util";

let pvBiasTimer: NodeJS.Timeout | null = null;

export async function initPvBiasLearning(adapter: ioBroker.Adapter): Promise<void> {
	const host = adapter as unknown as PvBiasRunHost & StateHost;
	await ensurePvBiasStates(host);
	await runPvBiasLearning(host);

	const cfg = pvBiasConfigFromAdapter(adapter.config);
	stopPvBiasLearning();
	pvBiasTimer = setInterval(() => {
		void runPvBiasLearning(host).catch((e) => {
			adapter.log.error(`PV-Bias tick: ${e}`);
		});
	}, cfg.intervalSec * 1000);

	adapter.log.info(`EMS-Light PV-Bias Learning ready (read-only, interval ${cfg.intervalSec}s)`);
}

export function stopPvBiasLearning(): void {
	if (pvBiasTimer) {
		clearInterval(pvBiasTimer);
		pvBiasTimer = null;
	}
}
