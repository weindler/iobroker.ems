"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const strict_1 = __importDefault(require("node:assert/strict"));
const node_test_1 = require("node:test");
const compute_js_1 = require("./compute.js");
const public_charge_js_1 = require("./public_charge.js");
(0, node_test_1.describe)("statistics compute", () => {
    (0, node_test_1.it)("fixed tariff cost matches Verivox-style energy + base share", () => {
        const cost = (0, compute_js_1.fixedTariffCostEur)({
            gridImportKwh: 10,
            compareTariffCtPerKwh: 30,
            monthlyBaseEur: 10,
            monthFraction: 1 / 30,
        });
        strict_1.default.equal(cost, 3.33);
    });
    (0, node_test_1.it)("savings = fixed − (dynamic − rewards)", () => {
        strict_1.default.equal((0, compute_js_1.savingsVsFixedEur)(5, 3, 0.5), 2.5);
    });
    (0, node_test_1.it)("energy counter reset does not invent negative kWh", () => {
        const d = (0, compute_js_1.energyCounterDeltaKwh)(100, 2);
        strict_1.default.equal(d.deltaKwh, 0);
        strict_1.default.equal(d.newBaseline, 2);
    });
    (0, node_test_1.it)("integrates import cost from power × Tibber", () => {
        const r = (0, compute_js_1.integrateImportCostEur)({
            importPowerW: 2000,
            priceCtPerKwh: 30,
            dtSec: 3600,
        });
        strict_1.default.equal(r.kwh, 2);
        strict_1.default.equal(r.costEur, 0.6);
    });
    (0, node_test_1.it)("prefers Ford/HA consumption over admin fallback", () => {
        strict_1.default.deepEqual((0, compute_js_1.resolveEvKwhPer100)({ mapped: 18, fallback: 20 }), {
            value: 18,
            source: "ford_hass",
        });
        strict_1.default.deepEqual((0, compute_js_1.resolveEvKwhPer100)({ mapped: null, fallback: 20 }), {
            value: 20,
            source: "admin_fallback",
        });
    });
    (0, node_test_1.it)("ice cost from km × l/100 × fuel price", () => {
        const r = (0, compute_js_1.iceCostForKm)({ km: 100, lPer100Km: 7, fuelPriceEurPerL: 1.8 });
        strict_1.default.equal(r.liters, 7);
        strict_1.default.equal(r.costEur, 12.6);
    });
});
(0, node_test_1.describe)("statistics public charge", () => {
    (0, node_test_1.it)("parses invoice submit and applies to latest pending", () => {
        const s = (0, public_charge_js_1.openPublicChargeSession)({
            nowIso: "2026-08-20T10:00:00.000Z",
            estimatedKwh: 40,
            fuelPriceEurPerLSnapshot: 1.7,
        });
        const parsed = (0, public_charge_js_1.parsePublicInvoiceSubmit)({ kwh: 38.2, eur: 22.5 });
        strict_1.default.ok(parsed);
        const out = (0, public_charge_js_1.applyPublicInvoice)([s], parsed, "2026-08-20T12:00:00.000Z");
        strict_1.default.match(out.ackDe, /Rechnung erfasst/);
        strict_1.default.equal(out.sessions[0].status, "invoiced");
        strict_1.default.equal(out.sessions[0].invoiceEur, 22.5);
    });
    (0, node_test_1.it)("rejects incomplete invoice", () => {
        const s = (0, public_charge_js_1.openPublicChargeSession)({
            nowIso: "2026-08-20T10:00:00.000Z",
            estimatedKwh: 40,
            fuelPriceEurPerLSnapshot: null,
        });
        const out = (0, public_charge_js_1.applyPublicInvoice)([s], { kwh: 40 }, "2026-08-20T12:00:00.000Z");
        strict_1.default.match(out.ackDe, /unvollständig/);
        strict_1.default.equal(out.sessions[0].status, "pending_invoice");
    });
});
