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
exports.writeMeasuredConsumersPersist = exports.readMeasuredConsumersPersist = void 0;
const fs = __importStar(require("node:fs/promises"));
const path = __importStar(require("node:path"));
const persist_1 = require("./persist");
async function readMeasuredConsumersPersist(baseDir) {
    try {
        const raw = await fs.readFile(path.join(baseDir, persist_1.MEASURED_CONSUMERS_RUNTIME_FILENAME), "utf8");
        const parsed = JSON.parse(raw);
        if (parsed?.version === 1 && parsed.slots && typeof parsed.slots === "object") {
            return parsed;
        }
    }
    catch {
        // neu / noch keine Persistenz vorhanden
    }
    return (0, persist_1.emptyMeasuredConsumersPersist)();
}
exports.readMeasuredConsumersPersist = readMeasuredConsumersPersist;
async function writeMeasuredConsumersPersist(baseDir, persist) {
    await fs.mkdir(baseDir, { recursive: true });
    await fs.writeFile(path.join(baseDir, persist_1.MEASURED_CONSUMERS_RUNTIME_FILENAME), `${JSON.stringify(persist, null, 2)}\n`, "utf8");
}
exports.writeMeasuredConsumersPersist = writeMeasuredConsumersPersist;
