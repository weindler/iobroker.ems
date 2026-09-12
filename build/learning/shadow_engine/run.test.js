"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const strict_1 = __importDefault(require("node:assert/strict"));
const node_test_1 = require("node:test");
const types_1 = require("../day_telemetry/types");
const constants_1 = require("./constants");
const run_1 = require("./run");
function day(dateKey, soc, loadKwh = 1, pvKwh = 0) {
    const out = (0, types_1.emptyDayRecord)(dateKey, "Europe/Berlin", 0, soc.length * 15 * 60_000, soc.length);
    out.complete = true;
    out.evaluable = true;
    out.buckets.pvKwh = soc.map(() => pvKwh);
    out.buckets.houseTotalKwh = soc.map(() => loadKwh);
    out.buckets.gridImportKwh = soc.map(() => 0);
    out.buckets.gridExportKwh = soc.map(() => 0);
    out.buckets.batteryChargedKwh = soc.map(() => 0);
    out.buckets.batteryDischargedKwh = soc.map(() => 0);
    out.buckets.batterySocEndPct = soc;
    out.buckets.priceCtPerKwh = soc.map(() => 30);
    return out;
}
const BATTERY = {
    usableCapacityKwh: 10,
    minSocPct: 10,
    maxSocPct: 100,
    maxChargeW: null,
    maxDischargeW: null,
};
(0, node_test_1.describe)("Shadow reference_no_ems über Tagesgrenzen", () => {
    (0, node_test_1.it)("führt den kontrafaktischen End-SOC als Start-SOC des Folgetags fort", () => {
        const previousReal = day("2026-08-28", [85, 80], 0, 0);
        const firstDay = day("2026-08-29", [80, 76, 73, 70]);
        const first = (0, run_1.buildShadowDayRecord)("2026-08-29", firstDay, previousReal, BATTERY, 8, false, "2026-08-31T00:00:00.000Z");
        const firstNoEms = first.strategies.reference_no_ems;
        strict_1.default.equal(firstNoEms.socStartPct, 80);
        strict_1.default.equal(firstNoEms.socStartSource, "previous_real");
        strict_1.default.equal(firstNoEms.socContinuousFromPreviousDay, false);
        strict_1.default.notEqual(firstNoEms.socEndPct, first.real.socEndPct);
        const secondDay = day("2026-08-30", [70, 68, 65, 63]);
        const second = (0, run_1.buildShadowDayRecord)("2026-08-30", secondDay, firstDay, BATTERY, 8, false, "2026-08-31T00:00:00.000Z", null, {
            dateKey: first.dateKey,
            socEndPct: firstNoEms.socEndPct,
            modelVersion: firstNoEms.modelVersion,
        });
        strict_1.default.equal(second.strategies.reference_no_ems.socStartPct, firstNoEms.socEndPct);
        strict_1.default.equal(second.strategies.reference_no_ems.socStartSource, "previous_shadow");
        strict_1.default.equal(second.strategies.reference_no_ems.socContinuousFromPreviousDay, true);
    });
    (0, node_test_1.it)("verwirft eine alte Modellkette und fällt nachvollziehbar auf realen Vortags-SOC zurück", () => {
        const previous = day("2026-08-29", [75, 70]);
        const current = day("2026-08-30", [70, 65]);
        const record = (0, run_1.buildShadowDayRecord)("2026-08-30", current, previous, BATTERY, 8, false, "2026-08-31T00:00:00.000Z", null, { dateKey: "2026-08-29", socEndPct: 25, modelVersion: "shadow_v3" });
        strict_1.default.equal(record.strategies.reference_no_ems.modelVersion, constants_1.SHADOW_ENGINE_MODEL_VERSION);
        strict_1.default.equal(record.strategies.reference_no_ems.socStartPct, 70);
        strict_1.default.equal(record.strategies.reference_no_ems.socStartSource, "previous_real");
    });
    (0, node_test_1.it)("versioniert auch nicht bewertbare Tage, damit der Batch sie nicht endlos neu berechnet", () => {
        const record = (0, run_1.buildShadowDayRecord)("2026-08-30", day("2026-08-30", [50]), null, { ...BATTERY, usableCapacityKwh: null }, 8, false, "2026-08-31T00:00:00.000Z");
        strict_1.default.equal(record.strategies.reference_no_ems.evaluable, false);
        strict_1.default.equal(record.strategies.reference_no_ems.modelVersion, constants_1.SHADOW_ENGINE_MODEL_VERSION);
    });
});
