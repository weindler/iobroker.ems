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
exports.IoBrokerPlannerSnapshotSource = exports.normalizeIoBrokerState = void 0;
const fs = __importStar(require("node:fs/promises"));
const path = __importStar(require("node:path"));
const allowed_paths_1 = require("./allowed_paths");
const config_from_adapter_1 = require("./config_from_adapter");
const types_1 = require("../learning/consumer_stats/types");
function observedAtFromState(st) {
    const ts = st.ts;
    if (typeof ts === "number" && Number.isFinite(ts) && ts > 0) {
        return new Date(ts).toISOString();
    }
    if (typeof st.lc === "number" && Number.isFinite(st.lc) && st.lc > 0) {
        return new Date(st.lc).toISOString();
    }
    return null;
}
/** Maps ioBroker state objects to SnapshotStateValue without coercing 0/false/"". */
function normalizeIoBrokerState(st) {
    if (!st || st.val === undefined) {
        return { value: null };
    }
    const observedAt = observedAtFromState(st);
    const base = observedAt ? { observedAt } : {};
    if (st.val === null) {
        return { value: null, ...base };
    }
    if (typeof st.val === "boolean") {
        return { value: st.val, ...base };
    }
    if (typeof st.val === "number") {
        return { value: Number.isFinite(st.val) ? st.val : null, ...base };
    }
    return { value: String(st.val), ...base };
}
exports.normalizeIoBrokerState = normalizeIoBrokerState;
class IoBrokerPlannerSnapshotSource {
    host;
    clock;
    constructor(host, clock = () => new Date()) {
        this.host = host;
        this.clock = clock;
    }
    now() {
        return this.clock();
    }
    async readState(id) {
        try {
            const st = await this.host.getStateAsync(id);
            return normalizeIoBrokerState(st);
        }
        catch (e) {
            throw new Error(`readState failed for ${id}: ${String(e)}`);
        }
    }
    async readForeignState(id) {
        if (!this.host.getForeignStateAsync) {
            return { value: null };
        }
        try {
            const st = await this.host.getForeignStateAsync(id);
            return normalizeIoBrokerState(st);
        }
        catch (e) {
            throw new Error(`readForeignState failed for ${id}: ${String(e)}`);
        }
    }
    async readConfig() {
        return (0, config_from_adapter_1.plannerRelevantConfigFromHost)(this.host);
    }
    async readJsonFile(absolutePath) {
        const resolved = path.resolve(absolutePath);
        const getPath = this.host.getAbsolutePath;
        if (!getPath) {
            throw new Error("getAbsolutePath unavailable for planner snapshot file read");
        }
        const allowedNames = new Set([
            allowed_paths_1.HOUSE_LOAD_LEARNING_FILE,
            allowed_paths_1.THERMAL_RUNTIME_LEARNING_FILE,
            types_1.CONSUMER_STATS_FILENAME,
        ]);
        if (!allowedNames.has(path.basename(resolved))) {
            throw new Error("planner snapshot file name not allowed");
        }
        (0, allowed_paths_1.assertAllowedPlannerJsonPath)(resolved, (category) => getPath(category));
        try {
            const raw = await fs.readFile(resolved, "utf8");
            return JSON.parse(raw);
        }
        catch (e) {
            const err = e;
            if (err.code === "ENOENT") {
                return null;
            }
            throw new Error(`invalid planner snapshot JSON at ${path.basename(resolved)}: ${String(e)}`);
        }
    }
}
exports.IoBrokerPlannerSnapshotSource = IoBrokerPlannerSnapshotSource;
