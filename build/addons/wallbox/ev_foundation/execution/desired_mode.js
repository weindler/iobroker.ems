"use strict";
/**
 * Mechanical projection: Unified/Daily-Plan intent → EVCC desired.
 * Does not score PV vs NOW; it only translates an already chosen slot.
 *
 * off  = EMS will actively press EVCC OFF
 * noop = EMS has nothing to execute (no button, no pending, no retry)
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.projectDesiredEvccMode = void 0;
function chargeMode(energySource) {
    if (energySource === "pv_surplus")
        return "pv";
    if (energySource === "mixed")
        return "min";
    if (energySource === "grid" || energySource === "battery")
        return "now";
    /** Unified already chose charge; unknown source still maps to an EVCC mode. */
    return "now";
}
/**
 * hold in the existing planner is two different things:
 * - explicit planned 0 W / below-min / stop leftover charge → OFF
 * - no consumer slot / planner uncertainty → No-Op (do not invent OFF)
 *
 * none is always "EMS has nothing to execute" → No-Op.
 */
function projectDesiredEvccMode(input) {
    if (input.intentAction === "none") {
        return { desired: "noop", reason: "no_wallbox_action" };
    }
    if (input.intentAction === "hold") {
        if (input.dailyPlanStatus === "power_limits_unknown") {
            return { desired: "noop", reason: "planner_uncertain" };
        }
        if (input.dailyPlanStatus === "allocation_below_min_power") {
            return { desired: "off", reason: "explicit_stop" };
        }
        if (input.allocatedPowerW === 0) {
            return { desired: "off", reason: "explicit_stop" };
        }
        if (input.allocatedPowerW != null && input.allocatedPowerW > 0) {
            return { desired: "off", reason: "explicit_stop" };
        }
        return { desired: "noop", reason: "no_planned_wallbox_action" };
    }
    if (!input.chargingAllowed || !(input.allocatedPowerW != null && input.allocatedPowerW > 0)) {
        return { desired: "off", reason: "explicit_stop" };
    }
    return { desired: chargeMode(input.energySource), reason: "planned_charge" };
}
exports.projectDesiredEvccMode = projectDesiredEvccMode;
