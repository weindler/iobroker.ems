"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const strict_1 = __importDefault(require("node:assert/strict"));
const node_test_1 = require("node:test");
const climate_energy_1 = require("./climate_energy");
(0, node_test_1.describe)("climate_energy", () => {
    (0, node_test_1.it)("scales outdoor drive factor by forecast max vs likely threshold", () => {
        strict_1.default.equal((0, climate_energy_1.outdoorDriveFactor)(25, 28), 0);
        strict_1.default.equal((0, climate_energy_1.outdoorDriveFactor)(27, 28), 0.35);
        strict_1.default.equal((0, climate_energy_1.outdoorDriveFactor)(30, 28), 0.55);
        strict_1.default.equal((0, climate_energy_1.outdoorDriveFactor)(35, 28), 0.95);
    });
    (0, node_test_1.it)("estimates cooling hours from outdoor max when room is cool", () => {
        const r = (0, climate_energy_1.estimateCoolingHours)({
            outdoorMaxC: 35,
            outdoorLikelyTempC: 28,
            remainingHours: 8,
            learnedHours: null,
            roomTempC: 24,
            onTempC: 26,
            offTempC: 24,
        });
        strict_1.default.equal(r.likelyActive, true);
        strict_1.default.ok(r.expectedHours >= 2);
        strict_1.default.match(r.reasonDe, /Außen-Max/);
    });
    (0, node_test_1.it)("estimates dehumidify hours on hot days without humidity reading", () => {
        const r = (0, climate_energy_1.estimateDehumidifyHours)({
            outdoorMaxC: 34,
            outdoorLikelyTempC: 28,
            remainingHours: 8,
            learnedHours: null,
            roomHumidityPct: null,
            maxHumidityPct: 60,
            dryModeConfigured: true,
        });
        strict_1.default.equal(r.likelyActive, true);
        strict_1.default.ok(r.expectedHours > 0);
    });
});
