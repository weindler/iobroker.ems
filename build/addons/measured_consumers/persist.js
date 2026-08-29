"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.emptyMeasuredConsumersPersist = exports.emptyMeasuredConsumerSlotPersist = exports.MEASURED_CONSUMERS_RUNTIME_FILENAME = void 0;
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
exports.emptyMeasuredConsumerSlotPersist = emptyMeasuredConsumerSlotPersist;
function emptyMeasuredConsumersPersist() {
    return { version: 1, slots: {} };
}
exports.emptyMeasuredConsumersPersist = emptyMeasuredConsumersPersist;
