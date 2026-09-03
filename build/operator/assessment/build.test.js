"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const strict_1 = __importDefault(require("node:assert/strict"));
const node_test_1 = require("node:test");
const quality_1 = require("../quality");
const build_1 = require("./build");
const NOW = new Date("2026-09-03T11:00:00.000Z");
const TZ = "Europe/Berlin";
const Q = (0, quality_1.operatorQuality)("valid", "ok");
function fresh(over = {}) {
    return {
        observedAtIso: NOW.toISOString(),
        ageSec: 0,
        quality: Q,
    };
}
function slot(startIso, endIso) {
    return { startIso, endIso, durationMinutes: 15 };
}
function cell(kind, startIso, endIso, w = 700) {
    return {
        slot: slot(startIso, endIso),
        consumerId: `${kind}.1`,
        kind,
        allocatedPowerW: w,
        allocatedEnergyKwh: (w / 1000) * 0.25,
        energySource: "pv_surplus",
        constraintIds: [],
        reasonCodes: [],
    };
}
function emptyPlan(alloc = []) {
    return {
        schemaVersion: 1,
        planId: "p1",
        generation: 1,
        inputRevision: 1,
        createdAtIso: NOW.toISOString(),
        timezone: TZ,
        horizonStartIso: "2026-09-03T00:00:00.000Z",
        horizonEndIso: "2026-09-04T22:00:00.000Z",
        globalMode: "balanced",
        allocations: alloc,
        constraints: [],
        goalStatuses: [],
        reasonCodes: ["battery_night_reserve"],
        reasonDe: "ok",
        totals: {
            expectedPvKwh: 12,
            expectedHouseLoadKwh: 10,
            plannedFlexKwh: 0,
            plannedGridImportKwh: 0,
            plannedFeedInKwh: 2,
        },
    };
}
function planner(over = {}) {
    return {
        schemaVersion: 1,
        planIntent: "unified_day",
        time: {
            nowIso: NOW.toISOString(),
            timezone: TZ,
            horizonStartIso: "2026-09-03T00:00:00.000Z",
            horizonEndIso: "2026-09-04T22:00:00.000Z",
            slotMinutes: 15,
            slots: [],
            freshness: fresh(),
        },
        pv: {
            slots: [],
            expectedDayEnergyKwh: 12,
            previousExpectedDayEnergyKwh: null,
            biasCorrected: true,
            biasPct: null,
            uncertainty: Q,
            freshness: fresh(),
        },
        prices: { slots: [], uncertainty: Q, freshness: fresh() },
        houseLoad: { slots: [], expectedDayEnergyKwh: 10, uncertainty: Q, freshness: fresh() },
        battery: {
            socPct: 100,
            usableCapacityKwh: 20,
            minSocPct: 10,
            maxSocPct: 100,
            maxChargePowerW: 5000,
            maxDischargePowerW: 5000,
            chargeEfficiency: 0.95,
            dischargeEfficiency: 0.95,
            allowedModes: ["charge"],
            reserveSocPct: 20,
            nightReserveKwh: 3,
            profileId: null,
            dischargeLiveSupported: false,
            passiveBatteryEnergyAvailable: true,
            requiredChargeEnergyKwh: null,
            endSocTargetPct: null,
            chargeDeadlineIso: null,
            uncertainty: Q,
            freshness: fresh(),
        },
        wallbox: {
            connectedNow: false,
            presenceWindows: [],
            presenceHardConstraint: true,
            vehicleProfileId: null,
            vehicleSocPct: 77,
            socSource: "evcc",
            fallbackEnergyNeedKwh: null,
            vehicleCapacityKwh: 60,
            targetSocPct: 80,
            requiredEnergyKwh: 0.1,
            deadlineIso: null,
            energyGoalHard: false,
            minChargePowerW: 1400,
            maxChargePowerW: 11000,
            chargeLossFactor: 1,
            evccExecutionMaster: true,
            evccChargeMode: "pv",
            uncertainty: Q,
            freshness: fresh(),
        },
        thermal: {
            bufferTempC: 62.3,
            boilerTempC: 67,
            minTempC: 45,
            boilerMinTempC: 45,
            maxTempC: 63,
            dayTargetTempC: 62.7,
            availablePowerW: 3000,
            minPowerW: 500,
            headroomEnergyKwh: 0,
            estimatedEmptyAtIso: null,
            deadlineIso: null,
            emptyAtSource: null,
            nightBridgeActive: false,
            coolingRateCPerH: null,
            minimumRuntimeSec: null,
            hysteresisK: 3,
            reheatHysteresisActive: true,
            uncertainty: Q,
            freshness: fresh(),
        },
        climate: { units: [], freshness: fresh() },
        otherFlex: [],
        contributionRevision: 1,
        globalMode: "balanced",
        ...over,
    };
}
function priceDay(dateKey, hours) {
    return hours.map(([h, ct]) => ({
        slot: {
            startIso: `${dateKey}T${String(h).padStart(2, "0")}:00:00.000Z`,
            endIso: `${dateKey}T${String(h).padStart(2, "0")}:15:00.000Z`,
            durationMinutes: 15,
        },
        importCtPerKwh: ct,
        exportCtPerKwh: 8,
        gridImportAllowed: true,
    }));
}
function climateContrib(over = {}) {
    return {
        contributionId: "air_conditioning.unit_1",
        contributor: { kind: "addon", id: "air_conditioning" },
        flow: "consume",
        roles: ["demand_flex"],
        generatedAt: NOW.toISOString(),
        validUntil: null,
        revision: 1,
        enabled: true,
        flexible: true,
        gridEligible: true,
        quality: Q,
        reasonDe: "Kein Climate-Bedarf.",
        details: {
            unitIndex: 1,
            unitName: "Wohnzimmer",
            unitEnabled: true,
            likelyActive: false,
            coolingHours: 0,
            heatingHours: 0,
            dehumidifyHours: 0,
            roomHumidityPct: 50,
            maxHumidityPct: 60,
            ...over,
        },
        slots: [],
    };
}
function base(over = {}) {
    return {
        now: NOW,
        timezone: TZ,
        plan: emptyPlan(),
        plannerInput: planner(),
        contributions: [climateContrib(), climateContrib({ unitIndex: 2, unitName: "Josef" })],
        strategy: {
            schemaVersion: 1,
            generatedAtIso: NOW.toISOString(),
            battery: {
                status: "reserve_protected",
                labelDe: "Reserve geschützt",
                reasonDe: "voll",
                summaryDe: "Reserve geschützt · SOC 100 %",
                hasChargeAllocation: false,
                socPct: 100,
                nightReserveKwh: 3,
            },
            wallbox: {
                status: "waiting_for_vehicle",
                labelDe: "Wartet auf Fahrzeug",
                reasonDe: "getrennt",
                summaryDe: "Wartet auf Fahrzeug",
                hasChargeAllocation: false,
                connectedNow: false,
                deadlineIso: null,
            },
        },
        pvTodayKwh: 12,
        pvTomorrowKwh: 28,
        weatherTodayMinC: 15,
        weatherTodayMaxC: 24,
        weatherTomorrowMinC: 15,
        weatherTomorrowMaxC: 28,
        surplusW: 2500,
        priceNowCt: 18.8,
        gb: {
            enabled: true,
            active: false,
            ready: true,
            priceAllowed: false,
            blockReason: "price_below_min",
            requestedPowerW: 0,
            minPriceCt: 30,
            currentPriceCt: 18.8,
        },
        immersion: {
            boilerTempC: 67,
            bufferTempC: 62.3,
            targetTempC: 62.7,
            maxTempC: 63,
            boilerMinC: 45,
            hygieneDue: false,
            forced: false,
            autoTargetReached: true,
            requiredFlexKwh: 0.3,
            mode: "auto",
        },
        ...over,
    };
}
(0, node_test_1.describe)("buildOperationalAssessment", () => {
    (0, node_test_1.it)("Produktionsbeispiel: voll, Ziel erreicht, Auto getrennt, GB preisgesperrt", () => {
        const a = (0, build_1.buildOperationalAssessment)(base());
        strict_1.default.match(a.ev.text, /kein Laden/i);
        strict_1.default.match(a.ev.text, /77/);
        strict_1.default.match(a.ev.text, /80/);
        strict_1.default.match(a.ev.next ?? "", /PV|neu bewertet|morgen/i);
        strict_1.default.match(a.immersion.text, /Zieltemperatur erreicht/);
        strict_1.default.doesNotMatch(a.immersion.text, /0,3 kWh/);
        strict_1.default.match(a.climate.units[0].cooling, /keine Kühlung/);
        strict_1.default.match(a.climate.units[0].dehumidify, /nicht erforderlich/);
        strict_1.default.equal(a.climate.units[0].heating, null);
        strict_1.default.match(a.battery.text, /100/);
        strict_1.default.match(a.battery.text, /Nachtreserve|eingespeist/);
        strict_1.default.match(a.gridBalance.text, /gesperrt/);
        strict_1.default.match(a.gridBalance.text, /Freigabegrenze/);
        strict_1.default.equal(a.gridBalance.status, "blocked");
        strict_1.default.match(a.forecast.text, /28/);
        strict_1.default.doesNotMatch(JSON.stringify(a), /mandatory|demand_model|expectedKwh=/);
    });
    (0, node_test_1.it)("EV Pflichtladung heute widerspricht nicht dem Text", () => {
        const a = (0, build_1.buildOperationalAssessment)(base({
            plan: emptyPlan([cell("wallbox", "2026-09-03T14:00:00.000Z", "2026-09-03T14:15:00.000Z")]),
            plannerInput: planner({
                wallbox: {
                    ...planner().wallbox,
                    requiredEnergyKwh: 8,
                    energyGoalHard: true,
                    connectedNow: true,
                    vehicleSocPct: 40,
                    targetSocPct: 80,
                },
            }),
        }));
        strict_1.default.match(a.ev.text, /Pflichtladung|Ladefenster/);
        strict_1.default.doesNotMatch(a.ev.text, /kein Laden nötig/);
    });
    (0, node_test_1.it)("EV: zukünftige Preise unbekannt → keine Billiger-übermorgen-Behauptung", () => {
        const a = (0, build_1.buildOperationalAssessment)(base({
            pvTomorrowKwh: null,
            plannerInput: planner({
                wallbox: { ...planner().wallbox, requiredEnergyKwh: 6, connectedNow: true, vehicleSocPct: 50 },
                prices: { slots: [], uncertainty: Q, freshness: fresh() },
            }),
        }));
        strict_1.default.doesNotMatch(a.ev.text + (a.ev.next ?? ""), /übermorgen|billiger als morgen/i);
        strict_1.default.match(a.ev.next ?? "", /neu bewertet/);
    });
    (0, node_test_1.it)("EV: günstiger Preis morgen nur bei belastbarem Horizon", () => {
        const hours = Array.from({ length: 12 }, (_, i) => [i, 28]);
        const cheap = Array.from({ length: 12 }, (_, i) => [i, i === 2 ? 12 : 22]);
        const a = (0, build_1.buildOperationalAssessment)(base({
            pvTomorrowKwh: 8,
            plannerInput: planner({
                wallbox: { ...planner().wallbox, requiredEnergyKwh: 5, connectedNow: true, vehicleSocPct: 55 },
                prices: {
                    slots: [...priceDay("2026-09-03", hours), ...priceDay("2026-09-04", cheap)],
                    uncertainty: Q,
                    freshness: fresh(),
                },
            }),
        }));
        strict_1.default.match(a.ev.next ?? "", /Günstigeres Fenster morgen/);
    });
    (0, node_test_1.it)("Heizstab Forced / Hygiene / Flex", () => {
        strict_1.default.match((0, build_1.buildOperationalAssessment)(base({ immersion: { ...base().immersion, forced: true } })).immersion.text, /Zwang/);
        strict_1.default.match((0, build_1.buildOperationalAssessment)(base({ immersion: { ...base().immersion, hygieneDue: true, autoTargetReached: false } }))
            .immersion.text, /Hygiene/);
        const flex = (0, build_1.buildOperationalAssessment)(base({
            immersion: { ...base().immersion, autoTargetReached: false, bufferTempC: 50, targetTempC: 62, requiredFlexKwh: 2 },
        }));
        strict_1.default.match(flex.immersion.text, /Flexibler|kein fahrbares Fenster/);
    });
    (0, node_test_1.it)("Climate Cooling / Pre-Cool / Dry / Heating disabled vs enabled", () => {
        const climateSlot = cell("climate", "2026-09-03T14:00:00.000Z", "2026-09-03T14:15:00.000Z", 800);
        climateSlot.consumerId = "air_conditioning.unit_1";
        const cool = (0, build_1.buildOperationalAssessment)(base({
            plan: emptyPlan([climateSlot]),
            contributions: [
                climateContrib({ likelyActive: true, coolingHours: 2.5, reasonDe: "aktueller Kühlbedarf" }),
            ],
        }));
        strict_1.default.match(cool.climate.units[0].cooling, /Kühlung heute vorgesehen/);
        const pre = (0, build_1.buildOperationalAssessment)(base({
            plan: emptyPlan([climateSlot]),
            contributions: [
                climateContrib({
                    likelyActive: true,
                    coolingHours: 1.2,
                    reasonDe: "Raum nähert sich 26 °C — vorsichtiges Pre-Cooling",
                }),
            ],
        }));
        strict_1.default.match(pre.climate.units[0].cooling, /Pre-Cooling/);
        const dry = (0, build_1.buildOperationalAssessment)(base({
            plan: emptyPlan([climateSlot]),
            contributions: [
                climateContrib({
                    likelyActive: true,
                    dehumidifyHours: 1,
                    coolingHours: 0,
                    roomHumidityPct: 68,
                    reasonDe: "aktueller Dry-Bedarf",
                }),
            ],
        }));
        strict_1.default.match(dry.climate.units[0].dehumidify, /68 %/);
        const heatOn = (0, build_1.buildOperationalAssessment)(base({
            contributions: [climateContrib({ heatSetpointC: 20, heatingHours: 0, likelyActive: false })],
        }));
        strict_1.default.equal(heatOn.climate.units[0].heating, "Kein Climate-Heizbedarf.");
        const heatOff = (0, build_1.buildOperationalAssessment)(base());
        strict_1.default.equal(heatOff.climate.units[0].heating, null);
    });
    (0, node_test_1.it)("Batterie Hold / Entladung / GB aktiv vs Hard-Gate", () => {
        const hold = (0, build_1.buildOperationalAssessment)(base({
            strategy: {
                ...base().strategy,
                battery: { ...base().strategy.battery, status: "hold", summaryDe: "Hold" },
            },
        }));
        strict_1.default.match(hold.battery.text, /Halt/);
        const dis = (0, build_1.buildOperationalAssessment)(base({
            plannerInput: planner({ battery: { ...planner().battery, socPct: 70 } }),
            strategy: {
                ...base().strategy,
                battery: { ...base().strategy.battery, status: "available_for_discharge", socPct: 70 },
            },
        }));
        strict_1.default.match(dis.battery.text, /Entladung/);
        const gbOn = (0, build_1.buildOperationalAssessment)(base({ gb: { ...base().gb, active: true, priceAllowed: true, requestedPowerW: 800 } }));
        strict_1.default.equal(gbOn.gridBalance.status, "active");
        strict_1.default.match(gbOn.gridBalance.text, /aktiv/);
        const blocked = (0, build_1.buildOperationalAssessment)(base());
        strict_1.default.equal(blocked.gridBalance.status, "blocked");
        const hard = (0, build_1.buildOperationalAssessment)(base({
            gb: {
                ...base().gb,
                priceAllowed: true,
                ready: false,
                active: false,
                requestedPowerW: 0,
                blockReason: "mapping_stale",
            },
        }));
        strict_1.default.equal(hard.gridBalance.status, "blocked");
        strict_1.default.match(hard.gridBalance.text, /technische Freigabe|gesperrt/i);
        const idleGb = (0, build_1.buildOperationalAssessment)(base({
            gb: {
                ...base().gb,
                priceAllowed: true,
                ready: true,
                active: false,
                requestedPowerW: 0,
                blockReason: "",
            },
        }));
        strict_1.default.equal(idleGb.gridBalance.status, "idle");
        strict_1.default.match(idleGb.gridBalance.text, /bereit|kein Abruf/i);
    });
    (0, node_test_1.it)("Heizstab Boiler-Min", () => {
        const a = (0, build_1.buildOperationalAssessment)(base({
            immersion: {
                ...base().immersion,
                autoTargetReached: false,
                boilerTempC: 46,
                boilerMinC: 45,
                bufferTempC: 50,
                targetTempC: 62,
            },
        }));
        strict_1.default.match(a.immersion.text, /nähert sich der Untergrenze/);
    });
    (0, node_test_1.it)("Konsistenz: keine Kühlung-Text wenn Cooling-Stunden geplant", () => {
        const climateSlot = cell("climate", "2026-09-03T14:00:00.000Z", "2026-09-03T16:00:00.000Z", 800);
        climateSlot.consumerId = "air_conditioning.unit_1";
        const a = (0, build_1.buildOperationalAssessment)(base({
            plan: emptyPlan([climateSlot]),
            contributions: [climateContrib({ likelyActive: true, coolingHours: 4 })],
        }));
        strict_1.default.doesNotMatch(a.climate.units[0].cooling, /keine Kühlung/);
        strict_1.default.match(a.climate.units[0].cooling, /Kühlung heute vorgesehen/);
    });
    (0, node_test_1.it)("Konsistenz: Kühlbedarf ohne Plan-Allocation nicht als geplant ausgeben", () => {
        const a = (0, build_1.buildOperationalAssessment)(base({
            contributions: [climateContrib({ likelyActive: true, coolingHours: 4 })],
        }));
        strict_1.default.match(a.climate.units[0].cooling, /kein Kühlfenster im Plan/);
        strict_1.default.doesNotMatch(a.climate.units[0].cooling, /Kühlung heute vorgesehen/);
    });
    (0, node_test_1.it)("EV getrennt mit Restbedarf", () => {
        const a = (0, build_1.buildOperationalAssessment)(base({
            pvTomorrowKwh: 22,
            plannerInput: planner({
                wallbox: {
                    ...planner().wallbox,
                    connectedNow: false,
                    vehicleSocPct: 55,
                    targetSocPct: 80,
                    requiredEnergyKwh: 12,
                },
            }),
        }));
        strict_1.default.match(a.ev.text, /nicht angesteckt/);
        strict_1.default.doesNotMatch(a.ev.text, /kein Laden nötig/);
        strict_1.default.match(a.ev.next ?? "", /PV|neu bewertet|Auto da/i);
    });
    (0, node_test_1.it)("Konsistenz: heute nicht laden nur ohne heutigen Wallbox-Slot", () => {
        const idle = (0, build_1.buildOperationalAssessment)(base());
        strict_1.default.match(idle.ev.text, /kein Laden/);
        const planned = (0, build_1.buildOperationalAssessment)(base({
            plan: emptyPlan([cell("wallbox", "2026-09-03T15:00:00.000Z", "2026-09-03T15:15:00.000Z")]),
        }));
        strict_1.default.doesNotMatch(planned.ev.text, /kein Laden nötig/);
    });
    (0, node_test_1.it)("Nutzersprache ohne Entwicklerfelder", () => {
        const de = (0, build_1.formatOperationalAssessmentDe)((0, build_1.buildOperationalAssessment)(base()));
        strict_1.default.match(de, /EMS-Einschätzung/);
        strict_1.default.match(de, /Auto:/);
        strict_1.default.match(de, /Heizstab:/);
        strict_1.default.doesNotMatch(de, /mandatory=|demand_model|expectedKwh=|ready=false/);
    });
});
