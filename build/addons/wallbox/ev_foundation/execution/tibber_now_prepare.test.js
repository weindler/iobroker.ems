"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const strict_1 = __importDefault(require("node:assert/strict"));
const tibber_now_prepare_js_1 = require("./tibber_now_prepare.js");
const NOW = Date.parse("2026-09-01T12:00:00.000Z");
const DELAY = tibber_now_prepare_js_1.TIBBER_NOW_STABILIZE_DEFAULT_S * 1000;
function evalAt(over) {
    return (0, tibber_now_prepare_js_1.evaluateTibberNowPrepare)({
        enabled: true,
        connected: true,
        nowMs: NOW,
        delayMs: DELAY,
        blocked: false,
        plannerWantsChargeOrStop: false,
        alreadyNow: false,
        prev: over.prev ?? (0, tibber_now_prepare_js_1.emptyTibberNowPrepareState)(),
        ...over,
    });
}
(0, node_test_1.describe)("evaluateTibberNowPrepare", () => {
    (0, node_test_1.it)("ohne Grid-Rewards kein NOW", () => {
        const r = evalAt({ enabled: false, connected: true });
        strict_1.default.equal(r.action, "idle");
    });
    (0, node_test_1.it)("bereits verbunden beim Start: kein sofortiges NOW", () => {
        const r = evalAt({ connected: true, prev: (0, tibber_now_prepare_js_1.emptyTibberNowPrepareState)() });
        strict_1.default.equal(r.action, "idle");
        strict_1.default.equal(r.reason, "already_connected_at_start");
    });
    (0, node_test_1.it)("disconnected → connected wartet, dann set_now", () => {
        const disc = evalAt({ connected: false });
        strict_1.default.equal(disc.next.prevConnected, false);
        const wait = evalAt({ connected: true, prev: disc.next, nowMs: NOW });
        strict_1.default.equal(wait.action, "wait");
        const tooSoon = evalAt({ connected: true, prev: wait.next, nowMs: NOW + 60_000 });
        strict_1.default.equal(tooSoon.action, "wait");
        const ready = evalAt({ connected: true, prev: wait.next, nowMs: NOW + DELAY });
        strict_1.default.equal(ready.action, "set_now");
        const once = evalAt({ connected: true, prev: ready.next, nowMs: NOW + DELAY + 1000 });
        strict_1.default.equal(once.action, "idle");
    });
    (0, node_test_1.it)("Abstecken während Wartezeit bricht ab", () => {
        const disc = evalAt({ connected: false });
        const wait = evalAt({ connected: true, prev: disc.next });
        const cancel = evalAt({ connected: false, prev: wait.next });
        strict_1.default.equal(cancel.action, "cancel");
        strict_1.default.equal(cancel.next.connectedSinceMs, null);
    });
    (0, node_test_1.it)("Planner-Ladung/Stop oder Sperre verhindert NOW", () => {
        const disc = evalAt({ connected: false });
        const wait = evalAt({ connected: true, prev: disc.next });
        const blocked = evalAt({
            connected: true,
            prev: wait.next,
            nowMs: NOW + DELAY,
            blocked: true,
        });
        strict_1.default.equal(blocked.action, "wait");
        const planner = evalAt({
            connected: true,
            prev: wait.next,
            nowMs: NOW + DELAY,
            plannerWantsChargeOrStop: true,
        });
        strict_1.default.equal(planner.action, "wait");
    });
});
