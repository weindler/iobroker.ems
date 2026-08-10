"use strict";
/**
 * Ziel-/kostenbasierte Unified Optimization — Abnahme A–J + Anti-Priorität.
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const strict_1 = __importDefault(require("node:assert/strict"));
const quality_1 = require("../../quality");
const allocate_1 = require("./allocate");
const fixtures_1 = require("./fixtures");
const product_summary_1 = require("../../../beta/product_summary");
const TZ = "Europe/Berlin";
const Q = (0, quality_1.operatorQuality)("valid", "cost-opt", 85);
const FRESH = { observedAtIso: "2026-08-08T08:55:00.000Z", ageSec: 5, quality: Q };
function sumKind(plan, kind, pred) {
    return plan.allocations
        .filter((a) => a.kind === kind && (!pred || pred(a)))
        .reduce((s, a) => s + a.allocatedEnergyKwh, 0);
}
function wallboxBase(overrides = {}) {
    return {
        connectedNow: true,
        presenceWindows: [
            {
                available: true,
                status: "available",
                source: "explicit",
                hard: true,
                startIso: "2026-08-08T08:55:00.000Z",
                endIso: "2026-08-10T00:00:00.000Z",
            },
        ],
        presenceHardConstraint: true,
        vehicleProfileId: "ford_explorer",
        vehicleSocPct: 35,
        socSource: "direct",
        fallbackEnergyNeedKwh: null,
        vehicleCapacityKwh: 79,
        targetSocPct: 80,
        requiredEnergyKwh: 35.55, // (80-35)% * 79
        deadlineIso: "2026-08-09T03:30:00.000Z", // 05:30 CEST
        energyGoalHard: true,
        minChargePowerW: 1380,
        maxChargePowerW: 11000,
        chargeLossFactor: 1.05,
        evccExecutionMaster: true,
        evccChargeMode: null,
        batteryHoldRequested: false,
        uncertainty: Q,
        freshness: FRESH,
        ...overrides,
    };
}
function baseHorizon(nowIso = "2026-08-08T08:55:00.000Z", hours = 40) {
    const slots = (0, fixtures_1.buildSlots)(nowIso, hours);
    const base = (0, fixtures_1.golden001Input)();
    base.time = {
        ...base.time,
        nowIso,
        timezone: TZ,
        slots,
        horizonStartIso: slots[0].startIso,
        horizonEndIso: slots[slots.length - 1].endIso,
    };
    base.pv.slots = slots.map((s) => {
        const h = new Date(s.startIso).getUTCHours();
        const day0 = Date.parse(s.startIso) < Date.parse("2026-08-09T00:00:00.000Z");
        let power = 0;
        if (day0 && h >= 7 && h < 16)
            power = h < 14 ? 4000 : 1500;
        else if (!day0 && h >= 7 && h < 16)
            power = 3800;
        return { slot: s, forecastPowerW: power, observedPowerW: null, energyKwh: (power / 1000) * 0.25 };
    });
    base.pv.expectedDayEnergyKwh = 43.6;
    base.houseLoad.slots = slots.map((s) => ({
        slot: s,
        forecastPowerW: 800,
        observedPowerW: null,
        energyKwh: 0.2,
    }));
    base.houseLoad.expectedDayEnergyKwh = 22;
    base.prices.slots = slots.map((s) => {
        const h = new Date(s.startIso).getUTCHours();
        const night = h >= 22 || h < 5;
        return {
            slot: s,
            importCtPerKwh: night ? 12 : 32,
            exportCtPerKwh: 8,
            gridImportAllowed: true,
        };
    });
    base.battery = {
        ...base.battery,
        socPct: 60,
        usableCapacityKwh: 10,
        nightReserveKwh: 2.5,
        requiredChargeEnergyKwh: null,
        endSocTargetPct: null,
        gridChargeAllowed: true,
        uncertainty: Q,
        freshness: FRESH,
    };
    base.thermal = {
        ...base.thermal,
        bufferTempC: 49,
        headroomEnergyKwh: 3.5,
        deadlineIso: "2026-08-08T15:25:00.000Z",
        estimatedEmptyAtIso: "2026-08-08T15:25:00.000Z",
        emptyAtSource: "estimated",
        nightBridgeActive: true,
        reheatHysteresisActive: false,
        uncertainty: Q,
        freshness: FRESH,
    };
    base.climate = {
        units: [
            {
                unitId: "air_conditioning.unit_1",
                label: "Wohnzimmer",
                roomTempC: 26.5,
                comfortMinC: null,
                comfortMaxC: 25.5,
                targetTempC: 25,
                mandatoryComfort: true,
                expectedEnergyKwh: 2.5,
                typicalPowerW: 900,
                maxShiftHours: 0,
                uncertainty: Q,
            },
        ],
        freshness: FRESH,
    };
    base.wallbox = null;
    base.globalMode = "balanced";
    return base;
}
(0, node_test_1.describe)("COST-A beta SOC100 + thermal + climate", () => {
    (0, node_test_1.it)("no battery charge; parallel climate + thermal", () => {
        const input = baseHorizon();
        input.battery = { ...input.battery, socPct: 100, requiredChargeEnergyKwh: 0 };
        const plan = (0, allocate_1.allocateUnifiedDayPlan)(input);
        strict_1.default.equal(sumKind(plan, "battery_charge"), 0);
        strict_1.default.ok(sumKind(plan, "immersion_heater") > 1);
        strict_1.default.ok(sumKind(plan, "climate") > 1);
    });
});
(0, node_test_1.describe)("COST-B Explorer + little PV + cheap night", () => {
    (0, node_test_1.it)("meets deadline using cheap night grid", () => {
        const input = baseHorizon();
        input.pv.slots = input.pv.slots.map((s) => ({
            ...s,
            forecastPowerW: 400,
            energyKwh: 0.1,
        }));
        input.pv.expectedDayEnergyKwh = 6;
        input.wallbox = wallboxBase({ evccChargeMode: null });
        const plan = (0, allocate_1.allocateUnifiedDayPlan)(input);
        const grid = sumKind(plan, "wallbox", (a) => a.energySource === "grid");
        const goal = plan.goalStatuses.find((g) => g.consumerId === "wallbox");
        strict_1.default.ok(grid > 15, `expected substantial night/grid charge, got ${grid}`);
        strict_1.default.ok(goal?.met !== false, String(goal?.detailDe));
        const eco = plan.vehicleChargeEconomics;
        strict_1.default.ok((eco.expectedGridCostCt ?? 9999) < 35 * 32); // not all at expensive day rate
        const agenda = (0, product_summary_1.buildUnifiedDayAgendaDe)(plan);
        const summary = (0, product_summary_1.buildProductSummaryDe)(plan, { batteryStartSocPct: 60 });
        strict_1.default.ok(agenda.some((l) => /Fahrzeug/i.test(l)) || /Fahrzeug|Netz/i.test(summary));
        // eslint-disable-next-line no-console
        console.log("\n=== COST-B PLAN ===\n", summary, "\n", agenda.join("\n"));
    });
});
(0, node_test_1.describe)("COST-C Explorer + strong tomorrow PV + evening deadline", () => {
    (0, node_test_1.it)("shifts charge into tomorrow PV window when deadline allows", () => {
        const input = baseHorizon();
        // Today weak, tomorrow strong; deadline tomorrow evening
        input.pv.slots = input.pv.slots.map((s) => {
            const day0 = Date.parse(s.slot.startIso) < Date.parse("2026-08-09T00:00:00.000Z");
            const h = new Date(s.slot.startIso).getUTCHours();
            const power = day0 ? (h >= 10 && h < 14 ? 800 : 200) : h >= 7 && h < 16 ? 5000 : 0;
            return { ...s, forecastPowerW: power, energyKwh: (power / 1000) * 0.25 };
        });
        input.prices.slots = input.prices.slots.map((s) => {
            const h = new Date(s.slot.startIso).getUTCHours();
            const night = h >= 22 || h < 5;
            return { ...s, importCtPerKwh: night ? 38 : 28 }; // night expensive
        });
        input.wallbox = wallboxBase({
            deadlineIso: "2026-08-09T18:00:00.000Z",
            requiredEnergyKwh: 20,
        });
        const plan = (0, allocate_1.allocateUnifiedDayPlan)(input);
        const pvWb = sumKind(plan, "wallbox", (a) => a.energySource === "pv_surplus");
        const gridWb = sumKind(plan, "wallbox", (a) => a.energySource === "grid");
        strict_1.default.ok(pvWb > gridWb, `prefer tomorrow PV: pv=${pvWb} grid=${gridWb}`);
        // eslint-disable-next-line no-console
        console.log("\n=== COST-C PLAN ===\n", (0, product_summary_1.buildUnifiedDayAgendaDe)(plan).join("\n"), `\npv=${pvWb} grid=${gridWb}`);
    });
});
(0, node_test_1.describe)("COST-D immediate/schnell → battery hold", () => {
    (0, node_test_1.it)("blocks battery charge while immediate EV charging", () => {
        const input = baseHorizon();
        input.battery = { ...input.battery, socPct: 40 };
        input.wallbox = wallboxBase({
            evccChargeMode: "now",
            batteryHoldRequested: true,
            deadlineIso: "2026-08-08T14:00:00.000Z",
            requiredEnergyKwh: 12,
        });
        const plan = (0, allocate_1.allocateUnifiedDayPlan)(input);
        strict_1.default.equal(sumKind(plan, "battery_charge"), 0, "battery hold during immediate");
        strict_1.default.ok(sumKind(plan, "wallbox") > 5);
    });
});
(0, node_test_1.describe)("COST-E climate + vehicle compete", () => {
    (0, node_test_1.it)("covers hard vehicle goal and mandatory climate together", () => {
        const input = baseHorizon();
        input.pv.slots = input.pv.slots.map((s) => ({
            ...s,
            forecastPowerW: 1200,
            energyKwh: 0.3,
        }));
        input.wallbox = wallboxBase({ requiredEnergyKwh: 12, deadlineIso: "2026-08-09T03:30:00.000Z" });
        input.battery = { ...input.battery, socPct: 70, nightReserveKwh: 2.5 };
        const plan = (0, allocate_1.allocateUnifiedDayPlan)(input);
        const wb = sumKind(plan, "wallbox");
        const climate = sumKind(plan, "climate");
        strict_1.default.ok(wb > 8, `vehicle energy ${wb}`);
        strict_1.default.ok(climate > 1, `climate energy ${climate}`);
        const goal = plan.goalStatuses.find((g) => g.consumerId === "wallbox");
        strict_1.default.ok(goal?.met === true || wb >= 11, `goal=${goal?.met} detail=${goal?.detailDe}`);
        // eslint-disable-next-line no-console
        console.log("\n=== COST-E PLAN ===\n", (0, product_summary_1.buildUnifiedDayAgendaDe)(plan).join("\n"));
    });
});
(0, node_test_1.describe)("COST-F thermal + climate + low battery", () => {
    (0, node_test_1.it)("does not invent fixed addon order — both get energy from situation", () => {
        const input = baseHorizon();
        input.battery = { ...input.battery, socPct: 15, nightReserveKwh: 2.5 };
        input.thermal = { ...input.thermal, headroomEnergyKwh: 3, deadlineIso: "2026-08-08T14:00:00.000Z" };
        const plan = (0, allocate_1.allocateUnifiedDayPlan)(input);
        strict_1.default.ok(sumKind(plan, "immersion_heater") > 0.5);
        strict_1.default.ok(sumKind(plan, "climate") > 0.5);
        strict_1.default.equal(sumKind(plan, "immersion_heater", (a) => a.energySource === "battery"), 0);
    });
});
(0, node_test_1.describe)("COST-G extremely cheap grid → conscious import OK", () => {
    (0, node_test_1.it)("may use cheap grid for vehicle while leaving battery on hold path", () => {
        const input = baseHorizon();
        input.prices.slots = input.prices.slots.map((s) => ({
            ...s,
            importCtPerKwh: 8,
            exportCtPerKwh: 2,
        }));
        input.pv.slots = input.pv.slots.map((s) => ({ ...s, forecastPowerW: 300, energyKwh: 0.075 }));
        input.battery = { ...input.battery, socPct: 55 };
        input.wallbox = wallboxBase({ requiredEnergyKwh: 25 });
        const plan = (0, allocate_1.allocateUnifiedDayPlan)(input);
        const grid = sumKind(plan, "wallbox", (a) => a.energySource === "grid");
        strict_1.default.ok(grid > 10);
        strict_1.default.ok(plan.allocations.some((a) => a.reasonCodes.includes("grid_import_cost_optimal")));
        // eslint-disable-next-line no-console
        console.log("\n=== COST-G PLAN ===\n", (0, product_summary_1.buildProductSummaryDe)(plan, { batteryStartSocPct: 55 }));
    });
});
(0, node_test_1.describe)("COST-H extremely expensive grid → prefer PV/flex", () => {
    (0, node_test_1.it)("avoids grid for soft loads when import is very expensive", () => {
        const input = baseHorizon();
        input.prices.slots = input.prices.slots.map((s) => ({
            ...s,
            importCtPerKwh: 55,
            exportCtPerKwh: 12,
        }));
        input.wallbox = null;
        input.climate = {
            units: [
                {
                    unitId: "air_conditioning.unit_1",
                    label: "Wohnzimmer",
                    roomTempC: 24,
                    comfortMinC: null,
                    comfortMaxC: 26,
                    targetTempC: 25,
                    mandatoryComfort: false,
                    expectedEnergyKwh: 2,
                    typicalPowerW: 900,
                    maxShiftHours: 4,
                    uncertainty: Q,
                },
            ],
            freshness: FRESH,
        };
        const plan = (0, allocate_1.allocateUnifiedDayPlan)(input);
        const climateGrid = sumKind(plan, "climate", (a) => a.energySource === "grid");
        strict_1.default.ok(climateGrid < 0.3, `flex climate should avoid expensive grid, got ${climateGrid}`);
        strict_1.default.ok(sumKind(plan, "immersion_heater") > 0.5 || sumKind(plan, "climate") > 0.5);
    });
});
(0, node_test_1.describe)("COST-I same state, different global modes", () => {
    (0, node_test_1.it)("eco vs comfort produce different allocation emphasis", () => {
        const mk = (mode) => {
            const input = baseHorizon();
            input.globalMode = mode;
            input.battery = { ...input.battery, socPct: 45 };
            input.wallbox = wallboxBase({ requiredEnergyKwh: 15 });
            input.climate = {
                units: [
                    {
                        unitId: "air_conditioning.unit_1",
                        label: "Wohnzimmer",
                        roomTempC: 26,
                        comfortMinC: null,
                        comfortMaxC: 25.5,
                        targetTempC: 25,
                        mandatoryComfort: true,
                        expectedEnergyKwh: 3,
                        typicalPowerW: 900,
                        maxShiftHours: 0,
                        uncertainty: Q,
                    },
                ],
                freshness: FRESH,
            };
            return (0, allocate_1.allocateUnifiedDayPlan)(input);
        };
        const eco = mk("eco");
        const comfort = mk("comfort");
        const ecoClimate = sumKind(eco, "climate");
        const comfortClimate = sumKind(comfort, "climate");
        const ecoBat = sumKind(eco, "battery_charge");
        const comfortBat = sumKind(comfort, "battery_charge");
        const ecoClimateBat = sumKind(eco, "climate", (a) => a.energySource === "battery");
        const comfortClimateBat = sumKind(comfort, "climate", (a) => a.energySource === "battery");
        const different = Math.abs(ecoClimate - comfortClimate) > 0.15 ||
            Math.abs(ecoBat - comfortBat) > 0.15 ||
            Math.abs(sumKind(eco, "wallbox") - sumKind(comfort, "wallbox")) > 0.15 ||
            Math.abs(ecoClimateBat - comfortClimateBat) > 0.05 ||
            eco.expectedCostCt !== comfort.expectedCostCt;
        strict_1.default.ok(different, "eco and comfort must diverge on at least one dimension");
        // Keine PV-Export/Batterie-Arbitrage: bei PV-Surplus kein Klima aus Batterie.
        strict_1.default.equal(ecoClimateBat, 0, "eco must not drain battery while PV can cover climate");
        strict_1.default.equal(comfortClimateBat, 0, "comfort must not drain battery for export arbitrage");
        // eslint-disable-next-line no-console
        console.log("\n=== COST-I eco vs comfort ===", {
            eco: {
                climate: ecoClimate,
                climateBat: ecoClimateBat,
                batCharge: ecoBat,
                wb: sumKind(eco, "wallbox"),
                export: eco.expectedGridExportEnergyKwh,
                cost: eco.expectedCostCt,
            },
            comfort: {
                climate: comfortClimate,
                climateBat: comfortClimateBat,
                batCharge: comfortBat,
                wb: sumKind(comfort, "wallbox"),
                export: comfort.expectedGridExportEnergyKwh,
                cost: comfort.expectedCostCt,
            },
        });
    });
});
(0, node_test_1.describe)("COST-BAT-OPP no battery drain to free PV export", () => {
    (0, node_test_1.it)("prefers PV for load when export is modest and later import is expensive", () => {
        const input = baseHorizon();
        input.globalMode = "comfort";
        input.battery = {
            ...input.battery,
            socPct: 70,
            nightReserveKwh: 2.5,
            dischargeLiveSupported: true,
            passiveBatteryEnergyAvailable: true,
        };
        input.prices.slots = input.prices.slots.map((s) => {
            const h = new Date(s.slot.startIso).getUTCHours();
            const lateExpensive = h >= 17 && h < 22;
            return {
                ...s,
                importCtPerKwh: lateExpensive ? 48 : 22,
                exportCtPerKwh: 9.3,
                gridImportAllowed: true,
            };
        });
        // Starke aktuelle PV, genug für Klima
        input.pv.slots = input.pv.slots.map((s) => {
            const h = new Date(s.slot.startIso).getUTCHours();
            const day0 = Date.parse(s.slot.startIso) < Date.parse("2026-08-09T00:00:00.000Z");
            const power = day0 && h >= 9 && h < 15 ? 4500 : day0 && h >= 7 && h < 17 ? 1200 : 0;
            return { ...s, forecastPowerW: power, energyKwh: (power / 1000) * 0.25 };
        });
        input.wallbox = null;
        input.thermal = { ...input.thermal, headroomEnergyKwh: 0.5 };
        input.climate = {
            units: [
                {
                    unitId: "air_conditioning.unit_1",
                    label: "Wohnzimmer",
                    roomTempC: 27,
                    comfortMinC: null,
                    comfortMaxC: 26,
                    targetTempC: 25.5,
                    mandatoryComfort: true,
                    expectedEnergyKwh: 2.5,
                    typicalPowerW: 900,
                    maxShiftHours: 0,
                    uncertainty: Q,
                },
            ],
            freshness: FRESH,
        };
        const plan = (0, allocate_1.allocateUnifiedDayPlan)(input);
        const climatePv = sumKind(plan, "climate", (a) => a.energySource === "pv_surplus");
        const climateBat = sumKind(plan, "climate", (a) => a.energySource === "battery");
        strict_1.default.ok(climatePv > 1.5, `climate should run on PV, got pv=${climatePv}`);
        strict_1.default.equal(climateBat, 0, `battery must stay reserved for later expensive hours, got ${climateBat}`);
    });
});
(0, node_test_1.describe)("COST-J no deadline + lots of PV", () => {
    (0, node_test_1.it)("raises self-consumption without forcing battery to 100%", () => {
        const input = baseHorizon();
        input.wallbox = null;
        input.battery = { ...input.battery, socPct: 70, nightReserveKwh: 2.5 };
        input.thermal = {
            ...input.thermal,
            deadlineIso: null,
            estimatedEmptyAtIso: null,
            emptyAtSource: null,
            nightBridgeActive: false,
            headroomEnergyKwh: 2,
        };
        const plan = (0, allocate_1.allocateUnifiedDayPlan)(input);
        const bat = sumKind(plan, "battery_charge");
        const ih = sumKind(plan, "immersion_heater");
        strict_1.default.ok(bat + ih > 1);
        const endSoc = plan.batteryTrajectory[plan.batteryTrajectory.length - 1]?.socPct;
        strict_1.default.ok(endSoc === null || endSoc <= 100);
        strict_1.default.ok(endSoc === null || endSoc < 99.5 || bat < 3, "must not blindly max battery");
    });
});
(0, node_test_1.describe)("COST-ANTI fixed addon priority forbidden", () => {
    (0, node_test_1.it)("same addons, different deadlines/prices → different energy mix", () => {
        const cheapNightVehicle = baseHorizon();
        cheapNightVehicle.climate = null; // isolate vehicle vs thermal priority
        cheapNightVehicle.pv.slots = cheapNightVehicle.pv.slots.map((s) => ({
            ...s,
            forecastPowerW: 500,
            energyKwh: 0.125,
        }));
        cheapNightVehicle.wallbox = wallboxBase({
            deadlineIso: "2026-08-09T03:30:00.000Z",
            requiredEnergyKwh: 22,
        });
        cheapNightVehicle.thermal = {
            ...cheapNightVehicle.thermal,
            headroomEnergyKwh: 2,
            deadlineIso: "2026-08-09T20:00:00.000Z",
        };
        const thermalUrgent = baseHorizon();
        thermalUrgent.climate = null;
        thermalUrgent.pv.slots = thermalUrgent.pv.slots.map((s) => {
            const h = new Date(s.slot.startIso).getUTCHours();
            const power = h >= 9 && h < 14 ? 4500 : 200;
            return { ...s, forecastPowerW: power, energyKwh: (power / 1000) * 0.25 };
        });
        thermalUrgent.prices.slots = thermalUrgent.prices.slots.map((s) => ({
            ...s,
            importCtPerKwh: 40,
        }));
        thermalUrgent.wallbox = wallboxBase({
            deadlineIso: "2026-08-09T20:00:00.000Z",
            requiredEnergyKwh: 8,
            energyGoalHard: false,
        });
        thermalUrgent.thermal = {
            ...thermalUrgent.thermal,
            headroomEnergyKwh: 4,
            deadlineIso: "2026-08-08T13:00:00.000Z",
            estimatedEmptyAtIso: "2026-08-08T13:00:00.000Z",
            emptyAtSource: "learned",
            coolingRateCPerH: 0.8,
            bufferTempC: 48.5,
            minTempC: 48,
        };
        const p1 = (0, allocate_1.allocateUnifiedDayPlan)(cheapNightVehicle);
        const p2 = (0, allocate_1.allocateUnifiedDayPlan)(thermalUrgent);
        const mix = (p) => ({
            wbGrid: sumKind(p, "wallbox", (a) => a.energySource === "grid"),
            wbPv: sumKind(p, "wallbox", (a) => a.energySource === "pv_surplus"),
            ih: sumKind(p, "immersion_heater"),
        });
        const m1 = mix(p1);
        const m2 = mix(p2);
        strict_1.default.ok(m1.wbGrid > m2.wbGrid + 2, `cheap-night vehicle uses more grid: ${JSON.stringify({ m1, m2 })}`);
        /** Dringendes Thermal: mindestens vergleichbar/mehr IH oder klar mehr PV-Flex als m1. */
        strict_1.default.ok(m2.ih + 0.15 >= m1.ih || m2.wbPv > m1.wbPv + 2, `urgent thermal mix vs vehicle-night: ${JSON.stringify({ m1, m2 })}`);
        // Score-Mix muss sich mit Deadlines/Preisen drehen — keine feste Add-on-Reihenfolge.
        const mixDiffers = Math.abs(m1.wbGrid - m2.wbGrid) > 2 ||
            Math.abs(m1.wbPv - m2.wbPv) > 1 ||
            Math.abs(m1.ih - m2.ih) > 0.3;
        strict_1.default.ok(mixDiffers, `energy mix must diverge: ${JSON.stringify({ m1, m2 })}`);
    });
});
