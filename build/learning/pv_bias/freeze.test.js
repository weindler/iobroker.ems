"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const strict_1 = __importDefault(require("node:assert/strict"));
const node_test_1 = require("node:test");
const freeze_1 = require("./freeze");
function atLocal(hours, minutes, dayOffset = 0) {
    const d = new Date();
    d.setHours(hours, minutes, 0, 0);
    d.setDate(d.getDate() + dayOffset);
    return d;
}
(0, node_test_1.describe)("pv_bias freeze", () => {
    (0, node_test_1.it)("freeze happens only once per day", () => {
        const frozenAt = atLocal(6, 5).toISOString();
        const later = atLocal(6, 15);
        const decision = (0, freeze_1.decideForecastFreeze)(later, true, "06:00", frozenAt);
        strict_1.default.equal(decision.shouldFreeze, false);
        strict_1.default.equal(decision.status, "ready");
    });
    (0, node_test_1.it)("adapter restart does not create new snapshot", () => {
        const frozenAt = atLocal(6, 2).toISOString();
        const afterRestart = atLocal(9, 30);
        const decision = (0, freeze_1.decideForecastFreeze)(afterRestart, true, "06:00", frozenAt);
        strict_1.default.equal(decision.shouldFreeze, false);
    });
    (0, node_test_1.it)("missing forecast yields error without zero", () => {
        const built = (0, freeze_1.buildFreezeSnapshot)(new Date(), "06:00", null, 40, "forecast.pv.today_kwh");
        strict_1.default.equal(built.ok, false);
        if (!built.ok) {
            strict_1.default.match(built.reason, /fehlt/);
        }
    });
    (0, node_test_1.it)("freeze time change waits until next calendar day", () => {
        const frozenAt = atLocal(6, 1).toISOString();
        const sameDayNewTime = atLocal(8, 5);
        const decision = (0, freeze_1.decideForecastFreeze)(sameDayNewTime, true, "08:00", frozenAt);
        strict_1.default.equal(decision.shouldFreeze, false);
    });
    (0, node_test_1.it)("new freeze time applies when no snapshot today yet", () => {
        const yesterday = atLocal(6, 0, -1).toISOString();
        const todayAfterNewTime = atLocal(8, 10);
        const decision = (0, freeze_1.decideForecastFreeze)(todayAfterNewTime, true, "08:00", yesterday);
        strict_1.default.equal(decision.shouldFreeze, true);
    });
    (0, node_test_1.it)("waits before freeze time", () => {
        const before = atLocal(5, 30);
        const decision = (0, freeze_1.decideForecastFreeze)(before, true, "06:00", null);
        strict_1.default.equal(decision.shouldFreeze, false);
        strict_1.default.equal(decision.status, "waiting");
    });
    (0, node_test_1.it)("creates snapshot after freeze time", () => {
        const after = atLocal(6, 10);
        const decision = (0, freeze_1.decideForecastFreeze)(after, true, "06:00", null);
        strict_1.default.equal(decision.shouldFreeze, true);
    });
    (0, node_test_1.it)("buildFreezeSnapshot keeps frozen values stable inputs", () => {
        const built = (0, freeze_1.buildFreezeSnapshot)(new Date(), "06:00", 30, 45, "forecast.pv.today_kwh");
        strict_1.default.equal(built.ok, true);
        if (built.ok) {
            strict_1.default.equal(built.snapshot.frozenTodayKwh, 30);
            strict_1.default.equal(built.snapshot.frozenTomorrowKwh, 45);
        }
    });
    (0, node_test_1.it)("localDateKey separates calendar days", () => {
        const today = atLocal(12, 0);
        const tomorrow = atLocal(12, 0, 1);
        strict_1.default.notEqual((0, freeze_1.localDateKey)(today), (0, freeze_1.localDateKey)(tomorrow));
    });
    (0, node_test_1.it)("freezeInstantMs aligns with HH:MM", () => {
        const ref = atLocal(0, 0);
        const ms = (0, freeze_1.freezeInstantMs)("06:00", ref);
        strict_1.default.ok(ms !== null);
        const d = new Date(ms);
        strict_1.default.equal(d.getHours(), 6);
        strict_1.default.equal(d.getMinutes(), 0);
    });
});
