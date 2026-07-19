/** Shared battery-for-consumers contract (Policy → Operator → Allocation). */

export type BatteryConsumerId = "immersion_heater" | "air_conditioning" | "wallbox";

export interface BatteryConsumerRule {
	/** May this consumer draw from the house battery at all? */
	mayUseBattery: boolean;
	/** If true, only when critical (e.g. buffer near min). */
	onlyWhenCritical: boolean;
	/** SOC floor — no battery draw at or below this % (null = no floor). */
	minSocPct: number | null;
	/**
	 * Immersion: Kelvin above planningMinTemp that still counts as critical.
	 * Ignored for other consumers until they have a critical signal.
	 */
	criticalMarginK: number | null;
}

export interface BatteryConsumersConfig {
	immersion_heater: BatteryConsumerRule;
	air_conditioning: BatteryConsumerRule;
	wallbox: BatteryConsumerRule;
	/** Max discharge power available for consumer allocation (W), null = unknown. */
	maxDischargePowerW: number | null;
}

export interface BatteryConsumerAccess {
	consumerId: BatteryConsumerId;
	allowed: boolean;
	mayUseBattery: boolean;
	onlyWhenCritical: boolean;
	criticalNow: boolean | null;
	minSocPct: number | null;
	socPct: number | null;
	batteryHoldActive: boolean;
	reasonDe: string;
}

export interface ResolveBatteryConsumerAccessInput {
	consumerId: BatteryConsumerId;
	rule: BatteryConsumerRule;
	batteryHoldActive: boolean;
	socPct: number | null;
	/** true/false when known; null = unknown (blocks onlyWhenCritical). */
	criticalNow: boolean | null;
}
