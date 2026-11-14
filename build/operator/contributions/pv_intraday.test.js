"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const strict_1 = __importDefault(require("node:assert/strict"));
const pv_intraday_1 = require("./pv_intraday");
function slots() {
    const out = [];
    const base = Date.parse("2026-11-14T08:00:00.000Z");
    for (let i = 0; i < 16; i++) {
        out.push({
            startIso: new Date(base + i * 900_000).toISOString(),
            endIso: new Date(base + (i + 1) * 900_000).toISOString(),
            pvPowerW: 2000,
        });
    }
    return out;
}
(0, node_test_1.describe)("pv intraday", () => {
    const now = Date.parse("2026-11-14T10:00:00.000Z"); // 2 h = 4 kWh erwartet
    (0, node_test_1.it)("sums expected energy, partial slot proportional", () => {
        strict_1.default.equal((0, pv_intraday_1.expectedEnergySoFarKwh)(slots(), now), 4);
        strict_1.default.equal((0, pv_intraday_1.expectedEnergySoFarKwh)(slots(), Date.parse("2026-11-14T08:07:30.000Z")), 0.25);
    });
    (0, node_test_1.it)("scales down when actual is far below expected", () => {
        const r = (0, pv_intraday_1.computeIntradayFactor)(slots(), 2, now);
        strict_1.default.equal(r.active, true);
        strict_1.default.equal(r.factor, 0.5);
    });
    (0, node_test_1.it)("caps upward factor", () => {
        strict_1.default.equal((0, pv_intraday_1.computeIntradayFactor)(slots(), 40, now).factor, 1.25);
    });
    (0, node_test_1.it)("no correction with too little evidence or invalid actual", () => {
        strict_1.default.equal((0, pv_intraday_1.computeIntradayFactor)(slots(), 0, Date.parse("2026-11-14T08:15:00.000Z")).factor, 1);
        strict_1.default.equal((0, pv_intraday_1.computeIntradayFactor)(slots(), null, now).factor, 1);
    });
    (0, node_test_1.it)("within tolerance stays 1", () => {
        strict_1.default.equal((0, pv_intraday_1.computeIntradayFactor)(slots(), 3.9, now).active, false);
    });
    (0, node_test_1.it)("applies factor only to future slots", () => {
        const out = (0, pv_intraday_1.applyIntradayFactor)(slots(), 0.5, now);
        strict_1.default.equal(out[0].pvPowerW, 2000);
        strict_1.default.equal(out[15].pvPowerW, 1000);
    });
    (0, node_test_1.it)("letzte Stunde senkt den Faktor schneller als die Tagessumme", () => {
        // Tagessumme passt (4 kWh), letzte Stunde nur 1 von erwarteten 2 kWh
        const withoutRecent = (0, pv_intraday_1.computeIntradayFactor)(slots(), 4, now);
        strict_1.default.equal(withoutRecent.active, false);
        const r = (0, pv_intraday_1.computeIntradayFactor)(slots(), 4, now, { deltaKwh: 1, windowMs: 3_600_000 });
        strict_1.default.equal(r.active, true);
        strict_1.default.equal(r.factor, 0.75);
    });
    (0, node_test_1.it)("Toleranz 8 %: kleine Abweichung bleibt ohne Korrektur", () => {
        strict_1.default.equal((0, pv_intraday_1.computeIntradayFactor)(slots(), 3.8, now).active, false);
        strict_1.default.equal((0, pv_intraday_1.computeIntradayFactor)(slots(), 3.5, now).active, true);
    });
    (0, node_test_1.it)("recentActualFromHistory nimmt den Stand ~60 min zurück, sonst null", () => {
        const h = [
            { ts: now - 120 * 60_000, kwh: 0.5 },
            { ts: now - 62 * 60_000, kwh: 1.5 },
            { ts: now - 10 * 60_000, kwh: 3.5 },
        ];
        const r = (0, pv_intraday_1.recentActualFromHistory)(h, now, 4);
        strict_1.default.equal(r?.deltaKwh, 2.5);
        strict_1.default.equal((0, pv_intraday_1.recentActualFromHistory)([{ ts: now - 10 * 60_000, kwh: 3.5 }], now, 4), null);
        strict_1.default.equal((0, pv_intraday_1.recentActualFromHistory)(h, now, 1), null);
    });
});
