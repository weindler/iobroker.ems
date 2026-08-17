"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const strict_1 = __importDefault(require("node:assert/strict"));
const setpoint_session_js_1 = require("./setpoint_session.js");
function owned(over = {}) {
    const owner = over.owner ?? "grid_charge";
    return {
        owner,
        kind: owner === "grid_balance" ? "discharge" : "charge",
        setpointW: 2000,
        wrotePositive: true,
        wroteLive: true,
        releasePending: false,
        releaseReason: "",
        lastReleaseAt: null,
        ...over,
    };
}
(0, node_test_1.describe)("battery setpoint release contract", () => {
    (0, node_test_1.it)("maps charge actions to owners", () => {
        strict_1.default.equal((0, setpoint_session_js_1.setpointOwnerFromAction)("grid_charge"), "grid_charge");
        strict_1.default.equal((0, setpoint_session_js_1.setpointOwnerFromAction)("charge"), "planned_charge");
        strict_1.default.equal((0, setpoint_session_js_1.setpointOwnerFromAction)("topoff"), "planned_charge");
        strict_1.default.equal((0, setpoint_session_js_1.setpointOwnerFromAction)("grid_balance"), "grid_balance");
        strict_1.default.equal((0, setpoint_session_js_1.setpointOwnerFromAction)("hold"), "none");
        strict_1.default.equal((0, setpoint_session_js_1.setpointOwnerFromAction)("self_consumption"), "none");
    });
    (0, node_test_1.it)("ownership only after own successful write > 0", () => {
        const s = (0, setpoint_session_js_1.notePositiveSetpointWrite)((0, setpoint_session_js_1.emptySetpointSession)(), "planned_charge", 2000, true);
        strict_1.default.equal(s.owner, "planned_charge");
        strict_1.default.equal(s.kind, "charge");
        strict_1.default.equal(s.setpointW, 2000);
        strict_1.default.equal(s.wrotePositive, true);
        strict_1.default.equal(s.wroteLive, true);
        strict_1.default.equal((0, setpoint_session_js_1.notePositiveSetpointWrite)((0, setpoint_session_js_1.emptySetpointSession)(), "planned_charge", 0, true).wrotePositive, false);
        strict_1.default.equal((0, setpoint_session_js_1.notePositiveSetpointWrite)((0, setpoint_session_js_1.emptySetpointSession)(), "none", 2000, true).wrotePositive, false);
    });
    (0, node_test_1.it)("grid_charge → self_consumption: exactly one 0 W release", () => {
        const d = (0, setpoint_session_js_1.decideSetpointRelease)({ session: owned(), handover: "none", regularEnd: true });
        strict_1.default.equal(d.shouldWriteZero, true);
        strict_1.default.equal(d.dropOwnership, true);
        strict_1.default.equal(d.reason, "regular_end");
        const after = (0, setpoint_session_js_1.applyZeroRelease)(owned({ releasePending: true }), "2026-08-17T08:00:00.000Z", d.reason);
        strict_1.default.equal(after.owner, "none");
        strict_1.default.equal(after.setpointW, 0);
        strict_1.default.equal(after.wrotePositive, false);
        strict_1.default.equal(after.lastReleaseAt, "2026-08-17T08:00:00.000Z");
        strict_1.default.equal(after.releasePending, false);
        const second = (0, setpoint_session_js_1.decideSetpointRelease)({ session: after, handover: "none", regularEnd: true });
        strict_1.default.equal(second.shouldWriteZero, false);
        strict_1.default.equal(second.reason, "no_ownership");
    });
    (0, node_test_1.it)("grid_balance → idle: 0 W if GB owned", () => {
        const d = (0, setpoint_session_js_1.decideSetpointRelease)({
            session: owned({ owner: "grid_balance", setpointW: 800 }),
            handover: "none",
            regularEnd: true,
        });
        strict_1.default.equal(d.shouldWriteZero, true);
        strict_1.default.equal(owned({ owner: "grid_balance" }).kind, "discharge");
        strict_1.default.equal(owned().kind, "charge");
    });
    (0, node_test_1.it)("charge and discharge ownership cannot be confused", () => {
        const gb = (0, setpoint_session_js_1.notePositiveSetpointWrite)((0, setpoint_session_js_1.emptySetpointSession)(), "grid_balance", 48, true);
        const gc = (0, setpoint_session_js_1.notePositiveSetpointWrite)((0, setpoint_session_js_1.emptySetpointSession)(), "grid_charge", 2000, true);
        strict_1.default.equal(gb.kind, "discharge");
        strict_1.default.equal(gb.owner, "grid_balance");
        strict_1.default.equal(gc.kind, "charge");
        strict_1.default.equal(gc.owner, "grid_charge");
        strict_1.default.notEqual(gb.kind, gc.kind);
    });
    (0, node_test_1.it)("grid_charge → hold: drop ownership, no 0 W", () => {
        const d = (0, setpoint_session_js_1.decideSetpointRelease)({ session: owned(), handover: "hold", regularEnd: true });
        strict_1.default.equal(d.shouldWriteZero, false);
        strict_1.default.equal(d.dropOwnership, true);
        strict_1.default.equal(d.reason, "handover_hold");
        const after = (0, setpoint_session_js_1.applyHandover)(owned(), d.reason);
        strict_1.default.equal(after.owner, "none");
        strict_1.default.equal(after.lastReleaseAt, null);
    });
    (0, node_test_1.it)("grid_balance → hold: no competing 0 W", () => {
        const d = (0, setpoint_session_js_1.decideSetpointRelease)({
            session: owned({ owner: "grid_balance" }),
            handover: "hold",
            regularEnd: true,
        });
        strict_1.default.equal(d.shouldWriteZero, false);
        strict_1.default.equal(d.reason, "handover_hold");
    });
    (0, node_test_1.it)("grid_charge → external: no competing 0 W", () => {
        const d = (0, setpoint_session_js_1.decideSetpointRelease)({ session: owned(), handover: "external", regularEnd: true });
        strict_1.default.equal(d.shouldWriteZero, false);
        strict_1.default.equal(d.reason, "handover_external");
    });
    (0, node_test_1.it)("restore/fault takeover: no competing 0 W", () => {
        const d = (0, setpoint_session_js_1.decideSetpointRelease)({ session: owned(), handover: "restore_fault", regularEnd: false });
        strict_1.default.equal(d.shouldWriteZero, false);
        strict_1.default.equal(d.dropOwnership, true);
        strict_1.default.equal(d.reason, "handover_restore_fault");
    });
    (0, node_test_1.it)("higher-priority battery action: no competing 0 W", () => {
        const d = (0, setpoint_session_js_1.decideSetpointRelease)({
            session: owned({ owner: "grid_balance" }),
            handover: "higher_priority",
            regularEnd: true,
        });
        strict_1.default.equal(d.shouldWriteZero, false);
        strict_1.default.equal(d.reason, "handover_higher_priority");
    });
    (0, node_test_1.it)("adapter restart / leftover setpoint without ownership: no 0 W", () => {
        const leftover = (0, setpoint_session_js_1.emptySetpointSession)();
        const d = (0, setpoint_session_js_1.decideSetpointRelease)({ session: leftover, handover: "none", regularEnd: true });
        strict_1.default.equal(d.shouldWriteZero, false);
        strict_1.default.equal(d.reason, "no_ownership");
    });
    (0, node_test_1.it)("handover wins over regular end", () => {
        strict_1.default.equal((0, setpoint_session_js_1.resolveBatterySetpointHandover)({
            hold: true,
            external: false,
            restoreOrFault: false,
            higherPriority: false,
        }), "hold");
        strict_1.default.equal((0, setpoint_session_js_1.resolveBatterySetpointHandover)({
            hold: true,
            external: true,
            restoreOrFault: false,
            higherPriority: false,
        }), "external");
        strict_1.default.equal((0, setpoint_session_js_1.resolveBatterySetpointHandover)({
            hold: true,
            external: true,
            restoreOrFault: true,
            higherPriority: false,
        }), "restore_fault");
    });
    (0, node_test_1.it)("release_pending is set before the 0-write and cleared after", () => {
        const pending = (0, setpoint_session_js_1.markReleasePending)(owned(), "regular_end");
        strict_1.default.equal(pending.releasePending, true);
        strict_1.default.equal(pending.releaseReason, "regular_end");
        strict_1.default.equal(pending.owner, "grid_charge");
        const done = (0, setpoint_session_js_1.applyZeroRelease)(pending, "2026-08-17T08:01:00.000Z", "regular_end");
        strict_1.default.equal(done.releasePending, false);
        strict_1.default.equal(done.lastReleaseAt, "2026-08-17T08:01:00.000Z");
    });
    (0, node_test_1.it)("dryrun write does not mark live ownership", () => {
        const s = (0, setpoint_session_js_1.notePositiveSetpointWrite)((0, setpoint_session_js_1.emptySetpointSession)(), "planned_charge", 2000, false);
        strict_1.default.equal(s.wrotePositive, true);
        strict_1.default.equal(s.wroteLive, false);
    });
});
