"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const strict_1 = __importDefault(require("node:assert/strict"));
const battery_discharge_authority_js_1 = require("./battery_discharge_authority.js");
(0, node_test_1.describe)("battery discharge authority (Phase 1b/1d)", () => {
    const base = {
        priceNowCt: 36.7,
        minPriceCtPerKwh: 30,
        socPct: 60,
        requiredSocAtPvEndPct: 30,
        configuredMaxDischargeW: 5000,
    };
    (0, node_test_1.it)("allows discharge and publishes the configured budget when price and SOC are fine", () => {
        const r = (0, battery_discharge_authority_js_1.resolveBatteryDischargeAuthorization)(base);
        strict_1.default.equal(r.allowed, true);
        strict_1.default.equal(r.maxDischargeW, 5000);
        strict_1.default.equal(r.priceAllowed, true);
        strict_1.default.equal(r.socAllowed, true);
        strict_1.default.match(r.reasonDe, /SOC 60 % > dynamische Reserve 30 %/);
    });
    (0, node_test_1.it)("blocks below the minimum price (reuses evaluateGridBalanceMinPrice, not a second rule)", () => {
        const r = (0, battery_discharge_authority_js_1.resolveBatteryDischargeAuthorization)({ ...base, priceNowCt: 16.5 });
        strict_1.default.equal(r.allowed, false);
        strict_1.default.equal(r.maxDischargeW, 0);
        strict_1.default.equal(r.priceAllowed, false);
        strict_1.default.match(r.reasonDe, /unter Mindestpreis/);
    });
    (0, node_test_1.it)("blocks with unknown price", () => {
        const r = (0, battery_discharge_authority_js_1.resolveBatteryDischargeAuthorization)({ ...base, priceNowCt: null });
        strict_1.default.equal(r.allowed, false);
        strict_1.default.equal(r.maxDischargeW, 0);
        strict_1.default.equal(r.priceAllowed, false);
    });
    (0, node_test_1.it)("blocks at/below the dynamic reserve even when price allows", () => {
        const r = (0, battery_discharge_authority_js_1.resolveBatteryDischargeAuthorization)({ ...base, socPct: 30 });
        strict_1.default.equal(r.allowed, false);
        strict_1.default.equal(r.maxDischargeW, 0);
        strict_1.default.equal(r.priceAllowed, true);
        strict_1.default.equal(r.socAllowed, false);
        strict_1.default.match(r.reasonDe, /dynamische Reserve 30 %/);
    });
    (0, node_test_1.it)("blocks with unknown SOC", () => {
        const r = (0, battery_discharge_authority_js_1.resolveBatteryDischargeAuthorization)({ ...base, socPct: null });
        strict_1.default.equal(r.allowed, false);
        strict_1.default.equal(r.maxDischargeW, 0);
        strict_1.default.equal(r.priceAllowed, true);
        strict_1.default.equal(r.socAllowed, false);
        strict_1.default.match(r.reasonDe, /SOC unbekannt/);
    });
    (0, node_test_1.it)("Phase 1d: blocks conservatively (no hidden fixed fallback) when the dynamic reserve is not yet learnable", () => {
        const r = (0, battery_discharge_authority_js_1.resolveBatteryDischargeAuthorization)({ ...base, requiredSocAtPvEndPct: null });
        strict_1.default.equal(r.allowed, false);
        strict_1.default.equal(r.maxDischargeW, 0);
        strict_1.default.equal(r.priceAllowed, true);
        strict_1.default.equal(r.socAllowed, false);
        strict_1.default.match(r.reasonDe, /Nacht-Reserve noch nicht ausreichend gelernt/);
    });
    (0, node_test_1.it)("Phase 1d: unknown reserve is diagnosed distinctly from an unknown/insufficient SOC", () => {
        const rReserveUnknown = (0, battery_discharge_authority_js_1.resolveBatteryDischargeAuthorization)({
            ...base,
            requiredSocAtPvEndPct: null,
        });
        const rSocTooLow = (0, battery_discharge_authority_js_1.resolveBatteryDischargeAuthorization)({ ...base, socPct: 30 });
        strict_1.default.notEqual(rReserveUnknown.reasonDe, rSocTooLow.reasonDe);
    });
    (0, node_test_1.it)("never returns a negative or non-integer budget", () => {
        const r = (0, battery_discharge_authority_js_1.resolveBatteryDischargeAuthorization)({ ...base, configuredMaxDischargeW: -10 });
        strict_1.default.equal(r.allowed, true);
        strict_1.default.equal(r.maxDischargeW, 0);
    });
    (0, node_test_1.describe)("Block B — Opportunity-Cost-Zusatzgate (additiv)", () => {
        (0, node_test_1.it)("ohne opportunityCostCtPerKwh: exakt bisheriges Verhalten (Fallback)", () => {
            const r = (0, battery_discharge_authority_js_1.resolveBatteryDischargeAuthorization)(base);
            strict_1.default.equal(r.allowed, true);
            strict_1.default.equal(r.opportunityAllowed, true);
        });
        (0, node_test_1.it)("Preis jetzt klar über Opportunity-Cost + Marge → weiterhin erlaubt", () => {
            const r = (0, battery_discharge_authority_js_1.resolveBatteryDischargeAuthorization)({ ...base, opportunityCostCtPerKwh: 20 });
            strict_1.default.equal(r.allowed, true);
            strict_1.default.equal(r.opportunityAllowed, true);
        });
        (0, node_test_1.it)("Preis jetzt nicht ausreichend über Opportunity-Cost → Netzausgleich zurückgestellt", () => {
            const r = (0, battery_discharge_authority_js_1.resolveBatteryDischargeAuthorization)({ ...base, opportunityCostCtPerKwh: 35 });
            strict_1.default.equal(r.allowed, false);
            strict_1.default.equal(r.opportunityAllowed, false);
            strict_1.default.equal(r.priceAllowed, true);
            strict_1.default.equal(r.socAllowed, true);
            strict_1.default.match(r.reasonDe, /Opportunity-Cost/);
        });
        (0, node_test_1.it)("Opportunity-Cost kann eine bereits gesperrte Entladung nicht freigeben (Preis-Gate bleibt vorrangig)", () => {
            const r = (0, battery_discharge_authority_js_1.resolveBatteryDischargeAuthorization)({ ...base, priceNowCt: 16.5, opportunityCostCtPerKwh: 0 });
            strict_1.default.equal(r.allowed, false);
            strict_1.default.equal(r.priceAllowed, false);
        });
        (0, node_test_1.it)("Opportunity-Cost kann Reserve-Sperre nicht aushebeln", () => {
            const r = (0, battery_discharge_authority_js_1.resolveBatteryDischargeAuthorization)({ ...base, socPct: 30, opportunityCostCtPerKwh: 0 });
            strict_1.default.equal(r.allowed, false);
            strict_1.default.equal(r.socAllowed, false);
        });
        (0, node_test_1.it)("eigene Margin-Konfiguration wird respektiert", () => {
            const r = (0, battery_discharge_authority_js_1.resolveBatteryDischargeAuthorization)({
                ...base,
                opportunityCostCtPerKwh: 30,
                opportunityMarginCtPerKwh: 10,
            });
            // priceNowCt=36.7, opportunity=30, margin=10 → 36.7 < 40 → zurückgestellt
            strict_1.default.equal(r.allowed, false);
            strict_1.default.equal(r.opportunityAllowed, false);
        });
    });
});
