import { runBatteryFailsafeCheck } from "./addons/battery/failsafe";
import { runImmersionFailsafeCheck } from "./addons/immersion_heater/failsafe";
import { runWallboxFailsafeCheck } from "./addons/wallbox/failsafe";
import { failsafeTimeoutsFromConfig } from "./failsafe_common";

let timer: NodeJS.Timeout | null = null;

export function startFailsafeRunner(adapter: ioBroker.Adapter): void {
	stopFailsafeRunner();
	const cfg =
		adapter.config && typeof adapter.config === "object"
			? (adapter.config as Record<string, unknown>)
			: {};
	const { failsafeCheckIntervalSec } = failsafeTimeoutsFromConfig(cfg, "global");

	timer = setInterval(() => {
		void runImmersionFailsafeCheck(adapter).catch((e) => adapter.log.error(`failsafe immersion: ${e}`));
		void runBatteryFailsafeCheck(adapter).catch((e) => adapter.log.error(`failsafe battery: ${e}`));
		void runWallboxFailsafeCheck(adapter).catch((e) => adapter.log.error(`failsafe wallbox: ${e}`));
	}, failsafeCheckIntervalSec * 1000);

	adapter.log.info(`failsafe runner: interval ${failsafeCheckIntervalSec}s (immersion, battery, wallbox)`);
}

export function stopFailsafeRunner(): void {
	if (timer) {
		clearInterval(timer);
		timer = null;
	}
}
