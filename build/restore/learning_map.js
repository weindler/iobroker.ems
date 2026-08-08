"use strict";
/** Feste Mappingtabelle Backup-Key → Learning-Ziel (kein freier Pfad aus JSON). */
Object.defineProperty(exports, "__esModule", { value: true });
exports.isKnownLearningKey = exports.restoreLearningRelativeTargetPath = exports.RESTORE_LEARNING_KEYS = exports.RESTORE_LEARNING_TARGETS = void 0;
exports.RESTORE_LEARNING_TARGETS = {
    "battery_runtime_learning_v1.json": { category: "learning/battery_runtime", fileName: "battery_runtime_learning_v1.json" },
    "house_load_learning_v1.json": { category: "learning/house_load", fileName: "house_load_learning_v1.json" },
    "thermal_runtime_learning_v1.json": { category: "learning/thermal_runtime", fileName: "thermal_runtime_learning_v1.json" },
    "price_learning_v1.json": { category: "learning/price_learning", fileName: "price_learning_v1.json" },
    "price_forecast_learning_v1.json": { category: "learning/price_forecast", fileName: "price_forecast_learning_v1.json" },
    "pv_bias_daily_v1.json": { category: "learning/pv_bias", fileName: "pv_bias_daily_v1.json" },
    "power_hourly_v1.json": { category: "learning/power_rollup", fileName: "power_hourly_v1.json" },
    "energy_daily_v1.json": { category: "learning/energy_daily_rollup", fileName: "energy_daily_v1.json" },
    "consumer_stats_v1.json": { category: "learning/consumer_stats", fileName: "consumer_stats_v1.json" },
    "day_evaluation_v1.json": { category: "learning/day_evaluation", fileName: "day_evaluation_v1.json" },
    "vehicle_presence_learning_v1.json": {
        category: "learning/vehicle_presence",
        fileName: "vehicle_presence_learning_v1.json",
    },
};
exports.RESTORE_LEARNING_KEYS = Object.keys(exports.RESTORE_LEARNING_TARGETS);
/** Relativer Zielpfad (Kategorie + Dateiname) unter dem Instanz-Datenroot. */
function restoreLearningRelativeTargetPath(key) {
    const target = exports.RESTORE_LEARNING_TARGETS[key];
    if (!target) {
        throw new Error(`unknown learning key: ${key}`);
    }
    return `${target.category}/${target.fileName}`;
}
exports.restoreLearningRelativeTargetPath = restoreLearningRelativeTargetPath;
function isKnownLearningKey(key) {
    return key in exports.RESTORE_LEARNING_TARGETS;
}
exports.isKnownLearningKey = isKnownLearningKey;
