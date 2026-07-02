import { readEnergyDailyPersist } from "./persist";

const PERSIST_CATEGORY = "learning/energy_daily_rollup";

export async function fetchRollupDayKwh(
	host: { getAbsolutePath?: (category?: string) => string },
	stateId: string,
	dateKey: string,
): Promise<number | null> {
	const dir = host.getAbsolutePath?.(PERSIST_CATEGORY);
	if (!dir || !stateId) {
		return null;
	}
	const persist = await readEnergyDailyPersist(dir);
	for (const source of Object.values(persist.sources)) {
		if (source.stateId !== stateId) {
			continue;
		}
		const rec = source.days[dateKey];
		if (rec?.kwh && rec.kwh > 0) {
			return rec.kwh;
		}
	}
	return null;
}
