import type { BatteryConsumerId, BatteryConsumerRule, BatteryConsumersConfig } from "./types";

function boolField(c: Record<string, unknown>, key: string, def: boolean): boolean {
	const v = c[key];
	if (v === true || v === false) return v;
	if (v === "true" || v === 1 || v === "1") return true;
	if (v === "false" || v === 0 || v === "0") return false;
	return def;
}

/**
 * Legacy export kept for source compatibility. Consumer-specific fixed SOC floors are no
 * longer used: the central reserve planner determines the dynamic discharge floor.
 */
export const DEFAULT_MIN_SOC = 50;

function automaticRule(enabled: boolean, criticalMarginK: number | null): BatteryConsumerRule {
	return {
		mayUseBattery: enabled,
		onlyWhenCritical: false,
		minSocPct: null,
		criticalMarginK,
	};
}

/**
 * A single operator consent replaces the former per-consumer switches and fixed SOC floors.
 *
 * The consent only enables automatic planning. Price, forecast, central dynamic reserve,
 * battery hold and hardware limits remain authoritative. Legacy bat_consumer_* settings are
 * deliberately ignored so an old saved checkbox cannot silently reintroduce grid import.
 */
export function batteryConsumersConfigFromAdapter(config: unknown): BatteryConsumersConfig {
	const c = (config && typeof config === "object" ? config : {}) as Record<string, unknown>;
	const automaticSupport = boolField(c, "bat_consumer_auto_support", true);
	return {
		immersion_heater: automaticRule(automaticSupport, 2),
		air_conditioning: automaticRule(automaticSupport, null),
		wallbox: automaticRule(automaticSupport, null),
		// The central battery/grid-balance limit is the only power budget.
		maxDischargePowerW: null,
	};
}

export function batteryConsumerRule(
	cfg: BatteryConsumersConfig,
	id: BatteryConsumerId,
): BatteryConsumerRule {
	return cfg[id];
}

/** Map contribution addon id → battery consumer id (or null). */
export function batteryConsumerIdFromAddon(addonId: string): BatteryConsumerId | null {
	if (addonId === "immersion_heater") return "immersion_heater";
	if (addonId === "air_conditioning" || addonId.startsWith("air_conditioning.")) return "air_conditioning";
	if (addonId === "wallbox") return "wallbox";
	return null;
}
