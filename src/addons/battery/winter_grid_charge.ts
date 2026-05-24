import { handleEmsMirrorStateChange } from "./ems_mirror_watch";
import type { BatteryTickHost } from "./grid_balance_runner";

/** Poll-Fallback: EMS-Spiegel (Modus-Sequenz) auch ohne stateChange. */

export async function runWinterGridChargeTick(adapter: BatteryTickHost): Promise<void> {
	await handleEmsMirrorStateChange(adapter);
}
