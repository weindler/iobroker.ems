"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const strict_1 = __importDefault(require("node:assert/strict"));
const climate_segments_js_1 = require("./climate_segments.js");
const sources_js_1 = require("./sources.js");
(0, node_test_1.describe)("day_telemetry shared power group", () => {
    (0, node_test_1.it)("unbekannte Gruppe erzeugt kein lernfähiges default-Segment", () => {
        const active = [true, false, false, false, false];
        const r = (0, sources_js_1.resolveActiveSharedPowerGroupId)(active, {}, null);
        strict_1.default.equal(r.groupId, null);
        strict_1.default.equal(r.rejectReason, "shared_power_group_unknown");
        let list = [];
        const step = (0, climate_segments_js_1.advanceClimateSegment)(null, 1_000, {
            sharedPowerGroupId: r.groupId,
            mode: "cool",
            activeUnitCombination: "1",
            valid: false,
        }, 0.1, 60, r.rejectReason, list);
        list = (0, climate_segments_js_1.closeClimateSegment)(step.open, 2_000, step.list);
        strict_1.default.equal(list.length, 1);
        strict_1.default.equal(list[0].sharedPowerGroupId, null);
        strict_1.default.equal(list[0].valid, false);
        strict_1.default.equal(list[0].rejectReason, "shared_power_group_unknown");
        strict_1.default.equal(list.some((s) => s.sharedPowerGroupId === "default"), false);
    });
    (0, node_test_1.it)("bekannte outdoor_1-Gruppe wird korrekt persistiert", () => {
        const active = [true, true, false, false, false];
        const config = {
            ac_u1_shared_power_group_id: "outdoor_1",
            ac_u2_shared_power_group_id: "outdoor_1",
        };
        const r = (0, sources_js_1.resolveActiveSharedPowerGroupId)(active, config, null);
        strict_1.default.equal(r.groupId, "outdoor_1");
        strict_1.default.equal(r.rejectReason, null);
        let list = [];
        const step = (0, climate_segments_js_1.advanceClimateSegment)(null, 1_000, {
            sharedPowerGroupId: r.groupId,
            mode: "cool",
            activeUnitCombination: "1+2",
            valid: true,
        }, 0.2, 120, null, list);
        list = (0, climate_segments_js_1.closeClimateSegment)(step.open, 2_000, step.list);
        strict_1.default.equal(list[0].sharedPowerGroupId, "outdoor_1");
        strict_1.default.equal(list[0].valid, true);
    });
    (0, node_test_1.it)("Wechsel unknown → outdoor_1 schließt/öffnet Segmente sauber ohne Umetikettierung", () => {
        let list = [];
        const unknown = (0, climate_segments_js_1.advanceClimateSegment)(null, 1_000, {
            sharedPowerGroupId: null,
            mode: "cool",
            activeUnitCombination: "1",
            valid: false,
        }, 0.05, 30, "shared_power_group_unknown", list);
        const next = (0, climate_segments_js_1.advanceClimateSegment)(unknown.open, 2_000, {
            sharedPowerGroupId: "outdoor_1",
            mode: "cool",
            activeUnitCombination: "1",
            valid: true,
        }, 0.1, 30, null, unknown.list);
        list = (0, climate_segments_js_1.closeClimateSegment)(next.open, 3_000, next.list);
        strict_1.default.equal(list.length, 2);
        strict_1.default.equal(list[0].sharedPowerGroupId, null);
        strict_1.default.equal(list[0].rejectReason, "shared_power_group_unknown");
        strict_1.default.equal(list[0].valid, false);
        strict_1.default.equal(list[1].sharedPowerGroupId, "outdoor_1");
        strict_1.default.equal(list[1].valid, true);
        /* Erstes Segment bleibt unknown — keine rückwirkende Umbenennung */
        strict_1.default.notEqual(list[0].sharedPowerGroupId, "outdoor_1");
    });
});
