"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.MEASURED_CONSUMERS_RUNTIME_FILENAME = void 0;
exports.emptyMeasuredConsumerSlotPersist = emptyMeasuredConsumerSlotPersist;
exports.emptyMeasuredConsumersPersist = emptyMeasuredConsumersPersist;
exports.MEASURED_CONSUMERS_RUNTIME_FILENAME = "measured_consumers_runtime_v1.json";
function emptyMeasuredConsumerSlotPersist() {
    return {
        initialized: false,
        rawEnergyBaselineKwh: null,
        lastPowerTsMs: null,
        totalKwh: 0,
        days: {},
    };
}
function emptyMeasuredConsumersPersist() {
    return { version: 1, slots: {} };
}
