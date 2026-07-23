"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const strict_1 = __importDefault(require("node:assert/strict"));
const generate_1 = require("./generate");
const climate_unit_shape_1 = require("./climate_unit_shape");
const climate_unit_defaults_1 = require("./climate_unit_defaults");
(0, node_test_1.describe)("admin_config climate generator", () => {
    (0, node_test_1.it)("builds all shape keys for every unit, with {N} fully substituted", () => {
        for (let unit = 1; unit <= 5; unit++) {
            const items = (0, generate_1.buildClimateUnitItems)(unit);
            strict_1.default.equal(items.length, climate_unit_shape_1.CLIMATE_UNIT_SHAPE.length);
            for (const [key, value] of items) {
                strict_1.default.ok(!key.includes("{N}"), `key ${key} still has placeholder`);
                strict_1.default.ok(!JSON.stringify(value).includes("{N}"), `value for ${key} still has placeholder`);
                strict_1.default.ok(!JSON.stringify(value).includes("__override__"), `value for ${key} still has unresolved override marker`);
            }
        }
    });
    (0, node_test_1.it)("applies the per-unit override value for a personalized field", () => {
        const unit2 = (0, generate_1.buildClimateUnitItems)(2);
        const entry = unit2.find(([key]) => key === "ac_u2_name");
        strict_1.default.ok(entry);
        const [, value] = entry;
        strict_1.default.equal(value.default, climate_unit_defaults_1.CLIMATE_UNIT_DEFAULTS["2"].name);
    });
    (0, node_test_1.it)("omits the default key when the unit has no override value configured (e.g. unused slot)", () => {
        const unit3 = (0, generate_1.buildClimateUnitItems)(3);
        const entry = unit3.find(([key]) => key === "ac_u3_room_temp_target");
        strict_1.default.ok(entry);
        const [, value] = entry;
        strict_1.default.ok(!("default" in value), "unconfigured unit 3 room_temp_target should not carry a default key");
    });
    (0, node_test_1.it)("throws for an unknown unit number (no defaults registered)", () => {
        strict_1.default.throws(() => (0, generate_1.buildClimateUnitItems)(6));
    });
    (0, node_test_1.it)("buildClimateTabItems keeps the 6 global climate keys plus 5x70 unit keys, rejects a missing global key", () => {
        const existing = {
            introAc: { type: "staticText" },
            climateGovernanceHint: { type: "staticText" },
            ac_addon_mode: { type: "select" },
            ac_outdoor_max_power_w: { type: "number" },
            ac_planner_outdoor_likely_temp_c: { type: "number" },
            ac_default_profile: { type: "select" },
        };
        const full = (0, generate_1.buildClimateTabItems)(existing);
        strict_1.default.equal(Object.keys(full).length, 6 + 5 * climate_unit_shape_1.CLIMATE_UNIT_SHAPE.length);
        const { ac_addon_mode: _drop, ...incomplete } = existing;
        strict_1.default.throws(() => (0, generate_1.buildClimateTabItems)(incomplete));
    });
});
