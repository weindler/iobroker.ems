"use strict";
/**
 * A1: Wann estimated_empty_at planungswirksam ist.
 * Cycle-Learning (Abkühlzyklen) und Newton-Schätzung bleiben semantisch getrennt:
 * - status "valid" nur bei genug Zyklen
 * - Newton darf trotzdem Deadline/empty_at treiben, ohne "cycle-valid" zu behaupten
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.thermalLearningDegradedCauseDe = exports.thermalEmptyAtUsableForPlanning = exports.hasNewtonEmptyAtModel = exports.hasCycleCoolingModel = void 0;
/** Abgeschlossene Peak→Floor-Zyklen mit positiver linearer Rate. */
function hasCycleCoolingModel(learning) {
    return (!!learning &&
        learning.coolingRateCPerHAvg !== null &&
        learning.coolingRateCPerHAvg > 0 &&
        (learning.samples ?? 0) > 0);
}
exports.hasCycleCoolingModel = hasCycleCoolingModel;
/** Newton-k + zukünftige empty_at (auch bei samples=0). */
function hasNewtonEmptyAtModel(learning) {
    return (!!learning &&
        !!learning.estimatedEmptyAt &&
        learning.coolingConstantPerH !== null &&
        learning.coolingConstantPerH > 0);
}
exports.hasNewtonEmptyAtModel = hasNewtonEmptyAtModel;
/**
 * Planning darf empty_at nutzen bei valid|degraded wenn Cycle-Rate oder Newton-Modell trägt.
 * status bleibt degraded bei samples&lt;3 — kein falsches „valid cycles“.
 */
function thermalEmptyAtUsableForPlanning(learning) {
    if (!learning?.estimatedEmptyAt)
        return false;
    if (learning.status !== "valid" && learning.status !== "degraded")
        return false;
    if (learning.coolingRateCPerHAvg !== null && learning.coolingRateCPerHAvg > 0)
        return true;
    return hasNewtonEmptyAtModel(learning);
}
exports.thermalEmptyAtUsableForPlanning = thermalEmptyAtUsableForPlanning;
/** Kurzer Diagnose-Code für Briefing/Details. */
function thermalLearningDegradedCauseDe(learning) {
    if (!learning || learning.status !== "degraded")
        return null;
    const samples = learning.samples ?? 0;
    if (hasNewtonEmptyAtModel(learning) && !hasCycleCoolingModel(learning)) {
        return `thermal learning usable only via Newton estimate, ${samples} completed cooling cycles`;
    }
    if (samples > 0 && samples < 3) {
        return `thermal learning few cooling cycles (${samples}), limited confidence`;
    }
    return `thermal learning degraded (${samples} cycles)`;
}
exports.thermalLearningDegradedCauseDe = thermalLearningDegradedCauseDe;
