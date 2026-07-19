"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const strict_1 = __importDefault(require("node:assert/strict"));
const analyze_object_dump_js_1 = require("./analyze_object_dump.js");
(0, node_test_1.describe)("analyze_object_dump", () => {
    (0, node_test_1.it)("extracts objects from array and map forms without reading values", () => {
        const arr = (0, analyze_object_dump_js_1.extractDumpObjects)([
            { _id: "ems.0.global.execution_mode", type: "state", common: { name: "x", type: "string" } },
        ]);
        strict_1.default.equal(arr.length, 1);
        const map = (0, analyze_object_dump_js_1.extractDumpObjects)({
            "ems.0.addons.air_conditioning.units.unit_1": {
                type: "channel",
                common: { name: "Unit 1" },
            },
        });
        strict_1.default.equal(map.length, 1);
    });
    (0, node_test_1.it)("reports object/state counts and gap vs catalog without PII", () => {
        const dump = [
            { _id: "ems.0.global.execution_mode", type: "state", common: { name: "mode", type: "string" } },
            { _id: "ems.0.addons.air_conditioning.units", type: "channel", common: { name: "units" } },
            { _id: "ems.0.addons.air_conditioning.units.unit_1", type: "channel", common: { name: "u1" } },
            { _id: "ems.0.addons.air_conditioning.units.unit_1.state", type: "state", common: { name: "s", type: "string" } },
            { _id: "ems.0.addons.air_conditioning.units.unit_2", type: "channel", common: { name: "u2" } },
            { _id: "ems.0.unknown.family.foo", type: "state", common: { name: "secret", type: "string" } },
        ];
        const analysis = (0, analyze_object_dump_js_1.analyzeObjectDump)(dump);
        strict_1.default.equal(analysis.namespace, "ems.0");
        strict_1.default.equal(analysis.totalStates, 3);
        strict_1.default.ok(analysis.gapVsCatalog !== 0 || analysis.catalogEstimatedStatic > 0);
        const md = (0, analyze_object_dump_js_1.formatDumpAnalysisMarkdown)(analysis);
        strict_1.default.ok(md.includes("Production Gap"));
        strict_1.default.ok(!md.includes("secret"));
        strict_1.default.ok(analysis.unknownPrefixGroups.some((g) => g.prefix.startsWith("unknown")));
    });
});
