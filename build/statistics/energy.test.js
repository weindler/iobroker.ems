"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const strict_1 = __importDefault(require("node:assert/strict"));
const node_test_1 = require("node:test");
const constants_1 = require("../learning/day_telemetry/constants");
const quality_mask_1 = require("../learning/day_telemetry/quality_mask");
const types_1 = require("../learning/day_telemetry/types");
const energy_1 = require("./energy");
function fixture(dateKey = "2026-09-10") {
    const startMs = Date.parse(`${dateKey}T00:00:00+02:00`);
    const day = (0, types_1.emptyDayRecord)(dateKey, "Europe/Berlin", startMs, startMs + constants_1.DAY_TELEMETRY_SLOT_MS * 4, 4);
    day.coveragePct = 75;
    day.buckets.pvKwh = [2, 0, 1, null];
    day.buckets.houseTotalKwh = [2, 1, 0.5, null];
    day.buckets.gridImportKwh = [0, 0.5, 0, null];
    day.buckets.gridExportKwh = [0.5, 0, 0.25, null];
    day.buckets.batteryChargedKwh = [0.4, 0, 0.2, null];
    day.buckets.batteryDischargedKwh = [0, 0.1, 0, null];
    day.buckets.batteryChargeSource = ["pv", null, "mixed", null];
    day.buckets.immersionKwh = [0.5, 0, 0.2, null];
    day.buckets.evChargedKwh = [0, 0.4, 0, null];
    day.buckets.evFastChargedKwh = [0, 0.4, 0, null];
    day.buckets.climateElecSharedKwh = [0.2, 0, 0.1, null];
    day.buckets.gridBalanceDischargeKwh = [0, 0.1, 0, null];
    return day;
}
(0, node_test_1.describe)("energetische Statistik", () => {
    (0, node_test_1.it)("uses Smart Meter 1.8.0/2.8.0 as the single grid truth", () => {
        const result = (0, energy_1.reconcileEnergeticGridTruth)((0, energy_1.buildEnergeticDayTotals)(fixture()), {
            gridImportKwh: 1.2,
            gridExportKwh: 0.4,
            captureSinceIso: "2026-09-10T08:00:00Z",
        });
        strict_1.default.equal(result.gridImportKwh, 1.2);
        strict_1.default.equal(result.gridExportKwh, 0.4);
        strict_1.default.equal(result.selfConsumptionKwh, 2.6);
        strict_1.default.equal(result.autonomyPct, 65.7);
        strict_1.default.equal(result.gridTruthSource, "smart_meter");
        strict_1.default.match(result.notesDe.join(" "), /erste Tag kann unvollständig/);
    });
    (0, node_test_1.it)("berechnet Eigenverbrauch, Autarkie und gemessene Geräte-PV-Anteile", () => {
        const result = (0, energy_1.buildEnergeticDayTotals)(fixture());
        strict_1.default.equal(result.pvGenerationKwh, 3);
        strict_1.default.equal(result.selfConsumptionKwh, 2.25);
        strict_1.default.equal(result.selfConsumptionPct, 75);
        strict_1.default.equal(result.autonomyPct, 85.7);
        strict_1.default.equal(result.immersionEnergyKwh, 0.7);
        strict_1.default.equal(result.immersionPvKwh, 0.575);
        strict_1.default.equal(result.immersionPvSharePct, 82.1);
        strict_1.default.equal(result.evPvKwh, 0);
        strict_1.default.equal(result.evFastChargedKwh, 0.4);
        strict_1.default.equal(result.evFastBatteryKwh, 0.04);
        strict_1.default.equal(result.evFastBatterySharePct, 10);
        strict_1.default.equal(result.evFastGridKwh, 0.2);
        strict_1.default.equal(result.evFastGridSharePct, 50);
        strict_1.default.equal(result.evFastLocalKwh, 0.16);
        strict_1.default.equal(result.evFastLocalSharePct, 40);
        strict_1.default.equal(result.climatePvKwh, 0.25);
        strict_1.default.equal(result.batteryPvChargedKwh, null, "mixed darf nicht als PV erfunden werden");
    });
    (0, node_test_1.it)("lässt Schnellmodus-Quellen bei einer Messlücke null, aber behält die Schnelllade-Energie", () => {
        const day = fixture();
        day.buckets.batteryDischargedKwh[1] = null;
        const result = (0, energy_1.buildEnergeticDayTotals)(day);
        strict_1.default.equal(result.evFastChargedKwh, 0.4);
        strict_1.default.equal(result.evFastBatteryKwh, null);
        strict_1.default.equal(result.evFastGridKwh, null);
        strict_1.default.equal(result.evFastLocalKwh, null);
        strict_1.default.match(result.notesDe.join(" "), /Schnellmodus-Quellen nicht bestimmbar/);
    });
    (0, node_test_1.it)("erfindet ohne vollständige EVCC-Modusspur keine Schnellladung", () => {
        const day = fixture();
        day.buckets.evFastChargedKwh[1] = null;
        const result = (0, energy_1.buildEnergeticDayTotals)(day);
        strict_1.default.equal(result.evChargedKwh, 0.4);
        strict_1.default.equal(result.evFastChargedKwh, null);
        strict_1.default.equal(result.evFastGridKwh, null);
        strict_1.default.match(result.notesDe.join(" "), /EVCC-Modus/);
    });
    (0, node_test_1.it)("lässt den Geräte-PV-Anteil bei einer Lücke null", () => {
        const day = fixture();
        day.buckets.gridExportKwh[0] = null;
        const result = (0, energy_1.buildEnergeticDayTotals)(day);
        strict_1.default.equal(result.immersionEnergyKwh, 0.7);
        strict_1.default.equal(result.immersionPvKwh, null);
        strict_1.default.equal(result.immersionPvSharePct, null);
        strict_1.default.match(result.notesDe.join(" "), /nicht bestimmbar/);
    });
    (0, node_test_1.it)("weist Batterieverlust nur mit vollständiger Tagesrand-Messkette aus", () => {
        const day = fixture();
        day.complete = true;
        day.evaluable = true;
        day.coveragePct = 100;
        day.firstSampleMs = day.startMs;
        day.lastSampleMs = day.endMs - 1;
        day.buckets.qualityMask = Array.from({ length: 4 }, () => (0, quality_mask_1.encodeQualityMask)({ BATTERY: quality_mask_1.DOMAIN_QUALITY.ok }));
        day.buckets.batterySocEndPct = [40, 45, 48, 50];
        day.buckets.batteryChargedKwh = [0.5, 0.5, 0.5, 0.5];
        day.buckets.batteryDischargedKwh = [0.2, 0.2, 0.2, 0.2];
        day.buckets.batteryChargeSource = ["pv", "pv", "grid", "grid"];
        day.forecastSnapshots = [
            { batteryCapacityKwh: 10 },
        ];
        const result = (0, energy_1.buildEnergeticDayTotals)(day);
        strict_1.default.equal(result.batteryMeasuredLossKwh, 0.2);
        day.lastSampleMs = day.endMs - constants_1.DAY_TELEMETRY_SLOT_MS * 3;
        strict_1.default.equal((0, energy_1.buildEnergeticDayTotals)(day).batteryMeasuredLossKwh, null);
    });
    (0, node_test_1.it)("aggregiert Prozentwerte energiemengengewichtet und lässt unbelegte Nutzen unmonetarisiert", () => {
        const first = (0, energy_1.buildEnergeticDayTotals)(fixture("2026-09-10"));
        const secondDay = fixture("2026-09-11");
        secondDay.buckets.pvKwh = [1, 0, 0, null];
        secondDay.buckets.gridExportKwh = [0, 0, 0, null];
        const second = (0, energy_1.buildEnergeticDayTotals)(secondDay);
        const period = (0, energy_1.sumEnergeticDays)([first, second, null], {
            period: "last_7_days",
            periodLabelDe: "Letzte 7 Tage",
            fromKey: "2026-09-05",
            toKey: "2026-09-11",
        });
        strict_1.default.equal(period.daysTotal, 3);
        strict_1.default.equal(period.daysWithTelemetry, 2);
        strict_1.default.equal(period.selfConsumptionKwh, 3.25);
        strict_1.default.equal(period.selfConsumptionPct, 81.3);
        strict_1.default.equal(period.evFastChargedKwh, 0.8);
        strict_1.default.equal(period.evFastBatteryKwh, 0.08);
        strict_1.default.equal(period.evFastGridKwh, 0.4);
        strict_1.default.equal(period.evFastLocalKwh, 0.32);
        strict_1.default.equal(period.nonMonetized.pelletReliefKwh, null);
        strict_1.default.equal(period.nonMonetized.avoidedBoilerStarts, null);
        strict_1.default.equal(period.nonMonetized.wearValueEur, null);
    });
    (0, node_test_1.it)("weist den Perioden-Schnellanteil bei einem Ladetag ohne Modusspur nicht teilweise aus", () => {
        const complete = (0, energy_1.buildEnergeticDayTotals)(fixture("2026-09-10"));
        const missingMode = fixture("2026-09-11");
        missingMode.buckets.evFastChargedKwh[1] = null;
        const period = (0, energy_1.sumEnergeticDays)([complete, (0, energy_1.buildEnergeticDayTotals)(missingMode)], {
            period: "last_7_days",
            periodLabelDe: "Letzte 7 Tage",
            fromKey: "2026-09-05",
            toKey: "2026-09-11",
        });
        strict_1.default.equal(period.evFastChargedKwh, null);
        strict_1.default.equal(period.evFastGridKwh, null);
        strict_1.default.match(period.notesDe.join(" "), /Modusspur/);
    });
});
