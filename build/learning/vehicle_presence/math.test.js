"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const strict_1 = __importDefault(require("node:assert/strict"));
const constants_1 = require("./constants");
const math_1 = require("./math");
(0, node_test_1.describe)("vehicle presence learning thresholds", () => {
    (0, node_test_1.it)("requires named minimum observations before predicting", () => {
        strict_1.default.ok(constants_1.MIN_OBSERVATIONS_FOR_PREDICTION >= 5);
        strict_1.default.equal((0, math_1.predictFromCounts)(0, constants_1.MIN_OBSERVATIONS_FOR_PREDICTION - 1).status, "unknown");
    });
    (0, node_test_1.it)("uses availability ratios as named constants", () => {
        strict_1.default.ok(constants_1.PREDICT_AVAILABLE_RATIO > 0.5);
        strict_1.default.ok(constants_1.PREDICT_UNAVAILABLE_RATIO < 0.5);
        const n = constants_1.CONFIDENCE_TARGET_SAMPLES;
        strict_1.default.equal((0, math_1.predictFromCounts)(Math.ceil(n * constants_1.PREDICT_AVAILABLE_RATIO), n).status, "available");
        strict_1.default.equal((0, math_1.predictFromCounts)(Math.floor(n * constants_1.PREDICT_UNAVAILABLE_RATIO), n).status, "unavailable");
    });
});
