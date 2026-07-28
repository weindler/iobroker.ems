"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const strict_1 = __importDefault(require("node:assert/strict"));
const surplus_pull_forward_1 = require("./surplus_pull_forward");
const STAGE = [{ index: 1, enabled: true, nominalPowerW: 1700, setStateId: "relay.1" }];
(0, node_test_1.describe)("immersion surplus pull-forward", () => {
    (0, node_test_1.it)("pulls stage when plan is 0 W, buffer below target, surplus covers stage", () => {
        const r = (0, surplus_pull_forward_1.resolveImmersionSurplusPullForward)({
            useDailyPlan: true,
            commandedStage: 0,
            bufferTempC: 49,
            targetTempC: 52,
            hysteresisK: 1,
            liveSurplusW: 2100,
            stages: STAGE,
            preferredStage: 1,
        });
        strict_1.default.equal(r.active, true);
        strict_1.default.equal(r.stage, 1);
        strict_1.default.match(r.reasonDe, /nachziehen/);
    });
    (0, node_test_1.it)("stays off when surplus below stage power", () => {
        const r = (0, surplus_pull_forward_1.resolveImmersionSurplusPullForward)({
            useDailyPlan: true,
            commandedStage: 0,
            bufferTempC: 49,
            targetTempC: 52,
            hysteresisK: 1,
            liveSurplusW: 500,
            stages: STAGE,
            preferredStage: 1,
        });
        strict_1.default.equal(r.active, false);
        strict_1.default.equal(r.stage, 0);
    });
    (0, node_test_1.it)("does not override an already allocated stage", () => {
        const r = (0, surplus_pull_forward_1.resolveImmersionSurplusPullForward)({
            useDailyPlan: true,
            commandedStage: 1,
            bufferTempC: 49,
            targetTempC: 52,
            hysteresisK: 1,
            liveSurplusW: 3000,
            stages: STAGE,
            preferredStage: 1,
        });
        strict_1.default.equal(r.active, false);
        strict_1.default.equal(r.stage, 1);
    });
    (0, node_test_1.it)("does not pull when buffer already at/near target", () => {
        const r = (0, surplus_pull_forward_1.resolveImmersionSurplusPullForward)({
            useDailyPlan: true,
            commandedStage: 0,
            bufferTempC: 51.5,
            targetTempC: 52,
            hysteresisK: 1,
            liveSurplusW: 3000,
            stages: STAGE,
            preferredStage: 1,
        });
        strict_1.default.equal(r.active, false);
    });
});
