"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.notEvaluableStrategyResult = exports.SHADOW_STRATEGY_IDS = void 0;
exports.SHADOW_STRATEGY_IDS = [
    "reference_no_ems",
    "reference_sonnen_native",
    "ems_without_ai",
];
function notEvaluableStrategyResult(strategy, assumptionsDe, missingSlotCount = 0) {
    return {
        strategy,
        modelVersion: "",
        evaluable: false,
        missingSlotCount,
        assumptionsDe,
        gridImportKwh: null,
        gridExportKwh: null,
        batteryChargeKwh: null,
        batteryDischargeKwh: null,
        socStartPct: null,
        socEndPct: null,
        importCostEur: null,
        exportCreditEur: null,
        netCostEur: null,
    };
}
exports.notEvaluableStrategyResult = notEvaluableStrategyResult;
