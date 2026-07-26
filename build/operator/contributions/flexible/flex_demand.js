"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildFlexibleDemandSlot = exports.estimateImmersionRequiredEnergyKwh = exports.IMMERSION_DEFAULT_KWH_PER_DEGREE_C = void 0;
const types_1 = require("./types");
/** Conservative electrical kWh per °C (~300 L buffer) when no volume is configured. */
exports.IMMERSION_DEFAULT_KWH_PER_DEGREE_C = 0.38;
const MAX_HEATING_HOURS_PER_DAY = 18;
/**
 * Sicherheitsmarge gegen gelernten Wärmeverlust (ein Daily-Plan-Slot = 15 min), bis die
 * Allocation den Heizstab tatsächlich einschalten kann. Nur genutzt, wenn Thermal-Runtime-Learning
 * (`learning.thermal_runtime.*`) ein belastbares Modell liefert (`status === "valid"`).
 */
const LEARNED_LOSS_MARGIN_HOURS = 0.25;
function estimateImmersionRequiredEnergyKwh(bufferTempC, targetTempC, maxPowerW, learning) {
    const delta = targetTempC - bufferTempC;
    if (delta <= 0)
        return 0;
    let kwh = (0, types_1.round3)(delta * exports.IMMERSION_DEFAULT_KWH_PER_DEGREE_C);
    if (learning?.status === "valid" && learning.coolingRateCPerHAvg !== null && learning.coolingRateCPerHAvg > 0) {
        const projectedLossC = (0, types_1.round3)(learning.coolingRateCPerHAvg * LEARNED_LOSS_MARGIN_HOURS);
        kwh = (0, types_1.round3)(kwh + projectedLossC * exports.IMMERSION_DEFAULT_KWH_PER_DEGREE_C);
    }
    if (maxPowerW !== null && maxPowerW > 0) {
        const cap = (0, types_1.round3)((maxPowerW / 1000) * MAX_HEATING_HOURS_PER_DAY);
        kwh = Math.min(kwh, cap);
    }
    return kwh;
}
exports.estimateImmersionRequiredEnergyKwh = estimateImmersionRequiredEnergyKwh;
function buildFlexibleDemandSlot(input) {
    if (!input.available ||
        input.requiredEnergyKwh === null ||
        !Number.isFinite(input.requiredEnergyKwh) ||
        input.requiredEnergyKwh <= 0 ||
        input.maxPowerW === null ||
        input.maxPowerW <= 0) {
        return [];
    }
    return [
        {
            slot: { startIso: input.generatedAt, endIso: input.generatedAt },
            minPowerW: null,
            preferredPowerW: null,
            maxPowerW: input.maxPowerW,
            requiredEnergyKwh: (0, types_1.round3)(input.requiredEnergyKwh),
            availableEnergyKwh: null,
            priceCtPerKwh: null,
            available: true,
            mandatory: input.mandatory === true,
            quality: input.quality,
        },
    ];
}
exports.buildFlexibleDemandSlot = buildFlexibleDemandSlot;
