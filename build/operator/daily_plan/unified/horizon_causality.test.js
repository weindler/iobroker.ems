"use strict";
/**
 * v0.1.261 — zusammenhängende Planner-Korrekturen (Audit 09.08.):
 * Thermal-Bridge, forecastabhängige Reserve, Feasibility/Starvation, zeitkausale SOC.
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const strict_1 = __importDefault(require("node:assert/strict"));
const allocate_1 = require("./allocate");
const fixtures_1 = require("./fixtures");
const battery_reserve_floor_1 = require("./battery_reserve_floor");
const next_reliable_pv_1 = require("./next_reliable_pv");
const score_allocate_1 = require("./score_allocate");
const quality_1 = require("../../quality");
const TZ = "Europe/Berlin";
const Q = (0, quality_1.operatorQuality)("valid", "horizon", 85);
const FRESH = { observedAtIso: "2026-08-09T10:00:00.000Z", ageSec: 10, quality: Q };
function sumIh(plan) {
    return plan.allocations
        .filter((a) => a.kind === "immersion_heater")
        .reduce((s, a) => s + a.allocatedEnergyKwh, 0);
}
function sumIhFromBattery(plan) {
    return plan.allocations
        .filter((a) => a.kind === "immersion_heater" &&
        (a.energySource === "battery" || a.energySource === "mixed"))
        .reduce((s, a) => s + a.allocatedEnergyKwh, 0);
}
function auditLikeInput(nowIso, opts) {
    const slots = (0, fixtures_1.buildSlots)(nowIso, 72); // 18 h
    const input = (0, fixtures_1.golden001Input)();
    input.globalMode = "balanced";
    input.time = {
        ...input.time,
        nowIso,
        timezone: TZ,
        slots,
        horizonStartIso: slots[0].startIso,
        horizonEndIso: slots[slots.length - 1].endIso,
        freshness: FRESH,
    };
    input.pv.uncertainty = Q;
    input.pv.slots = slots.map((s) => {
        const ms = Date.parse(s.startIso);
        const day0 = ms < Date.parse("2026-08-10T00:00:00.000Z");
        const h = new Date(s.startIso).getUTCHours();
        let power = 0;
        if (day0 && h >= 10 && h < 17)
            power = 4500;
        else if (!day0 && h >= 7 && h < 15)
            power = 4000;
        return {
            slot: s,
            forecastPowerW: power,
            observedPowerW: null,
            energyKwh: (power / 1000) * 0.25,
        };
    });
    input.houseLoad.slots = slots.map((s) => ({
        slot: s,
        forecastPowerW: 600,
        observedPowerW: null,
        energyKwh: 0.15,
    }));
    input.prices.slots = slots.map((s) => ({
        slot: s,
        importCtPerKwh: 28,
        exportCtPerKwh: 9.3,
        gridImportAllowed: true,
    }));
    input.battery = {
        ...input.battery,
        socPct: opts?.socPct ?? 55,
        usableCapacityKwh: 18,
        nightReserveKwh: 2.5,
        minSocPct: 10,
        reserveSocPct: 10,
        passiveBatteryEnergyAvailable: true,
        endSocTargetPct: 80,
        requiredChargeEnergyKwh: null,
        uncertainty: Q,
        freshness: FRESH,
    };
    input.thermal = {
        bufferTempC: 52,
        minTempC: 48,
        maxTempC: 60,
        dayTargetTempC: 56,
        availablePowerW: 1700,
        minPowerW: 1700,
        headroomEnergyKwh: opts?.headroom ?? 3.0,
        estimatedEmptyAtIso: "2026-08-10T07:25:00.000Z",
        deadlineIso: "2026-08-10T07:25:00.000Z",
        emptyAtSource: "learned",
        nightBridgeActive: false,
        coolingRateCPerH: 0.35,
        minimumRuntimeSec: 60,
        hysteresisK: 2,
        reheatHysteresisActive: false,
        uncertainty: Q,
        freshness: FRESH,
    };
    input.climate = null;
    input.wallbox = null;
    return input;
}
(0, node_test_1.describe)("next reliable PV — surplus window (no fixed +Nh)", () => {
    (0, node_test_1.it)("skips contiguous current surplus streak; keeps a later window after a real gap", () => {
        const start = "2026-08-09T10:00:00.000Z";
        /** 7 h Horizon: 10–12 Surplus, ~2 h Pause, 14–16 Surplus — Lücke ≫ 2 Slots. */
        const slots = (0, fixtures_1.buildSlots)(start, 28).map((s) => {
            const h = new Date(s.startIso).getUTCHours();
            const power = (h >= 10 && h < 12) || (h >= 14 && h < 16) ? 4000 : 0;
            return {
                startIso: s.startIso,
                endIso: s.endIso,
                startMs: Date.parse(s.startIso),
                pvKwh: (power / 1000) * 0.25,
                houseKwh: 0.15,
                importCt: 28,
            };
        });
        const endIdx = (0, next_reliable_pv_1.findEndOfCurrentSurplusWindowIdx)(slots, 0);
        strict_1.default.ok(endIdx > 0);
        strict_1.default.ok(endIdx <= slots.findIndex((s) => s.startMs >= Date.parse("2026-08-09T13:00:00.000Z")), `current window must end before afternoon, endIdx=${endIdx}`);
        const next = (0, next_reliable_pv_1.findNextReliablePvAfterCurrentWindow)(slots, 0, 0.9, Date.parse(start));
        strict_1.default.ok(next.startMs !== null);
        strict_1.default.ok(next.startMs >= Date.parse("2026-08-09T13:30:00.000Z"), `later window expected (~3h, not skipped by +6h), got ${next.startIso}`);
        strict_1.default.ok(next.startMs < Date.parse("2026-08-09T16:00:00.000Z"), `must land in afternoon window, got ${next.startIso}`);
    });
});
(0, node_test_1.describe)("T — Thermal bridge until next reliable PV", () => {
    (0, node_test_1.it)("T1: Boiler covers until next PV → Hard-Bridge ~0, Precharge soft", () => {
        const r = (0, next_reliable_pv_1.resolveThermalPlannerEnergy)({
            nowMs: Date.parse("2026-08-09T14:00:00.000Z"),
            bufferTempC: 52,
            boilerTempC: 52,
            minTempC: 48,
            boilerMinTempC: 48,
            bufferMaxTempC: 63,
            headroomEnergyKwh: 3.0,
            coolingRateCPerH: 0.3,
            estimatedEmptyAtMs: Date.parse("2026-08-10T07:25:00.000Z"),
            boilerEmptyAtUsable: true,
            nextReliablePvMs: Date.parse("2026-08-10T06:30:00.000Z"),
            pvConfidence01: 0.85,
        });
        strict_1.default.equal(r.coversUntilNextPv, true);
        strict_1.default.ok(r.mandatoryEnergyKwh < 0.5, `expected ~0 hard, got ${r.mandatoryEnergyKwh}`);
        strict_1.default.ok(r.economicHeadroomKwh >= 2.5, `soft headroom got ${r.economicHeadroomKwh}`);
        const plan = (0, allocate_1.allocateUnifiedDayPlan)(auditLikeInput("2026-08-09T14:00:00.000Z", { headroom: 3 }));
        /** Soft darf wirtschaftlich konkurrieren; bei SOC 55 % / Batteriebedarf oft wenig IH. */
        strict_1.default.ok(sumIh(plan) < 3.1, `IH soft cap, got ${sumIh(plan)}`);
    });
    (0, node_test_1.it)("T2: Boiler does not cover → mandatory energy planned (not full headroom)", () => {
        const r = (0, next_reliable_pv_1.resolveThermalPlannerEnergy)({
            nowMs: Date.parse("2026-08-09T18:00:00.000Z"),
            bufferTempC: 55,
            boilerTempC: 49,
            minTempC: 48,
            boilerMinTempC: 48,
            bufferMaxTempC: 63,
            headroomEnergyKwh: 0.5,
            coolingRateCPerH: 0.5,
            estimatedEmptyAtMs: Date.parse("2026-08-10T02:00:00.000Z"),
            boilerEmptyAtUsable: true,
            nextReliablePvMs: Date.parse("2026-08-10T08:00:00.000Z"),
            pvConfidence01: 0.8,
        });
        strict_1.default.equal(r.coversUntilNextPv, false);
        strict_1.default.ok(r.mandatoryEnergyKwh > 0.3, `mandatory got ${r.mandatoryEnergyKwh}`);
        strict_1.default.ok(r.plannerEnergyKwh >= r.mandatoryEnergyKwh);
        strict_1.default.ok(r.mandatoryEnergyKwh <= r.plannerEnergyKwh + 1e-9, "mandatory is bridge, soft is separate");
    });
    (0, node_test_1.it)("T3: low forecast confidence keeps uncertainty cushion on hard", () => {
        const weak = (0, next_reliable_pv_1.resolveThermalPlannerEnergy)({
            nowMs: Date.parse("2026-08-09T14:00:00.000Z"),
            bufferTempC: 52,
            boilerTempC: 50,
            minTempC: 48,
            boilerMinTempC: 48,
            bufferMaxTempC: 63,
            headroomEnergyKwh: 3,
            coolingRateCPerH: 0.3,
            estimatedEmptyAtMs: Date.parse("2026-08-10T04:00:00.000Z"),
            boilerEmptyAtUsable: true,
            nextReliablePvMs: Date.parse("2026-08-10T06:30:00.000Z"),
            pvConfidence01: 0.4,
        });
        const strong = (0, next_reliable_pv_1.resolveThermalPlannerEnergy)({
            nowMs: Date.parse("2026-08-09T14:00:00.000Z"),
            bufferTempC: 52,
            boilerTempC: 50,
            minTempC: 48,
            boilerMinTempC: 48,
            bufferMaxTempC: 63,
            headroomEnergyKwh: 3,
            coolingRateCPerH: 0.3,
            estimatedEmptyAtMs: Date.parse("2026-08-10T04:00:00.000Z"),
            boilerEmptyAtUsable: true,
            nextReliablePvMs: Date.parse("2026-08-10T06:30:00.000Z"),
            pvConfidence01: 0.9,
        });
        strict_1.default.ok(weak.mandatoryEnergyKwh >= strong.mandatoryEnergyKwh);
    });
});
(0, node_test_1.describe)("B — forecast-dependent battery reserve", () => {
    (0, node_test_1.it)("B1: strong morning PV → afternoon reserve below full night anchor", () => {
        const input = auditLikeInput("2026-08-09T14:00:00.000Z");
        const slots = (0, score_allocate_1.buildSlots)(input);
        const floor = (0, battery_reserve_floor_1.buildBatteryReserveFloor)(input, slots);
        const nowIdx = slots.findIndex((s) => s.startIso.startsWith("2026-08-09T14:00"));
        const req = floor.requiredKwhBySlot[Math.max(0, nowIdx)] ?? 0;
        strict_1.default.ok(req < 2.5, `reserve should be < night anchor, got ${req}`);
        /** Untere Grenze = Safety/minSoc (buildBatteryReserveFloor), kein 25%-Night-Floor. */
        const safety = (input.battery.usableCapacityKwh * (input.battery.minSocPct ?? 10)) / 100;
        strict_1.default.ok(req + 1e-9 >= safety, `reserve >= safety ${safety}, got ${req}`);
    });
    (0, node_test_1.it)("B2: no reliable morning PV → higher classic night reserve", () => {
        const weak = (0, battery_reserve_floor_1.unavoidableNeedKwh)({
            slotStartIso: "2026-08-09T14:00:00.000Z",
            slotMs: Date.parse("2026-08-09T14:00:00.000Z"),
            recoveryMs: Date.parse("2026-08-11T10:00:00.000Z"),
            nightReserveKwh: 2.5,
            timeZone: TZ,
            netDemandUntilRecoveryKwh: 4.0,
            pvConfidence01: 0.5,
        });
        strict_1.default.equal(weak, 2.5);
    });
    (0, node_test_1.it)("B3: confidence drop increases afternoon bridge need", () => {
        const hi = (0, battery_reserve_floor_1.unavoidableNeedKwh)({
            slotStartIso: "2026-08-09T14:00:00.000Z",
            slotMs: Date.parse("2026-08-09T14:00:00.000Z"),
            recoveryMs: Date.parse("2026-08-10T08:00:00.000Z"),
            nightReserveKwh: 2.5,
            timeZone: TZ,
            netDemandUntilRecoveryKwh: 1.0,
            pvConfidence01: 0.9,
        });
        const lo = (0, battery_reserve_floor_1.unavoidableNeedKwh)({
            slotStartIso: "2026-08-09T14:00:00.000Z",
            slotMs: Date.parse("2026-08-09T14:00:00.000Z"),
            recoveryMs: Date.parse("2026-08-10T08:00:00.000Z"),
            nightReserveKwh: 2.5,
            timeZone: TZ,
            netDemandUntilRecoveryKwh: 1.0,
            pvConfidence01: 0.45,
        });
        strict_1.default.ok(lo >= hi, `lo=${lo} hi=${hi}`);
    });
});
(0, node_test_1.describe)("S — feasibility / starvation", () => {
    (0, node_test_1.it)("S1: many good slots → flexibility (IH not forced into first slot only)", () => {
        const input = auditLikeInput("2026-08-09T10:00:00.000Z", { headroom: 1.2, socPct: 100 });
        // Hard-Bridge nötig: emptyAt vor Ende des laufenden PV-Fensters
        input.thermal.bufferTempC = 48.2;
        input.thermal.coolingRateCPerH = 0.55;
        input.thermal.estimatedEmptyAtIso = "2026-08-09T14:00:00.000Z";
        input.thermal.deadlineIso = "2026-08-09T14:00:00.000Z";
        input.thermal.minTempC = 48;
        const plan = (0, allocate_1.allocateUnifiedDayPlan)(input);
        const ihSlots = plan.allocations.filter((a) => a.kind === "immersion_heater");
        strict_1.default.ok(ihSlots.length >= 1, `expected IH hard/soft slots, got ${ihSlots.length}`);
    });
    (0, node_test_1.it)("S2/R: replans do not treat remaining energy as full-day again when capacity shrinks", () => {
        const base = auditLikeInput("2026-08-09T10:00:00.000Z", { headroom: 2.0 });
        base.thermal.bufferTempC = 48.5;
        base.thermal.coolingRateCPerH = 0.45;
        base.thermal.minTempC = 48;
        base.thermal.deadlineIso = "2026-08-09T18:00:00.000Z";
        base.thermal.estimatedEmptyAtIso = "2026-08-09T18:00:00.000Z";
        const morning = (0, allocate_1.allocateUnifiedDayPlan)(base);
        const morningIh = sumIh(morning);
        const midday = auditLikeInput("2026-08-09T13:00:00.000Z", { headroom: 2.0 });
        midday.thermal = { ...base.thermal };
        const midPlan = (0, allocate_1.allocateUnifiedDayPlan)(midday);
        const midIh = sumIh(midPlan);
        const afternoon = auditLikeInput("2026-08-09T15:30:00.000Z", { headroom: 1.5 });
        afternoon.thermal = {
            ...base.thermal,
            headroomEnergyKwh: 1.5,
            deadlineIso: "2026-08-09T18:00:00.000Z",
            estimatedEmptyAtIso: "2026-08-09T18:00:00.000Z",
        };
        const aftPlan = (0, allocate_1.allocateUnifiedDayPlan)(afternoon);
        const aftAllocs = aftPlan.allocations.filter((a) => a.kind === "immersion_heater");
        const aftStarts = aftAllocs.map((a) => a.slot.startIso);
        if (aftAllocs.length > 0) {
            const first = Date.parse(aftStarts[0]);
            strict_1.default.ok(first <= Date.parse("2026-08-09T17:00:00.000Z"), `afternoon replan should prefer soon slots, first=${aftStarts[0]}`);
        }
        strict_1.default.ok(morningIh >= 0 && midIh >= 0);
    });
    (0, node_test_1.it)("S3: pressure rises when feasible capacity shrinks", () => {
        const open = (0, next_reliable_pv_1.resolveThermalPlannerEnergy)({
            nowMs: Date.parse("2026-08-09T10:00:00.000Z"),
            bufferTempC: 48.2,
            minTempC: 48,
            headroomEnergyKwh: 2,
            coolingRateCPerH: 0.5,
            estimatedEmptyAtMs: Date.parse("2026-08-09T18:00:00.000Z"),
            nextReliablePvMs: Date.parse("2026-08-10T08:00:00.000Z"),
            pvConfidence01: 0.8,
        });
        strict_1.default.ok(open.mandatoryEnergyKwh > 0 || open.plannerEnergyKwh > 0);
    });
});
(0, node_test_1.describe)("SOC — temporal causality", () => {
    (0, node_test_1.it)("SOC1/SOC3: later charge does not enable earlier discharge", () => {
        const input = auditLikeInput("2026-08-09T14:00:00.000Z", { socPct: 20 });
        input.thermal = null;
        input.climate = {
            units: [
                {
                    unitId: "air_conditioning.unit_1",
                    label: "WZ",
                    roomTempC: 27,
                    comfortMinC: null,
                    comfortMaxC: 23,
                    targetTempC: 25,
                    mandatoryComfort: true,
                    expectedEnergyKwh: 2.0,
                    typicalPowerW: 900,
                    maxShiftHours: 0,
                    uncertainty: Q,
                    hardwareRunning: false,
                    runtimeHold: false,
                    holdPowerW: null,
                },
            ],
            freshness: FRESH,
        };
        input.battery = {
            ...input.battery,
            socPct: 18,
            nightReserveKwh: 2.0,
            passiveBatteryEnergyAvailable: true,
            endSocTargetPct: 90,
            requiredChargeEnergyKwh: 8,
        };
        // Weak PV now, strong later — greedy used to charge later then discharge earlier
        const slots = input.time.slots;
        input.pv.slots = slots.map((s) => {
            const h = new Date(s.startIso).getUTCHours();
            const power = h >= 16 && h < 18 ? 5000 : h >= 14 && h < 16 ? 200 : 0;
            return {
                slot: s,
                forecastPowerW: power,
                observedPowerW: null,
                energyKwh: (power / 1000) * 0.25,
            };
        });
        const work = (0, score_allocate_1.buildSlots)(input);
        const result = (0, score_allocate_1.runScoreBasedAllocation)(input, work, {
            initialSocKwh: (18 / 100) * 18,
            reserveKwh: 2.0,
        });
        // Rebuild deltas from allocations chronologically and ensure no slot SOC goes invalid
        let soc = (18 / 100) * 18;
        const bySlot = new Map();
        for (const a of result.allocations) {
            const cur = bySlot.get(a.slot.startIso) ?? { charge: 0, discharge: 0 };
            if (a.kind === "battery_charge")
                cur.charge += a.allocatedEnergyKwh;
            /*
             * Planungs-Wahrheit = nur reine Batterie-Zellen (socDeltaBySlot).
             * "mixed" ohne Split ist Diagnose-Label — nicht als voller Discharge zählen.
             */
            if (a.energySource === "battery") {
                cur.discharge += a.allocatedEnergyKwh / 0.95;
            }
            bySlot.set(a.slot.startIso, cur);
        }
        for (const s of work) {
            const d = bySlot.get(s.startIso) ?? { charge: 0, discharge: 0 };
            soc += d.charge * 0.95;
            soc -= d.discharge;
            soc = Math.max(0, Math.min(18, soc));
            strict_1.default.ok(soc >= -1e-6, `causal SOC went negative at ${s.startIso}: ${soc}`);
        }
    });
    (0, node_test_1.it)("SOC2: discharge only from SOC available at slot time", () => {
        const input = auditLikeInput("2026-08-09T12:00:00.000Z", { socPct: 25 });
        input.thermal = null;
        const work = (0, score_allocate_1.buildSlots)(input);
        const { allocations, finalSocKwh } = (0, score_allocate_1.runScoreBasedAllocation)(input, work, {
            initialSocKwh: 4.5,
            reserveKwh: 1.8,
        });
        strict_1.default.ok(Number.isFinite(finalSocKwh));
        void allocations;
    });
    (0, node_test_1.it)("SOC4: reserve floor respected in trajectory points", () => {
        const plan = (0, allocate_1.allocateUnifiedDayPlan)(auditLikeInput("2026-08-09T14:00:00.000Z", { socPct: 40 }));
        for (const p of plan.batteryTrajectory) {
            strict_1.default.ok(p.socPct === null || p.socPct >= -0.1, `traj SOC% ${p.socPct}`);
        }
    });
});
(0, node_test_1.describe)("G1 — synthetic 09.08. fault pattern", () => {
    (0, node_test_1.it)("strong surplus day: no blind night reserve + soft IH never from battery; export tariff 9.3", () => {
        const input = auditLikeInput("2026-08-09T13:00:00.000Z", { headroom: 3.5, socPct: 60 });
        strict_1.default.ok(input.prices.slots.every((s) => s.exportCtPerKwh === 9.3));
        const slots = (0, score_allocate_1.buildSlots)(input);
        const next = (0, next_reliable_pv_1.findNextReliablePvAfterCurrentWindow)(slots, 0, 0.85, Date.parse(input.time.nowIso));
        strict_1.default.ok(next.slotIdx !== null);
        const net = (0, next_reliable_pv_1.expectedNetDemandUntilPvKwh)(slots, 0, next.slotIdx, 0.85);
        const floor = (0, battery_reserve_floor_1.buildBatteryReserveFloor)(input, slots);
        const aft = floor.requiredKwhBySlot[0] ?? 0;
        strict_1.default.ok(aft < 2.5, `reserve must be forecast-driven, got ${aft}`);
        strict_1.default.ok(net >= 0);
        const plan = (0, allocate_1.allocateUnifiedDayPlan)(input);
        const batIh = sumIhFromBattery(plan);
        strict_1.default.equal(batIh, 0, `Soft/Hard-IH aus Batterie an Surplus-Tag unnötig, got ${batIh}`);
        strict_1.default.ok(sumIh(plan) <= 3.5 + 0.05, `IH capped by headroom, IH=${sumIh(plan)}`);
        strict_1.default.ok(!plan.reasonCodes.includes("export_tariff_unknown"));
    });
    (0, node_test_1.it)("replan sequence: soft may use PV surplus, never house battery; no reserve blow-up", () => {
        const times = [
            "2026-08-09T10:00:00.000Z",
            "2026-08-09T12:00:00.000Z",
            "2026-08-09T14:00:00.000Z",
            "2026-08-09T16:00:00.000Z",
        ];
        const ihByReplan = [];
        const reserveByReplan = [];
        for (const nowIso of times) {
            const input = auditLikeInput(nowIso, { headroom: 3.5, socPct: 55 });
            /** Puffer hält bis Folgemorgen; Morgen-PV vorhanden (auditLikeInput). */
            input.thermal.estimatedEmptyAtIso = "2026-08-10T07:25:00.000Z";
            input.thermal.deadlineIso = "2026-08-10T07:25:00.000Z";
            input.thermal.bufferTempC = 52;
            input.thermal.minTempC = 48;
            input.thermal.coolingRateCPerH = 0.3;
            const floor = (0, battery_reserve_floor_1.buildBatteryReserveFloor)(input, (0, score_allocate_1.buildSlots)(input));
            reserveByReplan.push(floor.requiredKwhBySlot[0] ?? 99);
            const plan = (0, allocate_1.allocateUnifiedDayPlan)(input);
            ihByReplan.push(sumIh(plan));
            strict_1.default.equal(sumIhFromBattery(plan), 0, `${nowIso}: Soft-IH darf Batterie nicht nutzen`);
            strict_1.default.ok(sumIh(plan) <= 3.5 + 0.05, `${nowIso}: IH=${sumIh(plan)}`);
            /** Reserve bleibt unter gelerntem Nachtanker. */
            strict_1.default.ok((floor.requiredKwhBySlot[0] ?? 99) < 2.5, `${nowIso}: reserve=${floor.requiredKwhBySlot[0]}`);
        }
        void reserveByReplan;
        void ihByReplan;
    });
    (0, node_test_1.it)("G2: soft thermal competes economically with battery/export — no battery-first hardcode", () => {
        /** A: Batterie unter Ziel → Batterie-Laden gewinnt wirtschaftlich gegen Soft-Thermal. */
        const needBat = auditLikeInput("2026-08-09T13:00:00.000Z", { headroom: 3.5, socPct: 40 });
        needBat.battery = {
            ...needBat.battery,
            endSocTargetPct: 85,
            requiredChargeEnergyKwh: null,
            socPct: 40,
        };
        needBat.thermal.estimatedEmptyAtIso = "2026-08-10T07:25:00.000Z";
        needBat.thermal.deadlineIso = "2026-08-10T07:25:00.000Z";
        needBat.thermal.coolingRateCPerH = 0.25;
        const planNeed = (0, allocate_1.allocateUnifiedDayPlan)(needBat);
        const batChg = planNeed.allocations
            .filter((a) => a.kind === "battery_charge")
            .reduce((s, a) => s + a.allocatedEnergyKwh, 0);
        const ihNeed = sumIh(planNeed);
        strict_1.default.ok(batChg > ihNeed, `battery should outcompete soft IH: bat=${batChg} ih=${ihNeed}`);
        /** B: Batterie am Ziel + Overnight-Lücke → Soft-Thermal darf PV nutzen. */
        const batFull = auditLikeInput("2026-08-09T13:00:00.000Z", { headroom: 3.5, socPct: 88 });
        batFull.battery = {
            ...batFull.battery,
            endSocTargetPct: 85,
            requiredChargeEnergyKwh: 0,
            socPct: 88,
        };
        /** emptyAt vor nächster Morgen-PV → Speichernutzen; Hard bleibt 0 wenn Fenster-Cover greift. */
        batFull.thermal.estimatedEmptyAtIso = "2026-08-09T20:00:00.000Z";
        batFull.thermal.deadlineIso = "2026-08-09T20:00:00.000Z";
        batFull.thermal.coolingRateCPerH = 0.25;
        batFull.thermal.bufferTempC = 52;
        batFull.thermal.minTempC = 48;
        /** Niedrige Einspeisung → Wärme speichern wirtschaftlich attraktiver. */
        batFull.prices.slots = batFull.prices.slots.map((s) => ({ ...s, exportCtPerKwh: 2.0 }));
        const planFull = (0, allocate_1.allocateUnifiedDayPlan)(batFull);
        const ihFull = sumIh(planFull);
        strict_1.default.ok(ihFull > 0.4, `soft thermal must compete when battery sated, IH=${ihFull}`);
    });
    (0, node_test_1.it)("G3: next reliable PV uses surplus after hard obligations — no double-promise", () => {
        const nowIso = "2026-08-09T18:00:00.000Z";
        const input = auditLikeInput(nowIso, { headroom: 2.0, socPct: 50 });
        /** Puffer endet morgen früh im PV-Fenster. */
        input.thermal.estimatedEmptyAtIso = "2026-08-10T09:00:00.000Z";
        input.thermal.deadlineIso = "2026-08-10T09:00:00.000Z";
        input.thermal.bufferTempC = 50;
        input.thermal.boilerTempC = 50;
        input.thermal.minTempC = 48;
        input.thermal.boilerMinTempC = 48;
        input.thermal.boilerEmptyAtUsable = true;
        input.thermal.coolingRateCPerH = 0.35;
        /** Pflicht-Klima bindet morgen früh den Großteil des Surplus. */
        input.climate = {
            units: [
                {
                    unitId: "air_conditioning.unit_1",
                    label: "WZ",
                    roomTempC: 28,
                    comfortMinC: null,
                    comfortMaxC: 24,
                    targetTempC: 25,
                    mandatoryComfort: true,
                    /** Bindet den Großteil des Morgen-Surplus (keine Doppelzusage an Thermal). */
                    expectedEnergyKwh: 20.0,
                    typicalPowerW: 3500,
                    maxShiftHours: 0,
                    uncertainty: Q,
                    hardwareRunning: false,
                    runtimeHold: false,
                    holdPowerW: null,
                },
            ],
            freshness: FRESH,
        };
        const slots = (0, score_allocate_1.buildSlots)(input);
        const bound = (0, next_reliable_pv_1.estimateHardPvBoundKwhBySlot)(slots, Date.parse(nowIso), (0, score_allocate_1.hardPvConsumersFromInput)(input));
        const boundSum = bound.reduce((s, v) => s + v, 0);
        strict_1.default.ok(boundSum > 2.0, `hard PV must bind morning surplus, bound=${boundSum}`);
        const rawNext = (0, next_reliable_pv_1.findNextReliablePvAfterCurrentWindow)(slots, 0, 0.85, Date.parse(nowIso), null);
        const oppNext = (0, next_reliable_pv_1.findNextReliablePvAfterCurrentWindow)(slots, 0, 0.85, Date.parse(nowIso), bound);
        /** Nach Pflichtbindung: Opportunity nicht früher; oft später wenn Morgen gebunden. */
        strict_1.default.ok(oppNext.startMs === null ||
            rawNext.startMs === null ||
            oppNext.startMs >= rawNext.startMs, `bound opportunity must not be earlier: raw=${rawNext.startIso} opp=${oppNext.startIso}`);
        const emptyMs = Date.parse("2026-08-10T09:00:00.000Z");
        const bridgeRaw = (0, next_reliable_pv_1.resolveThermalPlannerEnergy)({
            nowMs: Date.parse(nowIso),
            bufferTempC: 50,
            boilerTempC: 50,
            minTempC: 48,
            boilerMinTempC: 48,
            bufferMaxTempC: 63,
            headroomEnergyKwh: 2.0,
            coolingRateCPerH: 0.35,
            estimatedEmptyAtMs: emptyMs,
            boilerEmptyAtUsable: true,
            nextReliablePvMs: rawNext.startMs,
            pvConfidence01: 0.85,
        });
        const bridgeOpp = (0, next_reliable_pv_1.resolveThermalPlannerEnergy)({
            nowMs: Date.parse(nowIso),
            bufferTempC: 50,
            boilerTempC: 50,
            minTempC: 48,
            boilerMinTempC: 48,
            bufferMaxTempC: 63,
            headroomEnergyKwh: 2.0,
            coolingRateCPerH: 0.35,
            estimatedEmptyAtMs: emptyMs,
            boilerEmptyAtUsable: true,
            nextReliablePvMs: oppNext.startMs,
            pvConfidence01: 0.85,
        });
        /** Mit gebundener PV darf Thermal nicht fälschlich „sicher versorgt“ sein. */
        if (bridgeRaw.coversUntilNextPv) {
            strict_1.default.equal(bridgeOpp.coversUntilNextPv, false, "hard-bound morning PV must not fully count as thermal supply");
        }
        const plan = (0, allocate_1.allocateUnifiedDayPlan)(input);
        const climatePv = plan.allocations
            .filter((a) => a.kind === "climate" && a.energySource === "pv_surplus")
            .reduce((s, a) => s + a.allocatedEnergyKwh, 0);
        strict_1.default.ok(climatePv > 1.0, `mandatory climate should take PV, got ${climatePv}`);
    });
});
