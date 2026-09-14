"use strict";
/**
 * Netzausgleich — Ganzhauslast.
 *
 * Eine Hausbatterie kann einzelne Verbraucher physikalisch nicht trennen. Der schnelle
 * Netzausgleich arbeitet deshalb immer mit der real gemessenen gesamten Hauslast. Ob ein
 * flexibler Verbraucher laufen darf, entscheidet der Unified Planner über Preis, Forecast,
 * dynamische Reserve, Mindestlaufzeit und Priorität.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.resolveGridBalancePolicyLoadAdjustment = exports.parseExplicitBatteryPermission = void 0;
/** Behält die Planner-Freigabe dreiwertig; nur echtes Boolean wird akzeptiert. */
function parseExplicitBatteryPermission(raw) {
    if (raw === true)
        return true;
    if (raw === false)
        return false;
    return null;
}
exports.parseExplicitBatteryPermission = parseExplicitBatteryPermission;
/**
 * Returns the measured whole-house load unchanged. The legacy consumer list is intentionally
 * ignored: subtracting a running heater caused the battery to reduce discharge and forced the
 * missing energy to be imported from the grid.
 */
function resolveGridBalancePolicyLoadAdjustment(input) {
    const raw = Number.isFinite(input.rawConsumptionW) ? Math.max(0, input.rawConsumptionW) : 0;
    return {
        policyAdjustedConsumptionW: raw,
        excludedLoadW: 0,
        excludedConsumerIds: [],
        reasonDe: "",
    };
}
exports.resolveGridBalancePolicyLoadAdjustment = resolveGridBalancePolicyLoadAdjustment;
