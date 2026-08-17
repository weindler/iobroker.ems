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
exports.readThermalBoilerPersist = exports.writeThermalBoilerPersist = exports.isTrustedBoilerPersist = exports.BOILER_SOURCE_KIND = exports.BOILER_MODULE_TAG = void 0;
const fs = __importStar(require("node:fs/promises"));
const path = __importStar(require("node:path"));
const atomic_write_1 = require("../../persistence/atomic_write");
exports.BOILER_MODULE_TAG = "thermal_boiler_learning_v1";
exports.BOILER_SOURCE_KIND = "mapping.boiler_temp_c";
function isTrustedBoilerPersist(parsed) {
    if (!parsed || parsed.module !== exports.BOILER_MODULE_TAG)
        return false;
    if (parsed.source_kind !== exports.BOILER_SOURCE_KIND)
        return false;
    return typeof parsed.source_state_id === "string" && parsed.source_state_id.trim().length > 0;
}
exports.isTrustedBoilerPersist = isTrustedBoilerPersist;
async function writeThermalBoilerPersist(baseDir, result, lastRun, sourceStateId, tempSamples = []) {
    const source = sourceStateId.trim();
    if (!source)
        return;
    await fs.mkdir(baseDir, { recursive: true });
    const payload = {
        generated_at: lastRun,
        module: exports.BOILER_MODULE_TAG,
        samples: result.samples,
        runtime_hours_avg: result.runtimeHoursAvg,
        runtime_hours_median: result.runtimeHoursMedian,
        cooling_rate_c_per_h_avg: result.coolingRateCPerHAvg,
        by_season: result.bySeasonJson,
        by_day_type: result.byDayTypeJson,
        history: result.historyJson,
        health: result.health,
        source_kind: exports.BOILER_SOURCE_KIND,
        source_state_id: source,
        temp_samples: tempSamples,
    };
    await (0, atomic_write_1.atomicWriteFile)(path.join(baseDir, "thermal_boiler_learning_v1.json"), `${JSON.stringify(payload, null, 2)}\n`);
}
exports.writeThermalBoilerPersist = writeThermalBoilerPersist;
async function readThermalBoilerPersist(baseDir) {
    try {
        const raw = await fs.readFile(path.join(baseDir, "thermal_boiler_learning_v1.json"), "utf8");
        const parsed = JSON.parse(raw);
        if (!isTrustedBoilerPersist(parsed))
            return null;
        return parsed;
    }
    catch {
        return null;
    }
}
exports.readThermalBoilerPersist = readThermalBoilerPersist;
