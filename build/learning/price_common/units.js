"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.PLAUSIBLE_EUR_MAX = exports.PLAUSIBLE_EUR_MIN = exports.PLAUSIBLE_CT_MAX = exports.PLAUSIBLE_CT_MIN = void 0;
exports.detectPriceUnit = detectPriceUnit;
exports.isValidPriceValue = isValidPriceValue;
exports.toEurPerKwh = toEurPerKwh;
exports.toCtPerKwh = toCtPerKwh;
exports.eurToCt = eurToCt;
exports.resolvePriceUnit = resolvePriceUnit;
exports.PLAUSIBLE_CT_MIN = 0;
exports.PLAUSIBLE_CT_MAX = 500;
exports.PLAUSIBLE_EUR_MIN = 0;
exports.PLAUSIBLE_EUR_MAX = 5;
function detectPriceUnit(stateId, unit) {
    const u = (unit ?? "").toLowerCase();
    if (u.includes("ct") || stateId.includes("ct_per_kwh")) {
        return "ct_per_kwh";
    }
    if (u.includes("eur") || u.includes("€") || u.includes("euro")) {
        return "eur_per_kwh";
    }
    return stateId.includes("ct_per_kwh") ? "ct_per_kwh" : "eur_per_kwh";
}
function isValidPriceValue(value, unit) {
    if (value === null || !Number.isFinite(value)) {
        return false;
    }
    if (unit === "ct_per_kwh") {
        return value >= exports.PLAUSIBLE_CT_MIN && value <= exports.PLAUSIBLE_CT_MAX;
    }
    return value >= exports.PLAUSIBLE_EUR_MIN && value <= exports.PLAUSIBLE_EUR_MAX;
}
function toEurPerKwh(value, unit) {
    return unit === "ct_per_kwh" ? value / 100 : value;
}
function toCtPerKwh(valueEur) {
    return valueEur * 100;
}
function eurToCt(value, unit) {
    return unit === "ct_per_kwh" ? value : value * 100;
}
async function resolvePriceUnit(host, stateId) {
    if (!host.getObjectAsync) {
        return detectPriceUnit(stateId);
    }
    try {
        const obj = await host.getObjectAsync(stateId);
        const unit = obj?.common && typeof obj.common === "object"
            ? String(obj.common.unit ?? "")
            : "";
        return detectPriceUnit(stateId, unit);
    }
    catch {
        return detectPriceUnit(stateId);
    }
}
