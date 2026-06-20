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
exports.writePriceLearningPersist = void 0;
const fs = __importStar(require("node:fs/promises"));
const path = __importStar(require("node:path"));
const constants_1 = require("./constants");
async function writePriceLearningPersist(baseDir, result, lastRun) {
    await fs.mkdir(baseDir, { recursive: true });
    const payload = {
        generated_at: lastRun,
        module: constants_1.MODULE_TAG,
        price_source: result.priceSource,
        sample_days: result.sampleDays,
        coverage_pct: result.coveragePct,
        missing_days: result.missingDays,
        avg_price_7d: result.avgPrice7d,
        avg_price_30d: result.avgPrice30d,
        avg_price_90d: result.avgPrice90d,
        volatility_30d: result.volatility30d,
        cheap_hours: result.cheapHours,
        expensive_hours: result.expensiveHours,
        confidence: result.confidence,
        health: {
            status: result.health,
            sample_days: result.sampleDays,
            coverage_pct: result.coveragePct,
            missing_days: result.missingDays,
            last_run: lastRun,
            confidence: result.confidence,
        },
    };
    const filePath = path.join(baseDir, "price_learning_v1.json");
    await fs.writeFile(filePath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}
exports.writePriceLearningPersist = writePriceLearningPersist;
