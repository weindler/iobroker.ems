"use strict";
/**
 * Sicheres Verhalten bei fehlgeschlagenem Unified Replan (LIVE IH/AC/Battery/Wallbox).
 * Kein Classic-Planner-Takeover. Planner schreibt keine Geräte.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.clearIhAcAuthority = exports.applyReplanFailureAuthority = exports.assessUnifiedReplanFailure = exports.wallboxRestStillSafe = exports.batteryRestStillSafe = exports.climatePlanDispatchStillSafe = exports.immersionRestStillSafe = void 0;
const authority_1 = require("./authority");
Object.defineProperty(exports, "clearIhAcAuthority", { enumerable: true, get: function () { return authority_1.clearIhAcAuthority; } });
const dispatch_bridge_1 = require("./dispatch_bridge");
const reason_codes_1 = require("./reason_codes");
function hasFutureKind(plan, kind, nowMs) {
    if (!plan)
        return false;
    return plan.allocations.some((a) => a.kind === kind && Number.isFinite(Date.parse(a.slot.endIso)) && Date.parse(a.slot.endIso) > nowMs);
}
function thermalFreshnessOk(thermal) {
    if (!thermal)
        return false;
    const q = thermal.freshness?.quality?.status;
    if (q === "missing" || q === "blocked" || q === "unsupported" || q === "disabled")
        return false;
    if (thermal.bufferTempC === null || !Number.isFinite(thermal.bufferTempC))
        return false;
    const age = thermal.freshness?.ageSec;
    if (age !== null && age !== undefined && Number.isFinite(age) && age > 30 * 60)
        return false;
    return true;
}
function immersionRestStillSafe(args) {
    const { nowMs, lastUnifiedPlan, actual, thermal, replanReasons } = args;
    if (!hasFutureKind(lastUnifiedPlan, "immersion_heater", nowMs))
        return true;
    if (actual.thermalBlocked)
        return false;
    if (!thermal)
        return false;
    if (thermal.uncertainty.status === "blocked" || thermal.uncertainty.status === "missing") {
        return false;
    }
    if (!thermalFreshnessOk(thermal))
        return false;
    const head = thermal.headroomEnergyKwh ?? actual.thermalHeadroomKwh;
    if (head !== null && Number.isFinite(head) && head < 0.05)
        return false;
    const energyPremiseBroken = replanReasons.some((r) => r === reason_codes_1.REASON.REPLAN_THERMAL_DEVIATION ||
        r === reason_codes_1.REASON.REPLAN_PV_FORECAST_CHANGED ||
        r === reason_codes_1.REASON.REPLAN_PV_ACTUAL_DEVIATION);
    if (energyPremiseBroken)
        return false;
    return true;
}
exports.immersionRestStillSafe = immersionRestStillSafe;
function climatePlanDispatchStillSafe(args) {
    const { nowMs, lastUnifiedPlan, actual, climate, replanReasons } = args;
    if (!hasFutureKind(lastUnifiedPlan, "climate", nowMs) && !hasFutureKind(lastUnifiedPlan, "air_conditioning", nowMs)) {
        if (actual.acMandatoryAny)
            return false;
        return true;
    }
    if (actual.acMandatoryAny)
        return false;
    if (replanReasons.includes(reason_codes_1.REASON.REPLAN_AC_COMFORT_CHANGE))
        return false;
    if (climate?.units.some((u) => u.uncertainty.status === "blocked"))
        return false;
    return true;
}
exports.climatePlanDispatchStillSafe = climatePlanDispatchStillSafe;
/** Battery Charge: im Zweifel idle/hold — kein veralteter Charge-Dispatch. */
function batteryRestStillSafe(args) {
    const { nowMs, lastUnifiedPlan, actual, battery, replanReasons } = args;
    if (!hasFutureKind(lastUnifiedPlan, "battery_charge", nowMs))
        return true;
    if (!battery)
        return false;
    if (battery.socPct === null || battery.usableCapacityKwh === null)
        return false;
    const q = battery.uncertainty.status;
    if (q === "blocked" || q === "missing")
        return false;
    const age = battery.freshness?.ageSec;
    if (age !== null && age !== undefined && age > 30 * 60)
        return false;
    if (replanReasons.includes(reason_codes_1.REASON.REPLAN_BATTERY_SOC_DEVIATION))
        return false;
    if (replanReasons.includes(reason_codes_1.REASON.REPLAN_PV_FORECAST_CHANGED) ||
        replanReasons.includes(reason_codes_1.REASON.REPLAN_PV_ACTUAL_DEVIATION)) {
        return false;
    }
    void actual;
    return true;
}
exports.batteryRestStillSafe = batteryRestStillSafe;
/**
 * Wallbox: veralteten EMS-Charge-Intent entfernen bei Disconnect/Presence/Goal-Bruch.
 * EVCC bleibt manuell bedienbar (kein Geräte-Lock).
 */
