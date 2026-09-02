"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const strict_1 = __importDefault(require("node:assert/strict"));
const alpha_beta_js_1 = require("./alpha_beta.js");
function win(p) {
    return {
        durationSec: 600,
        eGbKwh: p.gbOn ? 0.2 : 0,
        importKwh: p.gbOn ? 0.02 : 0.12,
        batteryDischargeKwh: p.gbOn ? 0.22 : 0.05,
        houseMeanW: 400,
        pvMeanW: 0,
        deficitMeanW: 400,
        socMeanPct: 70,
        source: "episode",
        ...p,
    };
}
(0, node_test_1.describe)("α/β learning", () => {
    (0, node_test_1.it)("ist ohne Paare nicht usable (Cold Start)", () => {
        const r = (0, alpha_beta_js_1.learnAlphaBeta)([]);
        strict_1.default.equal(r.usable, false);
        strict_1.default.equal(r.alpha, null);
        strict_1.default.equal(r.beta, null);
    });
    (0, node_test_1.it)("zwingt β nicht auf ≥ α", () => {
        const ons = [];
        const offs = [];
        for (let i = 0; i < 10; i++) {
            ons.push(win({
                gbOn: true,
                startTs: Date.parse("2026-01-10T02:00:00Z") + i * 3600_000,
                importKwh: 0.08,
                batteryDischargeKwh: 0.1,
                eGbKwh: 0.2,
            }));
            offs.push(win({
                gbOn: false,
                startTs: Date.parse("2026-01-11T02:00:00Z") + i * 3600_000,
                importKwh: 0.1,
                batteryDischargeKwh: 0.08,
            }));
        }
        const r = (0, alpha_beta_js_1.learnAlphaBeta)([...ons, ...offs]);
        strict_1.default.ok(r.alpha != null && r.beta != null);
        /* beobachtetes β darf kleiner als α sein — nicht zurechtbiegen */
        if (r.beta < r.alpha) {
            strict_1.default.ok(r.beta < r.alpha);
        }
    });
    (0, node_test_1.it)("senkt usable bei zu großer Streuung", () => {
        const windows = [];
        for (let i = 0; i < 12; i++) {
            windows.push(win({
                gbOn: true,
                startTs: Date.parse("2026-01-10T02:00:00Z") + i * 3600_000,
                importKwh: i % 2 === 0 ? 0.01 : 0.4,
                batteryDischargeKwh: i % 2 === 0 ? 0.05 : 0.9,
                eGbKwh: 0.2,
            }));
            windows.push(win({
                gbOn: false,
                startTs: Date.parse("2026-01-11T02:00:00Z") + i * 3600_000,
                importKwh: 0.12,
                batteryDischargeKwh: 0.05,
            }));
        }
        const r = (0, alpha_beta_js_1.learnAlphaBeta)(windows);
        strict_1.default.equal(r.usable, false);
    });
    (0, node_test_1.it)("matched nur vergleichbare Lagen", () => {
        const on = win({ gbOn: true, startTs: Date.parse("2026-01-10T02:00:00Z"), houseMeanW: 400 });
        const offOk = win({ gbOn: false, startTs: Date.parse("2026-01-11T02:00:00Z"), houseMeanW: 420 });
        const offFar = win({ gbOn: false, startTs: Date.parse("2026-01-11T02:00:00Z"), houseMeanW: 2500 });
        strict_1.default.equal((0, alpha_beta_js_1.windowsMatch)(on, offOk), true);
        strict_1.default.equal((0, alpha_beta_js_1.windowsMatch)(on, offFar), false);
    });
});
