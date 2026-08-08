"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
/**
 * Beta-Befund 003: strategischer Planstatus + Execution/Operation-Trennung + Agenda.
 */
const strict_1 = __importDefault(require("node:assert/strict"));
const node_test_1 = require("node:test");
const quality_1 = require("../operator/quality");
const execution_display_1 = require("./execution_display");
const product_summary_1 = require("./product_summary");
const strategic_status_1 = require("./strategic_status");
const Q = (0, quality_1.operatorQuality)("valid", "test");
function emptyPlan(overrides = {}) {
    return {
        schemaVersion: 1,
        planId: "t",
        generation: 1,
        inputRevision: 1,
        createdAtIso: "2026-08-08T12:00:00.000Z",
        timezone: "Europe/Berlin",
        horizonStartIso: "2026-08-08T10:00:00.000Z",
        horizonEndIso: "2026-08-09T18:00:00.000Z",
        slotMinutes: 15,
        expectedPvEnergyTodayKwh: 40,
        expectedHouseLoadEnergyTodayKwh: 20,
        expectedPvEnergyToGoalKwh: null,
        expectedPvEnergyHorizonKwh: 80,
        expectedHouseLoadEnergyHorizonKwh: 40,
        expectedGridImportEnergyKwh: 0,
        expectedGridExportEnergyKwh: 5,
        expectedCostCt: null,
        batteryTrajectory: [],
        allocations: [],
        goalStatuses: [],
        constraints: [],
        reasonCodes: [],
        confidence: Q,
        vehicleChargeEconomics: null,
        totals: null,
        legacyDailyPlan: null,
        ...overrides,
    };
}
(0, node_test_1.describe)("Beta-Befund 003 — Battery strategic status", () => {
    (0, node_test_1.it)("SOC 100 %, keine Charge-Allocation → reserve_protected bei Nachtreserve", () => {
        const plan = emptyPlan({
            reasonCodes: ["battery_night_reserve", "battery_reserve_protected"],
            constraints: [
                {
                    id: "battery.night_reserve",
                    kind: "policy",
                    hard: true,
                    descriptionDe: "Nachtreserve schützen.",
                },
            ],
        });
        const s = (0, strategic_status_1.deriveBatteryStrategicStatus)({
            plan,
            socPct: 100,
            minSocPct: 10,
            maxSocPct: 100,
            nightReserveKwh: 4,
            usableCapacityKwh: 10,
            batteryHold: false,
            dischargeLiveSupported: false,
            nowMs: Date.parse("2026-08-08T14:00:00.000Z"),
        });
        strict_1.default.equal(s.status, "reserve_protected");
        strict_1.default.match(s.summaryDe, /Reserve|voll|SOC 100/i);
        strict_1.default.equal(s.hasChargeAllocation, false);
    });
    (0, node_test_1.it)("Night Reserve aktiv → reserve_protected", () => {
        const s = (0, strategic_status_1.deriveBatteryStrategicStatus)({
            plan: emptyPlan({ reasonCodes: ["battery_night_reserve"] }),
            socPct: 55,
            minSocPct: 10,
            maxSocPct: 100,
            nightReserveKwh: 5,
            usableCapacityKwh: 10,
            batteryHold: false,
            dischargeLiveSupported: false,
            nowMs: Date.parse("2026-08-08T20:00:00.000Z"),
        });
        strict_1.default.equal(s.status, "reserve_protected");
    });
    (0, node_test_1.it)("Hold-Entscheidung sichtbar ohne Write", () => {
        const s = (0, strategic_status_1.deriveBatteryStrategicStatus)({
            plan: emptyPlan(),
            socPct: 70,
            minSocPct: 10,
            maxSocPct: 100,
            nightReserveKwh: null,
            usableCapacityKwh: 10,
            batteryHold: true,
            dischargeLiveSupported: false,
            nowMs: Date.parse("2026-08-08T14:00:00.000Z"),
        });
        strict_1.default.equal(s.status, "hold");
        strict_1.default.match(s.reasonDe, /Hold/i);
        const op = (0, execution_display_1.operationFromBatteryStrategy)(s.status, false);
        strict_1.default.equal(op.kind, "hold");
    });
});
(0, node_test_1.describe)("Beta-Befund 003 — Wallbox strategic status", () => {
    (0, node_test_1.it)("ohne Fahrzeug → waiting_for_vehicle", () => {
        const s = (0, strategic_status_1.deriveWallboxStrategicStatus)({
            plan: emptyPlan(),
            connectedNow: false,
            requiredEnergyKwh: null,
            deadlineIso: null,
            hasHardFuturePresence: false,
            nowMs: Date.parse("2026-08-08T14:00:00.000Z"),
        });
        strict_1.default.equal(s.status, "waiting_for_vehicle");
        strict_1.default.match(s.summaryDe, /Fahrzeug|kein Ladeplan/i);
        strict_1.default.equal(s.hasChargeAllocation, false);
    });
    (0, node_test_1.it)("Fahrzeug + Goal/Deadline + future Allocation → scheduled", () => {
        const plan = emptyPlan({
            allocations: [
                {
                    slot: {
                        startIso: "2026-08-08T16:00:00.000Z",
                        endIso: "2026-08-08T16:15:00.000Z",
                    },
                    consumerId: "wallbox",
                    kind: "wallbox",
                    allocatedPowerW: 7000,
                    allocatedEnergyKwh: 1.75,
                    energySource: "pv_surplus",
                    constraintIds: [],
                    reasonCodes: [],
                },
            ],
            vehicleChargeEconomics: {
                deadlineIso: "2026-08-08T18:00:00.000Z",
                requiredEnergyKwh: 10,
                expectedPvChargeKwh: 8,
                expectedGridChargeKwh: 2,
                expectedGridCostCt: 40,
                alternativeGridCostCt: 60,
                savingsVsAlternativeCt: 20,
                exportTariffKnown: false,
                economicsCompleteness: "grid_only",
                baselineId: "earliest_feasible",
                slotCostsCtByStartIso: {},
            },
        });
        const s = (0, strategic_status_1.deriveWallboxStrategicStatus)({
            plan,
            connectedNow: true,
            requiredEnergyKwh: 10,
            deadlineIso: "2026-08-08T18:00:00.000Z",
            hasHardFuturePresence: true,
            nowMs: Date.parse("2026-08-08T14:00:00.000Z"),
        });
        strict_1.default.equal(s.status, "scheduled");
        strict_1.default.equal(s.hasChargeAllocation, true);
        strict_1.default.equal((0, execution_display_1.operationFromWallboxStrategy)(s.status, false).kind, "planned");
    });
});
(0, node_test_1.describe)("Beta-Befund 003 — Execution vs Operation", () => {
    (0, node_test_1.it)("Add-on Dryrun + keine Allocation → DRYRUN bleibt sichtbar", () => {
        strict_1.default.equal((0, execution_display_1.isEffectiveLiveWriteAllowed)("live", "dryrun"), false);
        strict_1.default.equal((0, execution_display_1.resolveExecutionAuthority)(false), "dryrun");
        strict_1.default.equal((0, execution_display_1.executionAuthorityBadge)("dryrun").labelDe, "DRYRUN");
        const agenda = (0, product_summary_1.buildUnifiedDayAgendaDe)(emptyPlan({
            reasonCodes: ["battery_night_reserve"],
            constraints: [
                {
                    id: "battery.night_reserve",
                    kind: "policy",
                    hard: true,
                    descriptionDe: "Nachtreserve.",
                },
            ],
        }), {
            nowMs: Date.parse("2026-08-08T14:00:00.000Z"),
            battery: { liveWriteAllowed: false, hardwareActive: false, currentAllocatedW: null },
            wallbox: { liveWriteAllowed: false, hardwareActive: false, currentAllocatedW: null },
        }, {
            schemaVersion: 1,
            generatedAtIso: "2026-08-08T14:00:00.000Z",
            battery: (0, strategic_status_1.deriveBatteryStrategicStatus)({
                plan: emptyPlan({ reasonCodes: ["battery_night_reserve"] }),
                socPct: 100,
                minSocPct: 10,
                maxSocPct: 100,
                nightReserveKwh: 4,
                usableCapacityKwh: 10,
                batteryHold: false,
                dischargeLiveSupported: false,
                nowMs: Date.parse("2026-08-08T14:00:00.000Z"),
            }),
            wallbox: (0, strategic_status_1.deriveWallboxStrategicStatus)({
                plan: emptyPlan(),
                connectedNow: false,
                requiredEnergyKwh: null,
                deadlineIso: null,
                hasHardFuturePresence: false,
                nowMs: Date.parse("2026-08-08T14:00:00.000Z"),
            }),
        });
        const batLine = agenda.find((l) => /Batterie/i.test(l)) ?? "";
        strict_1.default.match(batLine, /^DRYRUN/);
        strict_1.default.doesNotMatch(batLine, /PAUSIERT/i);
    });
    (0, node_test_1.it)("Add-on Live + keine Aktion → LIVE + operativer Wait/Idle", () => {
        strict_1.default.equal((0, execution_display_1.resolveExecutionAuthority)(true), "live");
        strict_1.default.equal((0, execution_display_1.executionAuthorityBadge)("live").labelDe, "LIVE");
        const agenda = (0, product_summary_1.buildUnifiedDayAgendaDe)(emptyPlan(), {
            nowMs: Date.parse("2026-08-08T14:00:00.000Z"),
            wallbox: { liveWriteAllowed: true, hardwareActive: false },
        }, {
            schemaVersion: 1,
            generatedAtIso: "2026-08-08T14:00:00.000Z",
            battery: (0, strategic_status_1.deriveBatteryStrategicStatus)({
                plan: emptyPlan(),
                socPct: 40,
                minSocPct: 10,
                maxSocPct: 100,
                nightReserveKwh: null,
                usableCapacityKwh: 10,
                batteryHold: false,
                dischargeLiveSupported: false,
                nowMs: Date.parse("2026-08-08T14:00:00.000Z"),
            }),
            wallbox: (0, strategic_status_1.deriveWallboxStrategicStatus)({
                plan: emptyPlan(),
                connectedNow: false,
                requiredEnergyKwh: null,
                deadlineIso: null,
                hasHardFuturePresence: false,
                nowMs: Date.parse("2026-08-08T14:00:00.000Z"),
            }),
        });
        const wb = agenda.find((l) => /Wallbox/i.test(l)) ?? "";
        strict_1.default.match(wb, /^LIVE/);
        strict_1.default.match(wb, /Fahrzeug/i);
    });
    (0, node_test_1.it)("Execution-Gates unverändert", () => {
        strict_1.default.equal((0, execution_display_1.isEffectiveLiveWriteAllowed)("live", "live"), true);
        strict_1.default.equal((0, execution_display_1.isEffectiveLiveWriteAllowed)("live", "dryrun"), false);
        strict_1.default.equal((0, execution_display_1.isEffectiveLiveWriteAllowed)("dryrun", "live"), false);
        // Legacy Heizstab-Phase bei aktueller Allocation bleibt dryrun
        strict_1.default.equal((0, execution_display_1.resolveExecutionDisplayPhase)({
            currentPlannedActive: true,
            hasFuturePlan: false,
            liveWriteAllowed: false,
            hardwareActive: false,
        }), "dryrun");
    });
});
(0, node_test_1.describe)("Beta-Befund 003 — Agenda Past verdrängt Zukunft nicht", () => {
    (0, node_test_1.it)("vergangene Fenster zählen nicht gegen Kontingent", () => {
        const nowMs = Date.parse("2026-08-08T14:00:00.000Z");
        const windows = [
            {
                startIso: "2026-08-08T08:00:00.000Z",
                endIso: "2026-08-08T09:00:00.000Z",
                energyKwh: 2,
            },
            {
                startIso: "2026-08-08T08:00:00.000Z",
                endIso: "2026-08-08T08:30:00.000Z",
                energyKwh: 1,
            },
            {
                startIso: "2026-08-08T16:00:00.000Z",
                endIso: "2026-08-08T17:00:00.000Z",
                energyKwh: 1.5,
            },
            {
                startIso: "2026-08-09T10:00:00.000Z",
                endIso: "2026-08-09T11:00:00.000Z",
                energyKwh: 2,
            },
        ];
        const selected = (0, product_summary_1.selectRelevantAgendaWindows)(windows, nowMs, "Europe/Berlin", { max: 2 });
        strict_1.default.equal(selected.length, 2);
        strict_1.default.equal(selected[0].startIso, "2026-08-08T16:00:00.000Z");
        strict_1.default.equal(selected[1].startIso, "2026-08-09T10:00:00.000Z");
    });
    (0, node_test_1.it)("Zukunft über Mitternacht / Goal-Deadline bleibt sichtbar", () => {
        const nowMs = Date.parse("2026-08-08T22:00:00.000Z");
        const windows = [
            {
                startIso: "2026-08-08T12:00:00.000Z",
                endIso: "2026-08-08T13:00:00.000Z",
                energyKwh: 1,
            },
            {
                startIso: "2026-08-09T06:00:00.000Z",
                endIso: "2026-08-09T07:00:00.000Z",
                energyKwh: 3,
            },
        ];
        const selected = (0, product_summary_1.selectRelevantAgendaWindows)(windows, nowMs, "Europe/Berlin", {
            max: 2,
            deadlineIso: "2026-08-09T08:00:00.000Z",
        });
        strict_1.default.ok(selected.some((w) => w.startIso.startsWith("2026-08-09")));
    });
    (0, node_test_1.it)("mergeWindows + select: Rest-heute vor Past", () => {
        const cells = [
            {
                slot: { startIso: "2026-08-08T06:00:00.000Z", endIso: "2026-08-08T06:15:00.000Z" },
                consumerId: "immersion_heater",
                kind: "immersion_heater",
                allocatedPowerW: 1700,
                allocatedEnergyKwh: 0.425,
                energySource: "pv_surplus",
                constraintIds: [],
                reasonCodes: [],
            },
            {
                slot: { startIso: "2026-08-08T15:00:00.000Z", endIso: "2026-08-08T15:15:00.000Z" },
                consumerId: "immersion_heater",
                kind: "immersion_heater",
                allocatedPowerW: 1700,
                allocatedEnergyKwh: 0.425,
                energySource: "pv_surplus",
                constraintIds: [],
                reasonCodes: [],
            },
        ];
        const merged = (0, product_summary_1.mergeWindows)(cells, "immersion_heater");
        const sel = (0, product_summary_1.selectRelevantAgendaWindows)(merged, Date.parse("2026-08-08T14:00:00.000Z"), "Europe/Berlin", { max: 2 });
        strict_1.default.equal(sel.length, 1);
        strict_1.default.equal(sel[0].startIso, "2026-08-08T15:00:00.000Z");
    });
});
