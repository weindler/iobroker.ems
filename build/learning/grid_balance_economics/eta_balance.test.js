"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const strict_1 = __importDefault(require("node:assert/strict"));
const node_test_1 = require("node:test");
const eta_balance_1 = require("./eta_balance");
function day(dateKey, c, d, s0, s1, cov = 1) {
    return { dateKey, chargedKwh: c, dischargedKwh: d, socFirstPct: s0, socLastPct: s1, socCoverage: cov };
}
(0, node_test_1.describe)("etaFromBalance", () => {
    (0, node_test_1.it)("berechnet η aus Bilanz über mehrere Tage (Speicherinhalt berücksichtigt)", () => {
        /* Kapazität 10 kWh, Start 20 %, Ende 40 % → +2 kWh gespeichert. Geladen 22, entladen 18 → 18/(22-2)=0,90 */
        const days = [day("2026-11-10", 6, 4, 20, 30), day("2026-11-11", 5, 5, 30, 28), day("2026-11-12", 6, 4, 28, 35), day("2026-11-13", 5, 5, 35, 40)];
        const r = (0, eta_balance_1.etaFromBalance)(days, 10);
        strict_1.default.equal(r.eta, 0.9);
        strict_1.default.equal(r.days, 4);
    });
    (0, node_test_1.it)("braucht lückenlose Tage und genug Energie", () => {
        const gap = [day("2026-11-08", 6, 5, 20, 20), day("2026-11-10", 6, 5, 20, 20), day("2026-11-11", 6, 5, 20, 20), day("2026-11-12", 6, 5, 20, 20)];
        strict_1.default.equal((0, eta_balance_1.etaFromBalance)(gap, 10).eta, null);
        const small = [1, 2, 3, 4].map((i) => day(`2026-11-0${i}`, 1, 1, 20, 20));
        strict_1.default.equal((0, eta_balance_1.etaFromBalance)(small, 10).eta, null);
        strict_1.default.equal((0, eta_balance_1.etaFromBalance)(small, null).eta, null);
    });
    (0, node_test_1.it)("verwirft unplausible Ergebnisse und Tage mit Datenlücken", () => {
        const bad = ["10", "11", "12", "13"].map((n) => day(`2026-11-${n}`, 6, 2, 20, 20));
        strict_1.default.equal((0, eta_balance_1.etaFromBalance)(bad, 10).eta, null);
        const holes = [day("2026-11-10", 6, 5, 20, 20), day("2026-11-11", 6, 5, 20, 20, 0.2), day("2026-11-12", 6, 5, 20, 20), day("2026-11-13", 6, 5, 20, 20)];
        strict_1.default.equal((0, eta_balance_1.etaFromBalance)(holes, 10).days, 2);
    });
});
