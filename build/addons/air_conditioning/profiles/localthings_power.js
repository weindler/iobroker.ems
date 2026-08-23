"use strict";
/**
 * LocalThings Leistung: Vorhandensein eines Power-States ≠ echte Messung.
 * Bei AC an und power≈0 nicht Learning/Leistung auf 0 setzen.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.resolveLocalthingsMeasuredPowerW = void 0;
function resolveLocalthingsMeasuredPowerW(input) {
    const minOn = input.minPlausibleOnW ?? 50;
    const p = input.rawPowerW;
    if (p === null || !Number.isFinite(p) || p < 0) {
        return { useMeasured: false, reason: p === null ? "missing" : "invalid" };
    }
    if (input.acConfirmedOn && p < minOn) {
        return { useMeasured: false, reason: "implausible_zero_while_on" };
    }
    return { useMeasured: true, powerW: Math.round(p) };
}
exports.resolveLocalthingsMeasuredPowerW = resolveLocalthingsMeasuredPowerW;
