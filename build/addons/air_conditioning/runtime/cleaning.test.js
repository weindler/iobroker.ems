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
    (0, node_test_1.it)("finishes only after active phase was seen", () => {
        strict_1.default.equal((0, cleaning_1.isCleaningFinishedByFeedback)({
            operatingStateRaw: "ready",
            modeRaw: "on",
            sawOperatingActive: false,
        }), false);
        strict_1.default.equal((0, cleaning_1.isCleaningFinishedByFeedback)({
            operatingStateRaw: "ready",
            modeRaw: "on",
            sawOperatingActive: true,
        }), true);
        strict_1.default.equal((0, cleaning_1.isCleaningFinishedByFeedback)({
            operatingStateRaw: "autoClean",
            modeRaw: "off",
            sawOperatingActive: true,
        }), true);
    });
});
