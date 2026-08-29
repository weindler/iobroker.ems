"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const strict_1 = __importDefault(require("node:assert/strict"));
const hard_off_worth_it_js_1 = require("./hard_off_worth_it.js");
(0, node_test_1.describe)("minutesUntilHardOff", () => {
    (0, node_test_1.it)("19:15 mit Hard-Off 20:00 → 45 Minuten", () => {
        strict_1.default.equal((0, hard_off_worth_it_js_1.minutesUntilHardOff)(19 * 60 + 15, "20:00"), 45);
    });
    (0, node_test_1.it)("null bei ungültiger Hard-Off-Konfiguration", () => {
        strict_1.default.equal((0, hard_off_worth_it_js_1.minutesUntilHardOff)(19 * 60, ""), null);
    });
    (0, node_test_1.it)("wickelt über Mitternacht, wenn Hard-Off morgens liegt", () => {
        strict_1.default.equal((0, hard_off_worth_it_js_1.minutesUntilHardOff)(23 * 60, "01:00"), 120);
    });
});
(0, node_test_1.describe)("demand urgency", () => {
    (0, node_test_1.it)("0 an der Schwelle, 1 bei voller Referenzspanne drüber, dazwischen linear", () => {
        strict_1.default.equal((0, hard_off_worth_it_js_1.coolingDemandUrgency01)(26, 26, 2), 0);
        strict_1.default.equal((0, hard_off_worth_it_js_1.coolingDemandUrgency01)(27, 26, 2), 0.5);
        strict_1.default.equal((0, hard_off_worth_it_js_1.coolingDemandUrgency01)(28, 26, 2), 1);
        strict_1.default.equal((0, hard_off_worth_it_js_1.coolingDemandUrgency01)(30, 26, 2), 1); // geclamped
    });
    (0, node_test_1.it)("0 ohne Raumtemperatur (kein erfundener Wert)", () => {
        strict_1.default.equal((0, hard_off_worth_it_js_1.coolingDemandUrgency01)(null, 26, 2), 0);
    });
    (0, node_test_1.it)("Feuchte analog", () => {
        strict_1.default.equal((0, hard_off_worth_it_js_1.dehumidifyDemandUrgency01)(65, 60, 10), 0.5);
        strict_1.default.equal((0, hard_off_worth_it_js_1.dehumidifyDemandUrgency01)(null, 60, 10), 0);
    });
});
(0, node_test_1.describe)("isHardOffStartWorthwhile — 19:15 bei Hard-Off 20:00 (45 Min Restzeit)", () => {
    (0, node_test_1.it)("geringer Komfortbedarf → kein unsinniger Start (Restzeit unter Mindestlaufzeit)", () => {
        const r = (0, hard_off_worth_it_js_1.isHardOffStartWorthwhile)({
            remainingMinutesUntilHardOff: 45,
            demandUrgency01: 0.1, // knapp über der Schwelle
            minWorthwhileRuntimeMin: 60,
        });
        strict_1.default.equal(r.worthwhile, false);
        strict_1.default.match(r.reasonDe, /Hard-Off in 45 Min/);
    });
    (0, node_test_1.it)("hoher Komfortbedarf → Start bleibt trotz kurzer Restzeit möglich", () => {
        const r = (0, hard_off_worth_it_js_1.isHardOffStartWorthwhile)({
            remainingMinutesUntilHardOff: 45,
            demandUrgency01: 0.9,
            minWorthwhileRuntimeMin: 60,
        });
        strict_1.default.equal(r.worthwhile, true);
        strict_1.default.ok(r.requiredMinutes <= 45);
    });
    (0, node_test_1.it)("keine starre Grenze — bei voller Dringlichkeit ist auch eine sehr kurze Restzeit noch ok", () => {
        const r = (0, hard_off_worth_it_js_1.isHardOffStartWorthwhile)({
            remainingMinutesUntilHardOff: 5,
            demandUrgency01: 1,
            minWorthwhileRuntimeMin: 60,
        });
        strict_1.default.equal(r.worthwhile, true);
        strict_1.default.equal(r.requiredMinutes, 0);
    });
    (0, node_test_1.it)("ohne Hard-Off-Konfiguration ist jeder Start wirtschaftlich", () => {
        const r = (0, hard_off_worth_it_js_1.isHardOffStartWorthwhile)({
            remainingMinutesUntilHardOff: null,
            demandUrgency01: 0,
        });
        strict_1.default.equal(r.worthwhile, true);
    });
});
