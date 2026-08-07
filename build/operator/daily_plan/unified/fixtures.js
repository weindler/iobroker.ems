"use strict";
/**
 * Golden-Szenario-Fixtures — relative Zahlen, keine Hardcodes als Produktregeln.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.golden005GoodDayPvHeat = exports.golden001ScaledBadPlan = exports.golden001ScaledInput = exports.golden005BadNightBatteryHeat = exports.golden005Input = exports.golden004StalePlanNoReplan = exports.golden004ReplanPlan = exports.golden004Input = exports.golden003GoodPv = exports.golden003BadEarlyGrid = exports.golden003Input = exports.golden002GoodPlan = exports.golden002BadPlanAbsentCharge = exports.golden002Input = exports.golden001GoodPlan = exports.golden001BadPlan = exports.golden001Input = exports.basePlan = exports.buildSlots = void 0;
const Q_OK = { status: "valid", confidencePct: 80, reasonDe: "fixture" };
const FRESH = {
    observedAtIso: "2026-08-04T00:00:00.000Z",
    ageSec: 0,
    quality: Q_OK,
};
function slot(startIso, endIso) {
    return { startIso, endIso };
}
/** 15-Min-Slots von startMs für n Stunden. */
function buildSlots(startIso, hours) {
    const start = Date.parse(startIso);
    const out = [];
    const n = hours * 4;
    for (let i = 0; i < n; i++) {
        const a = start + i * 15 * 60_000;
        const b = a + 15 * 60_000;
        out.push({ startIso: new Date(a).toISOString(), endIso: new Date(b).toISOString() });
    }
    return out;
}
exports.buildSlots = buildSlots;
function emptyTotals() {
    return {
        pvForecastEnergyKwh: null,
        fixedHouseLoadEnergyKwh: null,
        fixedRenewableBalanceKwh: null,
        flexibleRequestedEnergyKwh: null,
        flexibleAllocatedEnergyKwh: 0,
        flexibleUnallocatedEnergyKwh: null,
        pvAllocatedEnergyKwh: 0,
        gridAllocatedEnergyKwh: 0,
        batteryChargeEnergyKwh: 0,
        wallboxEnergyKwh: 0,
        immersionHeaterEnergyKwh: 0,
        airConditioningEnergyKwh: 0,
        estimatedGridCostCt: null,
        mandatoryRequestedEnergyKwh: null,
        mandatoryAllocatedEnergyKwh: 0,
        mandatoryUnallocatedEnergyKwh: null,
    };
}
function basePlan(overrides = {}) {
    return {
        schemaVersion: 1,
        planId: "fixture-plan",
        generation: 1,
        inputRevision: 1,
        createdAtIso: "2026-08-04T00:05:00.000Z",
        timezone: "Europe/Berlin",
        horizonStartIso: "2026-08-04T00:00:00.000Z",
        horizonEndIso: "2026-08-05T00:00:00.000Z",
        slotMinutes: 15,
        expectedPvEnergyKwh: null,
        expectedHouseLoadEnergyKwh: null,
        expectedGridImportEnergyKwh: null,
        expectedGridExportEnergyKwh: null,
        expectedCostCt: null,
        batteryTrajectory: [],
        allocations: [],
        goalStatuses: [],
        constraints: [],
        reasonCodes: [],
        confidence: Q_OK,
        totals: emptyTotals(),
        legacyDailyPlan: null,
        ...overrides,
    };
}
exports.basePlan = basePlan;
function pvSlotsFlat(slots, powerW) {
    const energy = (powerW / 1000) * 0.25;
    return slots.map((s) => ({
        slot: s,
        forecastPowerW: powerW,
        observedPowerW: null,
        energyKwh: energy,
    }));
}
function loadSlotsFlat(slots, powerW) {
    const energy = (powerW / 1000) * 0.25;
    return slots.map((s) => ({
        slot: s,
        forecastPowerW: powerW,
        observedPowerW: null,
        energyKwh: energy,
    }));
}
function priceSlots(slots, importCt) {
    return slots.map((s) => ({
        slot: s,
        importCtPerKwh: importCt,
        exportCtPerKwh: 9.3,
        gridImportAllowed: true,
    }));
}
/** GOLDEN-001 Input: starker PV-Tag, thermischer Headroom. */
function golden001Input() {
    const slots = buildSlots("2026-08-04T06:00:00.000Z", 12);
    const pvEnergy = slots.length * ((4000 / 1000) * 0.25);
    return {
        schemaVersion: 1,
        planIntent: "unified_day",
        time: {
            nowIso: "2026-08-04T00:05:00.000Z",
            timezone: "Europe/Berlin",
            horizonStartIso: slots[0].startIso,
            horizonEndIso: slots[slots.length - 1].endIso,
            slotMinutes: 15,
            slots,
            freshness: FRESH,
        },
        pv: {
            slots: pvSlotsFlat(slots, 4000),
            expectedDayEnergyKwh: pvEnergy,
            previousExpectedDayEnergyKwh: null,
            biasCorrected: true,
            biasPct: 5,
            uncertainty: Q_OK,
            freshness: FRESH,
        },
        prices: {
            slots: priceSlots(slots, 18),
            uncertainty: Q_OK,
            freshness: FRESH,
        },
        houseLoad: {
            slots: loadSlotsFlat(slots, 800),
            expectedDayEnergyKwh: slots.length * 0.2,
            uncertainty: Q_OK,
            freshness: FRESH,
        },
        battery: {
            socPct: 40,
            usableCapacityKwh: 10,
            minSocPct: 10,
            maxSocPct: 100,
            maxChargePowerW: 5000,
            maxDischargePowerW: 5000,
            chargeEfficiency: 0.95,
            dischargeEfficiency: 0.95,
            allowedModes: ["charge", "idle"],
            reserveSocPct: 20,
            uncertainty: Q_OK,
            freshness: FRESH,
        },
        wallbox: null,
        thermal: {
            bufferTempC: 47,
            minTempC: 44,
            maxTempC: 63,
            dayTargetTempC: 58,
            availablePowerW: 1700,
            minPowerW: 1700,
            headroomEnergyKwh: 4.2,
            estimatedEmptyAtIso: "2026-08-04T18:30:00.000Z",
            coolingRateCPerH: 1.0,
            minimumRuntimeSec: 300,
            hysteresisK: 2,
            uncertainty: Q_OK,
            freshness: FRESH,
        },
        climate: null,
        otherFlex: [],
        contributionRevision: 1,
        globalMode: "balanced",
    };
}
exports.golden001Input = golden001Input;
/** Schlechter Plan: viel Export, kaum thermische Allocation, Batterie abends voll. */
function golden001BadPlan(input) {
    const bat = [
        { slotStartIso: input.time.horizonEndIso, socPct: 95, chargeEnergyKwh: 6, dischargeEnergyKwh: 0 },
    ];
    return basePlan({
        planId: "golden-001-bad",
        expectedPvEnergyKwh: input.pv.expectedDayEnergyKwh,
        expectedHouseLoadEnergyKwh: input.houseLoad.expectedDayEnergyKwh,
        expectedGridExportEnergyKwh: 22,
        expectedGridImportEnergyKwh: 0,
        batteryTrajectory: bat,
        allocations: [
            {
                slot: slot("2026-08-04T10:00:00.000Z", "2026-08-04T10:15:00.000Z"),
                consumerId: "immersion_heater",
                kind: "immersion_heater",
                allocatedPowerW: 1700,
                allocatedEnergyKwh: 0.4,
                energySource: "pv_surplus",
                constraintIds: [],
                reasonCodes: ["TOKEN_THERMAL"],
            },
        ],
        reasonCodes: ["HIGH_EXPORT", "BATTERY_NEAR_FULL"],
    });
}
exports.golden001BadPlan = golden001BadPlan;
/** Guter Plan: thermischer Headroom weitgehend aus PV belegt, Export klein. */
function golden001GoodPlan(input) {
    const thermalSlots = [];
    const need = input.thermal.headroomEnergyKwh;
    const per = 1700 / 1000 * 0.25;
    let left = need;
    for (const s of input.time.slots) {
        if (left <= 0)
            break;
        const e = Math.min(per, left);
        thermalSlots.push({
            slot: s,
            consumerId: "immersion_heater",
            kind: "immersion_heater",
            allocatedPowerW: 1700,
            allocatedEnergyKwh: e,
            energySource: "pv_surplus",
            constraintIds: ["thermal_day_target"],
            reasonCodes: ["PREALLOCATE_PV_TO_THERMAL"],
        });
        left -= e;
    }
    return basePlan({
        planId: "golden-001-good",
        expectedPvEnergyKwh: input.pv.expectedDayEnergyKwh,
        expectedHouseLoadEnergyKwh: input.houseLoad.expectedDayEnergyKwh,
        expectedGridExportEnergyKwh: 2,
        expectedGridImportEnergyKwh: 0,
        allocations: thermalSlots,
        reasonCodes: ["PREALLOCATE_PV_TO_THERMAL"],
    });
}
exports.golden001GoodPlan = golden001GoodPlan;
/** GOLDEN-002: Fahrzeug 05:45–15:30 weg, PV später gut, Deadline Abend. */
function golden002Input() {
    const slots = buildSlots("2026-08-04T00:00:00.000Z", 24);
    const pv = slots.map((s) => {
        // UTC-Stunden als Profil-Stand-in: schwach vormittags, stark mittags (keine „mittags“-Hardcode-Regel im Produkt).
        const hh = Number(s.startIso.slice(11, 13));
        const power = hh >= 12 && hh < 16 ? 5000 : hh >= 8 && hh < 12 ? 800 : 0;
        return {
            slot: s,
            forecastPowerW: power,
            observedPowerW: null,
            energyKwh: (power / 1000) * 0.25,
        };
    });
    const prices = slots.map((s) => {
        const hh = Number(s.startIso.slice(11, 13));
        const importCt = hh >= 0 && hh < 5 ? 12 : hh >= 17 && hh < 20 ? 45 : 22;
        return {
            slot: s,
            importCtPerKwh: importCt,
            exportCtPerKwh: 9.3,
            gridImportAllowed: true,
        };
    });
    return {
        schemaVersion: 1,
        planIntent: "unified_day",
        time: {
            nowIso: "2026-08-04T00:05:00.000Z",
            timezone: "Europe/Berlin",
            horizonStartIso: slots[0].startIso,
            horizonEndIso: slots[slots.length - 1].endIso,
            slotMinutes: 15,
            slots,
            freshness: FRESH,
        },
        pv: {
            slots: pv,
            expectedDayEnergyKwh: pv.reduce((a, x) => a + (x.energyKwh ?? 0), 0),
            previousExpectedDayEnergyKwh: null,
            biasCorrected: true,
            biasPct: 0,
            uncertainty: Q_OK,
            freshness: FRESH,
        },
        prices: { slots: prices, uncertainty: Q_OK, freshness: FRESH },
        houseLoad: {
            slots: loadSlotsFlat(slots, 600),
            expectedDayEnergyKwh: 24 * 0.6,
            uncertainty: Q_OK,
            freshness: FRESH,
        },
        battery: {
            socPct: 50,
            usableCapacityKwh: 10,
            minSocPct: 10,
            maxSocPct: 100,
            maxChargePowerW: 5000,
            maxDischargePowerW: 5000,
            chargeEfficiency: 0.95,
            dischargeEfficiency: 0.95,
            allowedModes: ["charge", "idle"],
            reserveSocPct: 20,
            uncertainty: Q_OK,
            freshness: FRESH,
        },
        wallbox: {
            connectedNow: false,
            presenceWindows: [
                { available: true, startIso: "2026-08-04T00:00:00.000Z", endIso: "2026-08-04T03:45:00.000Z" }, // until 05:45 CEST = 03:45Z
                { available: false, startIso: "2026-08-04T03:45:00.000Z", endIso: "2026-08-04T13:30:00.000Z" }, // away until 15:30 CEST
                { available: true, startIso: "2026-08-04T13:30:00.000Z", endIso: "2026-08-05T00:00:00.000Z" },
            ],
            presenceHardConstraint: true,
            vehicleSocPct: 40,
            fallbackEnergyNeedKwh: null,
            vehicleCapacityKwh: 60,
            targetSocPct: 80,
            requiredEnergyKwh: 18,
            deadlineIso: "2026-08-04T22:00:00.000Z",
            energyGoalHard: true,
            minChargePowerW: 1380,
            maxChargePowerW: 11000,
            chargeLossFactor: 1.1,
            evccExecutionMaster: true,
            uncertainty: Q_OK,
            freshness: FRESH,
        },
        thermal: null,
        climate: null,
        otherFlex: [],
        contributionRevision: 1,
        globalMode: "balanced",
    };
}
exports.golden002Input = golden002Input;
function golden002BadPlanAbsentCharge() {
    return basePlan({
        planId: "golden-002-bad-absent",
        allocations: [
            {
                slot: slot("2026-08-04T10:00:00.000Z", "2026-08-04T10:15:00.000Z"),
                consumerId: "wallbox",
                kind: "wallbox",
                allocatedPowerW: 7000,
                allocatedEnergyKwh: 1.75,
                energySource: "pv_surplus",
                constraintIds: [],
                reasonCodes: ["INVALID_ABSENT_CHARGE"],
            },
        ],
    });
}
exports.golden002BadPlanAbsentCharge = golden002BadPlanAbsentCharge;
function golden002GoodPlan() {
    return basePlan({
        planId: "golden-002-good",
        allocations: [
            {
                slot: slot("2026-08-04T14:00:00.000Z", "2026-08-04T14:15:00.000Z"),
                consumerId: "wallbox",
                kind: "wallbox",
                allocatedPowerW: 7000,
                allocatedEnergyKwh: 1.75,
                energySource: "pv_surplus",
                constraintIds: ["presence"],
                reasonCodes: ["CHARGE_WHEN_PRESENT"],
            },
            {
                slot: slot("2026-08-04T01:00:00.000Z", "2026-08-04T01:15:00.000Z"),
                consumerId: "wallbox",
                kind: "wallbox",
                allocatedPowerW: 7000,
                allocatedEnergyKwh: 1.75,
                energySource: "grid",
                constraintIds: ["presence", "price_window"],
                reasonCodes: ["GRID_WINDOW_COMPARED"],
            },
        ],
        reasonCodes: ["PRESENCE_AWARE", "PRICE_WINDOWS_COMPARED"],
    });
}
exports.golden002GoodPlan = golden002GoodPlan;
/** GOLDEN-003: billiger Morgen-Netzstrom, aber genug PV vor Deadline. */
function golden003Input() {
    const input = golden002Input();
    // Ensure strong PV while present after 13:30Z and before deadline
    input.wallbox = {
        ...input.wallbox,
        connectedNow: true,
        presenceWindows: [
            { available: true, startIso: "2026-08-04T00:00:00.000Z", endIso: "2026-08-05T00:00:00.000Z" },
        ],
        requiredEnergyKwh: 8,
        deadlineIso: "2026-08-04T20:00:00.000Z",
    };
    // Boost afternoon PV energy in slots
    input.pv.slots = input.pv.slots.map((s) => {
        const hh = Number(s.slot.startIso.slice(11, 13));
        const power = hh >= 10 && hh < 16 ? 6000 : s.forecastPowerW;
        return { ...s, forecastPowerW: power, energyKwh: ((power ?? 0) / 1000) * 0.25 };
    });
    input.pv.expectedDayEnergyKwh = input.pv.slots.reduce((a, x) => a + (x.energyKwh ?? 0), 0);
    return input;
}
exports.golden003Input = golden003Input;
function golden003BadEarlyGrid() {
    return basePlan({
        planId: "golden-003-bad",
        allocations: [
            {
                slot: slot("2026-08-04T02:00:00.000Z", "2026-08-04T02:15:00.000Z"),
                consumerId: "wallbox",
                kind: "wallbox",
                allocatedPowerW: 7000,
                allocatedEnergyKwh: 5,
                energySource: "grid",
                constraintIds: [],
                reasonCodes: ["CHEAP_GRID_ONLY"],
            },
        ],
    });
}
exports.golden003BadEarlyGrid = golden003BadEarlyGrid;
function golden003GoodPv() {
    return basePlan({
        planId: "golden-003-good",
        allocations: [
            {
                slot: slot("2026-08-04T12:00:00.000Z", "2026-08-04T12:15:00.000Z"),
                consumerId: "wallbox",
                kind: "wallbox",
                allocatedPowerW: 7000,
                allocatedEnergyKwh: 8,
                energySource: "pv_surplus",
                constraintIds: ["pv_preferred"],
                reasonCodes: ["PV_BEFORE_DEADLINE"],
            },
        ],
    });
}
exports.golden003GoodPv = golden003GoodPv;
/** GOLDEN-004: Forecast kippt (40→12 kWh) — Plan muss revidierte PV + Netz-Pflicht zeigen. */
function golden004Input() {
    const input = golden001Input();
    input.pv.previousExpectedDayEnergyKwh = 40;
    input.pv.expectedDayEnergyKwh = 12;
    return input;
}
exports.golden004Input = golden004Input;
function golden004ReplanPlan() {
    return basePlan({
        planId: "golden-004-replan",
        expectedPvEnergyKwh: 12,
        allocations: [
            {
                slot: slot("2026-08-04T02:00:00.000Z", "2026-08-04T02:15:00.000Z"),
                consumerId: "immersion_heater",
                kind: "immersion_heater",
                allocatedPowerW: 1700,
                allocatedEnergyKwh: 2,
                energySource: "grid",
                constraintIds: ["deadline"],
                reasonCodes: ["DUTY_AFTER_FORECAST_COLLAPSE"],
            },
        ],
    });
}
exports.golden004ReplanPlan = golden004ReplanPlan;
/** Stale: Plan hängt noch an alter hoher PV und verschiebt keine Pflicht auf Netz. */
function golden004StalePlanNoReplan() {
    return basePlan({
        planId: "golden-004-stale",
        expectedPvEnergyKwh: 40,
        allocations: [],
    });
}
exports.golden004StalePlanNoReplan = golden004StalePlanNoReplan;
/** GOLDEN-005: Tages-PV verschwendet, Nacht Batterie→Heizstab. */
function golden005Input() {
    return golden001Input();
}
exports.golden005Input = golden005Input;
/**
 * Bad: Batterie→Heizstab in einem Slot ohne PV-Forecast (21:00Z liegt außerhalb
 * der Tages-PV-Slots von golden001 → pvPowerAtSlot=0), nach hohem Export.
 */
