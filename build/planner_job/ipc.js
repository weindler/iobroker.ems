"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.extractWorkerStatusLine = exports.captureStdioChunk = void 0;
const constants_1 = require("../planner_contracts/constants");
function captureStdioChunk(existing, chunk, budget = constants_1.PLANNER_IPC_BUDGET_BYTES) {
    const combined = existing + chunk.toString("utf8");
    if (Buffer.byteLength(combined, "utf8") <= budget) {
        return combined;
    }
    return combined.slice(0, budget);
}
exports.captureStdioChunk = captureStdioChunk;
function extractWorkerStatusLine(stdout) {
    const lines = stdout.split(/\r?\n/);
    for (const line of lines) {
        if (line.startsWith("PLANNER_WORKER_STATUS:")) {
            return line.slice("PLANNER_WORKER_STATUS:".length).trim();
        }
    }
    return null;
}
exports.extractWorkerStatusLine = extractWorkerStatusLine;
