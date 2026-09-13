"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const strict_1 = __importDefault(require("node:assert/strict"));
const node_test_1 = require("node:test");
const allocate_1 = require("./daily_plan/unified/allocate");
const fixtures_1 = require("./daily_plan/unified/fixtures");
const outlook_72h_1 = require("./outlook_72h");
const NOW = new Date("2026-09-03T00:00:00.000Z");
function input80h(withMissingPv = false) {
    const base = (0, fixtures_1.golden001Input)();
    const slots = (0, fixtures_1.buildSlots)(NOW.toISOString(), 80);
    return {
        ...base,
        time: {
            ...base.time,
            nowIso: NOW.toISOString(),
            timezone: "UTC",
            horizonStartIso: slots[0].startIso,
            horizonEndIso: slots[slots.length - 1].endIso,
            slots,
        },
        pv: {
            ...base.pv,
            slots: slots.map((slot, index) => ({
                slot,
                forecastPowerW: withMissingPv && index === 100 ? null : 1000,
                observedPowerW: null,
                energyKwh: withMissingPv && index === 100 ? null : 0.25,
            })),
        },
        houseLoad: {
            ...base.houseLoad,
            slots: slots.map((slot) => ({
                slot,
                forecastPowerW: 500,
                observedPowerW: null,
                energyKwh: 0.125,
            })),
        },
        prices: {
            ...base.prices,
            slots: slots.map((slot) => ({
                slot,
                importCtPerKwh: 20,
                exportCtPerKwh: 8,
                gridImportAllowed: true,
            })),
        },
        thermal: null,
        wallbox: null,
        climate: null,
        otherFlex: [],
    };
}
function multiDayThermalInput(args) {
    const input = input80h();
    const startMs = NOW.getTime();
    input.pv.slots = input.time.slots.map((slot) => {
        const slotMs = Date.parse(slot.startIso);
        const day = Math.floor((slotMs - startMs) / 86_400_000);
        const hour = new Date(slotMs).getUTCHours();
        const daylight = hour >= 9 && hour < 15;
        const powerW = !daylight
            ? 0
            : day === 0
                ? args.todayPvW
                : day === 1
                    ? args.tomorrowPvW
                    : day === 2
                        ? args.dayAfterPvW
                        : 0;
        return {
            slot,
            forecastPowerW: powerW,
            observedPowerW: null,
            energyKwh: powerW / 4000,
        };
    });
    input.houseLoad.slots = input.time.slots.map((slot) => ({
        slot,
        forecastPowerW: 500,
        observedPowerW: null,
        energyKwh: 0.125,
    }));
    input.pv.expectedDayEnergyKwh = input.pv.slots
        .filter((slot) => slot.slot.startIso < "2026-09-04T00:00:00.000Z")
        .reduce((sum, slot) => sum + (slot.energyKwh ?? 0), 0);
    input.battery = {
        ...input.battery,
        socPct: 100,
        minSocPct: 10,
        reserveSocPct: 10,
        endSocTargetPct: 100,
        requiredChargeEnergyKwh: 0,
        passiveBatteryEnergyAvailable: false,
    };
    input.thermal = {
        bufferTempC: 58,
        boilerTempC: 60,
        minTempC: 50,
        boilerMinTempC: 50,
        maxTempC: 65,
        dayTargetTempC: 63,
        availablePowerW: 1700,
        minPowerW: 1700,
        headroomEnergyKwh: 0.85,
        estimatedEmptyAtIso: args.emptyAtIso,
        deadlineIso: args.emptyAtIso,
        emptyAtSource: "estimated",
        boilerEmptyAtUsable: false,
        hygieneMandatoryKwh: 0,
        hygieneDue: false,
        nightBridgeActive: false,
        mayUseBatteryForImmersion: false,
        coolingRateCPerH: 0.15,
        minimumRuntimeSec: 300,
        hysteresisK: 2,
        reheatHysteresisActive: false,
        uncertainty: input.pv.uncertainty,
        freshness: input.pv.freshness,
    };
    return input;
}
(0, node_test_1.describe)("operator rolling 72 h outlook", () => {
    (0, node_test_1.it)("caps the authoritative horizon at 72 h and exposes complete per-day data", () => {
        const input = input80h();
        const plan = (0, allocate_1.allocateUnifiedDayPlan)(input);
        const outlook = (0, outlook_72h_1.buildOperatorOutlook72h)({ now: NOW, timezone: "UTC", plan, plannerInput: input });
        strict_1.default.equal(outlook.status, "ready");
        strict_1.default.equal(outlook.complete, true);
        strict_1.default.equal(outlook.coveredHours, 72);
        strict_1.default.deepEqual(outlook.coverageHours, { timeline: 72, pv: 72, houseLoad: 72, price: 72 });
        strict_1.default.equal(outlook.horizonEndIso, "2026-09-06T00:00:00.000Z");
        strict_1.default.deepEqual(outlook.days.map((day) => day.dateKey), ["2026-09-03", "2026-09-04", "2026-09-05"]);
        strict_1.default.equal(outlook.days[0].expectedPvKwh, 24);
        strict_1.default.equal(outlook.days[0].expectedHouseLoadKwh, 12);
        strict_1.default.equal(outlook.days[0].priceCtPerKwh.complete, true);
        strict_1.default.match((0, outlook_72h_1.formatOperatorOutlook72hDe)(outlook), /72-h-Ausblick/);
    });
    (0, node_test_1.it)("keeps a partially missing PV day null instead of fabricating a full sum", () => {
        const input = input80h(true);
        const plan = (0, allocate_1.allocateUnifiedDayPlan)(input);
        const outlook = (0, outlook_72h_1.buildOperatorOutlook72h)({ now: NOW, timezone: "UTC", plan, plannerInput: input });
        strict_1.default.equal(outlook.days[1].expectedPvKwh, null);
        strict_1.default.equal(outlook.days[1].pvKnownSlots, 95);
        strict_1.default.equal(outlook.coverageHours.pv, 71.75);
        strict_1.default.equal(outlook.status, "partial");
        strict_1.default.equal(outlook.complete, false);
        strict_1.default.ok(outlook.reasonCodes.includes("forecast_values_incomplete"));
    });
    (0, node_test_1.it)("counts real slot coverage and reports a gap as partial", () => {
        const input = input80h();
        input.time.slots = input.time.slots.filter((_, index) => index !== 120);
        const plan = (0, allocate_1.allocateUnifiedDayPlan)(input);
        const outlook = (0, outlook_72h_1.buildOperatorOutlook72h)({ now: NOW, timezone: "UTC", plan, plannerInput: input });
        strict_1.default.equal(outlook.coveredHours, 71.75);
        strict_1.default.equal(outlook.status, "partial");
        strict_1.default.ok(outlook.reasonCodes.includes("forecast_horizon_shorter_than_72h"));
    });
    (0, node_test_1.it)("reports unavailable without inventing a plan", () => {
        const outlook = (0, outlook_72h_1.buildOperatorOutlook72h)({
            now: NOW,
            timezone: "Europe/Berlin",
            plan: null,
            plannerInput: null,
        });
        strict_1.default.equal(outlook.status, "unavailable");
        strict_1.default.equal(outlook.coveredHours, 0);
        strict_1.default.deepEqual(outlook.coverageHours, { timeline: 0, pv: 0, houseLoad: 0, price: 0 });
        strict_1.default.deepEqual(outlook.days, []);
        strict_1.default.deepEqual(outlook.decisions, []);
    });
    (0, node_test_1.it)("waits through a weak tomorrow for the strong day-after PV window and explains why", () => {
        const input = multiDayThermalInput({
            todayPvW: 2500,
            tomorrowPvW: 900,
            dayAfterPvW: 5000,
            emptyAtIso: "2026-09-05T18:00:00.000Z",
        });
        const plan = (0, allocate_1.allocateUnifiedDayPlan)(input);
        const thermal = plan.allocations.filter((allocation) => allocation.kind === "immersion_heater");
        strict_1.default.ok(thermal.length > 0, "starkes PV-Fenster an Tag 3 muss als Soft-Wärmeslot nutzbar sein");
        strict_1.default.ok(thermal.every((allocation) => allocation.slot.startIso.startsWith("2026-09-05")), thermal.map((allocation) => allocation.slot.startIso).join(", "));
        const outlook = (0, outlook_72h_1.buildOperatorOutlook72h)({ now: NOW, timezone: "UTC", plan, plannerInput: input });
        const decision = outlook.decisions.find((entry) => entry.kind === "immersion_heater");
        strict_1.default.equal(decision?.state, "deferred");
        strict_1.default.match(decision?.explanationDe ?? "", /bessere PV-Fenster/);
        strict_1.default.match((0, outlook_72h_1.formatOperatorOutlook72hDe)(outlook), /Übermorgen/);
    });
    (0, node_test_1.it)("stores heat today when the following days are weak", () => {
        const input = multiDayThermalInput({
            todayPvW: 5000,
            tomorrowPvW: 200,
            dayAfterPvW: 200,
            emptyAtIso: "2026-09-04T06:00:00.000Z",
        });
        input.thermal = { ...input.thermal, headroomEnergyKwh: 1.7 };
        const plan = (0, allocate_1.allocateUnifiedDayPlan)(input);
        const thermal = plan.allocations.filter((allocation) => allocation.kind === "immersion_heater");
        strict_1.default.ok(thermal.length > 0);
        strict_1.default.ok(thermal.every((allocation) => allocation.slot.startIso.startsWith("2026-09-03")), thermal.map((allocation) => allocation.slot.startIso).join(", "));
    });
    (0, node_test_1.it)("states that an EV already at target needs no charge", () => {
        const input = input80h();
        input.battery = { ...input.battery, socPct: 100, requiredChargeEnergyKwh: 0 };
        input.wallbox = {
            connectedNow: true,
            presenceWindows: [{
                    available: true,
                    status: "available",
                    source: "explicit",
                    hard: true,
                    startIso: input.time.horizonStartIso,
                    endIso: input.time.horizonEndIso,
                }],
            presenceHardConstraint: true,
            vehicleProfileId: "weekend-car",
            vehicleSocPct: 80,
            socSource: "direct",
            fallbackEnergyNeedKwh: null,
            vehicleCapacityKwh: 60,
            targetSocPct: 80,
            requiredEnergyKwh: 0,
            deadlineIso: null,
            energyGoalHard: false,
            minChargePowerW: 1380,
            maxChargePowerW: 11000,
            chargeLossFactor: 1,
            evccExecutionMaster: true,
            managementMode: "ems_candidate",
            hardRequiredEnergyKwh: 0,
            targetEnergyKwh: 0,
            uncertainty: input.pv.uncertainty,
            freshness: input.pv.freshness,
        };
        const plan = (0, allocate_1.allocateUnifiedDayPlan)(input);
        strict_1.default.equal(plan.allocations.some((allocation) => allocation.kind === "wallbox"), false);
        const outlook = (0, outlook_72h_1.buildOperatorOutlook72h)({ now: NOW, timezone: "UTC", plan, plannerInput: input });
        const decision = outlook.decisions.find((entry) => entry.kind === "wallbox");
        strict_1.default.equal(decision?.state, "not_needed");
        strict_1.default.match(decision?.explanationDe ?? "", /Ziel.*erreicht/);
    });
    (0, node_test_1.it)("treats target SOC 0 as unset for an externally managed EV", () => {
        const input = input80h();
        input.wallbox = {
            connectedNow: true,
            presenceWindows: [],
            presenceHardConstraint: true,
            vehicleProfileId: null,
            vehicleSocPct: 64,
            socSource: "direct",
            fallbackEnergyNeedKwh: null,
            vehicleCapacityKwh: 60,
            targetSocPct: 0,
            requiredEnergyKwh: 0,
            deadlineIso: null,
            energyGoalHard: false,
            minChargePowerW: 1380,
            maxChargePowerW: 11000,
            chargeLossFactor: 1,
            evccExecutionMaster: true,
            evccChargeMode: "now",
            managementMode: "externally_managed",
            externalAuthorityState: "active_without_plan",
            hardRequiredEnergyKwh: 0,
            targetEnergyKwh: null,
            uncertainty: input.pv.uncertainty,
            freshness: input.pv.freshness,
        };
        const plan = (0, allocate_1.allocateUnifiedDayPlan)(input);
        const outlook = (0, outlook_72h_1.buildOperatorOutlook72h)({ now: NOW, timezone: "UTC", plan, plannerInput: input });
        const decision = outlook.decisions.find((entry) => entry.kind === "wallbox");
        strict_1.default.equal(decision?.state, "unallocated");
        strict_1.default.match(decision?.explanationDe ?? "", /externe Ladeplan/);
        strict_1.default.doesNotMatch(decision?.explanationDe ?? "", /Ziel 0/);
    });
    (0, node_test_1.it)("places a small EV need into the best available PV window instead of charging immediately", () => {
        const input = input80h();
        input.pv.slots = input.time.slots.map((slot) => {
            const inBestWindow = slot.startIso >= "2026-09-04T10:00:00.000Z" && slot.startIso < "2026-09-04T11:00:00.000Z";
            const powerW = inBestWindow ? 5000 : 100;
            return { slot, forecastPowerW: powerW, observedPowerW: null, energyKwh: powerW / 4000 };
        });
        input.houseLoad.slots = input.time.slots.map((slot) => ({
            slot,
            forecastPowerW: 500,
            observedPowerW: null,
            energyKwh: 0.125,
        }));
        input.battery = {
            ...input.battery,
            socPct: 100,
            requiredChargeEnergyKwh: 0,
            passiveBatteryEnergyAvailable: false,
        };
        input.wallbox = {
            connectedNow: true,
            presenceWindows: [{
                    available: true,
                    status: "available",
                    source: "explicit",
                    hard: true,
                    startIso: input.time.horizonStartIso,
                    endIso: input.time.horizonEndIso,
                }],
            presenceHardConstraint: true,
            vehicleProfileId: "weekend-car",
            vehicleSocPct: 78,
            socSource: "direct",
            fallbackEnergyNeedKwh: null,
            vehicleCapacityKwh: 50,
            targetSocPct: 80,
            requiredEnergyKwh: 1,
            deadlineIso: null,
            energyGoalHard: false,
            minChargePowerW: 1380,
            maxChargePowerW: 11000,
            chargeLossFactor: 1,
            evccExecutionMaster: true,
            evccChargeMode: "pv",
            managementMode: "ems_candidate",
            hardRequiredEnergyKwh: 0,
            targetEnergyKwh: 1,
            uncertainty: input.pv.uncertainty,
            freshness: input.pv.freshness,
        };
        const plan = (0, allocate_1.allocateUnifiedDayPlan)(input);
        const wallbox = plan.allocations.filter((allocation) => allocation.kind === "wallbox");
        strict_1.default.ok(wallbox.length > 0);
        strict_1.default.ok(wallbox.every((allocation) => allocation.energySource === "pv_surplus" &&
            allocation.slot.startIso >= "2026-09-04T10:00:00.000Z" &&
            allocation.slot.startIso < "2026-09-04T11:00:00.000Z"), wallbox.map((allocation) => `${allocation.slot.startIso}:${allocation.energySource}`).join(", "));
        strict_1.default.ok(wallbox.reduce((sum, allocation) => sum + allocation.allocatedEnergyKwh, 0) >= 0.99);
        const outlook = (0, outlook_72h_1.buildOperatorOutlook72h)({ now: NOW, timezone: "UTC", plan, plannerInput: input });
        const decision = outlook.decisions.find((entry) => entry.kind === "wallbox");
        strict_1.default.equal(decision?.state, "deferred");
        strict_1.default.match(decision?.explanationDe ?? "", /aus PV-Überschuss/);
    });
    (0, node_test_1.it)("pre-shifts climate only for a forecasted need and keeps it before Hard-Off", () => {
        const input = input80h();
        input.pv.slots = input.time.slots.map((slot) => {
            const goodWindow = slot.startIso >= "2026-09-03T02:00:00.000Z" && slot.startIso < "2026-09-03T03:00:00.000Z";
            const powerW = goodWindow ? 3000 : 100;
            return { slot, forecastPowerW: powerW, observedPowerW: null, energyKwh: powerW / 4000 };
        });
        input.houseLoad.slots = input.time.slots.map((slot) => ({
            slot,
            forecastPowerW: 500,
            observedPowerW: null,
            energyKwh: 0.125,
        }));
        input.battery = {
            ...input.battery,
            socPct: 10,
            minSocPct: 10,
            reserveSocPct: 10,
            requiredChargeEnergyKwh: 0,
            passiveBatteryEnergyAvailable: false,
        };
        input.climate = {
            units: [{
                    unitId: "air_conditioning.unit_1",
                    label: "Wohnzimmer",
                    roomTempC: 24,
                    comfortMinC: null,
                    comfortMaxC: 25,
                    targetTempC: 24,
                    mandatoryComfort: false,
                    expectedEnergyKwh: 0,
                    typicalPowerW: 850,
                    maxShiftHours: 3,
                    hardStopMs: Date.parse("2026-09-03T04:00:00.000Z"),
                    demandModel: "predictive",
                    predictiveConfidence: 0.8,
                    predictedCrossingAtIso: "2026-09-03T03:30:00.000Z",
                    uncertainty: input.pv.uncertainty,
                }],
            freshness: input.pv.freshness,
        };
        const withoutNeed = (0, allocate_1.allocateUnifiedDayPlan)(input);
        strict_1.default.equal(withoutNeed.allocations.some((allocation) => allocation.kind === "climate"), false);
        input.climate.units[0] = { ...input.climate.units[0], expectedEnergyKwh: 0.85 };
        const withNeed = (0, allocate_1.allocateUnifiedDayPlan)(input);
        const climate = withNeed.allocations.filter((allocation) => allocation.kind === "climate");
        strict_1.default.ok(climate.length > 0);
        strict_1.default.ok(climate.every((allocation) => Date.parse(allocation.slot.startIso) < Date.parse("2026-09-03T04:00:00.000Z")));
        const outlook = (0, outlook_72h_1.buildOperatorOutlook72h)({ now: NOW, timezone: "UTC", plan: withNeed, plannerInput: input });
        const decision = outlook.decisions.find((entry) => entry.kind === "climate");
        strict_1.default.match(decision?.explanationDe ?? "", /prädiktivem Raum-\/Wetter-Learning/);
        strict_1.default.match(decision?.explanationDe ?? "", /Hard-Off/);
    });
});
