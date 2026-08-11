"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
/**
 * v0.1.263 — Hard-Bridge vs Soft-Precharge + Newton-Verdrahtung + Realfall 10.08.
 */
const strict_1 = __importDefault(require("node:assert/strict"));
const node_test_1 = require("node:test");
const contribution_ids_1 = require("../../contribution_ids");
const quality_1 = require("../../quality");
const types_1 = require("../../contributions/types");
const contributor_1 = require("../../contributor");
const types_2 = require("../../contributions/types");
const allocate_1 = require("./allocate");
const from_forecast_context_1 = require("./from_forecast_context");
const next_reliable_pv_1 = require("./next_reliable_pv");
const thermal_cooling_rate_1 = require("../../contributions/flexible/thermal_cooling_rate");
const score_allocate_1 = require("./score_allocate");
const Q = (0, quality_1.operatorQuality)("valid", "test", 80);
const TZ = "Europe/Berlin";
const NOW = new Date("2026-08-10T08:45:35.859Z");
function contrib(id, opts) {
    const { details = {}, ...rest } = opts;
    const contributor = id.startsWith("immersion")
        ? (0, contributor_1.addonContributorRef)("immersion_heater")
        : id === contribution_ids_1.CONTRIBUTION_IDS.PV_SUPPLY
            ? (0, types_2.pvContributorRef)()
            : id === contribution_ids_1.CONTRIBUTION_IDS.HOUSE_LOAD_FIXED
                ? (0, contributor_1.systemContributorRef)("house_load")
                : id === contribution_ids_1.CONTRIBUTION_IDS.GRID_SUPPLY
                    ? (0, contributor_1.systemContributorRef)("grid_supply")
                    : (0, contributor_1.addonContributorRef)("battery");
    return (0, types_1.baseContribution)(id, contributor, "consume", ["demand_flex"], {
        generatedAt: NOW.toISOString(),
        validUntil: null,
        revision: 1,
        enabled: true,
        flexible: true,
        gridEligible: false,
        quality: Q,
        reasonDe: "test",
        details,
        slots: [],
        ...rest,
    });
}
function ihDetails(over = {}) {
    return {
        bufferTempC: 54,
        boilerTempC: 58,
        boilerMinTempC: 50,
        targetTempC: 61.803,
        forecastTargetTempC: 51.6,
        planningMinTempC: 44,
        mandatoryMinTempC: 50,
        planningMaxTempC: 63,
        requiredEnergyKwh: 2.965,
        maxPowerW: 1700,
        minPowerW: 1700,
        pvPrechargeActive: true,
        pvPrechargeExtraK: 10.2,
        /** Puffer-Newton nur Soft — nicht Hard-usable. */
        coolingRateCPerHAvg: null,
        coolingConstantPerH: 0.08853,
        coolingAsymptoteC: 40.35,
        bufferEstimatedEmptyAt: "2026-08-10T18:56:50.898Z",
        boilerEstimatedEmptyAt: null,
        estimatedEmptyAt: null,
        emptyAtSource: null,
        emptyAtPlanningUsable: false,
        boilerSensorDegraded: false,
        thermalLearningStatus: "degraded",
        thermalLearningModel: "newton",
        nightBridgeActive: false,
        ...over,
    };
}
function realCaseContext() {
    const slots = [];
    const start = Date.parse("2026-08-10T08:45:00.000Z");
    for (let i = 0; i < 96; i++) {
        const a = new Date(start + i * 15 * 60_000).toISOString();
        const b = new Date(start + (i + 1) * 15 * 60_000).toISOString();
        const h = new Date(a).getUTCHours();
        let pv = h >= 8 && h < 18 ? 3500 : h === 18 ? 2800 : 0;
        let house = pv > 500 ? 400 : 300;
        if (i === 0) {
            pv = 4652;
            house = 1940;
        }
        slots.push({
            slot: { startIso: a, endIso: b },
            pvPowerW: pv,
            houseLoadPowerW: house,
            fixedBalancePowerW: pv - house,
            gridPriceCtPerKwh: 25,
            gridImportAllowed: true,
            gridMaxImportPowerW: 30000,
            outdoorTempC: null,
            quality: Q,
            reasonDe: "",
        });
    }
    return {
        now: NOW,
        timezone: TZ,
        globalMode: "balanced",
        forecastPlan: {
            generatedAt: NOW.toISOString(),
            validUntil: "2026-08-12T08:45:00.000Z",
            revision: 1,
            timezone: TZ,
            horizonStart: "2026-08-10T08:45:00.000Z",
            horizonEnd: slots[slots.length - 1].slot.endIso,
            slotMinutes: 15,
            status: "ready",
            reasonDe: "test",
            quality: Q,
            days: [
                {
                    date: "2026-08-10",
                    pvEnergyKwh: 40.2,
                    houseLoadEnergyKwh: 14.9,
                    renewableBalanceKwh: 25.3,
                    weatherMinTempC: null,
                    weatherMaxTempC: null,
                    quality: Q,
                    reasonDe: "test",
                },
            ],
            slots,
            contributions: [
                contrib(contribution_ids_1.CONTRIBUTION_IDS.PV_SUPPLY, {
                    details: { correctedTodayKwh: 40.2, rawTodayKwh: 40.2 },
                }),
                contrib(contribution_ids_1.CONTRIBUTION_IDS.HOUSE_LOAD_FIXED, { details: {} }),
                contrib(contribution_ids_1.CONTRIBUTION_IDS.GRID_SUPPLY, { details: {} }),
                contrib(contribution_ids_1.CONTRIBUTION_IDS.IMMERSION_FLEXIBLE, {
                    deadlineIso: "2026-08-10T18:56:50.898Z",
                    details: ihDetails(),
                }),
            ],
            activeContributors: [],
            excludedContributors: [],
        },
        observedPvPowerW: 4652,
        observedHouseLoadPowerW: 1940,
        observedPvAgeSec: 5,
        observedHouseAgeSec: 5,
        feedInCtPerKwh: 9.3,
        preferImmersionLiveSurplusNow: true,
        passiveBatteryEnergyAvailable: true,
    };
}
function sumIh(plan) {
    return plan.allocations
        .filter((a) => a.kind === "immersion_heater")
        .reduce((s, a) => s + a.allocatedEnergyKwh, 0);
}
(0, node_test_1.describe)("v0.1.268 thermal cooling / Boiler-Puffer-Trennung (T1)", () => {
    (0, node_test_1.it)("Puffer-Newton berechenbar; Hard nutzt Boiler (kein Buffer-emptyAt)", () => {
        const rate = (0, thermal_cooling_rate_1.effectiveCoolingRateCPerH)({
            coolingRateCPerHAvg: null,
            coolingConstantPerH: 0.08853,
            coolingAsymptoteC: 40.35,
            bufferTempC: 54,
            minTempC: 44,
            estimatedEmptyAtMs: Date.parse("2026-08-10T18:56:50.898Z"),
            nowMs: Date.parse("2026-08-10T08:45:00.000Z"),
        });
        strict_1.default.ok(rate != null && rate > 0.5, `newton instant rate got ${rate}`);
        const input = (0, from_forecast_context_1.buildUnifiedInputFromForecastContext)(realCaseContext());
        strict_1.default.equal(input.thermal?.coolingRateCPerH, null);
        strict_1.default.equal(input.thermal?.boilerMinTempC ?? input.thermal?.minTempC, 50);
        strict_1.default.equal(input.thermal?.boilerTempC, 58);
        strict_1.default.equal(input.thermal?.boilerEmptyAtUsable, false);
        strict_1.default.equal(input.thermal?.forecastTargetTempC, 51.6);
        strict_1.default.equal(input.thermal?.dayTargetTempC, 61.803);
        strict_1.default.equal(input.thermal?.pvPrechargeActive, true);
    });
});
(0, node_test_1.describe)("v0.1.268 hard bridge vs soft — Boiler Hard / Puffer Soft", () => {
    (0, node_test_1.it)("T2: Boiler über Min, Learning nicht usable → hard ~0, Soft aus Headroom", () => {
        const r = (0, next_reliable_pv_1.resolveThermalPlannerEnergy)({
            nowMs: Date.parse("2026-08-10T08:45:00.000Z"),
            bufferTempC: 54,
            boilerTempC: 58,
            minTempC: 50,
            boilerMinTempC: 50,
            bufferMaxTempC: 63,
            headroomEnergyKwh: 2.965,
            coolingRateCPerH: 1.21,
            estimatedEmptyAtMs: Date.parse("2026-08-10T18:56:50.898Z"),
            boilerEmptyAtUsable: false,
            nextReliablePvMs: Date.parse("2026-08-11T05:00:00.000Z"),
            currentWindowEndMs: Date.parse("2026-08-10T18:30:00.000Z"),
            pvConfidence01: 0.81,
        });
        strict_1.default.equal(r.coversUntilNextPv, true);
        strict_1.default.ok(r.mandatoryEnergyKwh < 0.2, `hard got ${r.mandatoryEnergyKwh}`);
        strict_1.default.ok(r.economicHeadroomKwh >= 2.7, `soft got ${r.economicHeadroomKwh}`);
    });
    (0, node_test_1.it)("T3: Boiler unter Cover mit usable Learning → hard > 0, nicht full headroom", () => {
        const r = (0, next_reliable_pv_1.resolveThermalPlannerEnergy)({
            nowMs: Date.parse("2026-08-10T16:00:00.000Z"),
            bufferTempC: 55,
            boilerTempC: 51,
            minTempC: 50,
            boilerMinTempC: 50,
            bufferMaxTempC: 63,
            headroomEnergyKwh: 2.0,
            coolingRateCPerH: 0.8,
            estimatedEmptyAtMs: Date.parse("2026-08-10T17:00:00.000Z"),
            boilerEmptyAtUsable: true,
            nextReliablePvMs: Date.parse("2026-08-11T05:00:00.000Z"),
            currentWindowEndMs: Date.parse("2026-08-10T18:30:00.000Z"),
            pvConfidence01: 0.85,
        });
        strict_1.default.equal(r.coversUntilNextPv, false);
        strict_1.default.ok(r.mandatoryEnergyKwh > 0.2, `hard got ${r.mandatoryEnergyKwh}`);
        strict_1.default.ok(r.mandatoryEnergyKwh < 2.0, `hard must not swallow full headroom`);
    });
    (0, node_test_1.it)("T6: Boiler nahe Min + usable cooling → hard shortfall vor Fensterende", () => {
        const r = (0, next_reliable_pv_1.resolveThermalPlannerEnergy)({
            nowMs: Date.parse("2026-08-10T12:00:00.000Z"),
            bufferTempC: 55,
            boilerTempC: 50.2,
            minTempC: 50,
            boilerMinTempC: 50,
            bufferMaxTempC: 63,
            headroomEnergyKwh: 1.0,
            coolingRateCPerH: 0.6,
            estimatedEmptyAtMs: Date.parse("2026-08-10T12:30:00.000Z"),
            boilerEmptyAtUsable: true,
            nextReliablePvMs: Date.parse("2026-08-11T05:00:00.000Z"),
            currentWindowEndMs: Date.parse("2026-08-10T18:00:00.000Z"),
            pvConfidence01: 0.9,
        });
        strict_1.default.ok(r.mandatoryEnergyKwh > 0.1);
        strict_1.default.equal(r.coversUntilNextPv, false);
    });
});
(0, node_test_1.describe)("v0.1.263 current PV window (T4)", () => {
    (0, node_test_1.it)("remaining current window end is used as cover — not only tomorrow", () => {
        const slots = [];
        const start = Date.parse("2026-08-10T08:45:00.000Z");
        for (let i = 0; i < 48; i++) {
            const a = new Date(start + i * 15 * 60_000).toISOString();
            const b = new Date(start + (i + 1) * 15 * 60_000).toISOString();
            const h = new Date(a).getUTCHours();
            const pv = h >= 8 && h < 18 ? 0.75 : 0;
            slots.push({
                startIso: a,
                endIso: b,
                startMs: Date.parse(a),
                pvKwh: pv,
                houseKwh: 0.1,
                importCt: 25,
            });
        }
        const endIdx = (0, next_reliable_pv_1.findEndOfCurrentSurplusWindowIdx)(slots, 0);
        strict_1.default.ok(endIdx > 1, `window end idx ${endIdx}`);
        const windowEndMs = Date.parse(slots[endIdx - 1].endIso);
        const next = (0, next_reliable_pv_1.findNextReliablePvAfterCurrentWindow)(slots, 0, 0.85, start);
        /** Cover über Fensterende: hard ~0 trotz nextPv morgen (Boiler warm, Learning nicht usable). */
        const rWindow = (0, next_reliable_pv_1.resolveThermalPlannerEnergy)({
            nowMs: start,
            bufferTempC: 54,
            boilerTempC: 58,
            minTempC: 50,
            boilerMinTempC: 50,
            bufferMaxTempC: 63,
            headroomEnergyKwh: 2.965,
            coolingRateCPerH: 1.2,
            estimatedEmptyAtMs: Date.parse("2026-08-10T18:56:50.898Z"),
            boilerEmptyAtUsable: false,
            nextReliablePvMs: next.startMs ?? Date.parse("2026-08-11T05:00:00.000Z"),
            currentWindowEndMs: windowEndMs,
            pvConfidence01: 0.85,
        });
        const rTomorrowOnly = (0, next_reliable_pv_1.resolveThermalPlannerEnergy)({
            nowMs: start,
            bufferTempC: 54,
            boilerTempC: 58,
            minTempC: 50,
            boilerMinTempC: 50,
            bufferMaxTempC: 63,
            headroomEnergyKwh: 2.965,
            coolingRateCPerH: 1.2,
            estimatedEmptyAtMs: Date.parse("2026-08-10T18:56:50.898Z"),
            boilerEmptyAtUsable: false,
            nextReliablePvMs: Date.parse("2026-08-11T05:00:00.000Z"),
            currentWindowEndMs: null,
            pvConfidence01: 0.85,
        });
        strict_1.default.equal(rWindow.coversUntilNextPv, true);
        strict_1.default.ok(rWindow.mandatoryEnergyKwh < 0.25);
        strict_1.default.ok(rTomorrowOnly.mandatoryEnergyKwh >= rWindow.mandatoryEnergyKwh, `window cover must not invent more hard than tomorrow-only path`);
    });
});
(0, node_test_1.describe)("v0.1.268 real-case regression 2026-08-10 ~10:45", () => {
    (0, node_test_1.it)("hard ≠ full 2.965; soft; no buffer-emptyAt evening pile-up", () => {
        const input = (0, from_forecast_context_1.buildUnifiedInputFromForecastContext)(realCaseContext());
        input.battery = {
            ...input.battery,
            socPct: 100,
            usableCapacityKwh: 18,
            minSocPct: 10,
            maxSocPct: 100,
            endSocTargetPct: 100,
            requiredChargeEnergyKwh: 0,
            nightReserveKwh: 2.5,
            passiveBatteryEnergyAvailable: true,
            allowedModes: input.battery.allowedModes ?? ["pv"],
            uncertainty: Q,
            freshness: {
                observedAtIso: input.time.nowIso,
                ageSec: 0,
                quality: Q,
            },
        };
        strict_1.default.equal(input.thermal?.coolingRateCPerH, null);
        strict_1.default.equal(input.thermal?.boilerTempC, 58);
        strict_1.default.equal(input.thermal?.boilerEmptyAtUsable, false);
        const plan = (0, allocate_1.allocateUnifiedDayPlan)(input);
        const ih = plan.allocations.filter((a) => a.kind === "immersion_heater");
        const evening = ih.filter((a) => new Date(a.slot.startIso).getUTCHours() >= 16);
        const early = ih.filter((a) => new Date(a.slot.startIso).getUTCHours() < 16);
        const goal = plan.goalStatuses.find((g) => g.consumerId === "immersion_heater");
        strict_1.default.ok(goal?.detailDe &&
            (goal.detailDe.includes("Soft") ||
                goal.detailDe.includes("Precharge") ||
                goal.detailDe.includes("Hard") ||
                goal.detailDe.includes("Headroom")), goal?.detailDe);
        if (ih.length >= 2) {
            strict_1.default.ok(early.length >= 1, `expected early soft placement, early=${early.length} evening=${evening.length} starts=${ih.map((a) => a.slot.startIso).join(",")}`);
        }
        strict_1.default.ok(sumIh(plan) <= 3.1);
        if (ih.length > 0) {
            const first = Date.parse(ih[0].slot.startIso);
            strict_1.default.ok(first <= Date.parse("2026-08-10T14:00:00.000Z"), `first IH should not be evening-only, got ${ih[0].slot.startIso}`);
        }
    });
});
(0, node_test_1.describe)("v0.1.263 soft upgrade when later PV disappears (T5)", () => {
    (0, node_test_1.it)("without current window hard bridge can rise vs with window", () => {
        const withPv = (0, next_reliable_pv_1.resolveThermalPlannerEnergy)({
            nowMs: Date.parse("2026-08-10T10:00:00.000Z"),
            bufferTempC: 50,
            minTempC: 48,
            headroomEnergyKwh: 1.5,
            coolingRateCPerH: 0.5,
            estimatedEmptyAtMs: Date.parse("2026-08-10T16:00:00.000Z"),
            nextReliablePvMs: Date.parse("2026-08-11T06:00:00.000Z"),
            currentWindowEndMs: Date.parse("2026-08-10T17:00:00.000Z"),
            pvConfidence01: 0.85,
        });
        const withoutWindow = (0, next_reliable_pv_1.resolveThermalPlannerEnergy)({
            nowMs: Date.parse("2026-08-10T10:00:00.000Z"),
            bufferTempC: 50,
            minTempC: 48,
            headroomEnergyKwh: 1.5,
            coolingRateCPerH: 0.5,
            estimatedEmptyAtMs: Date.parse("2026-08-10T16:00:00.000Z"),
            nextReliablePvMs: Date.parse("2026-08-11T06:00:00.000Z"),
            currentWindowEndMs: null,
            pvConfidence01: 0.85,
        });
        strict_1.default.ok(withoutWindow.mandatoryEnergyKwh >= withPv.mandatoryEnergyKwh, `without window hard ${withoutWindow.mandatoryEnergyKwh} vs with ${withPv.mandatoryEnergyKwh}`);
    });
});
(0, node_test_1.describe)("v0.1.263 consumer split ids", () => {
    (0, node_test_1.it)("exports hard/soft consumer ids", () => {
        strict_1.default.equal(score_allocate_1.IMMERSION_HARD_CONSUMER_ID, "immersion_heater");
        strict_1.default.equal(score_allocate_1.IMMERSION_SOFT_CONSUMER_ID, "immersion_heater_soft");
    });
});
