"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const strict_1 = __importDefault(require("node:assert/strict"));
const state_surface_catalog_js_1 = require("./state_surface_catalog.js");
(0, node_test_1.describe)("state surface audit catalog", () => {
    (0, node_test_1.it)("covers required planner and addon families", () => {
        const ids = new Set(state_surface_catalog_js_1.STATE_SURFACE_FAMILIES.map((f) => f.id));
        for (const required of [
            "global",
            "planner_core",
            "planner_coordinator",
            "planner_authority",
            "planner_takeover",
            "forecast_plan",
            "daily_plan",
            "allocations",
            "contributions",
            "learning",
            "wallbox",
            "vehicle_profiles",
            "battery",
            "immersion_heater",
            "air_conditioning",
        ]) {
            strict_1.default.ok(ids.has(required), required);
        }
    });
    (0, node_test_1.it)("summarizes without mutating anything", () => {
        const before = state_surface_catalog_js_1.STATE_SURFACE_FAMILIES.length;
        const summary = (0, state_surface_catalog_js_1.summarizeStateSurfaceCatalog)();
        strict_1.default.equal(state_surface_catalog_js_1.STATE_SURFACE_FAMILIES.length, before);
        strict_1.default.ok(summary.estimatedStaticTotal > 500);
        strict_1.default.ok(summary.byClass.A_core_user > 0);
        strict_1.default.ok(summary.byClass.C_temporary_diagnostics > 0);
        strict_1.default.ok(summary.byClass.D_internal_file_data > 0);
    });
});
