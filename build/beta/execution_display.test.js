"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const strict_1 = __importDefault(require("node:assert/strict"));
const node_test_1 = require("node:test");
const execution_display_1 = require("./execution_display");
const product_summary_1 = require("./product_summary");
(0, node_test_1.describe)("execution_display hierarchy", () => {
    (0, node_test_1.it)("only Global Live + Addon Live allows effective live writes", () => {
        strict_1.default.equal((0, execution_display_1.isEffectiveLiveWriteAllowed)("live", "live"), true);
        strict_1.default.equal((0, execution_display_1.isEffectiveLiveWriteAllowed)("live", "dryrun"), false);
        strict_1.default.equal((0, execution_display_1.isEffectiveLiveWriteAllowed)("dryrun", "live"), false);
        strict_1.default.equal((0, execution_display_1.isEffectiveLiveWriteAllowed)("dryrun", "dryrun"), false);
    });
});
(0, node_test_1.describe)("execution_display phases GEPLANT / DRYRUN / LÄUFT", () => {
    (0, node_test_1.it)("GEPLANT: future allocation, no current dryrun claim", () => {
        const phase = (0, execution_display_1.resolveExecutionDisplayPhase)({
            currentPlannedActive: false,
            hasFuturePlan: true,
            liveWriteAllowed: false,
            hardwareActive: false,
        });
        strict_1.default.equal(phase, "planned");
        strict_1.default.equal((0, execution_display_1.agendaStatusLabelDe)(phase), "GEPLANT");
        strict_1.default.equal((0, execution_display_1.executionDisplayBadge)(phase).labelDe, "Geplant");
        strict_1.default.equal((0, execution_display_1.executionDisplayBadge)(phase).cls, "plan");
    });
    (0, node_test_1.it)("DRYRUN: Global Live + Addon Dryrun + current allocation — never LÄUFT", () => {
        strict_1.default.equal((0, execution_display_1.isEffectiveLiveWriteAllowed)("live", "dryrun"), false);
        const phase = (0, execution_display_1.resolveExecutionDisplayPhase)({
            currentPlannedActive: true,
            hasFuturePlan: false,
            liveWriteAllowed: false,
            hardwareActive: false,
        });
        strict_1.default.equal(phase, "dryrun");
        strict_1.default.equal((0, execution_display_1.agendaStatusLabelDe)(phase), "DRYRUN");
        strict_1.default.equal((0, execution_display_1.executionDisplayBadge)(phase).cls, "dryrun");
        strict_1.default.equal((0, execution_display_1.formatAgendaSlotMetaDe)({ phase, plannerPowerW: 1700 }), "DRYRUN · geplant 1700 W");
        strict_1.default.equal((0, execution_display_1.formatExecutionNowLineDe)({
            phase,
            plannerPowerW: 1700,
            hardwareLabelDe: "unverändert",
        }), "Planner: 1700 W · Hardware: unverändert");
    });
    (0, node_test_1.it)("DRYRUN: Global Dryrun + Addon Live + current allocation — never LÄUFT", () => {
        strict_1.default.equal((0, execution_display_1.isEffectiveLiveWriteAllowed)("dryrun", "live"), false);
        const phase = (0, execution_display_1.resolveExecutionDisplayPhase)({
            currentPlannedActive: true,
            hasFuturePlan: true,
            liveWriteAllowed: false,
            hardwareActive: true, // Ist egal — ohne Live-Authority kein LÄUFT
        });
        strict_1.default.equal(phase, "dryrun");
        strict_1.default.notEqual((0, execution_display_1.agendaStatusLabelDe)(phase), "LÄUFT");
    });
    (0, node_test_1.it)("LÄUFT: only Global Live + Addon Live + hardware confirmed", () => {
        const phase = (0, execution_display_1.resolveExecutionDisplayPhase)({
            currentPlannedActive: true,
            hasFuturePlan: false,
            liveWriteAllowed: true,
            hardwareActive: true,
        });
        strict_1.default.equal(phase, "running");
        strict_1.default.equal((0, execution_display_1.agendaStatusLabelDe)(phase), "LÄUFT");
        strict_1.default.equal((0, execution_display_1.executionDisplayBadge)(phase).cls, "on");
        strict_1.default.equal((0, execution_display_1.formatExecutionNowLineDe)({
            phase,
            plannerPowerW: 1700,
            hardwareLabelDe: "an · 1700 W",
        }), "an · 1700 W");
    });
    (0, node_test_1.it)("allocated/commanded without live authority never becomes LÄUFT", () => {
        strict_1.default.equal((0, execution_display_1.isImmersionHardwareActive)({
            liveWriteAllowed: false,
            feedbackStage: 0,
            measuredPowerW: 0,
            commandedPowerW: 1700,
        }), false);
        const phase = (0, execution_display_1.resolveExecutionDisplayPhase)({
            currentPlannedActive: true,
            hasFuturePlan: false,
            liveWriteAllowed: false,
            hardwareActive: (0, execution_display_1.isImmersionHardwareActive)({
                liveWriteAllowed: false,
                feedbackStage: 0,
                measuredPowerW: null,
                commandedPowerW: 1700,
            }),
        });
        strict_1.default.equal(phase, "dryrun");
    });
    (0, node_test_1.it)("live + feedback confirms hardware even if allocation already ended", () => {
        strict_1.default.equal((0, execution_display_1.isImmersionHardwareActive)({
            liveWriteAllowed: true,
            feedbackStage: 1,
            measuredPowerW: null,
            commandedPowerW: 0,
        }), true);
        const phase = (0, execution_display_1.resolveExecutionDisplayPhase)({
            currentPlannedActive: false,
            hasFuturePlan: false,
            liveWriteAllowed: true,
            hardwareActive: true,
        });
        strict_1.default.equal(phase, "running");
    });
    (0, node_test_1.it)("live + current plan without hardware → GEPLANT, not LÄUFT", () => {
        const phase = (0, execution_display_1.resolveExecutionDisplayPhase)({
            currentPlannedActive: true,
            hasFuturePlan: false,
            liveWriteAllowed: true,
            hardwareActive: false,
        });
        strict_1.default.equal(phase, "planned");
        strict_1.default.equal((0, execution_display_1.agendaStatusLabelDe)(phase), "GEPLANT");
    });
    (0, node_test_1.it)("buildAgendaExecutionHints: Global Live + IH Dryrun → effective dryrun", () => {
        const hints = (0, execution_display_1.buildAgendaExecutionHints)({
            globalMode: "live",
            addonModes: {
                immersion_heater: "dryrun",
                battery: "live",
                wallbox: "live",
                air_conditioning: "live",
            },
            hardware: {
                immersion: {
                    feedbackStage: 0,
                    measuredPowerW: 0,
                    commandedPowerW: 1700,
                    allocatedPowerW: 1700,
                },
            },
            nowMs: Date.parse("2026-08-04T12:00:00.000Z"),
        });
        strict_1.default.equal(hints.immersion_heater.liveWriteAllowed, false);
        strict_1.default.equal(hints.immersion_heater.hardwareActive, false);
        strict_1.default.equal(hints.immersion_heater.currentAllocatedW, 1700);
    });
});
(0, node_test_1.describe)("product_summary agenda execution labels", () => {
    function ihPlan(nowMs) {
        const start = new Date(nowMs - 5 * 60_000).toISOString();
        const end = new Date(nowMs + 10 * 60_000).toISOString();
        return {
            schemaVersion: 1,
            planId: "exec-agenda",
            generation: 1,
            inputRevision: 1,
            createdAtIso: new Date(nowMs).toISOString(),
            timezone: "Europe/Berlin",
            horizonStartIso: start,
            horizonEndIso: end,
            slotMinutes: 15,
            expectedPvEnergyTodayKwh: null,
            expectedHouseLoadEnergyTodayKwh: null,
            expectedPvEnergyToGoalKwh: null,
            expectedPvEnergyHorizonKwh: null,
            expectedHouseLoadEnergyHorizonKwh: null,
            expectedGridImportEnergyKwh: null,
            expectedGridExportEnergyKwh: null,
            expectedCostCt: null,
            batteryTrajectory: [],
            allocations: [
                {
                    consumerId: "immersion_heater",
                    kind: "immersion_heater",
                    slot: { startIso: start, endIso: end },
                    allocatedEnergyKwh: 0.4,
                    allocatedPowerW: 1700,
                    energySource: "pv_surplus",
                    constraintIds: [],
                    reasonCodes: [],
                },
            ],
            goalStatuses: [],
            constraints: [],
            reasonCodes: [],
            confidence: { status: "valid", confidencePct: 80, reasonDe: "test" },
            vehicleChargeEconomics: null,
            totals: {
                pvForecastEnergyKwh: null,
                fixedHouseLoadEnergyKwh: null,
                fixedRenewableBalanceKwh: null,
                flexibleRequestedEnergyKwh: null,
                flexibleAllocatedEnergyKwh: 0.4,
                flexibleUnallocatedEnergyKwh: null,
                pvAllocatedEnergyKwh: 0.4,
                gridAllocatedEnergyKwh: 0,
                batteryChargeEnergyKwh: 0,
                wallboxEnergyKwh: 0,
                immersionHeaterEnergyKwh: 0.4,
                airConditioningEnergyKwh: 0,
                estimatedGridCostCt: null,
                mandatoryRequestedEnergyKwh: null,
                mandatoryAllocatedEnergyKwh: 0,
                mandatoryUnallocatedEnergyKwh: null,
            },
            legacyDailyPlan: null,
        };
    }
    (0, node_test_1.it)("current IH dryrun slot shows DRYRUN · geplant 1700 W, never LÄUFT", () => {
        const nowMs = Date.parse("2026-08-04T12:00:00.000Z");
        const agenda = (0, product_summary_1.buildUnifiedDayAgendaDe)(ihPlan(nowMs), {
            nowMs,
            immersion_heater: {
                liveWriteAllowed: false,
                hardwareActive: false,
                currentAllocatedW: 1700,
            },
        });
        const line = agenda.find((l) => /Heizstab/i.test(l)) ?? "";
        strict_1.default.match(line, /DRYRUN · geplant 1700 W/);
        strict_1.default.doesNotMatch(line, /LÄUFT/);
    });
    (0, node_test_1.it)("current IH live+hardware shows LÄUFT", () => {
        const nowMs = Date.parse("2026-08-04T12:00:00.000Z");
        const agenda = (0, product_summary_1.buildUnifiedDayAgendaDe)(ihPlan(nowMs), {
            nowMs,
            immersion_heater: {
                liveWriteAllowed: true,
                hardwareActive: true,
                currentAllocatedW: 1700,
            },
        });
        const line = agenda.find((l) => /Heizstab/i.test(l)) ?? "";
        strict_1.default.match(line, /LÄUFT/);
    });
    (0, node_test_1.it)("future-only without current active stays GEPLANT without LÄUFT/DRYRUN claim on idle", () => {
        const nowMs = Date.parse("2026-08-04T10:00:00.000Z");
        const start = new Date(nowMs + 2 * 3600_000).toISOString();
        const end = new Date(nowMs + 2.25 * 3600_000).toISOString();
        const plan = ihPlan(nowMs);
        plan.allocations = [
            {
                ...plan.allocations[0],
                slot: { startIso: start, endIso: end },
            },
        ];
        const agenda = (0, product_summary_1.buildUnifiedDayAgendaDe)(plan, {
            nowMs,
            immersion_heater: {
                liveWriteAllowed: false,
                hardwareActive: false,
                currentAllocatedW: null,
            },
        });
        const line = agenda.find((l) => /Heizstab/i.test(l)) ?? "";
        strict_1.default.doesNotMatch(line, /LÄUFT/);
        strict_1.default.doesNotMatch(line, /^DRYRUN/);
    });
});
(0, node_test_1.describe)("climate unit display — Plan ≠ Bedarf ≠ Hardware", () => {
    (0, node_test_1.it)("hardware on + active demand → LÄUFT · Kühlbedarf aktiv", () => {
        const d = (0, execution_display_1.resolveClimateUnitDisplay)({
            liveWriteAllowed: true,
            hardwareRunning: true,
            allocatedPowerW: 700,
            decisionSource: "daily_plan",
            reasonDe: "Läuft (Temp 26.0 °C ≥ 25.0 °C — cool). Daily Plan: 700 W freigegeben.",
            likelyActiveToday: true,
            expectedHoursToday: 2,
            expectedKwhToday: 1.4,
        });
        strict_1.default.equal(d.phase, "running");
        strict_1.default.equal(d.badge.labelDe, "Läuft");
        strict_1.default.equal(d.demand, "active");
        strict_1.default.equal(d.nowLineDe, "Läuft · Kühlbedarf aktiv");
        strict_1.default.equal(d.planLineDe, "Budget 700 W");
    });
    (0, node_test_1.it)("hardware on + no new demand (temperature_no_demand) → LÄUFT · Restlauf/Hysterese", () => {
        const d = (0, execution_display_1.resolveClimateUnitDisplay)({
            liveWriteAllowed: true,
            hardwareRunning: true,
            allocatedPowerW: 700,
            decisionSource: "temperature_no_demand",
            reasonDe: "Daily Plan stellt 700 W bereit, aktuell kein Kühlbedarf.",
            likelyActiveToday: false,
        });
        strict_1.default.equal(d.phase, "running");
        strict_1.default.equal(d.badge.labelDe, "Läuft");
        strict_1.default.equal(d.demand, "hold");
        strict_1.default.match(d.nowLineDe, /Läuft · kein neuer Kühlbedarf, läuft wegen .+ weiter/);
        strict_1.default.doesNotMatch(d.nowLineDe, /^eingeschaltet$/);
        strict_1.default.equal(d.heuteLineDe, "Klima im Tagesplan");
        strict_1.default.equal(d.planLineDe, "Budget 700 W");
    });
    (0, node_test_1.it)("hardware on + explicit hysteresis reason → hold with Hysterese", () => {
        const d = (0, execution_display_1.resolveClimateUnitDisplay)({
            liveWriteAllowed: true,
            hardwareRunning: true,
            allocatedPowerW: 700,
            decisionSource: "climate_fallback",
            reasonDe: "Temp 24.2 °C im Hysterese-Bereich — läuft weiter.",
        });
        strict_1.default.equal(d.demand, "hold");
        strict_1.default.match(d.nowLineDe, /wegen Hysterese weiter/);
    });
    (0, node_test_1.it)("hardware off + allocation + no demand → Bereit, not LÄUFT", () => {
        const d = (0, execution_display_1.resolveClimateUnitDisplay)({
            liveWriteAllowed: true,
            hardwareRunning: false,
            allocatedPowerW: 700,
            decisionSource: "temperature_no_demand",
            reasonDe: "Daily Plan stellt 700 W bereit, aktuell kein Kühlbedarf.",
            likelyActiveToday: false,
        });
        strict_1.default.equal(d.phase, "planned");
        strict_1.default.equal(d.badge.labelDe, "Bereit");
        strict_1.default.equal(d.demand, "none");
        strict_1.default.equal(d.nowLineDe, "aktuell kein Kühlbedarf");
        strict_1.default.notEqual(d.badge.labelDe, "Läuft");
        strict_1.default.equal(d.planLineDe, "Budget 700 W");
    });
    (0, node_test_1.it)("dryrun + allocation never yields LÄUFT from planner alone", () => {
        const d = (0, execution_display_1.resolveClimateUnitDisplay)({
            liveWriteAllowed: false,
            hardwareRunning: false,
            allocatedPowerW: 700,
            decisionSource: "temperature_no_demand",
            reasonDe: "Daily Plan stellt 700 W bereit, aktuell kein Kühlbedarf.",
        });
        strict_1.default.equal(d.phase, "dryrun");
        strict_1.default.equal(d.badge.cls, "dryrun");
        strict_1.default.notEqual(d.badge.labelDe, "Läuft");
        strict_1.default.match(d.nowLineDe, /Planner: 700 W/);
        strict_1.default.match(d.nowLineDe, /Hardware: aus/);
    });
    (0, node_test_1.it)("allocation is budget only — not automatic Kühlbedarf on Heute line", () => {
        const d = (0, execution_display_1.resolveClimateUnitDisplay)({
            liveWriteAllowed: true,
            hardwareRunning: false,
            allocatedPowerW: 700,
            decisionSource: "temperature_no_demand",
            reasonDe: "Daily Plan stellt 700 W bereit, aktuell kein Kühlbedarf.",
            likelyActiveToday: false,
        });
        strict_1.default.equal(d.heuteLineDe, "Klima im Tagesplan");
        strict_1.default.equal(d.planLineDe, "Budget 700 W");
        strict_1.default.notEqual(d.heuteLineDe, d.planLineDe);
    });
    (0, node_test_1.it)("outside clock window + future plan → Gesperrt, not Aus; plan shows next window", () => {
        const d = (0, execution_display_1.resolveClimateUnitDisplay)({
            liveWriteAllowed: true,
            hardwareRunning: false,
            allocatedPowerW: 0,
            decisionSource: "climate_fallback",
            reasonDe: "Außerhalb Zeitfenster 08:00–20:00.",
            likelyActiveToday: false,
            hasFuturePlan: true,
            nextPlanWindow: {
                startIso: "2026-08-09T09:00:00.000Z",
                endIso: "2026-08-09T11:00:00.000Z",
                startMs: Date.parse("2026-08-09T09:00:00.000Z"),
                endMs: Date.parse("2026-08-09T11:00:00.000Z"),
                powerW: 700,
                contributionId: "air_conditioning.unit_1",
            },
            timezone: "UTC",
        });
        strict_1.default.match(d.operationLabelDe, /Gesperrt/i);
        strict_1.default.match(d.operationLabelDe, /Zeitfenster/i);
        strict_1.default.notEqual(d.badge.labelDe, "Aus");
        strict_1.default.match(d.planLineDe, /nächstes/);
        strict_1.default.match(d.planLineDe, /700 W/);
        strict_1.default.equal(d.heuteLineDe, "Klima im Tagesplan");
    });
    (0, node_test_1.it)("outside clock window + no future plan → Gesperrt, wirklich kein Budget", () => {
        const d = (0, execution_display_1.resolveClimateUnitDisplay)({
            liveWriteAllowed: true,
            hardwareRunning: false,
            allocatedPowerW: 0,
            reasonDe: "Außerhalb Zeitfenster 08:00–20:00.",
            likelyActiveToday: false,
            hasFuturePlan: false,
            nextPlanWindow: null,
        });
        strict_1.default.match(d.operationLabelDe, /Gesperrt/i);
        strict_1.default.equal(d.planLineDe, "kein Budget");
        strict_1.default.equal(d.heuteLineDe, "heute keine geplante Klimaaktion");
    });
});
