"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const strict_1 = __importDefault(require("node:assert/strict"));
const slots_js_1 = require("../day_telemetry/slots.js");
const types_js_1 = require("../day_telemetry/types.js");
const quality_mask_js_1 = require("../day_telemetry/quality_mask.js");
const eligibility_js_1 = require("./eligibility.js");
const types_js_2 = require("./types.js");
function freshDay(dateKey = "2026-06-15", tz = "Europe/Berlin") {
    const layout = (0, slots_js_1.buildDaySlotLayout)(dateKey, tz);
    return (0, types_js_1.emptyDayRecord)(dateKey, tz, layout.startMs, layout.endMs, layout.slotCount);
}
(0, node_test_1.describe)("daily_evaluator eligibility", () => {
    (0, node_test_1.it)("keine Evidenz für Domäne → not_applicable (nicht insufficient_data)", () => {
        const day = freshDay();
        const elig = (0, eligibility_js_1.evaluateDomainEligibility)(day, types_js_2.EVALUATOR_DOMAIN.EV);
        strict_1.default.equal(elig.status, "not_applicable");
        strict_1.default.equal(elig.reasonCode, "no_evidence_of_domain");
    });
    (0, node_test_1.it)("EV: Snapshot wallboxConnected=true ohne connect-Event zählt als Evidenz (Mitternachts-Fall, Korrektur #7)", () => {
        const day = freshDay();
        day.forecastSnapshots.push({
            id: "s1",
            tsIso: "2026-06-15T00:05:00.000Z",
            date: "2026-06-15",
            timezone: "Europe/Berlin",
            globalMode: "balanced",
            contributionRevision: 1,
            pvExpectedDayKwh: null,
            houseLoadExpectedDayKwh: null,
            batterySocPct: null,
            batteryCapacityKwh: null,
            batteryNightReserveKwh: null,
            priceSlots: [],
            pvSlotKwh: [],
            wallboxRequiredEnergyKwh: null,
            wallboxDeadlineIso: null,
            wallboxConnected: true,
            wallboxPresenceDigest: null,
            thermalBufferTempC: null,
            thermalEmptyAtIso: null,
            thermalHeadroomKwh: null,
            climateUnits: [],
            wallboxTargetSocPct: null,
            wallboxMinimumDepartureSocPct: null,
            wallboxEnergyGoalHard: null,
            wallboxManagementMode: null,
            batteryDecision: null,
        });
        /* Kein ev_connected-Event heute (Verbindung bestand schon vor Mitternacht) */
        const elig = (0, eligibility_js_1.evaluateDomainEligibility)(day, types_js_2.EVALUATOR_DOMAIN.EV);
        strict_1.default.notEqual(elig.status, "not_applicable");
    });
    (0, node_test_1.it)("EV: nur connect-Event ohne Snapshot/Energie zählt ebenfalls als Evidenz", () => {
        const day = freshDay();
        day.statusEvents.push({ tsIso: "2026-06-15T10:00:00.000Z", kind: "ev_connected", detail: "" });
        const elig = (0, eligibility_js_1.evaluateDomainEligibility)(day, types_js_2.EVALUATOR_DOMAIN.EV);
        strict_1.default.notEqual(elig.status, "not_applicable");
    });
    (0, node_test_1.it)("Evidenz vorhanden + hohe Coverage → evaluable", () => {
        const day = freshDay();
        day.statusEvents.push({ tsIso: "2026-06-15T10:00:00.000Z", kind: "ev_connected", detail: "" });
        for (let i = 0; i < day.slotCount; i++) {
            day.buckets.evChargedKwh[i] = 0.05;
            day.buckets.qualityMask[i] = (0, quality_mask_js_1.encodeDomainQuality)(0, quality_mask_js_1.TELEMETRY_DOMAIN.EV, quality_mask_js_1.DOMAIN_QUALITY.ok);
        }
        const elig = (0, eligibility_js_1.evaluateDomainEligibility)(day, types_js_2.EVALUATOR_DOMAIN.EV);
        strict_1.default.equal(elig.status, "evaluable");
        strict_1.default.ok(elig.coveragePct >= 80);
    });
    (0, node_test_1.it)("Evidenz vorhanden + niedrige Coverage → insufficient_data", () => {
        const day = freshDay();
        day.statusEvents.push({ tsIso: "2026-06-15T10:00:00.000Z", kind: "ev_connected", detail: "" });
        /* nur 5 von vielen Slots ok, Rest bleibt unobserved (null) */
        for (let i = 0; i < 5; i++) {
            day.buckets.qualityMask[i] = (0, quality_mask_js_1.encodeDomainQuality)(0, quality_mask_js_1.TELEMETRY_DOMAIN.EV, quality_mask_js_1.DOMAIN_QUALITY.ok);
        }
        const elig = (0, eligibility_js_1.evaluateDomainEligibility)(day, types_js_2.EVALUATOR_DOMAIN.EV);
        strict_1.default.equal(elig.status, "insufficient_data");
    });
    (0, node_test_1.it)("Battery/Thermal/Climate: gleiche Evidenz-Logik unabhängig prüfbar", () => {
        const day = freshDay();
        day.buckets.batterySocEndPct[10] = 55;
        const elig = (0, eligibility_js_1.evaluateDomainEligibility)(day, types_js_2.EVALUATOR_DOMAIN.BATTERY);
        strict_1.default.notEqual(elig.status, "not_applicable");
        const climateElig = (0, eligibility_js_1.evaluateDomainEligibility)(day, types_js_2.EVALUATOR_DOMAIN.CLIMATE);
        strict_1.default.equal(climateElig.status, "not_applicable");
    });
    (0, node_test_1.it)("evaluateAllDomainEligibility liefert genau 4 Domänen", () => {
        const day = freshDay();
        const all = (0, eligibility_js_1.evaluateAllDomainEligibility)(day);
        strict_1.default.equal(all.length, 4);
        const domains = all.map((e) => e.domain).sort();
        strict_1.default.deepEqual(domains, ["battery", "climate", "ev", "thermal"]);
    });
    (0, node_test_1.it)("DST-Tage (92/100 Slots) — totalSlotCount folgt dem jeweiligen Tag", () => {
        const dstSpring = freshDay("2026-03-29", "Europe/Berlin");
        const eligSpring = (0, eligibility_js_1.evaluateDomainEligibility)(dstSpring, types_js_2.EVALUATOR_DOMAIN.BATTERY);
        strict_1.default.equal(eligSpring.totalSlotCount, 92);
        const dstAutumn = freshDay("2026-10-25", "Europe/Berlin");
        const eligAutumn = (0, eligibility_js_1.evaluateDomainEligibility)(dstAutumn, types_js_2.EVALUATOR_DOMAIN.BATTERY);
        strict_1.default.equal(eligAutumn.totalSlotCount, 100);
    });
});
