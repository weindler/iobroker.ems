"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SHADOW_STRATEGY_IDS = void 0;
exports.notEvaluableStrategyResult = notEvaluableStrategyResult;
const constants_1 = require("./constants");
exports.SHADOW_STRATEGY_IDS = [
    "reference_no_ems",
    "reference_sonnen_native",
    "ems_without_ai",
];
function notEvaluableStrategyResult(strategy, assumptionsDe, missingSlotCount = 0) {
    return {
        strategy,
        /* Auch ein nicht bewertbarer Lauf gehört zu einer reproduzierbaren Modellversion. */
        modelVersion: constants_1.SHADOW_ENGINE_MODEL_VERSION,
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
