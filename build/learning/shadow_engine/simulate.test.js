"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const strict_1 = __importDefault(require("node:assert/strict"));
const types_1 = require("../day_telemetry/types");
const simulate_1 = require("./simulate");
function fixtureDay(slotCount = 4) {
    const day = (0, types_1.emptyDayRecord)("2026-08-30", "Europe/Berlin", 0, slotCount * 15 * 60_000, slotCount);
    day.complete = true;
    day.evaluable = true;
    return day;
}
(0, node_test_1.describe)("computeRealDayResult", () => {
    (0, node_test_1.it)("aggregiert Import/Export/Kosten aus den Buckets", () => {
        const day = fixtureDay(4);
        day.buckets.gridImportKwh = [1, 1, 0, 0];
        day.buckets.gridExportKwh = [0, 0, 2, 2];
        day.buckets.priceCtPerKwh = [30, 30, 10, 10];
        day.buckets.batterySocEndPct = [80, 75, 90, 95];
        const r = (0, simulate_1.computeRealDayResult)(day, 8);
        strict_1.default.equal(r.gridImportKwh, 2);
        strict_1.default.equal(r.gridExportKwh, 4);
        strict_1.default.equal(r.importCostEur, 0.6);
        strict_1.default.equal(r.exportCreditEur, 0.32);
        strict_1.default.equal(r.netCostEur, 0.28);
        strict_1.default.equal(r.socStartPct, 80);
        strict_1.default.equal(r.socEndPct, 95);
        strict_1.default.equal(r.missingSlotCount, 0);
    });
    (0, node_test_1.it)("liefert netCostEur=null statt erfundenen Wert, wenn kein Preis bekannt ist", () => {
        const day = fixtureDay(2);
        day.buckets.gridImportKwh = [1, 1];
        day.buckets.priceCtPerKwh = [null, null];
        const r = (0, simulate_1.computeRealDayResult)(day, null);
        strict_1.default.equal(r.netCostEur, null);
        strict_1.default.equal(r.gridImportKwh, 2);
    });
    (0, node_test_1.it)("zählt vollständig fehlende Slots als missing statt 0", () => {
        const day = fixtureDay(3);
        day.buckets.gridImportKwh = [1, null, null];
        day.buckets.priceCtPerKwh = [10, null, null];
        const r = (0, simulate_1.computeRealDayResult)(day, null);
        strict_1.default.equal(r.missingSlotCount, 2);
        strict_1.default.equal(r.observedSlotCount, 1);
    });
});
(0, node_test_1.describe)("simulateReferenceNoEms", () => {
    (0, node_test_1.it)("nicht bewertbar ohne Batteriekapazität/SOC-Grenzen — keine erfundene Aussage", () => {
        const day = fixtureDay(4);
        const r = (0, simulate_1.simulateReferenceNoEms)(day, { usableCapacityKwh: null, minSocPct: 5, maxSocPct: 100, maxChargeW: null, maxDischargeW: null, startSocPct: 50 }, null);
        strict_1.default.equal(r.evaluable, false);
        strict_1.default.equal(r.netCostEur, null);
    });
    (0, node_test_1.it)("simuliert Netzbezug/-einspeisung deterministisch aus PV/Hauslast der Buckets", () => {
        const day = fixtureDay(2);
        day.buckets.pvKwh = [3, 0];
        day.buckets.houseTotalKwh = [1, 1];
        day.buckets.priceCtPerKwh = [20, 20];
        const r = (0, simulate_1.simulateReferenceNoEms)(day, { usableCapacityKwh: 10, minSocPct: 5, maxSocPct: 100, maxChargeW: null, maxDischargeW: null, startSocPct: 50 }, 8);
        strict_1.default.equal(r.evaluable, true);
        strict_1.default.equal(r.strategy, "reference_no_ems");
        strict_1.default.ok(r.assumptionsDe.length > 0);
        strict_1.default.ok((r.batteryChargeKwh ?? 0) > 0, "Überschuss der Slot 0 sollte Batterie laden");
    });
});
(0, node_test_1.describe)("simulateReferenceNoEms — Point-in-time, kein Future Leakage", () => {
    (0, node_test_1.it)("Forecast-Snapshots auf dem Tag ändern die naive Eigenverbrauchslogik nicht", () => {
        const day = fixtureDay(2);
        day.buckets.pvKwh = [3, 0];
        day.buckets.houseTotalKwh = [1, 1];
        day.buckets.priceCtPerKwh = [20, 20];
        const params = {
            usableCapacityKwh: 10,
            minSocPct: 5,
            maxSocPct: 100,
            maxChargeW: null,
            maxDischargeW: null,
            startSocPct: 50,
        };
        const without = (0, simulate_1.simulateReferenceNoEms)(day, params, 8);
        day.forecastSnapshots = [
            {
                id: "future",
                tsIso: "2026-08-30T08:00:00.000Z",
                date: "2026-08-30",
                timezone: "Europe/Berlin",
                globalMode: "balanced",
                contributionRevision: null,
                pvExpectedDayKwh: 99,
                houseLoadExpectedDayKwh: 1,
                batterySocPct: 50,
                batteryCapacityKwh: 10,
                batteryNightReserveKwh: 2,
                priceSlots: [[0, 99]],
                pvSlotKwh: [[0, 50]],
                wallboxRequiredEnergyKwh: null,
                wallboxDeadlineIso: null,
                wallboxConnected: null,
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
            },
        ];
        const withSnap = (0, simulate_1.simulateReferenceNoEms)(day, params, 8);
        strict_1.default.equal(withSnap.netCostEur, without.netCostEur);
        strict_1.default.equal(withSnap.gridImportKwh, without.gridImportKwh);
        strict_1.default.equal(withSnap.batteryChargeKwh, without.batteryChargeKwh);
    });
});
(0, node_test_1.describe)("simulateEmsWithoutAi", () => {
    (0, node_test_1.it)("entspricht exakt dem realen Tag, solange kein KI-Override aktiv war", () => {
        const day = fixtureDay(2);
        day.buckets.gridImportKwh = [1, 0];
        day.buckets.priceCtPerKwh = [30, 30];
        const real = (0, simulate_1.computeRealDayResult)(day, null);
        const r = (0, simulate_1.simulateEmsWithoutAi)(real, false);
        strict_1.default.equal(r.evaluable, true);
        strict_1.default.equal(r.netCostEur, real.netCostEur);
        strict_1.default.equal(r.gridImportKwh, real.gridImportKwh);
    });
    (0, node_test_1.it)("markiert Tag als nicht bewertbar statt zu schätzen, wenn ein KI-Override aktiv war", () => {
        const day = fixtureDay(2);
        day.buckets.gridImportKwh = [1, 0];
        day.buckets.priceCtPerKwh = [30, 30];
        const real = (0, simulate_1.computeRealDayResult)(day, null);
        const r = (0, simulate_1.simulateEmsWithoutAi)(real, true);
        strict_1.default.equal(r.evaluable, false);
        strict_1.default.equal(r.netCostEur, null);
    });
});
