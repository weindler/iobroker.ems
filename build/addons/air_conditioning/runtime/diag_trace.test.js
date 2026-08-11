"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const strict_1 = __importDefault(require("node:assert/strict"));
const diag_trace_1 = require("./diag_trace");
function snap(over = {}) {
    return {
        tag: "stop",
        unitIndex: 1,
        nowMs: Date.parse("2026-08-11T09:30:28.000Z"),
        slotStartIso: "2026-08-11T09:30:00.000Z",
        slotEndIso: "2026-08-11T09:45:00.000Z",
        allocatedPowerW: 850,
        dailyPlanRevision: 42,
        dailyPlanStatus: "daily_plan_valid",
        desired: "off",
        lastDesired: "on",
        commandGeneration: 3,
        stopArmedGeneration: 3,
        feedback: "on",
        decisionSource: "daily_plan",
        allowStart: false,
        allowStop: true,
        demandStop: false,
        plannerOff: true,
        reasonDe: "Daily Plan: keine aktive Allocation für air_conditioning.unit_1 (0 W).",
        ...over,
    };
}
(0, node_test_1.describe)("formatAcCoolingDiagLine", () => {
    (0, node_test_1.it)("includes transition fields in one compact line", () => {
        const line = (0, diag_trace_1.formatAcCoolingDiagLine)(snap({ allocatedPowerW: 0 }));
        strict_1.default.match(line, /diag stop/);
        strict_1.default.match(line, /allocW=0/);
        strict_1.default.match(line, /rev=42/);
        strict_1.default.match(line, /desired=off/);
        strict_1.default.match(line, /lastDesired=on/);
        strict_1.default.match(line, /cmdGen=3/);
        strict_1.default.match(line, /stopGen=3/);
        strict_1.default.match(line, /fb=on/);
        strict_1.default.match(line, /plannerOff=true/);
        strict_1.default.match(line, /demandStop=false/);
        strict_1.default.match(line, /allowStop=true/);
    });
    (0, node_test_1.it)("marks missing allocation fields without inventing zeros", () => {
        const line = (0, diag_trace_1.formatAcCoolingDiagLine)(snap({
            tag: "start",
            allocatedPowerW: null,
            dailyPlanRevision: null,
            slotStartIso: null,
            slotEndIso: null,
            stopArmedGeneration: null,
            lastDesired: null,
        }));
        strict_1.default.match(line, /diag start/);
        strict_1.default.match(line, /allocW=null/);
        strict_1.default.match(line, /rev=null/);
        strict_1.default.match(line, /slot=none/);
        strict_1.default.match(line, /stopGen=null/);
        strict_1.default.match(line, /lastDesired=null/);
    });
});
