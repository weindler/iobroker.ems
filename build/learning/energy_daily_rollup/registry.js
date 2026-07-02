"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.resolveDailyEnergySources = exports.DAILY_ENERGY_SOURCES = void 0;
const config_1 = require("../pv_bias/config");
exports.DAILY_ENERGY_SOURCES = [
    { sourceKey: "pv.day_energy" },
];
const DEFAULT_LOOKBACK_DAYS = 30;
function resolveDailyEnergySources(config) {
    const pv = (0, config_1.pvBiasConfigFromAdapter)(config);
    if (!pv.enabled || !pv.historyActualStateId) {
        return [];
    }
    return exports.DAILY_ENERGY_SOURCES.map((def) => ({
        ...def,
        stateId: pv.historyActualStateId,
        lookbackDays: DEFAULT_LOOKBACK_DAYS,
    }));
}
exports.resolveDailyEnergySources = resolveDailyEnergySources;
