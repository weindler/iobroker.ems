"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const strict_1 = __importDefault(require("node:assert/strict"));
const vis_telemetry_js_1 = require("./vis_telemetry.js");
(0, node_test_1.describe)("AC VIS telemetry", () => {
    (0, node_test_1.it)("1) measured power >0", () => {
        const d = (0, vis_telemetry_js_1.resolveAcPowerDisplay)({ measuredPowerW: 727, estimatedPowerW: 700, running: true });
        strict_1.default.equal(d.kind, "measured");
        strict_1.default.equal(d.displayPowerW, 727);
    });
    (0, node_test_1.it)("2) AC on + power null (0 filtered) → estimated fallback", () => {
        const d = (0, vis_telemetry_js_1.resolveAcPowerDisplay)({ measuredPowerW: null, estimatedPowerW: 700, running: true });
        strict_1.default.equal(d.kind, "estimated");
        strict_1.default.equal(d.displayPowerW, 700);
    });
    (0, node_test_1.it)("3) estimated kind when no measurement", () => {
        const d = (0, vis_telemetry_js_1.resolveAcPowerDisplay)({ measuredPowerW: null, estimatedPowerW: 650, running: true });
        strict_1.default.equal(d.kind, "estimated");
    });
    (0, node_test_1.it)("4) filter normal", () => {
        const f = (0, vis_telemetry_js_1.resolveAcFilterVis)({ statusRaw: "normal", usagePct: 75, usageHours: 375 });
        strict_1.default.equal(f.status, "normal");
        strict_1.default.equal(f.labelDe, "Normal");
        strict_1.default.equal(f.warnDe, "");
    });
    (0, node_test_1.it)("5) filter wash → Reinigen + warn", () => {
        const f = (0, vis_telemetry_js_1.resolveAcFilterVis)({ statusRaw: "wash", usagePct: 90, usageHours: 400 });
        strict_1.default.equal(f.labelDe, "Reinigen");
        strict_1.default.equal(f.warnDe, "FILTER REINIGEN");
    });
    (0, node_test_1.it)("6) filter replace → Ersetzen", () => {
        const f = (0, vis_telemetry_js_1.resolveAcFilterVis)({ statusRaw: "replace", usagePct: null, usageHours: null });
        strict_1.default.equal(f.labelDe, "Ersetzen");
        strict_1.default.equal(f.warnDe, "FILTER ERSETZEN");
    });
    (0, node_test_1.it)("7) filter hours and pct", () => {
        const f = (0, vis_telemetry_js_1.resolveAcFilterVis)({ statusRaw: "normal", usagePct: 75.4, usageHours: 375.2 });
        strict_1.default.equal(f.usagePct, 75);
        strict_1.default.equal(f.usageHours, 375);
    });
    (0, node_test_1.it)("8) filter missing entirely", () => {
        const f = (0, vis_telemetry_js_1.resolveAcFilterVis)({ statusRaw: null, usagePct: null, usageHours: null });
        strict_1.default.equal(f.status, "");
        strict_1.default.equal(f.labelDe, "");
        strict_1.default.equal(f.warnDe, "");
    });
    (0, node_test_1.it)("off without power → none", () => {
        const d = (0, vis_telemetry_js_1.resolveAcPowerDisplay)({ measuredPowerW: null, estimatedPowerW: 700, running: false });
        strict_1.default.equal(d.kind, "none");
    });
});
