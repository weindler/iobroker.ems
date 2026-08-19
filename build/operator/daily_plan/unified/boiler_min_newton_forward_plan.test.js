"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
/**
 * One-Plan-Kernfall: Boiler am Minimum, nur Newton-Modell (keine abgeschlossenen Zyklen),
 * frisch überfälliges estimated_empty_at (Boiler erreicht Minimum gerade jetzt). PV-Überschuss
 * jetzt vorhanden, danach Nacht ohne PV. Der Planner muss den Heizstab JETZT priorisieren
 * (Vorplanen), statt "ohne emptyAt" auf 0 zu fallen und Klima den ganzen Überschuss geben zu
 * lassen. Integrationsebene für die Kette Contribution-Details → Unified-Bridge → Allocator
 * (die feingranulare Learning→Contribution-Ableitung ist separat in thermal_learning.test.ts
 * und flexible.test.ts abgedeckt — dort schlagen die Tests ohne die jeweiligen Fixes fehl).
 */
const strict_1 = __importDefault(require("node:assert/strict"));
const node_test_1 = require("node:test");
const contribution_ids_1 = require("../../contribution_ids");
const quality_1 = require("../../quality");
const types_1 = require("../../contributions/types");
const contributor_1 = require("../../contributor");
const allocate_1 = require("./allocate");
const from_forecast_context_1 = require("./from_forecast_context");
const Q = (0, quality_1.operatorQuality)("valid", "test", 80);
const TZ = "Europe/Berlin";
/** 16:00 Ortszeit (CEST, UTC+2) — genau der Nutzer-Realfall. */
const NOW = new Date("2026-08-19T14:00:00.000Z");
function contrib(id, details) {
    const contributor = id.startsWith("immersion")
        ? (0, contributor_1.addonContributorRef)("immersion_heater")
        : id.startsWith("air_conditioning")
            ? (0, contributor_1.addonContributorRef)("air_conditioning")
            : id === contribution_ids_1.CONTRIBUTION_IDS.PV_SUPPLY
                ? (0, types_1.pvContributorRef)()
                : id === contribution_ids_1.CONTRIBUTION_IDS.HOUSE_LOAD_FIXED
                    ? (0, contributor_1.systemContributorRef)("house_load")
                    : (0, contributor_1.systemContributorRef)("grid_supply");
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
    });
}
/**
 * PV-Überschuss jetzt (~16:00–18:00 Ortszeit), dann Nacht ohne PV, nächster verlässlicher
 * PV-Slot erst morgen ab ~08:00 Ortszeit — exakt das Nutzer-Szenario ("es ist 16 Uhr, dann
 * kommt die Nacht, da habe ich keine PV").
 */
