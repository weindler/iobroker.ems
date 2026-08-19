import type { BatteryConsumerAccess, BatteryConsumerId } from "./types";

/** Live diagnostic states advertised in Admin (Batterie für Verbraucher). */
export const BATTERY_CONSUMER_CONSTRAINT_STATES = {
	immersion_heater: {
		allowed: "planner.constraints.battery_consumer_immersion_allowed",
		reasonDe: "planner.constraints.battery_consumer_immersion_reason_de",
	},
	air_conditioning: {
		allowed: "planner.constraints.battery_consumer_climate_allowed",
		reasonDe: "planner.constraints.battery_consumer_climate_reason_de",
	},
	wallbox: {
		allowed: "planner.constraints.battery_consumer_wallbox_allowed",
		reasonDe: "planner.constraints.battery_consumer_wallbox_reason_de",
	},
} as const satisfies Record<BatteryConsumerId, { allowed: string; reasonDe: string }>;

export type BatteryConsumerConstraintWrite = { id: string; val: boolean | string };

/**
 * Admin-Häkchen → sichtbare Planner-States. Immer schreiben (nicht nur bei Flip),
 * sonst bleibt `ts` monatelang stehen und die Diagnose lügt.
 */
export function batteryConsumerConstraintStateWrites(
	access: Record<BatteryConsumerId, BatteryConsumerAccess>,
): BatteryConsumerConstraintWrite[] {
	const ids: BatteryConsumerId[] = ["immersion_heater", "air_conditioning", "wallbox"];
	const out: BatteryConsumerConstraintWrite[] = [];
	for (const id of ids) {
		const a = access[id];
		const states = BATTERY_CONSUMER_CONSTRAINT_STATES[id];
		out.push({ id: states.allowed, val: a.allowed });
		out.push({ id: states.reasonDe, val: a.reasonDe });
	}
	return out;
}
