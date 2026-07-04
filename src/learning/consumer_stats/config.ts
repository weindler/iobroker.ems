import type { ConsumerStatsConfig } from "./types";

function configRecord(config: unknown): Record<string, unknown> {
	return config && typeof config === "object" ? (config as Record<string, unknown>) : {};
}

function boolField(c: Record<string, unknown>, key: string, def: boolean): boolean {
	const v = c[key];
	if (typeof v === "boolean") return v;
	if (typeof v === "number") return v !== 0;
	const s = String(v ?? "").trim().toLowerCase();
	if (["1", "true", "on", "yes", "ja"].includes(s)) return true;
	if (["0", "false", "off", "no", "nein"].includes(s)) return false;
	return def;
}

function numField(c: Record<string, unknown>, key: string, def: number): number {
	const v = c[key];
	if (v === null || v === undefined || v === "") return def;
	const n = typeof v === "number" ? v : parseFloat(String(v).replace(",", "."));
	return Number.isFinite(n) ? n : def;
}

export function immersionConsumerStatsFromConfig(config: unknown): ConsumerStatsConfig {
	const c = configRecord(config);
	return {
		enabled: boolField(c, "ih_stats_enabled", true),
		trackRuntime: boolField(c, "ih_stats_track_runtime", true),
		trackEnergy: boolField(c, "ih_stats_track_energy", true),
		runtimeOffsetSec: Math.max(0, numField(c, "ih_stats_runtime_offset_h", 0) * 3600),
		energyOffsetKwh: Math.max(0, numField(c, "ih_stats_energy_offset_kwh", 0)),
	};
}

export type ConsumerStatsConfigReader = (config: unknown) => ConsumerStatsConfig;

export const CONSUMER_STATS_CONFIG_READERS: Record<string, ConsumerStatsConfigReader> = {
	immersion_heater: immersionConsumerStatsFromConfig,
};

export function consumerStatsConfigFor(addonId: string, config: unknown): ConsumerStatsConfig | null {
	const reader = CONSUMER_STATS_CONFIG_READERS[addonId];
	return reader ? reader(config) : null;
}
