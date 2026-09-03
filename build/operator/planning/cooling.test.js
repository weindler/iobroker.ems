"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const strict_1 = __importDefault(require("node:assert/strict"));
const node_test_1 = require("node:test");
const config_1 = require("../../addons/air_conditioning/config");
const cooling_1 = require("./cooling");
const math_1 = require("../../learning/climate_shared_power/math");
function highConfidenceStat(overrides = {}) {
    return {
        sharedPowerGroupId: "outdoor_1",
        mode: "cooling",
        activeUnitCombination: "1",
        sampleCount: 10,
        medianPowerW: 700,
        p75PowerW: 720,
        spreadW: 30,
        minPowerW: 650,
        maxPowerW: 780,
        lastSampleAtIso: new Date().toISOString(),
        ageDays: 1,
        confidence: 1,
        ...overrides,
    };
}
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
    (0, node_test_1.it)("does not invent multi-hour cooling from day-max when room is at off-temp (fresh install)", () => {
        const unit = (0, config_1.acUnitConfigFromAdapter)({
            ac_u1_enabled: true,
            ac_u1_name: "Wohnen",
            ac_u1_on_temp_c: 26,
            ac_u1_off_temp_c: 24,
            ac_u1_estimated_power_w: 900,
            ac_u1_active_from: "08:00",
            ac_u1_active_until: "20:00",
        }, 1);
        const result = (0, cooling_1.planCooling)({
            now: NOW,
            acConfig: {
                outdoorMaxPowerW: 2000,
                plannerOutdoorLikelyTempC: 28,
                defaultProfileId: "generic",
                units: [unit],
            },
            governanceEnabled: true,
            outdoorTempC: 22,
            outdoorForecastMaxC: 34,
            units: [{ unit, roomTempC: 24, consumerStats: undefined }],
        });
        strict_1.default.equal(result.likely_active, false);
        strict_1.default.equal(result.expected_kwh_today, 0);
        strict_1.default.equal(result.units[0]?.demandModel, "bootstrap");
    });
    (0, node_test_1.describe)("PHASE 3 — Shared-Power/Climate Learning", () => {
        (0, node_test_1.it)("gemeinsames Außengerät ohne Learning-Sample: Peak = max() statt Summe (nie 700+700 für ein Außengerät)", () => {
            const u1 = (0, config_1.acUnitConfigFromAdapter)({
                ac_u1_enabled: true,
                ac_u1_estimated_power_w: 800,
                ac_u1_on_temp_c: 25.5,
                ac_u1_off_temp_c: 24,
                ac_u1_shared_power_group_id: "outdoor_1",
            }, 1);
            const u2 = (0, config_1.acUnitConfigFromAdapter)({
                ac_u2_enabled: true,
                ac_u2_estimated_power_w: 650,
                ac_u2_on_temp_c: 24.5,
                ac_u2_off_temp_c: 23,
                ac_u2_shared_power_group_id: "outdoor_1",
            }, 2);
            const result = (0, cooling_1.planCooling)({
                now: NOW,
                acConfig: {
                    outdoorMaxPowerW: 5000, // absichtlich sehr hoch — Effekt kommt aus dem Group-Dedup, nicht dem Cap
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
            // Ohne Dedup wäre das 800+650=1450 (durch den hohen Cap nicht mehr begrenzt).
            strict_1.default.equal(result.expected_peak_w, 800, "Peak muss max(800,650)=800 sein, nicht die Summe 1450");
        });
        (0, node_test_1.it)("gemeinsames Außengerät MIT belastbarem Kombi-Learning-Sample: Peak = gelernter Kombi-Wert", () => {
            const u1 = (0, config_1.acUnitConfigFromAdapter)({
                ac_u1_enabled: true,
                ac_u1_estimated_power_w: 800,
                ac_u1_on_temp_c: 25.5,
                ac_u1_off_temp_c: 24,
                ac_u1_shared_power_group_id: "outdoor_1",
            }, 1);
            const u2 = (0, config_1.acUnitConfigFromAdapter)({
                ac_u2_enabled: true,
                ac_u2_estimated_power_w: 650,
                ac_u2_on_temp_c: 24.5,
                ac_u2_off_temp_c: 23,
                ac_u2_shared_power_group_id: "outdoor_1",
            }, 2);
            const combinedKey = (0, math_1.climateSharedPowerKey)("outdoor_1", "cooling", "1+2");
            const result = (0, cooling_1.planCooling)({
                now: NOW,
                acConfig: {
                    outdoorMaxPowerW: 5000,
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
                sharedPowerStats: {
                    [combinedKey]: highConfidenceStat({
                        activeUnitCombination: "1+2",
                        medianPowerW: 1000,
                        p75PowerW: 1020,
                    }),
                },
            });
            strict_1.default.equal(result.likely_active, true);
            strict_1.default.equal(result.expected_peak_w, 1020, "Peak muss den gelernten Kombi-p75-Wert verwenden");
        });
        (0, node_test_1.it)("Solo-Betrieb einer Shared-Power-Unit nutzt den gruppenbewussten gelernten Wert statt Config", () => {
            const u2 = (0, config_1.acUnitConfigFromAdapter)({
                ac_u2_enabled: true,
                ac_u2_name: "Josef",
                ac_u2_estimated_power_w: 650,
                ac_u2_on_temp_c: 24.5,
                ac_u2_off_temp_c: 23,
                ac_u2_shared_power_group_id: "outdoor_1",
            }, 2);
            const soloKey = (0, math_1.climateSharedPowerKey)("outdoor_1", "cooling", "2");
            const result = (0, cooling_1.planCooling)({
                now: NOW,
                acConfig: {
                    outdoorMaxPowerW: 1400,
                    plannerOutdoorLikelyTempC: 28,
                    defaultProfileId: "generic",
                    units: [u2],
                },
                governanceEnabled: true,
                outdoorTempC: 31,
                units: [{ unit: u2, roomTempC: null, consumerStats: undefined }],
                sharedPowerStats: {
                    [soloKey]: highConfidenceStat({ activeUnitCombination: "2", medianPowerW: 700, p75PowerW: 715 }),
                },
            });
            strict_1.default.equal(result.likely_active, true);
            strict_1.default.equal(result.expected_peak_w, 715);
            strict_1.default.equal(result.units[0]?.powerSource, "learned_shared");
        });
    });
});
