"use strict";
/**
 * Persistentes Climate-Thermal-Learning.
 * Operativ nur wenn usable=true (Predictive). Unusable bleibt Diagnose/Bootstrap.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.emptyPassiveStat = exports.emptyEffectStat = exports.CLIMATE_THERMAL_MODULE = exports.CLIMATE_THERMAL_FILENAME = void 0;
exports.CLIMATE_THERMAL_FILENAME = "climate_thermal_v1.json";
exports.CLIMATE_THERMAL_MODULE = "climate_thermal_v1";
function emptyEffectStat(status, reasonDe, lastRunIso = null) {
    return {
        sampleCount: 0,
        usableDurationSec: 0,
        rate: null,
        spread: null,
        confidence: 0,
        usable: false,
        status,
        reasonDe,
        lastRunIso,
        soloSampleCount: 0,
        sharedSampleCount: 0,
    };
}
exports.emptyEffectStat = emptyEffectStat;
function emptyPassiveStat(status, reasonDe, lastRunIso = null) {
    return {
        ...emptyEffectStat(status, reasonDe, lastRunIso),
        warmingRateKPerH: null,
        coolingRateKPerH: null,
    };
}
exports.emptyPassiveStat = emptyPassiveStat;
