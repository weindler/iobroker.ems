import { mappedTargetId, writeForeignIfLive } from "./io";
import type { BatteryTickHost } from "./grid_balance_runner";

/** Sonnen API v2: 1 = Manuell, 2 = Eigenverbrauch */
export const SONNEN_OPERATING_MODE_MANUAL = 1;
export const SONNEN_OPERATING_MODE_AUTO = 2;

export async function ensureOperatingMode(
	adapter: BatteryTickHost,
	mode: number,
	liveEnabled: boolean,
): Promise<string | null> {
	const { targetId } = await mappedTargetId(adapter, "operating_mode");
	if (!targetId) {
		return "operating_mode_mapping_missing";
	}
	const wrote = await writeForeignIfLive(adapter, targetId, mode, liveEnabled);
	return wrote ? null : "dryrun_mode";
}