function buildContext(overrideIhDetails, withCompetingClimate = false) {
    const slots = [];
    const start = Date.parse(NOW.toISOString());
    for (let i = 0; i < 96; i++) {
        const a = new Date(start + i * 15 * 60_000).toISOString();
        const b = new Date(start + (i + 1) * 15 * 60_000).toISOString();
        const h = new Date(a).getUTCHours();
        // UTC 14-16 == CEST 16-18 (Rest-PV heute); UTC 6-14 morgen == CEST 8-16 (PV morgen).
        const isTodayEveningPv = i < 8; // erste 2h ab NOW
        const isTomorrowMorningPv = h >= 6 && h < 14 && i >= 8;
        const pv = isTodayEveningPv ? 3000 : isTomorrowMorningPv ? 3500 : 0;
        const house = 400;
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
            validUntil: new Date(start + 48 * 3600_000).toISOString(),
            revision: 1,
            timezone: TZ,
            horizonStart: NOW.toISOString(),
            horizonEnd: slots[slots.length - 1].slot.endIso,
            slotMinutes: 15,
            status: "ready",
            reasonDe: "test",
            quality: Q,
            days: [
                {
                    date: "2026-08-19",
                    pvEnergyKwh: 26.7,
                    houseLoadEnergyKwh: 13,
                    renewableBalanceKwh: 13.7,
                    weatherMinTempC: null,
                    weatherMaxTempC: null,
                    quality: Q,
                    reasonDe: "test",
                },
            ],
            slots,
            contributions: [
                contrib(contribution_ids_1.CONTRIBUTION_IDS.PV_SUPPLY, { correctedTodayKwh: 26.7, rawTodayKwh: 26.7 }),
                contrib(contribution_ids_1.CONTRIBUTION_IDS.HOUSE_LOAD_FIXED, {}),
                contrib(contribution_ids_1.CONTRIBUTION_IDS.GRID_SUPPLY, {}),
                contrib(contribution_ids_1.CONTRIBUTION_IDS.IMMERSION_FLEXIBLE, {
                    bufferTempC: 50,
                    boilerTempC: 50,
                    boilerMinTempC: 50,
                    targetTempC: 52.8,
                    forecastTargetTempC: 52.8,
                    planningMinTempC: 44,
                    mandatoryMinTempC: 50,
                    planningMaxTempC: 63,
                    requiredEnergyKwh: 5.8,
                    maxPowerW: 1700,
                    minPowerW: 1700,
                    pvPrechargeActive: false,
                    coolingRateCPerHAvg: null,
                    coolingConstantPerH: 0.00477,
                    coolingAsymptoteC: 18,
                    bufferEstimatedEmptyAt: null,
                    boilerSensorDegraded: false,
                    thermalLearningStatus: "missing",
                    thermalLearningModel: "newton",
                    nightBridgeActive: false,
                    ...overrideIhDetails,
                }),
                ...(withCompetingClimate
                    ? [
                        contrib(contribution_ids_1.CONTRIBUTION_IDS.AC_UNIT(1), {
                            name: "unit_1",
                            roomTempC: 27,
                            onTempC: 26,
                            offTempC: 24,
                            /** Mandatory comfort (room >= onTemp) — konkurriert real um denselben PV-Überschuss. */
                            estimatedPowerW: 2500,
                            expectedKwhToday: 5,
                        }),
                    ]
                    : []),
            ],
            activeContributors: [],
            excludedContributors: [],
        },
        observedPvPowerW: 3000,
        observedHouseLoadPowerW: 400,
        observedPvAgeSec: 5,
        observedHouseAgeSec: 5,
        feedInCtPerKwh: 9.3,
        preferImmersionLiveSurplusNow: true,
        passiveBatteryEnergyAvailable: true,
    };
}
function sumIhKwh(plan) {
    return plan.allocations
        .filter((a) => a.kind === "immersion_heater")
        .reduce((s, a) => s + a.allocatedEnergyKwh, 0);
}
(0, node_test_1.describe)("Boiler-Minimum + Newton-only (One-Plan-Kernfall — Vorplanen vor Nacht ohne PV)", () => {
    (0, node_test_1.it)("boiler AT minimum with usable Newton emptyAt: immersion heater gets a hard slot now, not zero", () => {
        const emptyAtIso = new Date(NOW.getTime() - 4 * 60_000).toISOString(); // frisch überfällig (Boiler jetzt am Min)
        const context = buildContext({
            boilerEstimatedEmptyAt: emptyAtIso,
            estimatedEmptyAt: emptyAtIso,
            emptyAtSource: "estimated",
            emptyAtPlanningUsable: true,
        });
        const input = (0, from_forecast_context_1.buildUnifiedInputFromForecastContext)(context);
        // Bridge muss die überfällige, aber frische Schätzung als usable durchreichen.
        strict_1.default.equal(input.thermal?.boilerEmptyAtUsable, true);
        strict_1.default.equal(input.thermal?.boilerTempC, 50);
        const plan = (0, allocate_1.allocateUnifiedDayPlan)(input);
        const ih = plan.allocations.filter((a) => a.kind === "immersion_heater");
        strict_1.default.ok(sumIhKwh(plan) > 0, `expected immersion heater energy > 0, got ${sumIhKwh(plan)}`);
        // Muss JETZT (im aktuellen PV-Fenster, vor der Nacht) geplant werden — Vorplanen, kein
        // "wartet auf geplanten Slot" bis morgen.
        const nowWindowIh = ih.filter((a) => Date.parse(a.slot.startIso) < NOW.getTime() + 2 * 3600_000);
        strict_1.default.ok(nowWindowIh.length > 0, `expected immersion heater allocation within the current PV window before night, starts=${ih.map((a) => a.slot.startIso).join(",")}`);
    });
    (0, node_test_1.it)("without usable emptyAt (regression guard): boiler-at-min hard guard still forces a minimal slot", () => {
        const context = buildContext({
            boilerEstimatedEmptyAt: null,
            estimatedEmptyAt: null,
            emptyAtSource: null,
            emptyAtPlanningUsable: false,
        });
        const input = (0, from_forecast_context_1.buildUnifiedInputFromForecastContext)(context);
        strict_1.default.equal(input.thermal?.boilerEmptyAtUsable, false);
        const plan = (0, allocate_1.allocateUnifiedDayPlan)(input);
        strict_1.default.ok(sumIhKwh(plan) > 0, `hard guard (boilerAtOrNearMinNow) must still force a slot`);
    });
    (0, node_test_1.it)("boiler-min Pflicht must not be starved to zero by a competing mandatory-comfort climate unit", () => {
        const emptyAtIso = new Date(NOW.getTime() - 4 * 60_000).toISOString();
        const context = buildContext({
            boilerEstimatedEmptyAt: emptyAtIso,
            estimatedEmptyAt: emptyAtIso,
            emptyAtSource: "estimated",
            emptyAtPlanningUsable: true,
        }, true);
        const input = (0, from_forecast_context_1.buildUnifiedInputFromForecastContext)(context);
        const plan = (0, allocate_1.allocateUnifiedDayPlan)(input);
        const ihKwh = sumIhKwh(plan);
        const acKwh = plan.allocations
            .filter((a) => a.kind === "climate")
            .reduce((s, a) => s + a.allocatedEnergyKwh, 0);
        strict_1.default.ok(ihKwh > 0, `Boiler-Minimum ist Pflichtbedarf (Lastenheft §5.4) — darf nicht auf 0 fallen, nur weil Klima gleichzeitig will (AC=${acKwh} kWh, IH=${ihKwh} kWh)`);
    });
});
