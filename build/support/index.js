"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.runSupportBundleExport = exports.readAllNdjson = exports.appendNdjsonRotating = exports.DIAGNOSTIC_ALLOWED_DURATIONS = exports.DIAGNOSTIC_MAX_DURATION_MIN = exports.DIAGNOSTIC_DEFAULT_DURATION_MIN = exports.resetDiagnosticOnStartup = exports.resetDiagnosticModeForTest = exports.totalSupportLogBytes = exports.collectSupportLogEntries = exports.recordErrorLog = exports.recordDiagnosticEvent = exports.diagnosticModeStatus = exports.isDiagnosticModeActive = exports.stopDiagnosticMode = exports.startDiagnosticMode = void 0;
var diagnostic_mode_1 = require("./diagnostic_mode");
Object.defineProperty(exports, "startDiagnosticMode", { enumerable: true, get: function () { return diagnostic_mode_1.startDiagnosticMode; } });
Object.defineProperty(exports, "stopDiagnosticMode", { enumerable: true, get: function () { return diagnostic_mode_1.stopDiagnosticMode; } });
Object.defineProperty(exports, "isDiagnosticModeActive", { enumerable: true, get: function () { return diagnostic_mode_1.isDiagnosticModeActive; } });
Object.defineProperty(exports, "diagnosticModeStatus", { enumerable: true, get: function () { return diagnostic_mode_1.diagnosticModeStatus; } });
Object.defineProperty(exports, "recordDiagnosticEvent", { enumerable: true, get: function () { return diagnostic_mode_1.recordDiagnosticEvent; } });
Object.defineProperty(exports, "recordErrorLog", { enumerable: true, get: function () { return diagnostic_mode_1.recordErrorLog; } });
Object.defineProperty(exports, "collectSupportLogEntries", { enumerable: true, get: function () { return diagnostic_mode_1.collectSupportLogEntries; } });
Object.defineProperty(exports, "totalSupportLogBytes", { enumerable: true, get: function () { return diagnostic_mode_1.totalSupportLogBytes; } });
Object.defineProperty(exports, "resetDiagnosticModeForTest", { enumerable: true, get: function () { return diagnostic_mode_1.resetDiagnosticModeForTest; } });
Object.defineProperty(exports, "resetDiagnosticOnStartup", { enumerable: true, get: function () { return diagnostic_mode_1.resetDiagnosticOnStartup; } });
Object.defineProperty(exports, "DIAGNOSTIC_DEFAULT_DURATION_MIN", { enumerable: true, get: function () { return diagnostic_mode_1.DIAGNOSTIC_DEFAULT_DURATION_MIN; } });
Object.defineProperty(exports, "DIAGNOSTIC_MAX_DURATION_MIN", { enumerable: true, get: function () { return diagnostic_mode_1.DIAGNOSTIC_MAX_DURATION_MIN; } });
Object.defineProperty(exports, "DIAGNOSTIC_ALLOWED_DURATIONS", { enumerable: true, get: function () { return diagnostic_mode_1.DIAGNOSTIC_ALLOWED_DURATIONS; } });
var log_rotation_1 = require("./log_rotation");
Object.defineProperty(exports, "appendNdjsonRotating", { enumerable: true, get: function () { return log_rotation_1.appendNdjsonRotating; } });
Object.defineProperty(exports, "readAllNdjson", { enumerable: true, get: function () { return log_rotation_1.readAllNdjson; } });
const service_1 = require("../backup/service");
const diagnostic_mode_2 = require("./diagnostic_mode");
async function runSupportBundleExport(host) {
    return (0, service_1.runSupportExport)(host, async (h) => (0, diagnostic_mode_2.collectSupportLogEntries)(h));
}
exports.runSupportBundleExport = runSupportBundleExport;
