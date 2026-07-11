"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.acUnitContributionId = exports.CONTRIBUTION_IDS = void 0;
/** Stabile Contribution-IDs — keine Zeitstempel, keine dynamischen Werte. */
exports.CONTRIBUTION_IDS = {
    PV_SUPPLY: "pv_forecast.supply",
    HOUSE_LOAD_FIXED: "house_load.fixed",
    WEATHER_CONTEXT: "weather_forecast.context",
    GRID_SUPPLY: "grid_supply.pricing",
    HOUSE_MAIN_FUSE: "house_main_fuse.limits",
    GLOBAL_CONSTRAINTS: "global_constraints.limits",
    BATTERY_CHARGE: "battery.charge",
    BATTERY_DISCHARGE: "battery.discharge",
    BATTERY_RESERVE: "battery.reserve",
    WALLBOX_EV_SESSION: "wallbox.ev_session",
    IMMERSION_MANDATORY: "immersion_heater.mandatory",
    IMMERSION_FLEXIBLE: "immersion_heater.flexible",
    AC_UNIT: (unitIndex) => `air_conditioning.unit_${unitIndex}`,
};
function acUnitContributionId(unitIndex) {
    if (unitIndex < 1 || unitIndex > 5) {
        throw new Error(`invalid AC unit index for contribution: ${unitIndex}`);
    }
    return `air_conditioning.unit_${unitIndex}`;
}
exports.acUnitContributionId = acUnitContributionId;
