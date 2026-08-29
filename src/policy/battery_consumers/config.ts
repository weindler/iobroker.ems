import { asNum } from "../../ems_light/state_util";
import type { BatteryConsumerId, BatteryConsumerRule, BatteryConsumersConfig } from "./types";

function boolField(c: Record<string, unknown>, key: string, def: boolean): boolean {
	const v = c[key];
	if (v === true || v === false) return v;
	if (v === "true" || v === 1 || v === "1") return true;
	if (v === "false" || v === 0 || v === "0") return false;
	return def;
}

function numOrNull(c: Record<string, unknown>, key: string): number | null {
	const n = asNum(c[key]);
	return n === null || !Number.isFinite(n) ? null : n;
}

function clampSoc(n: number | null, def: number): number {
	if (n === null) return def;
	return Math.max(0, Math.min(100, n));
}

function ruleFromConfig(
	c: Record<string, unknown>,
	prefix: string,
	defaults: { mayUse: boolean; onlyCritical: boolean; minSoc: number; marginK: number | null },
): BatteryConsumerRule {
	return {
		mayUseBattery: boolField(c, `${prefix}_may_use_battery`, defaults.mayUse),
		onlyWhenCritical: boolField(c, `${prefix}_only_when_critical`, defaults.onlyCritical),
		minSocPct: clampSoc(numOrNull(c, `${prefix}_min_soc_pct`), defaults.minSoc),
		criticalMarginK: defaults.marginK === null ? null : (numOrNull(c, `${prefix}_critical_margin_k`) ?? defaults.marginK),
	};
}

/**
 * Geteilter Policy-Reserve-Boden (auch für Netzausgleich-Entladung wiederverwendet,
 * siehe `operator/daily_plan/battery_discharge_authority.ts`) — kein zweiter, separat
 * gepflegter Schwellwert.
 */
export const DEFAULT_MIN_SOC = 50;

export function batteryConsumersConfigFromAdapter(config: unknown): BatteryConsumersConfig {
	const c = (config && typeof config === "object" ? config : {}) as Record<string, unknown>;
	return {
		immersion_heater: ruleFromConfig(c, "bat_consumer_immersion", {
			mayUse: false,
			onlyCritical: true,
			minSoc: DEFAULT_MIN_SOC,
			marginK: 2,
		}),
		air_conditioning: ruleFromConfig(c, "bat_consumer_climate", {
			mayUse: false,
			onlyCritical: true,
			minSoc: DEFAULT_MIN_SOC,
			marginK: null,
		}),
		wallbox: ruleFromConfig(c, "bat_consumer_wallbox", {
			mayUse: false,
			onlyCritical: false,
			minSoc: DEFAULT_MIN_SOC,
			marginK: null,
		}),
		maxDischargePowerW: numOrNull(c, "bat_consumer_max_discharge_w"),
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
