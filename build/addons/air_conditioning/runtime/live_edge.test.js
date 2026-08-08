"use strict";
/**
 * BETA-GATE-003 — AC effective live false→true: Start-Retry darf nicht 120s blockieren.
 * Edge = (global live AND addon live), nicht nur Global.
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const strict_1 = __importDefault(require("node:assert/strict"));
const constants_1 = require("../constants");
/** Spiegel der Engine-Bedingung für effective-live reconcile. */
function shouldClearStartRetryOnEffectiveLiveEdge(input) {
    return input.effectiveLiveEdge && input.feedbackOff && input.claimedRunningOrHadStart;
}
(0, node_test_1.describe)("AC effective live start retry", () => {
    (0, node_test_1.it)("clears retry on effective live edge (global or addon edge) when hardware off", () => {
        strict_1.default.equal(shouldClearStartRetryOnEffectiveLiveEdge({
            effectiveLiveEdge: true,
            feedbackOff: true,
            claimedRunningOrHadStart: true,
        }), true);
    });
    (0, node_test_1.it)("does not clear without effective live edge", () => {
        strict_1.default.equal(shouldClearStartRetryOnEffectiveLiveEdge({
            effectiveLiveEdge: false,
            feedbackOff: true,
            claimedRunningOrHadStart: true,
        }), false);
    });
    (0, node_test_1.it)("does not clear when feedback already on", () => {
        strict_1.default.equal(shouldClearStartRetryOnEffectiveLiveEdge({
            effectiveLiveEdge: true,
            feedbackOff: false,
            claimedRunningOrHadStart: true,
        }), false);
    });
    (0, node_test_1.it)("documents that AC_START_RETRY_MS would otherwise block immediate live start", () => {
        strict_1.default.ok(constants_1.AC_START_RETRY_MS >= 60_000);
    });
});
