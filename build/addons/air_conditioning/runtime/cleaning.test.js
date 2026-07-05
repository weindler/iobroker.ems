"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const strict_1 = __importDefault(require("node:assert/strict"));
const node_test_1 = require("node:test");
const cleaning_1 = require("./cleaning");
(0, node_test_1.describe)("ac cleaning feedback", () => {
    (0, node_test_1.it)("detects active operating states", () => {
        strict_1.default.equal((0, cleaning_1.isCleaningOperatingActive)("autoClean"), true);
        strict_1.default.equal((0, cleaning_1.isCleaningOperatingActive)("ready"), false);
    });
    (0, node_test_1.it)("ignores autoClean flicker in the first minute", () => {
        strict_1.default.equal((0, cleaning_1.shouldMarkCleaningOperatingActive)("autoClean", 12), false);
        strict_1.default.equal((0, cleaning_1.shouldMarkCleaningOperatingActive)("autoClean", 90), true);
    });
    (0, node_test_1.it)("does not finish on idle ready shortly after start", () => {
        strict_1.default.equal((0, cleaning_1.isCleaningFinishedByFeedback)({
            operatingStateRaw: "ready",
            modeRaw: "on",
            sawOperatingActive: true,
            elapsedSec: 12,
        }), false);
    });
    (0, node_test_1.it)("finishes on ready after minimum runtime once autoClean was seen", () => {
        strict_1.default.equal((0, cleaning_1.isCleaningFinishedByFeedback)({
            operatingStateRaw: "ready",
            modeRaw: "on",
            sawOperatingActive: true,
            elapsedSec: 600,
        }), true);
    });
    (0, node_test_1.it)("finishes on autoCleaningMode off after confirm window", () => {
        strict_1.default.equal((0, cleaning_1.isCleaningFinishedByFeedback)({
            operatingStateRaw: "autoClean",
            modeRaw: "off",
            sawOperatingActive: true,
            elapsedSec: 120,
        }), true);
    });
});
