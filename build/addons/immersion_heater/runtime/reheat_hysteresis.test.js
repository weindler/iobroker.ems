"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const strict_1 = __importDefault(require("node:assert/strict"));
const reheat_hysteresis_1 = require("./reheat_hysteresis");
(0, node_test_1.describe)("immersion reheat hysteresis", () => {
    (0, node_test_1.it)("blocks when target was reached and buffer still above Ziel − Hysterese", () => {
        strict_1.default.equal((0, reheat_hysteresis_1.isImmersionReheatHysteresisActive)({
            bufferTempC: 48,
            targetTempC: 51.6,
            hysteresisK: 5,
            autoTargetReached: true,
        }), true);
    });
    (0, node_test_1.it)("releases when buffer cools below Ziel − Hysterese", () => {
        strict_1.default.equal((0, reheat_hysteresis_1.isImmersionReheatHysteresisActive)({
            bufferTempC: 46,
            targetTempC: 51.6,
            hysteresisK: 5,
            autoTargetReached: true,
        }), false);
    });
    (0, node_test_1.it)("does not block before the target was ever reached", () => {
        strict_1.default.equal((0, reheat_hysteresis_1.isImmersionReheatHysteresisActive)({
            bufferTempC: 48,
            targetTempC: 51.6,
            hysteresisK: 5,
            autoTargetReached: false,
        }), false);
    });
});
