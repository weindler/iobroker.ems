"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const strict_1 = __importDefault(require("node:assert/strict"));
const thermal_empty_at_1 = require("./thermal_empty_at");
function signal(partial) {
    return {
        status: "degraded",
        health: "degraded",
        samples: 0,
        coolingRateCPerHAvg: null,
        coolingConstantPerH: null,
        coolingAsymptoteC: null,
        estimatedRemainingHours: null,
        estimatedEmptyAt: null,
        currentDayTypeRuntimeHoursMedian: null,
        reasonDe: "t",
        ...partial,
    };
}
(0, node_test_1.describe)("A1 thermal empty_at planning usability", () => {
    (0, node_test_1.it)("Newton estimate with samples=0 is planning-usable without cycle-valid claim", () => {
        const learning = signal({
            status: "degraded",
            samples: 0,
            coolingConstantPerH: 0.09,
            estimatedEmptyAt: "2026-08-09T14:00:00.000Z",
        });
        strict_1.default.equal((0, thermal_empty_at_1.hasNewtonEmptyAtModel)(learning), true);
        strict_1.default.equal((0, thermal_empty_at_1.hasCycleCoolingModel)(learning), false);
        strict_1.default.equal((0, thermal_empty_at_1.thermalEmptyAtUsableForPlanning)(learning), true);
        strict_1.default.match((0, thermal_empty_at_1.thermalLearningDegradedCauseDe)(learning) ?? "", /Newton estimate.*0 completed cooling cycles/);
    });
    (0, node_test_1.it)("does not mark Newton-only learning as cycle-valid", () => {
        const learning = signal({
            status: "degraded",
            samples: 0,
            coolingConstantPerH: 0.09,
            estimatedEmptyAt: "2026-08-09T14:00:00.000Z",
        });
        strict_1.default.notEqual(learning.status, "valid");
        strict_1.default.equal((0, thermal_empty_at_1.hasCycleCoolingModel)(learning), false);
    });
    (0, node_test_1.it)("missing empty_at is not planning-usable", () => {
        const learning = signal({
            status: "degraded",
            samples: 0,
            coolingConstantPerH: 0.09,
            estimatedEmptyAt: null,
        });
        strict_1.default.equal((0, thermal_empty_at_1.thermalEmptyAtUsableForPlanning)(learning), false);
    });
});
