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
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || function (mod) {
    if (mod && mod.__esModule) return mod;
    var result = {};
    if (mod != null) for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
    __setModuleDefault(result, mod);
    return result;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.assertAllowedPlannerJsonPath = exports.resolveAllowedPlannerJsonPath = exports.THERMAL_RUNTIME_LEARNING_FILE = exports.HOUSE_LOAD_LEARNING_FILE = void 0;
const path = __importStar(require("node:path"));
const paths_1 = require("../backup_integration/paths");
const types_1 = require("../learning/consumer_stats/types");
exports.HOUSE_LOAD_LEARNING_FILE = "house_load_learning_v1.json";
exports.THERMAL_RUNTIME_LEARNING_FILE = "thermal_runtime_learning_v1.json";
const ALLOWED = {
    house_load_learning: {
        category: "learning/house_load",
        fileName: exports.HOUSE_LOAD_LEARNING_FILE,
    },
    thermal_runtime_learning: {
        category: "learning/thermal_runtime",
        fileName: exports.THERMAL_RUNTIME_LEARNING_FILE,
    },
    consumer_stats: {
        category: "learning/consumer_stats",
        fileName: types_1.CONSUMER_STATS_FILENAME,
    },
};
function resolveAllowedPlannerJsonPath(getAbsolutePath, kind) {
    if (typeof getAbsolutePath !== "function") {
        throw new Error("getAbsolutePath unavailable for planner snapshot file path");
    }
    const spec = ALLOWED[kind];
    const rawBase = getAbsolutePath(spec.category);
    if (typeof rawBase !== "string" || !rawBase.trim()) {
        throw new Error("getAbsolutePath returned empty planner snapshot root");
    }
    const baseDir = path.resolve(rawBase);
    if (!path.isAbsolute(baseDir)) {
        throw new Error("getAbsolutePath must resolve to an absolute directory");
    }
    const target = path.resolve(path.join(baseDir, spec.fileName));
    (0, paths_1.assertPathWithinRoot)(target, baseDir);
    if (path.basename(target) !== spec.fileName) {
        throw new Error("invalid planner snapshot file name");
    }
    return target;
}
exports.resolveAllowedPlannerJsonPath = resolveAllowedPlannerJsonPath;
/** Validates an absolute path is one of the allowed planner learning JSON files. */
function assertAllowedPlannerJsonPath(absolutePath, getAbsolutePath) {
    const resolved = path.resolve(absolutePath);
    for (const kind of Object.keys(ALLOWED)) {
        const allowed = resolveAllowedPlannerJsonPath(getAbsolutePath, kind);
        if (resolved === allowed) {
            return;
        }
    }
    throw new Error("planner snapshot file path not allowed");
}
exports.assertAllowedPlannerJsonPath = assertAllowedPlannerJsonPath;
