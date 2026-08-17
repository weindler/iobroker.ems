"use strict";
/** Netzausgleich-Logik — rein, ohne ioBroker. */
Object.defineProperty(exports, "__esModule", { value: true });
exports.resolveController = exports.computeGridBalanceTarget = exports.evaluateGridBalanceMinPrice = void 0;
/** price_allowed = current >= configured minimum. No median, no second switch. */
function evaluateGridBalanceMinPrice(params) {
    const price = params.priceNowCt;
    if (price === null || !Number.isFinite(price)) {
        return { passed: false, reasonDe: "Strompreis unbekannt — Netzausgleich pausiert" };
    }
    if (price < params.minPriceCtPerKwh) {
        return {
            passed: false,
            reasonDe: `Preis ${price.toFixed(1)} ct/kWh unter Mindestpreis (${params.minPriceCtPerKwh.toFixed(1)} ct/kWh)`,
        };
    }
    return {
        passed: true,
        reasonDe: `Preis ${price.toFixed(1)} ct/kWh ≥ ${params.minPriceCtPerKwh.toFixed(1)} ct/kWh`,
    };
}
exports.evaluateGridBalanceMinPrice = evaluateGridBalanceMinPrice;
function computeGridBalanceTarget(inputs) {
    const checksPassed = [];
    const checksFailed = [];
    if (inputs.controller !== "grid_balance") {
        checksFailed.push("controller_not_grid_balance");
        return inactive(`Controller=${inputs.controller}`, checksPassed, checksFailed);
    }
    checksPassed.push("controller_grid_balance");
    if (inputs.mode1Active) {
        checksFailed.push("mode1_active");
        return inactive("Sonnen Mode 1 aktiv — Netzausgleich pausiert", checksPassed, checksFailed);
    }
    checksPassed.push("mode2_only");
    if (inputs.batteryHoldActive) {
        checksFailed.push("battery_hold");
        return inactive("Batterie-Hold aktiv — Netzausgleich pausiert", checksPassed, checksFailed);
    }
    checksPassed.push("no_battery_hold");
    if (inputs.evccCharging) {
        checksFailed.push("evcc_charging");
        return inactive("EVCC lädt — Netzausgleich pausiert", checksPassed, checksFailed);
    }
    checksPassed.push("no_evcc_charging");
    if (inputs.dailyPlanAuthoritative) {
        checksFailed.push("daily_plan_authoritative");
        return inactive("Daily Plan autoritativ — Netzausgleich pausiert", checksPassed, checksFailed);
    }
    checksPassed.push("no_daily_plan_authority");
    if (inputs.winterGridPlanActive) {
        checksFailed.push("winter_grid_plan");
        return inactive("Winter-Netzplan aktiv — Netzausgleich pausiert", checksPassed, checksFailed);
    }
    checksPassed.push("no_winter_grid");
    if (!inputs.adapterFeatureEnabled) {
        checksFailed.push("adapter_feature_disabled");
        return inactive("Netzausgleich im Adapter deaktiviert", checksPassed, checksFailed);
    }
    checksPassed.push("adapter_feature_enabled");
    if (!inputs.emsGridBalanceEnabled) {
        checksFailed.push("ems_grid_balance_disabled");
        return inactive("EMS: grid_balance_enabled=false", checksPassed, checksFailed);
    }
    checksPassed.push("ems_grid_balance_enabled");
    if (inputs.snowCoverSuspected) {
        checksFailed.push("snow_cover_suspected");
        return inactive("Schnee-/Ertrags-Verdacht (EMS)", checksPassed, checksFailed);
    }
    checksPassed.push("no_snow");
    const cap = inputs.capacityWh;
    if (!(cap > 0)) {
        checksFailed.push("capacity_missing");
        return inactive("ems_mirror.capacity_wh fehlt", checksPassed, checksFailed);
    }
    checksPassed.push("capacity_ok");
    const restWh = inputs.effectiveRestOfDayKwh * 1000;
    if (!(restWh >= cap)) {
        checksFailed.push("pv_forecast_below_capacity");
        return inactive(`Rest-PV ${inputs.effectiveRestOfDayKwh.toFixed(2)} kWh < Kapazität ${(cap / 1000).toFixed(2)} kWh`, checksPassed, checksFailed);
    }
    checksPassed.push("pv_forecast_gate");
    const loadW = inputs.adjustedConsumptionW ?? inputs.consumptionW;
    if (!(loadW > inputs.pvAcPowerW)) {
        checksFailed.push("no_grid_import");
        return inactive("adjusted_consumption_w <= pv_ac_power_w", checksPassed, checksFailed);
    }
    checksPassed.push("consumption_gt_pv");
    const priceCheck = evaluateGridBalanceMinPrice({
        minPriceCtPerKwh: inputs.minPriceCtPerKwh,
        priceNowCt: inputs.priceNowCt,
    });
    if (!priceCheck.passed) {
        checksFailed.push("price_below_minimum");
        return inactive(priceCheck.reasonDe, checksPassed, checksFailed);
    }
    checksPassed.push("price_minimum");
    const offset = inputs.socPct != null && inputs.socPct > inputs.socThresholdPct
        ? inputs.offsetHighSocW
        : inputs.offsetLowSocW;
    checksPassed.push(`offset_${offset}w`);
    const target = Math.max(0, Math.round(loadW - inputs.pvAcPowerW + offset));
    return {
        active: true,
        gatePassed: true,
        targetDischargeW: target,
        reasonDe: `Netzausgleich: ${target} W (consumption − pv + ${offset} W); ${priceCheck.reasonDe}`,
        checksPassed,
        checksFailed,
    };
}
exports.computeGridBalanceTarget = computeGridBalanceTarget;
function inactive(reasonDe, checksPassed, checksFailed) {
    return {
        active: false,
        gatePassed: false,
        targetDischargeW: 0,
        reasonDe,
        checksPassed,
        checksFailed,
    };
}
function resolveController(params) {
    if (params.emsBatteryIntentActive || params.gridBalancePaused) {
        return "ems";
    }
    if (params.gridBalanceSuppressed) {
        return "idle";
    }
    if (params.emsGridBalanceEnabled && params.adapterFeatureEnabled && params.batteryAddonEnabled) {
        return "grid_balance";
    }
    return "idle";
}
exports.resolveController = resolveController;
