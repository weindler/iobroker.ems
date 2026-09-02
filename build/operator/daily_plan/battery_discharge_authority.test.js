"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const strict_1 = __importDefault(require("node:assert/strict"));
const battery_discharge_authority_js_1 = require("./battery_discharge_authority.js");
const battery_opportunity_cost_js_1 = require("./battery_opportunity_cost.js");
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
    (0, node_test_1.describe)("PFLICHT-FIX 2 — Produktions-Regressionsfall (30.08.2026, planner_budget_zero trotz Preis/SOC/Reserve ok)", () => {
        (0, node_test_1.it)("hoher SOC (91 %), Preis über Schwelle, reichlich Headroom + kleiner später Bedarf → Netzausgleich bleibt zugelassen", () => {
            const opportunity = (0, battery_opportunity_cost_js_1.evaluateBatteryOpportunityCost)({
                nowMs: Date.parse("2026-08-30T21:13:00.000Z"),
                priceSlots: [{ startMs: Date.parse("2026-08-31T18:00:00.000Z"), importCtPerKwh: 45 }],
                // SOC 91 % bei 10 kWh, Reserve ≈ 42 % (≈ 3.5 kWh × 1.2) → Headroom ≈ 4.9 kWh.
                headroomAboveReserveKwh: 4.9,
                pvRemainingTodayKwh: 0,
                plannedLaterDemandKwh: 2,
            });
            strict_1.default.ok(opportunity.opportunityCostCtPerKwh < 45, `opportunity=${opportunity.opportunityCostCtPerKwh}`);
            const r = (0, battery_discharge_authority_js_1.resolveBatteryDischargeAuthorization)({
                priceNowCt: 39.6,
                minPriceCtPerKwh: 30,
                socPct: 91,
                requiredSocAtPvEndPct: 42,
                configuredMaxDischargeW: 3000,
                opportunityCostCtPerKwh: opportunity.opportunityCostCtPerKwh,
            });
            strict_1.default.equal(r.allowed, true, r.reasonDe);
            strict_1.default.equal(r.opportunityAllowed, true);
            strict_1.default.equal(r.maxDischargeW, 3000);
        });
    });
    (0, node_test_1.describe)("Economic Grid Balance", () => {
        const eco = {
            usable: true,
            alpha: 0.7,
            beta: 1.1,
            cReplaceCtPerKwh: 22,
            marginCtPerKwh: 1.5,
        };
        (0, node_test_1.it)("Cold Start ohne Economics → 30-ct-Fallback", () => {
            const r = (0, battery_discharge_authority_js_1.resolveBatteryDischargeAuthorization)({ ...base, priceNowCt: 16.5 });
            strict_1.default.equal(r.allowed, false);
            strict_1.default.equal(r.economicsUsable, false);
            strict_1.default.match(r.reasonDe, /Mindestpreis/);
        });
        (0, node_test_1.it)("usable Economics erlaubt unter 30 ct wenn Netto positiv (kein 30-ct-Zusatzgate)", () => {
            const r = (0, battery_discharge_authority_js_1.resolveBatteryDischargeAuthorization)({
                ...base,
                priceNowCt: 18,
                economics: { ...eco, alpha: 0.9, beta: 1.0, cReplaceCtPerKwh: 12 },
            });
            strict_1.default.equal(r.allowed, true, r.reasonDe);
            strict_1.default.equal(r.economicsUsable, true);
            strict_1.default.equal(r.economicsAllowed, true);
            strict_1.default.ok(r.netBenefitCtPerKwh != null && r.netBenefitCtPerKwh > 1.5);
        });
        (0, node_test_1.it)("usable Economics blockt bei negativem Netto trotz Preis > 30 ct", () => {
            const r = (0, battery_discharge_authority_js_1.resolveBatteryDischargeAuthorization)({
                ...base,
                priceNowCt: 36,
                economics: { ...eco, alpha: 0.4, beta: 1.2, cReplaceCtPerKwh: 40 },
            });
            strict_1.default.equal(r.allowed, false);
            strict_1.default.equal(r.economicsUsable, true);
            strict_1.default.equal(r.economicsAllowed, false);
        });
        (0, node_test_1.it)("Economics öffnet Reserve-Sperre nicht", () => {
            const r = (0, battery_discharge_authority_js_1.resolveBatteryDischargeAuthorization)({
                ...base,
                socPct: 20,
                priceNowCt: 50,
                economics: eco,
            });
            strict_1.default.equal(r.allowed, false);
            strict_1.default.equal(r.socAllowed, false);
        });
        (0, node_test_1.it)("Economics nicht mehr belastbar → automatisch 30-ct-Fallback", () => {
            const r = (0, battery_discharge_authority_js_1.resolveBatteryDischargeAuthorization)({
                ...base,
                priceNowCt: 16.5,
                economics: { usable: false, alpha: 0.7, beta: 1.1, cReplaceCtPerKwh: 22 },
            });
            strict_1.default.equal(r.allowed, false);
            strict_1.default.equal(r.economicsUsable, false);
            strict_1.default.match(r.reasonDe, /Mindestpreis/);
        });
    });
    (0, node_test_1.describe)("PFLICHT-FIX 2 leftover — Hold/Reserve/Safety", () => {
        (0, node_test_1.it)("Netzausgleich bleibt trotz reichlichem Headroom gesperrt, wenn Hold/Reserve/Safety greifen", () => {
            // SOC unterhalb der Reserve — Opportunity-Discount darf das nie aushebeln.
            const rReserve = (0, battery_discharge_authority_js_1.resolveBatteryDischargeAuthorization)({
                priceNowCt: 39.6,
                minPriceCtPerKwh: 30,
                socPct: 35,
                requiredSocAtPvEndPct: 42,
                configuredMaxDischargeW: 3000,
                opportunityCostCtPerKwh: 5,
            });
            strict_1.default.equal(rReserve.allowed, false);
            strict_1.default.equal(rReserve.socAllowed, false);
            // Preis unter Mindestpreis — bleibt vorrangig vor jedem Opportunity-Abschlag.
            const rPrice = (0, battery_discharge_authority_js_1.resolveBatteryDischargeAuthorization)({
                priceNowCt: 20,
                minPriceCtPerKwh: 30,
                socPct: 91,
                requiredSocAtPvEndPct: 42,
                configuredMaxDischargeW: 3000,
                opportunityCostCtPerKwh: 5,
            });
            strict_1.default.equal(rPrice.allowed, false);
            strict_1.default.equal(rPrice.priceAllowed, false);
        });
    });
});
