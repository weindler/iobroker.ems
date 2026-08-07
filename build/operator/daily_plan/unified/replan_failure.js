"use strict";
/**
 * Sicheres Verhalten bei fehlgeschlagenem Unified Replan (LIVE IH/AC).
 * Kein zweiter Klima-Tagesplaner — nur Authority-Bereinigung + bestehender AC-Runtime-Fallback.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.applyReplanFailureAuthority = exports.assessUnifiedReplanFailure = exports.climatePlanDispatchStillSafe = exports.immersionRestStillSafe = void 0;
const authority_1 = require("./authority");
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
    // Sehr altes Telemetrie-Signal → nicht auf veraltetem Slice beharren
    if (age !== null && age !== undefined && Number.isFinite(age) && age > 30 * 60)
        return false;
    return true;
}
/**
 * IH: im Zweifel idle. Alter Rest-Slice nur behalten, wenn aktuell noch fachlich zulässig.
 */
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
    // Ziel erreicht / kein Bedarf → energetischer Slice unzulässig
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
/**
 * Klima: planbasierten Flex-Dispatch nicht ungeprüft halten, wenn Komfortbedarf besteht.
 * Leeren Plan → bestehende Runtime-Komfort-FSM (Climate-Fallback), kein zweiter Planner.
 */
function climatePlanDispatchStillSafe(args) {
    const { nowMs, lastUnifiedPlan, actual, climate, replanReasons } = args;
    if (!hasFutureKind(lastUnifiedPlan, "climate", nowMs) && !hasFutureKind(lastUnifiedPlan, "air_conditioning", nowMs)) {
        // Auch ohne zukünftige Slice: bei Komfortbedarf Plan-Authority leeren, damit lokaler Pfad greift
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
function assessUnifiedReplanFailure(args) {
    const clearImmersion = !immersionRestStillSafe(args);
    const clearClimate = !climatePlanDispatchStillSafe(args);
    const parts = ["Unified Replan fehlgeschlagen"];
    if (clearImmersion)
        parts.push("IH idle (Rest-Slice nicht mehr zulässig)");
    else
        parts.push("IH Restplan behalten");
    if (clearClimate)
        parts.push("Klima Plan-Dispatch geleert (lokaler Komfort-Pfad)");
    else
        parts.push("Klima Restplan behalten");
    return {
        clearImmersion,
        clearClimate,
        reasonDe: `${parts.join(" — ")}.`,
    };
}
exports.assessUnifiedReplanFailure = assessUnifiedReplanFailure;
/**
 * Wendet Failure-Disposition auf den frischen Classic-Daily-Plan an.
 * Nutzt den letzten gültigen Unified-Plan als Quelle verbleibender Slices.
 * Publiziert nie eine neue Unified-Generation.
 */
function applyReplanFailureAuthority(classicPlan, lastUnifiedPlan, disposition) {
    if (!lastUnifiedPlan) {
        if (disposition.clearImmersion || disposition.clearClimate) {
            return (0, authority_1.clearIhAcAuthority)(classicPlan);
        }
        return classicPlan;
    }
    const pub = (0, dispatch_bridge_1.buildUnifiedIhAcDispatchPublish)(lastUnifiedPlan);
    const ih = disposition.clearImmersion ? [] : pub.immersionEntries;
    const ac = disposition.clearClimate ? [] : pub.climateEntries;
    if (disposition.clearImmersion && disposition.clearClimate) {
        return (0, authority_1.clearIhAcAuthority)(classicPlan);
    }
    return (0, authority_1.applyUnifiedIhAcAuthority)(classicPlan, ih, ac, {
        dailyPlanRevision: classicPlan.revision,
        unifiedPlanId: `${lastUnifiedPlan.planId}:replan-fail-safe`,
    });
}
exports.applyReplanFailureAuthority = applyReplanFailureAuthority;
