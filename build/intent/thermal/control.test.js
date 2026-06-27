"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const strict_1 = __importDefault(require("node:assert/strict"));
const control_js_1 = require("./control.js");
(0, node_test_1.describe)("thermal control", () => {
    (0, node_test_1.it)("parses control modes", () => {
        strict_1.default.equal((0, control_js_1.parseControlMode)("force"), "force");
        strict_1.default.equal((0, control_js_1.parseControlMode)("OFF"), "off");
        strict_1.default.equal((0, control_js_1.parseControlMode)("weird"), null);
    });
    (0, node_test_1.it)("force maps to force_on in request", () => {
        const req = (0, control_js_1.buildControlThermalRequest)({
            mode: "force",
            forceTargetTempC: 58,
            forceUntil: null,
            config: { ih_planning_max_temp_c: 60, ih_planning_min_temp_c: 48 },
            issuedAt: "2026-06-27T12:00:00Z",
        });
        const values = req.values;
        strict_1.default.equal(values.operating_request, "force_on");
        strict_1.default.equal(values.target_temperature_c, 58);
    });
    (0, node_test_1.it)("rejects force target above max", () => {
        const r = (0, control_js_1.validateForceTarget)(65, { ih_planning_max_temp_c: 60, ih_planning_min_temp_c: 48 });
        strict_1.default.equal(r.ok, false);
    });
    (0, node_test_1.it)("defaults force target to planning max", () => {
        const r = (0, control_js_1.validateForceTarget)("", { ih_planning_max_temp_c: 60, ih_planning_min_temp_c: 48 });
        strict_1.default.equal(r.ok, true);
        if (r.ok)
            strict_1.default.equal(r.value, 60);
    });
});
