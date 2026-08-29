"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.emptyAcRuntimePersist = exports.emptyUnitPersist = exports.AC_RUNTIME_FILENAME = void 0;
const device_ownership_1 = require("../../../ems_light/device_ownership");
exports.AC_RUNTIME_FILENAME = "air_conditioning_runtime_v1.json";
function emptyUnitPersist(index) {
    return {
        index,
        running: false,
        cleaningActive: false,
        cleaningStartedAtMs: null,
        cleaningPendingUntilMs: null,
        cleaningSawOperatingActive: false,
        cleaningSawProgressActive: false,
        cleaningStartProgressPct: null,
        cleaningLastRefreshAtMs: null,
        lastStartAtMs: null,
        lastStopAtMs: null,
        lastModePurpose: null,
        commandGeneration: 0,
        stopArmedGeneration: null,
        lastDesired: null,
        ownership: (0, device_ownership_1.emptyDeviceOwnershipState)(),
    };
}
exports.emptyUnitPersist = emptyUnitPersist;
function emptyAcRuntimePersist() {
    return { version: 1, units: {} };
}
exports.emptyAcRuntimePersist = emptyAcRuntimePersist;
