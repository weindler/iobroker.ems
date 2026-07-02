import { pvBiasConfigFromAdapter } from "../pv_bias/config";
import type { DailyEnergySourceDef, ResolvedDailyEnergySource } from "./types";

export const DAILY_ENERGY_SOURCES: readonly DailyEnergySourceDef[] = [
	{ sourceKey: "pv.day_energy" },
] as const;

const DEFAULT_LOOKBACK_DAYS = 30;

export type EnergyDailyRegistryHost = {
	config: unknown;
};

export function resolveDailyEnergySources(config: unknown): ResolvedDailyEnergySource[] {
	const pv = pvBiasConfigFromAdapter(config);
	if (!pv.enabled || !pv.historyActualStateId) {
		return [];
	}

	return DAILY_ENERGY_SOURCES.map((def) => ({
		...def,
		stateId: pv.historyActualStateId,
		lookbackDays: DEFAULT_LOOKBACK_DAYS,
	}));
}