function golden005BadNightBatteryHeat(input) {
    return basePlan({
        planId: "golden-005-bad",
        expectedGridExportEnergyKwh: 18,
        allocations: [
            {
                slot: slot("2026-08-04T10:00:00.000Z", "2026-08-04T10:15:00.000Z"),
                consumerId: "immersion_heater",
                kind: "immersion_heater",
                allocatedPowerW: 0,
                allocatedEnergyKwh: 0.2,
                energySource: "pv_surplus",
                constraintIds: [],
                reasonCodes: ["TOKEN"],
            },
            {
                slot: slot("2026-08-04T21:00:00.000Z", "2026-08-04T21:15:00.000Z"),
                consumerId: "immersion_heater",
                kind: "immersion_heater",
                allocatedPowerW: 1700,
                allocatedEnergyKwh: 2.5,
                energySource: "battery",
                constraintIds: [],
                reasonCodes: ["HEAT_FROM_BATTERY_ZERO_PV_SLOT"],
            },
        ],
    });
}
exports.golden005BadNightBatteryHeat = golden005BadNightBatteryHeat;
/** Skaliertes 001-Szenario (andere Zahlen) — beweist Unabhängigkeit von 22 kWh / 47 °C. */
function golden001ScaledInput() {
    const input = golden001Input();
    input.thermal = {
        ...input.thermal,
        bufferTempC: 50,
        headroomEnergyKwh: 8,
        dayTargetTempC: 60,
    };
    return input;
}
exports.golden001ScaledInput = golden001ScaledInput;
function golden001ScaledBadPlan(input) {
    return basePlan({
        planId: "golden-001-scaled-bad",
        expectedPvEnergyKwh: input.pv.expectedDayEnergyKwh,
        expectedGridExportEnergyKwh: 14,
        allocations: [
            {
                slot: slot("2026-08-04T11:00:00.000Z", "2026-08-04T11:15:00.000Z"),
                consumerId: "immersion_heater",
                kind: "immersion_heater",
                allocatedPowerW: 1700,
                allocatedEnergyKwh: 0.3,
                energySource: "pv_surplus",
                constraintIds: [],
                reasonCodes: [],
            },
        ],
    });
}
exports.golden001ScaledBadPlan = golden001ScaledBadPlan;
function golden005GoodDayPvHeat(input) {
    return golden001GoodPlan(input);
}
exports.golden005GoodDayPvHeat = golden005GoodDayPvHeat;
