"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const strict_1 = __importDefault(require("node:assert/strict"));
const compute_1 = require("./compute");
const types_1 = require("../learning/shadow_engine/types");
const NOW = new Date("2026-08-30T12:00:00.000Z");
function shadowFixture(overrides = {}) {
    return {
        module: "shadow_engine",
        schemaVersion: 1,
        dateKey: "2026-08-29",
        timezone: "Europe/Berlin",
        generatedAtIso: NOW.toISOString(),
        sourceTelemetryLastSampleIso: NOW.toISOString(),
        dayEvaluable: true,
        real: {
            gridImportKwh: 2,
            gridExportKwh: 3,
            batteryChargeKwh: 4,
            batteryDischargeKwh: 3,
            socStartPct: 90,
            socEndPct: 60,
            importCostEur: 0.6,
            exportCreditEur: 0.24,
            netCostEur: 0.36,
            slotCount: 96,
            observedSlotCount: 96,
            missingSlotCount: 0,
        },
        strategies: {
            reference_no_ems: {
                strategy: "reference_no_ems",
                modelVersion: "shadow_v1",
                evaluable: true,
                missingSlotCount: 0,
                assumptionsDe: ["x"],
                gridImportKwh: 5,
                gridExportKwh: 1,
                batteryChargeKwh: 2,
                batteryDischargeKwh: 1,
                socStartPct: 90,
                socEndPct: 70,
                importCostEur: 1.5,
                exportCreditEur: 0.08,
                netCostEur: 1.42,
            },
            ems_without_ai: {
                strategy: "ems_without_ai",
                modelVersion: "shadow_v1",
                evaluable: true,
                missingSlotCount: 0,
                assumptionsDe: ["y"],
                gridImportKwh: 2,
                gridExportKwh: 3,
                batteryChargeKwh: 4,
                batteryDischargeKwh: 3,
                socStartPct: 90,
                socEndPct: 60,
                importCostEur: 0.6,
                exportCreditEur: 0.24,
                netCostEur: 0.36,
            },
        },
        ...overrides,
    };
}
(0, node_test_1.describe)("buildEconomicsDayRecord", () => {
    (0, node_test_1.it)("berechnet EMS-Vorteil und KI-Mehrwert aus Shadow-Netto-Kosten", () => {
        const rec = (0, compute_1.buildEconomicsDayRecord)({
            dateKey: "2026-08-29",
            final: true,
            tarifvorteilEur: 0.5,
            gridRewardsCreditEur: 0.1,
            gridRewardsSource: "estimate_day",
            shadow: shadowFixture(),
            now: NOW,
        });
        strict_1.default.equal(rec.emsVorteilEur, 1.06); // 1.42 - 0.36
        strict_1.default.equal(rec.kiMehrwertEur, 0); // 0.36 - 0.36 (kein Live-KI-Einfluss)
        strict_1.default.equal(rec.tarifvorteilEur, 0.5);
        strict_1.default.equal(rec.emsVorteilEvaluable, true);
        strict_1.default.equal(rec.kiMehrwertEvaluable, true);
    });
    (0, node_test_1.it)("negativer KI-Mehrwert ist darstellbar (kein Schönrechnen)", () => {
        const shadow = shadowFixture({
            strategies: {
                reference_no_ems: (0, types_1.notEvaluableStrategyResult)("reference_no_ems", []),
                ems_without_ai: {
                    strategy: "ems_without_ai",
                    modelVersion: "shadow_v1",
                    evaluable: true,
                    missingSlotCount: 0,
                    assumptionsDe: [],
                    gridImportKwh: 1,
                    gridExportKwh: 1,
                    batteryChargeKwh: 1,
                    batteryDischargeKwh: 1,
                    socStartPct: 90,
                    socEndPct: 80,
                    importCostEur: 0.1,
                    exportCreditEur: 0,
                    netCostEur: 0.1,
                },
            },
            real: { ...shadowFixture().real, netCostEur: 0.5 },
        });
        const rec = (0, compute_1.buildEconomicsDayRecord)({
            dateKey: "2026-08-29",
            final: true,
            tarifvorteilEur: null,
            gridRewardsCreditEur: null,
            gridRewardsSource: null,
            shadow,
            now: NOW,
        });
        strict_1.default.equal(rec.kiMehrwertEur, -0.4); // 0.1 - 0.5 < 0 → KI hat es schlechter gemacht
        strict_1.default.equal(rec.emsVorteilEvaluable, false);
        strict_1.default.equal(rec.emsVorteilEur, null);
    });
    (0, node_test_1.it)("liefert null statt erfundener Werte ohne Shadow-Daten", () => {
        const rec = (0, compute_1.buildEconomicsDayRecord)({
            dateKey: "2026-08-30",
            final: false,
            tarifvorteilEur: 0.2,
            gridRewardsCreditEur: null,
            gridRewardsSource: null,
            shadow: null,
            now: NOW,
        });
        strict_1.default.equal(rec.emsVorteilEur, null);
        strict_1.default.equal(rec.kiMehrwertEur, null);
        strict_1.default.equal(rec.tarifvorteilEur, 0.2);
        strict_1.default.ok(rec.notesDe.length >= 2);
    });
});
(0, node_test_1.describe)("sumEconomicsDays", () => {
    (0, node_test_1.it)("summiert nur bewertbare Tage getrennt je Effekt", () => {
        const days = [
            (0, compute_1.buildEconomicsDayRecord)({
                dateKey: "2026-08-28",
                final: true,
                tarifvorteilEur: 1,
                gridRewardsCreditEur: 0.5,
                gridRewardsSource: "estimate_day",
                shadow: shadowFixture(),
                now: NOW,
            }),
            (0, compute_1.buildEconomicsDayRecord)({
                dateKey: "2026-08-29",
                final: false,
                tarifvorteilEur: null,
                gridRewardsCreditEur: null,
                gridRewardsSource: null,
                shadow: null,
                now: NOW,
            }),
        ];
        const sum = (0, compute_1.sumEconomicsDays)(days, {
            period: "test",
            periodLabelDe: "Test",
            fromKey: "2026-08-28",
            toKey: "2026-08-29",
        });
        strict_1.default.equal(sum.daysTotal, 2);
        strict_1.default.equal(sum.daysTarifvorteilEvaluable, 1);
        strict_1.default.equal(sum.tarifvorteilEur, 1);
        strict_1.default.equal(sum.daysEmsVorteilEvaluable, 1);
        strict_1.default.equal(sum.gridRewardsCreditEur, 0.5);
    });
    (0, node_test_1.it)("liefert null (nicht 0) wenn kein Tag bewertbar ist", () => {
        const sum = (0, compute_1.sumEconomicsDays)([], { period: "x", periodLabelDe: "x", fromKey: "a", toKey: "b" });
        strict_1.default.equal(sum.tarifvorteilEur, null);
        strict_1.default.equal(sum.emsVorteilEur, null);
        strict_1.default.equal(sum.kiMehrwertEur, null);
    });
});
