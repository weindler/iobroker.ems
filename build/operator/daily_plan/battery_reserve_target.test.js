"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const strict_1 = __importDefault(require("node:assert/strict"));
const battery_reserve_target_js_1 = require("./battery_reserve_target.js");
const SLOT_MIN = 15;
const SLOT_H = SLOT_MIN / 60;
const SLOT_MS = SLOT_MIN * 60_000;
/**
 * Baut Slots ab `startMs`: `lowHours` Stunden PV≈0 (Haus konstant `houseW`), danach
 * `highHours` Stunden starke PV (`highPvW`) — Modell für „Nacht“ unterschiedlicher Länge,
 * unabhängig von festen Uhrzeiten.
 */
function buildLowPvThenRecoverySlots(opts) {
    const slots = [];
    const lowSlots = Math.round((opts.lowHours * 60) / SLOT_MIN);
    const highSlots = Math.round((opts.highHours * 60) / SLOT_MIN);
    let t = opts.startMs;
    for (let i = 0; i < lowSlots; i++) {
        slots.push({
            startIso: new Date(t).toISOString(),
            endIso: new Date(t + SLOT_MS).toISOString(),
            startMs: t,
            pvKwh: 0,
            houseKwh: (opts.houseW / 1000) * SLOT_H,
            importCt: 30,
        });
        t += SLOT_MS;
    }
    for (let i = 0; i < highSlots; i++) {
        slots.push({
            startIso: new Date(t).toISOString(),
            endIso: new Date(t + SLOT_MS).toISOString(),
            startMs: t,
            pvKwh: (opts.highPvW / 1000) * SLOT_H,
            houseKwh: (opts.houseW / 1000) * SLOT_H,
            importCt: 20,
        });
        t += SLOT_MS;
    }
    return slots;
}
(0, node_test_1.describe)("central battery reserve target", () => {
    const nowMs = Date.parse("2026-01-15T22:00:00.000Z");
    (0, node_test_1.it)("shorter (summer-like) low-PV period yields a lower reserve than a longer (winter-like) one", () => {
        const summer = buildLowPvThenRecoverySlots({
            startMs: nowMs,
            lowHours: 6,
            highHours: 10,
            houseW: 500,
            highPvW: 3000,
        });
        const winter = buildLowPvThenRecoverySlots({
            startMs: nowMs,
            lowHours: 15,
            highHours: 10,
            houseW: 500,
            highPvW: 3000,
        });
        const common = {
            nowMs,
            pvConfidence01: 0.9,
            socPct: 80,
            usableCapacityKwh: 20,
            predictedNightConsumptionKwh: null,
            avgChargePowerW: 3000,
            contributionTargetSocPct: null,
        };
        const rSummer = (0, battery_reserve_target_js_1.resolveCentralBatteryReserveTarget)({ ...common, slots: summer });
        const rWinter = (0, battery_reserve_target_js_1.resolveCentralBatteryReserveTarget)({ ...common, slots: winter });
        strict_1.default.ok(rSummer.requiredSocAtPvEndPct !== null, "summer target should be computable");
        strict_1.default.ok(rWinter.requiredSocAtPvEndPct !== null, "winter target should be computable");
        strict_1.default.ok(rWinter.requiredSocAtPvEndPct > rSummer.requiredSocAtPvEndPct, `winter=${rWinter.requiredSocAtPvEndPct} should exceed summer=${rSummer.requiredSocAtPvEndPct}`);
        strict_1.default.ok((rWinter.hoursUntilNextReliablePv ?? 0) > (rSummer.hoursUntilNextReliablePv ?? 0), "winter reliable PV should be further away");
    });
    (0, node_test_1.it)("a weak/late follow-up PV forecast increases the reserve versus a strong/near one", () => {
        const goodForecast = buildLowPvThenRecoverySlots({
            startMs: nowMs,
            lowHours: 8,
            highHours: 10,
            houseW: 400,
            highPvW: 4000,
        });
        const badForecast = buildLowPvThenRecoverySlots({
            startMs: nowMs,
            lowHours: 8,
            highHours: 4,
            houseW: 400,
            highPvW: 600, // sehr schwache Folge-PV
        });
        const common = {
            nowMs,
            pvConfidence01: 0.9,
            socPct: 80,
            usableCapacityKwh: 20,
            predictedNightConsumptionKwh: null,
            avgChargePowerW: 3000,
            contributionTargetSocPct: null,
        };
        const rGood = (0, battery_reserve_target_js_1.resolveCentralBatteryReserveTarget)({ ...common, slots: goodForecast });
        const rBad = (0, battery_reserve_target_js_1.resolveCentralBatteryReserveTarget)({ ...common, slots: badForecast });
        strict_1.default.ok(rGood.requiredSocAtPvEndPct !== null && rBad.requiredSocAtPvEndPct !== null);
        strict_1.default.ok(rBad.requiredSocAtPvEndPct >= rGood.requiredSocAtPvEndPct, `bad=${rBad.requiredSocAtPvEndPct} should be >= good=${rGood.requiredSocAtPvEndPct}`);
    });
    (0, node_test_1.it)("low SOC yields a larger energyToTargetKwh / longer estimated charge time than high SOC", () => {
        const slots = buildLowPvThenRecoverySlots({
            startMs: nowMs,
            lowHours: 10,
            highHours: 10,
            houseW: 500,
            highPvW: 3000,
        });
        const base = {
            nowMs,
            slots,
            pvConfidence01: 0.9,
            usableCapacityKwh: 20,
            predictedNightConsumptionKwh: null,
            avgChargePowerW: 3000,
            contributionTargetSocPct: null,
        };
        const low = (0, battery_reserve_target_js_1.resolveCentralBatteryReserveTarget)({ ...base, socPct: 10 });
        const high = (0, battery_reserve_target_js_1.resolveCentralBatteryReserveTarget)({ ...base, socPct: 90 });
        strict_1.default.ok((low.energyToTargetKwh ?? 0) > (high.energyToTargetKwh ?? 0));
        strict_1.default.equal(high.energyToTargetKwh, 0);
        strict_1.default.equal(high.estimatedChargeTimeToTargetHours, null);
        strict_1.default.ok((low.estimatedChargeTimeToTargetHours ?? 0) > 0);
    });
    (0, node_test_1.it)("falls back to learned historical consumption when no forecast slots are available", () => {
        const r = (0, battery_reserve_target_js_1.resolveCentralBatteryReserveTarget)({
            nowMs,
            slots: [],
            pvConfidence01: null,
            socPct: 60,
            usableCapacityKwh: 20,
            predictedNightConsumptionKwh: 5,
            avgChargePowerW: 2000,
            contributionTargetSocPct: null,
        });
        strict_1.default.equal(r.predictedConsumptionUntilNextPvKwh, 5);
        strict_1.default.ok(r.requiredSocAtPvEndPct !== null && r.requiredSocAtPvEndPct > 0);
        strict_1.default.equal(r.nextReliablePvIso, null);
        strict_1.default.match(r.reasonDe, /gelernter Nachtverbrauch/);
    });
    (0, node_test_1.it)("real historical consumption acts as a floor when the forecast is more optimistic", () => {
        const slots = buildLowPvThenRecoverySlots({
            startMs: nowMs,
            lowHours: 4, // Forecast sagt nur kurze PV-arme Zeit voraus
            highHours: 10,
            houseW: 200,
            highPvW: 3000,
        });
        const r = (0, battery_reserve_target_js_1.resolveCentralBatteryReserveTarget)({
            nowMs,
            slots,
            pvConfidence01: 0.9,
            socPct: 80,
            usableCapacityKwh: 20,
            predictedNightConsumptionKwh: 8, // real deutlich höher als der kurze Forecast-Bedarf
            avgChargePowerW: 3000,
            contributionTargetSocPct: null,
        });
        strict_1.default.equal(r.predictedConsumptionUntilNextPvKwh, 8);
        strict_1.default.match(r.reasonDe, /max\(Forecast/);
    });
    (0, node_test_1.it)("never returns a hidden fixed fallback when both forecast and learning are missing", () => {
        const r = (0, battery_reserve_target_js_1.resolveCentralBatteryReserveTarget)({
            nowMs,
            slots: [],
            pvConfidence01: null,
            socPct: 60,
            usableCapacityKwh: 20,
            predictedNightConsumptionKwh: null,
            avgChargePowerW: null,
            contributionTargetSocPct: null,
        });
        strict_1.default.equal(r.requiredSocAtPvEndPct, null);
        strict_1.default.equal(r.requiredReserveKwh, null);
        strict_1.default.equal(r.energyToTargetKwh, null);
        strict_1.default.equal(r.estimatedBatteryEmptyAtIso, null);
        strict_1.default.match(r.reasonDe, /Weder Forecast noch gelernter Verbrauch/);
    });
    (0, node_test_1.it)("the existing battery.charge contribution target is combined in (never lowers the result)", () => {
        const slots = buildLowPvThenRecoverySlots({
            startMs: nowMs,
            lowHours: 6,
            highHours: 10,
            houseW: 300,
            highPvW: 3000,
        });
        const withoutContribution = (0, battery_reserve_target_js_1.resolveCentralBatteryReserveTarget)({
            nowMs,
            slots,
            pvConfidence01: 0.9,
            socPct: 80,
            usableCapacityKwh: 20,
            predictedNightConsumptionKwh: null,
            avgChargePowerW: 3000,
            contributionTargetSocPct: null,
        });
        const withHigherContribution = (0, battery_reserve_target_js_1.resolveCentralBatteryReserveTarget)({
            nowMs,
            slots,
            pvConfidence01: 0.9,
            socPct: 80,
            usableCapacityKwh: 20,
            predictedNightConsumptionKwh: null,
            avgChargePowerW: 3000,
            contributionTargetSocPct: 95,
        });
        strict_1.default.equal(withHigherContribution.requiredSocAtPvEndPct, 95);
        strict_1.default.ok(withHigherContribution.requiredSocAtPvEndPct >= (withoutContribution.requiredSocAtPvEndPct ?? 0));
    });
    (0, node_test_1.it)("estimatedBatteryEmptyAt is derived from the same consumption/time basis, not a third assumption", () => {
        const slots = buildLowPvThenRecoverySlots({
            startMs: nowMs,
            lowHours: 10,
            highHours: 10,
            houseW: 500,
            highPvW: 3000,
        });
        const r = (0, battery_reserve_target_js_1.resolveCentralBatteryReserveTarget)({
            nowMs,
            slots,
            pvConfidence01: 0.9,
            socPct: 50,
            usableCapacityKwh: 20,
            predictedNightConsumptionKwh: null,
            avgChargePowerW: 3000,
            contributionTargetSocPct: null,
        });
        strict_1.default.ok(r.estimatedBatteryEmptyAtIso !== null);
        const emptyMs = Date.parse(r.estimatedBatteryEmptyAtIso);
        strict_1.default.ok(emptyMs > nowMs, "empty-at must be in the future");
    });
});
