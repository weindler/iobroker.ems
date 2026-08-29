"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const strict_1 = __importDefault(require("node:assert/strict"));
const energy_integrate_js_1 = require("./energy_integrate.js");
const slots_js_1 = require("./slots.js");
const constants_js_1 = require("./constants.js");
const compute_js_1 = require("../../statistics/compute.js");
(0, node_test_1.describe)("day_telemetry energy integrate", () => {
    const layout = (0, slots_js_1.buildDaySlotLayout)("2026-06-15", "Europe/Berlin");
    const slot14 = layout.slots.find((s) => {
        const d = new Date(s.startMs);
        /* lokale Stunde via layout: Slot bei 14:00 */
        return s.index === 14 * 4;
    });
    (0, node_test_1.it)("4) Tick über Slotgrenze proportional geteilt (14:14:45–14:15:45)", () => {
        const fromMs = slot14.startMs + 14 * 60_000 + 45_000; /* 14:14:45 */
        const toMs = fromMs + 60_000; /* 14:15:45 */
        const shares = (0, energy_integrate_js_1.splitAmountAcrossSlots)(layout, fromMs, toMs, 1.0);
        strict_1.default.equal(shares.length, 2);
        strict_1.default.ok(Math.abs(shares[0].energyKwh - 0.25) < 1e-9);
        strict_1.default.ok(Math.abs(shares[1].energyKwh - 0.75) < 1e-9);
        strict_1.default.equal(shares[0].slotIndex + 1, shares[1].slotIndex);
    });
    (0, node_test_1.it)("5) kleine Energie-Deltas gehen nicht verloren (anders als round3 early)", () => {
        const precise = (0, energy_integrate_js_1.energyCounterDeltaPreciseKwh)(100.0, 100.0004);
        strict_1.default.ok(precise.deltaKwh != null && precise.deltaKwh > 0);
        strict_1.default.ok(precise.deltaKwh > 0.0003);
        /* Bestehende Statistik-Funktion rundet früh — Nachweis der Differenz */
        const rounded = (0, compute_js_1.energyCounterDeltaKwh)(100.0, 100.0004);
        strict_1.default.equal(rounded.deltaKwh, 0);
    });
    (0, node_test_1.it)("6) Counter Reset", () => {
        const d = (0, energy_integrate_js_1.energyCounterDeltaPreciseKwh)(100.5, 0.1);
        strict_1.default.equal(d.deltaKwh, 0);
        strict_1.default.equal(d.reset, true);
        strict_1.default.equal(d.newBaseline, 0.1);
    });
    (0, node_test_1.it)("8) lange Datenlücke", () => {
        const prev = 1_000_000;
        const cur = prev + constants_js_1.DAY_TELEMETRY_MAX_GAP_MS + 1;
        const g = (0, energy_integrate_js_1.decideIntegrationGap)(prev, cur);
        strict_1.default.equal(g.kind, "gap_too_long");
    });
    (0, node_test_1.it)("Power-Integration über Grenze", () => {
        const fromMs = slot14.startMs + 14 * 60_000 + 45_000;
        const toMs = fromMs + 60_000;
        /* 60_000 W × (60/3600) h / 1000 = 1 kWh */
        const shares = (0, energy_integrate_js_1.integratePowerAcrossSlots)(layout, fromMs, toMs, 60_000);
        const sum = shares.reduce((s, x) => s + x.energyKwh, 0);
        strict_1.default.ok(Math.abs(sum - 1) < 1e-9, `sum=${sum}`);
        strict_1.default.equal(shares.length, 2);
    });
    (0, node_test_1.it)("Restart: first sample kein Phantom", () => {
        const d = (0, energy_integrate_js_1.energyCounterDeltaPreciseKwh)(null, 542.224);
        strict_1.default.equal(d.deltaKwh, 0);
        strict_1.default.equal(d.newBaseline, 542.224);
        const g = (0, energy_integrate_js_1.decideIntegrationGap)(null, Date.now());
        strict_1.default.equal(g.kind, "first_sample");
    });
});
