"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.batteryConsumerConstraintStateWrites = exports.BATTERY_CONSUMER_CONSTRAINT_STATES = void 0;
/** Live diagnostic states advertised in Admin (Batterie für Verbraucher). */
exports.BATTERY_CONSUMER_CONSTRAINT_STATES = {
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
};
/**
 * Admin-Häkchen → sichtbare Planner-States. Immer schreiben (nicht nur bei Flip),
 * sonst bleibt `ts` monatelang stehen und die Diagnose lügt.
 */
function batteryConsumerConstraintStateWrites(access) {
    const ids = ["immersion_heater", "air_conditioning", "wallbox"];
    const out = [];
    for (const id of ids) {
        const a = access[id];
        const states = exports.BATTERY_CONSUMER_CONSTRAINT_STATES[id];
        out.push({ id: states.allowed, val: a.allowed });
        out.push({ id: states.reasonDe, val: a.reasonDe });
    }
    return out;
}
exports.batteryConsumerConstraintStateWrites = batteryConsumerConstraintStateWrites;
