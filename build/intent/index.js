"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __exportStar = (this && this.__exportStar) || function(m, exports) {
    for (var p in m) if (p !== "default" && !Object.prototype.hasOwnProperty.call(exports, p)) __createBinding(exports, m, p);
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.semanticIntentChanged = exports.computeSemanticHash = exports.resolveWallboxIntent = exports.normalizeDeadline = exports.normalizeTargetSoc = exports.normalizeEvccMode = exports.ensureIntentStates = exports.getLastResolvedWallboxIntentForTest = exports.resetIntentEngineForTest = exports.handleIntentStateChange = exports.runIntentEngine = exports.stopIntentEngine = exports.initIntentEngine = void 0;
var engine_1 = require("./engine");
Object.defineProperty(exports, "initIntentEngine", { enumerable: true, get: function () { return engine_1.initIntentEngine; } });
Object.defineProperty(exports, "stopIntentEngine", { enumerable: true, get: function () { return engine_1.stopIntentEngine; } });
Object.defineProperty(exports, "runIntentEngine", { enumerable: true, get: function () { return engine_1.runIntentEngine; } });
Object.defineProperty(exports, "handleIntentStateChange", { enumerable: true, get: function () { return engine_1.handleIntentStateChange; } });
Object.defineProperty(exports, "resetIntentEngineForTest", { enumerable: true, get: function () { return engine_1.resetIntentEngineForTest; } });
Object.defineProperty(exports, "getLastResolvedWallboxIntentForTest", { enumerable: true, get: function () { return engine_1.getLastResolvedWallboxIntentForTest; } });
var ensure_states_1 = require("./ensure_states");
Object.defineProperty(exports, "ensureIntentStates", { enumerable: true, get: function () { return ensure_states_1.ensureIntentStates; } });
__exportStar(require("./core/types"), exports);
__exportStar(require("./core/constants"), exports);
__exportStar(require("./wallbox/types"), exports);
var normalize_1 = require("./wallbox/normalize");
Object.defineProperty(exports, "normalizeEvccMode", { enumerable: true, get: function () { return normalize_1.normalizeEvccMode; } });
Object.defineProperty(exports, "normalizeTargetSoc", { enumerable: true, get: function () { return normalize_1.normalizeTargetSoc; } });
Object.defineProperty(exports, "normalizeDeadline", { enumerable: true, get: function () { return normalize_1.normalizeDeadline; } });
var resolve_1 = require("./wallbox/resolve");
Object.defineProperty(exports, "resolveWallboxIntent", { enumerable: true, get: function () { return resolve_1.resolveWallboxIntent; } });
var revision_1 = require("./core/revision");
Object.defineProperty(exports, "computeSemanticHash", { enumerable: true, get: function () { return revision_1.computeSemanticHash; } });
Object.defineProperty(exports, "semanticIntentChanged", { enumerable: true, get: function () { return revision_1.semanticIntentChanged; } });