function wallboxRestStillSafe(args) {
    const { nowMs, lastUnifiedPlan, actual, wallbox, replanReasons } = args;
    if (!hasFutureKind(lastUnifiedPlan, "wallbox", nowMs))
        return true;
    if (actual.vehicleConnected === false)
        return false;
    if (replanReasons.includes(reason_codes_1.REASON.REPLAN_VEHICLE_DISCONNECTED) ||
        replanReasons.includes(reason_codes_1.REASON.REPLAN_VEHICLE_PRESENCE_CHANGED) ||
        replanReasons.includes(reason_codes_1.REASON.REPLAN_VEHICLE_GOAL_CHANGED)) {
        return false;
    }
    if (!wallbox)
        return false;
    if (!wallbox.connectedNow && wallbox.presenceWindows.every((w) => !w.available && w.status !== "available")) {
        return false;
    }
    return true;
}
exports.wallboxRestStillSafe = wallboxRestStillSafe;
function assessUnifiedReplanFailure(args) {
    const clearImmersion = !immersionRestStillSafe(args);
    const clearClimate = !climatePlanDispatchStillSafe(args);
    const clearBattery = !batteryRestStillSafe({
        nowMs: args.nowMs,
        lastUnifiedPlan: args.lastUnifiedPlan,
        actual: args.actual,
        battery: args.battery,
        replanReasons: args.replanReasons,
    });
    const clearWallbox = !wallboxRestStillSafe({
        nowMs: args.nowMs,
        lastUnifiedPlan: args.lastUnifiedPlan,
        actual: args.actual,
        wallbox: args.wallbox,
        replanReasons: args.replanReasons,
    });
    const parts = ["Unified Replan fehlgeschlagen"];
    if (clearImmersion)
        parts.push("IH idle");
    else
        parts.push("IH behalten");
    if (clearClimate)
        parts.push("Klima Plan geleert");
    else
        parts.push("Klima behalten");
    if (clearBattery)
        parts.push("Battery Charge idle/hold");
    else
        parts.push("Battery behalten");
    if (clearWallbox)
        parts.push("Wallbox EMS-Intent idle (EVCC manuell ok)");
    else
        parts.push("Wallbox behalten");
    return {
        clearImmersion,
        clearClimate,
        clearBattery,
        clearWallbox,
        reasonDe: `${parts.join(" — ")}.`,
    };
}
exports.assessUnifiedReplanFailure = assessUnifiedReplanFailure;
function applyReplanFailureAuthority(classicPlan, lastUnifiedPlan, disposition) {
    if (!lastUnifiedPlan) {
        if (disposition.clearImmersion ||
            disposition.clearClimate ||
            disposition.clearBattery ||
            disposition.clearWallbox) {
            return (0, authority_1.clearAllUnifiedAuthority)(classicPlan);
        }
        return classicPlan;
    }
    const pub = (0, dispatch_bridge_1.buildUnifiedDispatchPublish)(lastUnifiedPlan);
    const ih = disposition.clearImmersion ? [] : pub.immersionEntries;
    const ac = disposition.clearClimate ? [] : pub.climateEntries;
    const bat = disposition.clearBattery ? [] : pub.batteryEntries;
    const wb = disposition.clearWallbox ? [] : pub.wallboxEntries;
    if (disposition.clearImmersion &&
        disposition.clearClimate &&
        disposition.clearBattery &&
        disposition.clearWallbox) {
        return (0, authority_1.clearAllUnifiedAuthority)(classicPlan);
    }
    // Compat: wenn nur IH/AC betroffen und battery/wallbox keep via legacy path
    if (!disposition.clearBattery &&
        !disposition.clearWallbox &&
        (disposition.clearImmersion || disposition.clearClimate)) {
        const ihAc = (0, dispatch_bridge_1.buildUnifiedIhAcDispatchPublish)(lastUnifiedPlan);
        return (0, authority_1.applyUnifiedDayAuthority)(classicPlan, {
            immersionEntries: disposition.clearImmersion ? [] : ihAc.immersionEntries,
            climateEntries: disposition.clearClimate ? [] : ihAc.climateEntries,
            batteryEntries: null,
            wallboxEntries: null,
        }, {
            dailyPlanRevision: classicPlan.revision,
            unifiedPlanId: `${lastUnifiedPlan.planId}:replan-fail-safe`,
        });
    }
    return (0, authority_1.applyUnifiedDayAuthority)(classicPlan, {
        immersionEntries: ih,
        climateEntries: ac,
        batteryEntries: bat,
        wallboxEntries: wb,
    }, {
        dailyPlanRevision: classicPlan.revision,
        unifiedPlanId: `${lastUnifiedPlan.planId}:replan-fail-safe`,
    });
}
exports.applyReplanFailureAuthority = applyReplanFailureAuthority;
