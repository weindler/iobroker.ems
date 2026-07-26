"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const strict_1 = __importDefault(require("node:assert/strict"));
const node_test_1 = require("node:test");
const config_1 = require("../../addons/air_conditioning/config");
const cooling_1 = require("./cooling");
const NOW = new Date("2026-07-05T10:00:00");
(0, node_test_1.describe)("planCooling", () => {
    (0, node_test_1.it)("uses config watt values not hardcoded defaults", () => {
        const unit = (0, config_1.acUnitConfigFromAdapter)({
            ac_u2_enabled: true,
            ac_u2_name: "Josef",
            ac_u2_on_temp_c: 24.5,
            ac_u2_off_temp_c: 23,
            ac_u2_estimated_power_w: 720,
            ac_u2_active_from: "08:00",
            ac_u2_active_until: "19:00",
            ac_u2_hard_off_at: "19:00",
        }, 2);
        const result = (0, cooling_1.planCooling)({
            now: NOW,
            acConfig: {
                outdoorMaxPowerW: 1400,
                plannerOutdoorLikelyTempC: 28,
                defaultProfileId: "generic",
                units: [unit],
            },
            governanceEnabled: true,
            outdoorTempC: 31,
            units: [{ unit, roomTempC: null, consumerStats: undefined }],
        });
        strict_1.default.equal(result.likely_active, true);
        strict_1.default.equal(result.expected_peak_w, 720);
    });
    (0, node_test_1.it)("caps peak at outdoor max when two units likely", () => {
        const u1 = (0, config_1.acUnitConfigFromAdapter)({
            ac_u1_enabled: true,
            ac_u1_estimated_power_w: 800,
            ac_u1_on_temp_c: 25.5,
            ac_u1_off_temp_c: 24,
        }, 1);
        const u2 = (0, config_1.acUnitConfigFromAdapter)({
            ac_u2_enabled: true,
            ac_u2_estimated_power_w: 650,
            ac_u2_on_temp_c: 24.5,
            ac_u2_off_temp_c: 23,
        }, 2);
        const result = (0, cooling_1.planCooling)({
            now: NOW,
            acConfig: {
                outdoorMaxPowerW: 1300,
                plannerOutdoorLikelyTempC: 28,
                defaultProfileId: "generic",
                units: [u1, u2],
            },
            governanceEnabled: true,
            outdoorTempC: null,
            units: [
                { unit: u1, roomTempC: 26, consumerStats: undefined },
                { unit: u2, roomTempC: 25, consumerStats: undefined },
            ],
        });
        strict_1.default.equal(result.likely_active, true);
        strict_1.default.equal(result.expected_peak_w, 1300);
    });
});
