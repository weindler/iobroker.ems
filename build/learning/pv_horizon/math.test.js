"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const strict_1 = __importDefault(require("node:assert/strict"));
const node_test_1 = require("node:test");
const constants_1 = require("./constants");
const math_1 = require("./math");
(0, node_test_1.describe)("pv_horizon math", () => {
    (0, node_test_1.it)("applies negative bias with day1 full weight", () => {
        const eff = (0, math_1.effectiveBiasPct)(-20, 1);
        strict_1.default.equal(eff, -20);
        strict_1.default.equal((0, math_1.correctHorizonKwh)(100, -20, 1), 80);
    });
    (0, node_test_1.it)("applies positive bias with reduced weight on day7", () => {
        const eff = (0, math_1.effectiveBiasPct)(20, 7);
        strict_1.default.equal(eff, 20 * constants_1.PV_HORIZON_BIAS_WEIGHT_BY_DAY[6]);
        strict_1.default.equal((0, math_1.correctHorizonKwh)(100, 20, 7), 108);
    });
    (0, node_test_1.it)("computes full 7 days without skip", () => {
        const raws = [10, 11, 12, 13, 14, 15, 16];
        const result = (0, math_1.computePvHorizon)(raws, -10, 70);
        strict_1.default.equal(result.daysAvailable, 7);
        strict_1.default.equal(result.expectedDays, 7);
        strict_1.default.equal(result.status, "ready");
        strict_1.default.equal(result.total7dRawKwh, 91);
        strict_1.default.ok(result.total7dCorrectedKwh !== null && result.total7dCorrectedKwh < 91);
        strict_1.default.equal(result.days[0].confidencePct, 70);
        strict_1.default.equal(result.days[6].confidencePct, 70 - 6 * constants_1.PV_HORIZON_CONFIDENCE_DECAY_PP_PER_DAY);
    });
    (0, node_test_1.it)("skips day1+2 when pv forecast covers short horizon", () => {
        const raws = [99, 99, 30, 31, 32, 33, 34];
        const result = (0, math_1.computePvHorizon)(raws, -10, 50, { skipDayIndices: [1, 2] });
        strict_1.default.deepEqual(result.skippedDayIndices, [1, 2]);
        strict_1.default.equal(result.days[0].rawKwh, null);
        strict_1.default.equal(result.days[1].rawKwh, null);
        strict_1.default.equal(result.days[2].rawKwh, 30);
        strict_1.default.equal(result.daysAvailable, 5);
        strict_1.default.equal(result.expectedDays, constants_1.PV_HORIZON_EXTENDED_DAY_COUNT);
        strict_1.default.equal(result.status, "ready");
        strict_1.default.equal(result.total7dRawKwh, 160);
    });
    (0, node_test_1.it)("reports no_extended_days when only short horizon is configured", () => {
        const raws = [10, 11, null, null, null, null, null];
        const result = (0, math_1.computePvHorizon)(raws, -10, 50, { skipDayIndices: [1, 2] });
        strict_1.default.equal(result.daysAvailable, 0);
        strict_1.default.equal(result.status, "no_extended_days");
        strict_1.default.equal(result.total7dRawKwh, null);
    });
    (0, node_test_1.it)("handles partial extended days (3 of 5)", () => {
        const raws = [null, null, 20, 21, 22, null, null];
        const result = (0, math_1.computePvHorizon)(raws, -10, 50, { skipDayIndices: [1, 2] });
        strict_1.default.equal(result.daysAvailable, 3);
        strict_1.default.equal(result.status, "partial");
        strict_1.default.equal(result.total7dRawKwh, 63);
    });
    (0, node_test_1.it)("skips missing forecast without zero", () => {
        const result = (0, math_1.computePvHorizon)([null, null, null, null, null, null, null], -10, 50);
        strict_1.default.equal(result.daysAvailable, 0);
        strict_1.default.equal(result.status, "no_data");
        strict_1.default.equal(result.total7dRawKwh, null);
    });
    (0, node_test_1.it)("reports no_bias when bias missing", () => {
        const result = (0, math_1.computePvHorizon)([30, 31, 32, null, null, null, null], null, 40);
        strict_1.default.equal(result.status, "no_bias");
        strict_1.default.equal(result.days[0].correctedKwh, null);
        strict_1.default.equal(result.days[0].rawKwh, 30);
    });
    (0, node_test_1.it)("inherits confidence from phase 2a base", () => {
        const result = (0, math_1.computePvHorizon)([5, 5, 5, 5, 5, 5, 5], 0, 19);
        strict_1.default.equal(result.days[0].confidencePct, 19);
        strict_1.default.equal(result.days[1].confidencePct, 16);
    });
});
