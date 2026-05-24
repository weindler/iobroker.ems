"use strict";
/** Netzausgleich-Logik (ersetzt Blockly) — rein, ohne ioBroker. */
Object.defineProperty(exports, "__esModule", { value: true });
exports.resolveController = exports.computeGridBalanceTarget = void 0;
function computeGridBalanceTarget(inputs) {
    const checksPassed = [];
    const checksFailed = [];
    const offsetHigh = inputs.offsetHighSocW ?? 25;
    const offsetLow = inputs.offsetLowSocW ?? 10;
    const socThr = inputs.socThresholdPct ?? 20;
    if (inputs.controller !== "grid_balance") {
        checksFailed.push("controller_not_grid_balance");
        return inactive(`Controller=${inputs.controller}`, checksPassed, checksFailed);
    }
    checksPassed.push("controller_grid_balance");
    if (!inputs.gridBalanceEnabled) {
        checksFailed.push("grid_balance_disabled");
        return inactive("grid_balance_enabled=false", checksPassed, checksFailed);
    }
    checksPassed.push("grid_balance_enabled");
    if (inputs.snowCoverSuspected) {
        checksFailed.push("snow_cover_suspected");
        return inactive("Schnee-/Ertrags-Verdacht (EMS)", checksPassed, checksFailed);
    }
    checksPassed.push("no_snow");
    if (!inputs.activeMonths.includes(inputs.month)) {
        checksFailed.push("month_outside_active");
        return inactive(`Monat ${inputs.month} außerhalb aktiver Monate`, checksPassed, checksFailed);
    }
    checksPassed.push("month_active");
    const cap = inputs.capacityWh;
    if (!(cap > 0)) {
        checksFailed.push("capacity_missing");
        return inactive("capacity_wh fehlt", checksPassed, checksFailed);
    }
    checksPassed.push("capacity_ok");
    const restWh = inputs.effectiveRestOfDayKwh * 1000;
    if (!(restWh >= cap)) {
        checksFailed.push("pv_forecast_below_capacity");
        return inactive(`Rest-PV ${inputs.effectiveRestOfDayKwh.toFixed(2)} kWh < Kapazität ${(cap / 1000).toFixed(2)} kWh`, checksPassed, checksFailed);
    }
    checksPassed.push("pv_forecast_gate");
    if (!(inputs.consumptionW > inputs.pvAcPowerW)) {
        checksFailed.push("no_grid_import");
        return inactive("consumption_w <= pv_ac_power_w", checksPassed, checksFailed);
    }
    checksPassed.push("consumption_gt_pv");
    const offset = inputs.socPct != null && inputs.socPct > socThr ? offsetHigh : offsetLow;
    checksPassed.push(`offset_${offset}w`);
    const target = Math.max(0, Math.round(inputs.consumptionW - inputs.pvAcPowerW + offset));
    return {
        active: true,
        gatePassed: true,
        targetBatteryChargingW: target,
        reasonDe: `Netzausgleich: ${target} W (consumption − pv + ${offset} W)`,
        checksPassed,
        checksFailed,
    };
}
exports.computeGridBalanceTarget = computeGridBalanceTarget;
function inactive(reasonDe, checksPassed, checksFailed) {
    return {
        active: false,
        gatePassed: false,
        targetBatteryChargingW: 0,
        reasonDe,
        checksPassed,
        checksFailed,
    };
}
function resolveController(params) {
    if (params.emsBatteryIntentActive) {
        return "ems";
    }
    if (params.gridBalanceEnabled && params.batteryAddonEnabled) {
        return "grid_balance";
    }
    return "idle";
}
exports.resolveController = resolveController;
