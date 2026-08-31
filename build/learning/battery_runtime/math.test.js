"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || function (mod) {
    if (mod && mod.__esModule) return mod;
    var result = {};
    if (mod != null) for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
    __setModuleDefault(result, mod);
    return result;
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const strict_1 = __importDefault(require("node:assert/strict"));
const history_1 = require("./history");
const math_1 = require("./math");
const persist_1 = require("./persist");
const time_1 = require("./time");
const constants_1 = require("./constants");
const fs = __importStar(require("node:fs/promises"));
const os = __importStar(require("node:os"));
const path = __importStar(require("node:path"));
const MS_H = 3_600_000;
function cfg() {
    return {
        enabled: true,
        lookbackDays: 90,
        socStateId: "",
        powerStateId: "",
        powerInvert: false,
        capacityStateId: "",
        secondsSinceFullStateId: "",
        fullChargeSoc: 100,
        topoffIntervalDays: 20,
        nightStart: "22:00",
        nightEnd: "06:00",
        nightAstroEnabled: false,
        nightStartStateId: "",
        nightEndStateId: "",
    };
}
function socAt(dateKey, hour, socPct) {
    return {
        ts: (0, time_1.timestampAtLocalTime)(dateKey, hour, 0),
        socPct,
    };
}
(0, node_test_1.describe)("battery runtime validation", () => {
    (0, node_test_1.it)("ignores invalid soc and null power", () => {
        strict_1.default.equal((0, history_1.isValidSoc)(null), false);
        strict_1.default.equal((0, history_1.isValidSoc)(-1), false);
        strict_1.default.equal((0, history_1.isValidSoc)(50), true);
        strict_1.default.equal((0, history_1.normalizeBatteryPowerW)(null), null);
        strict_1.default.equal((0, history_1.normalizeBatteryPowerW)(10), null);
        strict_1.default.equal((0, history_1.normalizeBatteryPowerW)(500), 500);
        strict_1.default.equal((0, history_1.normalizeBatteryPowerW)(-800), -800);
    });
    (0, node_test_1.it)("inverts power sign for sources like Sonnen pacTotal", () => {
        strict_1.default.equal((0, history_1.normalizeBatteryPowerW)(2000, true), -2000);
        strict_1.default.equal((0, history_1.normalizeBatteryPowerW)(-1500, true), 1500);
    });
});
(0, node_test_1.describe)("battery runtime night discharge", () => {
    (0, node_test_1.it)("computes average night discharge percent", () => {
        const points = [
            socAt("2026-01-05", 22, 80),
            socAt("2026-01-06", 6, 72),
            socAt("2026-01-06", 22, 78),
            socAt("2026-01-07", 6, 70),
        ];
        const r = (0, math_1.computeNightDischarges)({
            socPoints: points,
            nightStart: "22:00",
            nightEnd: "06:00",
            capacityKwh: null,
        });
        strict_1.default.equal(r.validNights, 2);
        strict_1.default.equal(r.avgPct, 8);
        strict_1.default.equal(r.avgKwh, null);
    });
    (0, node_test_1.it)("computes kwh with capacity", () => {
        const points = [
            socAt("2026-01-05", 22, 80),
            socAt("2026-01-06", 6, 70),
        ];
        const r = (0, math_1.computeNightDischarges)({
            socPoints: points,
            nightStart: "22:00",
            nightEnd: "06:00",
            capacityKwh: 10,
        });
        strict_1.default.equal(r.avgKwh, 1);
    });
    (0, node_test_1.it)("uses overnight SOC low, not morning recharge nearest sample (≈3.5 kWh)", () => {
        /** Fenster 22–07; Tief 65 % um 05:00; um 07:00 schon wieder 80 % — nearest würde unterschätzen. */
        const points = [
            socAt("2026-08-20", 22, 100),
            socAt("2026-08-21", 2, 78),
            socAt("2026-08-21", 5, 65),
            socAt("2026-08-21", 7, 80),
        ];
        const r = (0, math_1.computeNightDischarges)({
            socPoints: points,
            nightStart: "22:00",
            nightEnd: "07:00",
            capacityKwh: 10,
            nowMs: Date.parse("2026-08-21T12:00:00"),
        });
        strict_1.default.equal(r.validNights, 1);
        strict_1.default.equal(r.avgPct, 35);
        strict_1.default.equal(r.avgKwh, 3.5);
    });
    (0, node_test_1.it)("does not treat missing kwh as zero without capacity", () => {
        const r = (0, math_1.computeNightDischarges)({
            socPoints: [socAt("2026-01-05", 22, 80), socAt("2026-01-06", 6, 70)],
            nightStart: "22:00",
            nightEnd: "06:00",
            capacityKwh: null,
        });
        strict_1.default.equal(r.avgKwh, null);
    });
    (0, node_test_1.it)("uses per-day astro times with fixed fallback", () => {
        const points = [
            socAt("2026-06-20", 22, 80),
            socAt("2026-06-21", 5, 72),
        ];
        const astroDaily = (0, history_1.mergeDailyAstroTimes)([{ ts: Date.parse("2026-06-20T08:00:00"), dateKey: "2026-06-20", hour: 23, minute: 0 }], [{ ts: Date.parse("2026-06-21T08:00:00"), dateKey: "2026-06-21", hour: 4, minute: 30 }]);
        const r = (0, math_1.computeNightDischarges)({
            socPoints: points,
            nightStart: "22:00",
            nightEnd: "06:00",
            astroDaily,
            capacityKwh: null,
        });
        strict_1.default.equal(r.validNights, 1);
        strict_1.default.equal(r.avgPct, 8);
    });
    (0, node_test_1.it)("prefers battery_discharge over thin pv_house (zu wenige gültige Nächte)", () => {
        const MS = 3_600_000;
        const day0 = Date.parse("2026-08-10T00:00:00.000Z");
        const socPoints = [];
        const battery = [];
        const house = [];
        const pv = [];
        /** 5 Nächte: Batterie entlädt 20–06, SOC −25 % — belastbarer Kandidat. */
        for (let d = 0; d < 5; d++) {
            const evening = day0 + d * 86_400_000 + 20 * MS;
            const morning = day0 + (d + 1) * 86_400_000 + 6 * MS;
            socPoints.push({ ts: evening, socPct: 90 });
            socPoints.push({ ts: morning, socPct: 65 });
            for (let h = 0; h < 24; h++) {
                const ts = day0 + d * 86_400_000 + h * MS;
                const discharging = h >= 20 || h < 6;
                battery.push({ ts, powerW: discharging ? -400 : 500 });
                house.push({ ts, powerW: 400 });
                /** Nur eine Nacht PV-Defizit → pv_house dünn; Batterie-Serie bleibt dicht. */
                const pvDeficit = d === 0 && (h >= 19 || h < 7);
                pv.push({ ts, powerW: pvDeficit ? 0 : 3000 });
            }
        }
        const r = (0, math_1.computeNightDischarges)({
            socPoints,
            nightStart: "22:00",
            nightEnd: "06:00",
            capacityKwh: 10,
            pvPowerPoints: pv,
            housePowerPoints: house,
            batteryPowerPoints: battery,
            nowMs: day0 + 6 * 86_400_000,
        });
        strict_1.default.equal(r.method, "battery_discharge");
        strict_1.default.ok(r.validNights >= 3, `validNights=${r.validNights}`);
        strict_1.default.ok((r.avgKwh ?? 0) >= 2, `avgKwh=${r.avgKwh}`);
    });
    (0, node_test_1.it)("prefers denser battery_discharge over barely-ok pv_house (≥ MIN_VALID_NIGHTS)", () => {
        const MS = 3_600_000;
        const day0 = Date.parse("2026-08-01T00:00:00.000Z");
        const socPoints = [];
        const battery = [];
        const house = [];
        const pv = [];
        /** 10 Nächte Batterie −25 %; nur 4 Nächte mit PV-Defizit (≥3, aber dünn). */
        for (let d = 0; d < 10; d++) {
            const evening = day0 + d * 86_400_000 + 20 * MS;
            const morning = day0 + (d + 1) * 86_400_000 + 6 * MS;
            socPoints.push({ ts: evening, socPct: 90 });
            socPoints.push({ ts: morning, socPct: 65 });
            for (let h = 0; h < 24; h++) {
                const ts = day0 + d * 86_400_000 + h * MS;
                const discharging = h >= 20 || h < 6;
                battery.push({ ts, powerW: discharging ? -400 : 500 });
                house.push({ ts, powerW: 400 });
                const pvDeficit = d < 4 && (h >= 19 || h < 7);
                pv.push({ ts, powerW: pvDeficit ? 0 : 3000 });
            }
        }
        const r = (0, math_1.computeNightDischarges)({
            socPoints,
            nightStart: "22:00",
            nightEnd: "06:00",
            capacityKwh: 10,
            pvPowerPoints: pv,
            housePowerPoints: house,
            batteryPowerPoints: battery,
            nowMs: day0 + 11 * 86_400_000,
        });
        strict_1.default.equal(r.method, "battery_discharge");
        strict_1.default.ok(r.validNights >= 7, `validNights=${r.validNights}`);
        strict_1.default.ok((r.avgKwh ?? 0) >= 2, `avgKwh=${r.avgKwh}`);
    });
    (0, node_test_1.it)("fixed_clock gewinnt nie gegen belastbares pv_house (auch bei mehr Uhr-Nächten)", () => {
        const MS = 3_600_000;
        const day0 = Date.parse("2026-06-01T00:00:00.000Z");
        const socPoints = [];
        const battery = [];
        const house = [];
        const pv = [];
        /*
         * 30 SOC-Nächte (fixed_clock hätte 29 Fenster), aber PV/Haus-Defizit nur in den
         * letzten 8 Nächten — früher hätte Dominanz fixed_clock gewählt.
         */
        for (let d = 0; d < 30; d++) {
            const evening = day0 + d * 86_400_000 + 20 * MS;
            const morning = day0 + (d + 1) * 86_400_000 + 6 * MS;
            socPoints.push({ ts: evening, socPct: 90 });
            socPoints.push({ ts: morning, socPct: 70 });
            for (let h = 0; h < 24; h++) {
                const ts = day0 + d * 86_400_000 + h * MS;
                const isNight = h >= 20 || h < 6;
                battery.push({ ts, powerW: isNight ? -300 : 400 });
                house.push({ ts, powerW: 300 });
                const pvDeficit = d >= 22 && isNight;
                pv.push({ ts, powerW: pvDeficit ? 0 : 2500 });
            }
        }
        const r = (0, math_1.computeNightDischarges)({
            socPoints,
            nightStart: "22:00",
            nightEnd: "06:00",
            capacityKwh: 10,
            pvPowerPoints: pv,
            housePowerPoints: house,
            batteryPowerPoints: battery,
            nowMs: day0 + 31 * 86_400_000,
        });
        strict_1.default.notEqual(r.method, "fixed_clock");
        strict_1.default.ok(r.method === "pv_house" || r.method === "battery_discharge", `method=${r.method}`);
        strict_1.default.ok(r.validNights >= constants_1.MIN_VALID_NIGHTS, `validNights=${r.validNights}`);
    });
});
(0, node_test_1.describe)("battery runtime night consumption + dynamic reserve (konsolidiert, SOC-first)", () => {
    function buildTenNightPvHouseScenario() {
        const MS = 3_600_000;
        const day0 = Date.parse("2026-01-10T00:00:00.000Z");
        const socPoints = [];
        const battery = [];
        const house = [];
        const pv = [];
        /** 10 gleiche Nächte: 20–06 Uhr (10 h) PV=0, Haus 500 W konstant, Batterie deckt das Defizit. */
        for (let d = 0; d < 10; d++) {
            const evening = day0 + d * 86_400_000 + 20 * MS;
            const morning = day0 + (d + 1) * 86_400_000 + 6 * MS;
            socPoints.push({ ts: evening, socPct: 90 });
            socPoints.push({ ts: morning, socPct: 65 });
            for (let h = 0; h < 24; h++) {
                const ts = day0 + d * 86_400_000 + h * MS;
                const isNight = h >= 20 || h < 6;
                battery.push({ ts, powerW: isNight ? -500 : 300 });
                house.push({ ts, powerW: 500 });
                pv.push({ ts, powerW: isNight ? 0 : 3000 });
            }
        }
        return { socPoints, battery, house, pv, day0 };
    }
    (0, node_test_1.it)("normale SOC-Nacht: computeNightHouseLoadDiagnostic bleibt reine Diagnose über dieselben Fenster", () => {
        const { socPoints, battery, house, pv, day0 } = buildTenNightPvHouseScenario();
        const nowMs = day0 + 11 * 86_400_000;
        const discharge = (0, math_1.computeNightDischarges)({
            socPoints,
            nightStart: "22:00",
            nightEnd: "06:00",
            capacityKwh: 20,
            pvPowerPoints: pv,
            housePowerPoints: house,
            batteryPowerPoints: battery,
            nowMs,
        });
        strict_1.default.equal(discharge.method, "pv_house");
        strict_1.default.ok(discharge.windows.length >= 8, `windows=${discharge.windows.length}`);
        // Führende Größe: reine SOC-Entladung (90→65 % auf 20 kWh = 5 kWh).
        strict_1.default.ok(discharge.avgKwh !== null && discharge.avgKwh > 4.5 && discharge.avgKwh < 5.5, `avgKwh=${discharge.avgKwh}`);
        const houseLoad = (0, math_1.computeNightHouseLoadDiagnostic)({
            windows: discharge.windows,
            housePowerPoints: house,
            nightStart: "22:00",
            nightEnd: "06:00",
            nowMs,
        });
        // 500 W über ~10 h Nachtfenster ≈ 5 kWh/Nacht — Diagnose, keine Reserve-Größe.
        strict_1.default.ok(houseLoad.avgKwh !== null && houseLoad.avgKwh > 4.5 && houseLoad.avgKwh < 5.5, `avgKwh=${houseLoad.avgKwh}`);
        strict_1.default.ok(houseLoad.validNights >= 8, `validNights=${houseLoad.validNights}`);
    });
    (0, node_test_1.it)("computeBatteryRuntimeLearning veröffentlicht predictedNightConsumptionKwh, avgNightLoadW und dynamische Reserve", () => {
        const { socPoints, battery, house, pv, day0 } = buildTenNightPvHouseScenario();
        const nowMs = day0 + 11 * 86_400_000;
        const r = (0, math_1.computeBatteryRuntimeLearning)({
            socPoints,
            secondsSinceFull: null,
            powerPoints: battery,
            pvPowerPoints: pv,
            housePowerPoints: house,
            capacityKwh: 20,
            currentSocPct: 80,
            cfg: cfg(),
            sourceSocStateId: "x",
            sourcePowerStateId: "y",
            now: new Date(nowMs),
            sampleDays: 11,
        });
        strict_1.default.ok(r.predictedNightConsumptionKwh !== null && r.predictedNightConsumptionKwh > 4.5, `predictedNightConsumptionKwh=${r.predictedNightConsumptionKwh}`);
        // Batterie deckt fast die gesamte Nachtlast → Netzbezug nahe 0.
        strict_1.default.ok((r.predictedNightGridImportKwh ?? 0) < 1, `predictedNightGridImportKwh=${r.predictedNightGridImportKwh}`);
        // avgNightLoadW muss ~500 W ergeben (Hauslast-Eingabe), keine Verzerrung durch falsche Stundenbasis.
        strict_1.default.ok(r.avgNightLoadW !== null && r.avgNightLoadW > 400 && r.avgNightLoadW < 600, `avgNightLoadW=${r.avgNightLoadW}`);
        // Reserve: predictedNightConsumptionKwh(~5) * 1.2 / capacityKwh(20) * 100 ≈ 30 %.
        strict_1.default.ok(r.requiredSocAtPvEndPct !== null && r.requiredSocAtPvEndPct > 20 && r.requiredSocAtPvEndPct < 40, `requiredSocAtPvEndPct=${r.requiredSocAtPvEndPct}`);
        strict_1.default.ok(r.nightReserveReasonDe.length > 0);
    });
    (0, node_test_1.it)("nutzt SOC-/Batterie-Nachtenergie wenn Hausverbrauch fehlt (kein versteckter Fallback-Prozent)", () => {
        const { socPoints, battery, pv, day0 } = buildTenNightPvHouseScenario();
        const nowMs = day0 + 11 * 86_400_000;
        const r = (0, math_1.computeBatteryRuntimeLearning)({
            socPoints,
            secondsSinceFull: null,
            powerPoints: battery,
            pvPowerPoints: pv,
            housePowerPoints: [],
            capacityKwh: 20,
            currentSocPct: 80,
            cfg: cfg(),
            sourceSocStateId: "x",
            sourcePowerStateId: "y",
            now: new Date(nowMs),
            sampleDays: 11,
        });
        // SOC 90→65 auf 20 kWh = 5 kWh; Batterie −500 W × ~10 h ≈ 5 kWh.
        strict_1.default.ok(r.predictedNightConsumptionKwh !== null && r.predictedNightConsumptionKwh > 4, `predictedNightConsumptionKwh=${r.predictedNightConsumptionKwh}`);
        strict_1.default.ok(r.requiredSocAtPvEndPct !== null && r.requiredSocAtPvEndPct > 20, `requiredSocAtPvEndPct=${r.requiredSocAtPvEndPct}`);
    });
    (0, node_test_1.it)("liefert null wenn weder Haus- noch Batterie-/SOC-Nachtenergie belastbar ist", () => {
        const r = (0, math_1.computeBatteryRuntimeLearning)({
            socPoints: [],
            secondsSinceFull: null,
            powerPoints: [],
            pvPowerPoints: [],
            housePowerPoints: [],
            capacityKwh: 20,
            currentSocPct: 80,
            cfg: cfg(),
            sourceSocStateId: "x",
            sourcePowerStateId: "y",
            now: new Date(),
            sampleDays: 0,
        });
        strict_1.default.equal(r.predictedNightConsumptionKwh, null);
        strict_1.default.equal(r.requiredSocAtPvEndPct, null);
        strict_1.default.match(r.nightReserveReasonDe, /Nachtverbrauch/);
    });
    (0, node_test_1.it)("predictedNightConsumptionKwh folgt SOC, nicht Batterie-Peaks", () => {
        const MS = 3_600_000;
        const day0 = Date.parse("2026-01-10T00:00:00.000Z");
        const socPoints = [];
        const battery = [];
        const house = [];
        const pv = [];
        /*
         * SOC 100→65 auf 10 kWh = 3.5 kWh. Batterie-Peak-Serie −3000 W/h würde
         * integriert ~30+ kWh vortäuschen — darf predicted nicht treiben.
         */
        for (let d = 0; d < 10; d++) {
            const evening = day0 + d * 86_400_000 + 20 * MS;
            const morning = day0 + (d + 1) * 86_400_000 + 6 * MS;
            socPoints.push({ ts: evening, socPct: 100 });
            socPoints.push({ ts: morning, socPct: 65 });
            for (let h = 0; h < 24; h++) {
                const ts = day0 + d * 86_400_000 + h * MS;
                const isNight = h >= 20 || h < 6;
                battery.push({ ts, powerW: isNight ? -3000 : 500 });
                house.push({ ts, powerW: isNight ? 350 : 400 });
                pv.push({ ts, powerW: isNight ? 0 : 3000 });
            }
        }
        const r = (0, math_1.computeBatteryRuntimeLearning)({
            socPoints,
            secondsSinceFull: null,
            powerPoints: battery,
            pvPowerPoints: pv,
            housePowerPoints: house,
            capacityKwh: 10,
            currentSocPct: 80,
            cfg: cfg(),
            sourceSocStateId: "x",
            sourcePowerStateId: "y",
            now: new Date(day0 + 11 * 86_400_000),
            sampleDays: 11,
        });
        strict_1.default.ok(r.predictedNightConsumptionKwh !== null &&
            r.predictedNightConsumptionKwh >= 3.2 &&
            r.predictedNightConsumptionKwh <= 4.5, `predictedNightConsumptionKwh=${r.predictedNightConsumptionKwh}`);
        strict_1.default.ok(r.requiredNightReserveKwh !== null && r.requiredNightReserveKwh <= 10, `requiredNightReserveKwh=${r.requiredNightReserveKwh}`);
        strict_1.default.ok((r.requiredSocAtPvEndPct ?? 0) < 60, `requiredSocAtPvEndPct=${r.requiredSocAtPvEndPct}`);
    });
    (0, node_test_1.it)("hohe Hauslast/EV bei geringer Batterieentladung: predictedNightConsumptionKwh folgt ausschließlich SOC, nie Haus", () => {
        const MS = 3_600_000;
        const day0 = Date.parse("2026-01-10T00:00:00.000Z");
        const socPoints = [];
        const battery = [];
        const house = [];
        const pv = [];
        /*
         * Hauslast-Historie ist niedrig (~200 W ≈ 2 kWh/Nacht — teils Netzbezug außerhalb der
         * Batterie), reale Batterie entlädt SOC 100→63 auf 10 kWh = 3.7 kWh. Die Reserve-Basis
         * MUSS exakt dem SOC-Delta folgen — weder auf Haus (2 kWh) herunterziehen noch aus
         * einem max()-Vergleich höher werden als das reale SOC-Delta.
         */
        for (let d = 0; d < 10; d++) {
            const evening = day0 + d * 86_400_000 + 20 * MS;
            const morning = day0 + (d + 1) * 86_400_000 + 6 * MS;
            socPoints.push({ ts: evening, socPct: 100 });
            socPoints.push({ ts: morning, socPct: 63 });
            for (let h = 0; h < 24; h++) {
                const ts = day0 + d * 86_400_000 + h * MS;
                const isNight = h >= 20 || h < 6;
                battery.push({ ts, powerW: isNight ? -400 : 300 });
                house.push({ ts, powerW: isNight ? 200 : 400 });
                pv.push({ ts, powerW: isNight ? 0 : 3000 });
            }
        }
        const r = (0, math_1.computeBatteryRuntimeLearning)({
            socPoints,
            secondsSinceFull: null,
            powerPoints: battery,
            pvPowerPoints: pv,
            housePowerPoints: house,
            capacityKwh: 10,
            currentSocPct: 80,
            cfg: cfg(),
            sourceSocStateId: "x",
            sourcePowerStateId: "y",
            now: new Date(day0 + 11 * 86_400_000),
            sampleDays: 11,
        });
        // Exakt SOC-Delta (100 − 63 % auf 10 kWh = 3.7 kWh) — weder Haus-only (~2) noch darüber.
        strict_1.default.ok(r.predictedNightConsumptionKwh !== null &&
            r.predictedNightConsumptionKwh > 3.5 &&
            r.predictedNightConsumptionKwh < 3.9, `predictedNightConsumptionKwh=${r.predictedNightConsumptionKwh} (erwartet ≈3.7, SOC-exakt)`);
        strict_1.default.equal(r.avgNightDischargeKwh, r.predictedNightConsumptionKwh);
        // Diagnose: Netzbezug > 0, weil Haus (2 kWh) niedriger als SOC-Bedarf ist — beeinflusst Reserve nicht.
        strict_1.default.equal(r.predictedNightGridImportKwh, 0);
        strict_1.default.equal(r.nightBridgeMethod, "pv_house");
        strict_1.default.ok(r.requiredNightReserveKwh !== null &&
            r.requiredNightReserveKwh > 3.7 * 1.2 - 0.05 &&
            r.requiredNightReserveKwh < 3.7 * 1.2 + 0.05, `requiredNightReserveKwh=${r.requiredNightReserveKwh}`);
    });
    (0, node_test_1.it)("Zwischenladung mitten in der Nacht: Netzladung vor dem Tiefpunkt schließt die Nacht aus der Reserve-Basis aus", () => {
        const MS = 3_600_000;
        const day0 = Date.parse("2026-01-10T00:00:00.000Z");
        const socPoints = [];
        const battery = [];
        const house = [];
        const pv = [];
        for (let d = 0; d < 10; d++) {
            const evening = day0 + d * 86_400_000 + 20 * MS;
            const morning = day0 + (d + 1) * 86_400_000 + 6 * MS;
            const interimChargeNight = d === 5;
            socPoints.push({ ts: evening, socPct: 90 });
            if (interimChargeNight) {
                /*
                 * 90 → 65 (normaler Abfall) → 95 (Netzladung mitten in der Nacht) → 55 (danach
                 * weiter entladen). Tiefpunkt ist 55 %, aber die +30-%-Zwischenladung DAVOR
                 * verfälscht den einfachen Start-Ende-Wert (90 − 55 = 35 %, ohne Zwischenladung
                 * wäre die Nacht wie die anderen bei ~25 % gelegen).
                 */
                socPoints.push({ ts: evening + 4 * MS, socPct: 65 });
                socPoints.push({ ts: evening + 6 * MS, socPct: 95 });
                socPoints.push({ ts: morning - 1 * MS, socPct: 55 });
            }
            socPoints.push({ ts: morning, socPct: interimChargeNight ? 60 : 65 });
            for (let h = 0; h < 24; h++) {
                const ts = day0 + d * 86_400_000 + h * MS;
                const isNight = h >= 20 || h < 6;
                battery.push({ ts, powerW: isNight ? -500 : 300 });
                house.push({ ts, powerW: 500 });
                pv.push({ ts, powerW: isNight ? 0 : 3000 });
            }
        }
        const discharge = (0, math_1.computeNightDischarges)({
            socPoints,
            nightStart: "22:00",
            nightEnd: "06:00",
            capacityKwh: 20,
            pvPowerPoints: pv,
            housePowerPoints: house,
            batteryPowerPoints: battery,
            nowMs: day0 + 11 * 86_400_000,
        });
        // Genau eine Nacht weniger als insgesamt erkannte Fenster — nur die Zwischenladungsnacht
        // (d=5) fällt heraus, sonst keine.
        strict_1.default.equal(discharge.validNights, discharge.windows.length - 1, `validNights=${discharge.validNights} windows=${discharge.windows.length}`);
        strict_1.default.ok(discharge.avgKwh !== null && discharge.avgKwh > 4.5 && discharge.avgKwh < 5.5, `avgKwh=${discharge.avgKwh} (Zwischenladungsnacht darf nicht mit 90−55=35 % einfließen)`);
    });
    (0, node_test_1.it)("Sondernacht mit Netzladung (SOC steigt) fließt nicht in die Reserve-Basis", () => {
        const MS = 3_600_000;
        const day0 = Date.parse("2026-01-10T00:00:00.000Z");
        const socPoints = [];
        const battery = [];
        const house = [];
        const pv = [];
        for (let d = 0; d < 10; d++) {
            const evening = day0 + d * 86_400_000 + 20 * MS;
            const morning = day0 + (d + 1) * 86_400_000 + 6 * MS;
            const chargeNight = d === 5;
            socPoints.push({ ts: evening, socPct: chargeNight ? 40 : 90 });
            socPoints.push({ ts: morning, socPct: chargeNight ? 80 : 65 });
            for (let h = 0; h < 24; h++) {
                const ts = day0 + d * 86_400_000 + h * MS;
                const isNight = h >= 20 || h < 6;
                battery.push({ ts, powerW: isNight ? (chargeNight ? 1500 : -500) : 300 });
                house.push({ ts, powerW: 500 });
                pv.push({ ts, powerW: isNight ? 0 : 3000 });
            }
        }
        const r = (0, math_1.computeBatteryRuntimeLearning)({
            socPoints,
            secondsSinceFull: null,
            powerPoints: battery,
            pvPowerPoints: pv,
            housePowerPoints: house,
            capacityKwh: 20,
            currentSocPct: 80,
            cfg: cfg(),
            sourceSocStateId: "x",
            sourcePowerStateId: "y",
            now: new Date(day0 + 11 * 86_400_000),
            sampleDays: 11,
        });
        // Ohne die Ladenacht bleibt ~5 kWh; die Ladenacht darf nicht nach unten/oben verzerren.
        strict_1.default.ok(r.predictedNightConsumptionKwh !== null &&
            r.predictedNightConsumptionKwh > 4.5 &&
            r.predictedNightConsumptionKwh < 5.5, `predictedNightConsumptionKwh=${r.predictedNightConsumptionKwh}`);
    });
    (0, node_test_1.it)("extrem hohe Hauslast (EV) ohne Batterie-Entladung wird nicht als Reserve übernommen", () => {
        const MS = 3_600_000;
        const day0 = Date.parse("2026-01-10T00:00:00.000Z");
        const socPoints = [];
        const battery = [];
        const house = [];
        const pv = [];
        for (let d = 0; d < 10; d++) {
            const evening = day0 + d * 86_400_000 + 20 * MS;
            const morning = day0 + (d + 1) * 86_400_000 + 6 * MS;
            const evNight = d === 3;
            socPoints.push({ ts: evening, socPct: 90 });
            socPoints.push({ ts: morning, socPct: 65 });
            for (let h = 0; h < 24; h++) {
                const ts = day0 + d * 86_400_000 + h * MS;
                const isNight = h >= 20 || h < 6;
                battery.push({ ts, powerW: isNight ? -500 : 300 });
                house.push({ ts, powerW: isNight ? (evNight ? 7000 : 500) : 400 });
                pv.push({ ts, powerW: isNight ? 0 : 3000 });
            }
        }
        const r = (0, math_1.computeBatteryRuntimeLearning)({
            socPoints,
            secondsSinceFull: null,
            powerPoints: battery,
            pvPowerPoints: pv,
            housePowerPoints: house,
            capacityKwh: 20,
            currentSocPct: 80,
            cfg: cfg(),
            sourceSocStateId: "x",
            sourcePowerStateId: "y",
            now: new Date(day0 + 11 * 86_400_000),
            sampleDays: 11,
        });
        // EV-Nacht (~70 kWh Haus, aber Batterie entlädt wie jede andere Nacht) darf die
        // Reserve-Basis gar nicht beeinflussen — sie kommt ausschließlich aus SOC, nicht aus Haus.
        strict_1.default.ok(r.predictedNightConsumptionKwh !== null &&
            r.predictedNightConsumptionKwh > 4.5 &&
            r.predictedNightConsumptionKwh < 5.5, `predictedNightConsumptionKwh=${r.predictedNightConsumptionKwh} (erwartet ≈5, unbeeinflusst von EV-Haus)`);
    });
    (0, node_test_1.it)("PFLICHT-FIX 1 Korrektur: belastbar zurechenbare Netzausgleichs-Energie wird von der SOC-basierten Nachtentladung abgezogen", () => {
        const { socPoints, battery, house, pv, day0 } = buildTenNightPvHouseScenario();
        const gridBalance = [];
        for (let d = 0; d < 10; d++) {
            for (let h = 0; h < 24; h++) {
                const ts = day0 + d * 86_400_000 + h * MS_H;
                const isNight = h >= 20 || h < 6;
                // EMS zieht während der gesamten Nachtbrücke zusätzlich 200 W für Netzausgleich.
                gridBalance.push({ ts, powerW: isNight ? 200 : 0 });
            }
        }
        const nowMs = day0 + 11 * 86_400_000;
        const baseline = (0, math_1.computeNightDischarges)({
            socPoints,
            nightStart: "22:00",
            nightEnd: "06:00",
            capacityKwh: 20,
            pvPowerPoints: pv,
            housePowerPoints: house,
            batteryPowerPoints: battery,
            nowMs,
        });
        const withGb = (0, math_1.computeNightDischarges)({
            socPoints,
            nightStart: "22:00",
            nightEnd: "06:00",
            capacityKwh: 20,
            pvPowerPoints: pv,
            housePowerPoints: house,
            batteryPowerPoints: battery,
            gridBalancePowerPoints: gridBalance,
            nowMs,
        });
        strict_1.default.ok(baseline.avgKwh !== null && withGb.avgKwh !== null);
        // ~10 h × 200 W ≈ 2 kWh Netzausgleichs-Anteil muss klar unterhalb des Baseline-Werts liegen.
        strict_1.default.ok(withGb.avgKwh < baseline.avgKwh - 1, `withGb=${withGb.avgKwh} baseline=${baseline.avgKwh}`);
        strict_1.default.ok(withGb.gridBalanceAttributedNights > 0, `attributed=${withGb.gridBalanceAttributedNights}`);
        strict_1.default.equal(withGb.gridBalanceExcludedNights, 0);
        // Ohne jegliche Netzausgleichs-Historie (leeres Array) bleibt das Verhalten unverändert.
        const withEmptyGb = (0, math_1.computeNightDischarges)({
            socPoints,
            nightStart: "22:00",
            nightEnd: "06:00",
            capacityKwh: 20,
            pvPowerPoints: pv,
            housePowerPoints: house,
            batteryPowerPoints: battery,
            gridBalancePowerPoints: [],
            nowMs,
        });
        strict_1.default.equal(withEmptyGb.avgKwh, baseline.avgKwh);
    });
    (0, node_test_1.it)("PFLICHT-FIX 1 Korrektur: nicht belastbar bestimmbarer Netzausgleichs-Anteil einer einzelnen Nacht schließt genau diese Nacht aus, statt zu schätzen", () => {
        const { socPoints, battery, house, pv, day0 } = buildTenNightPvHouseScenario();
        /*
         * `integratePowerKwh` überbrückt kleine Lücken über die nächsten Nachbarpunkte
         * (energieerhaltende Interpolation) — die Lücke muss daher so breit sein, dass auch
         * die Nachbarpunkte außerhalb der ±1h-Toleranz um das Fenster liegen, sonst würde die
         * Coverage-Prüfung fälschlich "0 W durchgehend" statt "unbekannt" ergeben.
         */
        const gapStart = day0 + 3 * 86_400_000 + 17 * MS_H;
        const gapEnd = day0 + 4 * 86_400_000 + 9 * MS_H;
        const gridBalance = [];
        for (let d = 0; d < 10; d++) {
            for (let h = 0; h < 24; h++) {
                const ts = day0 + d * 86_400_000 + h * MS_H;
                // Lücke: für exakt EIN Fenster (Abend Tag 3 → Morgen Tag 4) liegt keine
                // Netzausgleichs-Historie vor — nicht raten, Sample ausschließen.
                if (ts >= gapStart && ts < gapEnd)
                    continue;
                gridBalance.push({ ts, powerW: 0 });
            }
        }
        const nowMs = day0 + 11 * 86_400_000;
        const baseline = (0, math_1.computeNightDischarges)({
            socPoints,
            nightStart: "22:00",
            nightEnd: "06:00",
            capacityKwh: 20,
            pvPowerPoints: pv,
            housePowerPoints: house,
            batteryPowerPoints: battery,
            nowMs,
        });
        const withGb = (0, math_1.computeNightDischarges)({
            socPoints,
            nightStart: "22:00",
            nightEnd: "06:00",
            capacityKwh: 20,
            pvPowerPoints: pv,
            housePowerPoints: house,
            batteryPowerPoints: battery,
            gridBalancePowerPoints: gridBalance,
            nowMs,
        });
        strict_1.default.equal(withGb.validNights, baseline.validNights - 1, `withGb=${withGb.validNights} baseline=${baseline.validNights}`);
        strict_1.default.ok(withGb.gridBalanceExcludedNights >= 1, `excluded=${withGb.gridBalanceExcludedNights}`);
    });
});
(0, node_test_1.describe)("battery runtime astro parse", () => {
    (0, node_test_1.it)("parses HH:MM:SS astro strings", () => {
        strict_1.default.deepEqual((0, history_1.parseAstroTimeValue)("22:03:12"), { hour: 22, minute: 3 });
        strict_1.default.deepEqual((0, history_1.parseAstroTimeValue)("04:22:52"), { hour: 4, minute: 22 });
        strict_1.default.equal((0, history_1.parseAstroTimeValue)(""), null);
    });
});
(0, node_test_1.describe)("battery runtime rates and power", () => {
    (0, node_test_1.it)("separates charge and discharge soc rates", () => {
        const points = [
            { ts: 0, socPct: 50 },
            { ts: MS_H, socPct: 55 },
            { ts: 2 * MS_H, socPct: 52 },
        ];
        const r = (0, math_1.computeSocRates)(points);
        strict_1.default.equal(r.avgChargeRatePctH, 5);
        strict_1.default.equal(r.avgDischargeRatePctH, 3);
    });
    (0, node_test_1.it)("computes max charge and discharge power", () => {
        const points = [
            { ts: 0, powerW: 2000 },
            { ts: MS_H, powerW: -1500 },
            { ts: 2 * MS_H, powerW: 3000 },
        ];
        const r = (0, math_1.computePowerStats)(points);
        strict_1.default.equal(r.maxChargePowerW, 3000);
        strict_1.default.equal(r.maxDischargePowerW, 1500);
        strict_1.default.equal(r.avgChargePowerW, 2500);
        strict_1.default.equal(r.avgDischargePowerW, 1500);
    });
});
(0, node_test_1.describe)("battery runtime full charge and topoff", () => {
    (0, node_test_1.it)("detects last full charge at 100%", () => {
        const points = [
            { ts: Date.parse("2026-01-01T10:00:00Z"), socPct: 90 },
            { ts: Date.parse("2026-01-10T10:00:00Z"), socPct: 100 },
            { ts: Date.parse("2026-01-11T10:00:00Z"), socPct: 92 },
        ];
        strict_1.default.equal((0, math_1.findLastFullCharge)(points, 100), "2026-01-10T10:00:00.000Z");
    });
    (0, node_test_1.it)("does not treat 95% as full when threshold is 100%", () => {
        const points = [{ ts: Date.parse("2026-06-30T10:00:00Z"), socPct: 95 }];
        strict_1.default.equal((0, math_1.findLastFullCharge)(points, 100), null);
    });
    (0, node_test_1.it)("detects full charge peak missed by hourly dedup", () => {
        const hourly = [
            { ts: Date.parse("2026-06-30T09:00:00Z"), socPct: 88 },
            { ts: Date.parse("2026-06-30T10:00:00Z"), socPct: 91 },
        ];
        const raw = [
            ...hourly,
            { ts: Date.parse("2026-06-30T09:45:00Z"), socPct: 100 },
        ];
        strict_1.default.equal((0, math_1.findLastFullCharge)(hourly, 100), null);
        strict_1.default.equal((0, math_1.findLastFullCharge)(raw, 100), "2026-06-30T09:45:00.000Z");
    });
    (0, node_test_1.it)("prefers live soc when currently full", () => {
        const points = [{ ts: Date.parse("2026-06-29T10:00:00Z"), socPct: 100 }];
        const liveTs = Date.parse("2026-06-30T14:00:00Z");
        strict_1.default.equal((0, math_1.findLastFullCharge)(points, 100, { socPct: 100, ts: liveTs }), "2026-06-30T14:00:00.000Z");
    });
    (0, node_test_1.it)("uses Sonnen secondsSinceFullCharge when available", () => {
        const now = new Date("2026-07-01T12:00:00.000Z");
        const seconds = 86_400;
        const resolved = (0, math_1.resolveLastFullCharge)({
            secondsSinceFull: seconds,
            socPointsForFullCharge: [],
            fullChargeSoc: 100,
            currentSocPct: 80,
            now,
        });
        strict_1.default.equal(resolved.fullChargeSource, "device");
        strict_1.default.equal(resolved.lastFullCharge, (0, math_1.fullChargeFromSecondsSince)(seconds, now));
        const topoff = (0, math_1.computeTopoffStatus)({
            lastFullCharge: resolved.lastFullCharge,
            topoffIntervalDays: 20,
            now,
        });
        strict_1.default.equal(topoff.daysSinceFull, 1);
    });
    (0, node_test_1.it)("falls back to soc history when device counter missing", () => {
        const now = new Date("2026-07-01T12:00:00.000Z");
        const resolved = (0, math_1.resolveLastFullCharge)({
            secondsSinceFull: null,
            socPointsForFullCharge: [
                { ts: Date.parse("2026-06-30T10:00:00Z"), socPct: 100 },
            ],
            fullChargeSoc: 100,
            currentSocPct: 80,
            now,
        });
        strict_1.default.equal(resolved.fullChargeSource, "soc_history");
        strict_1.default.equal(resolved.lastFullCharge, "2026-06-30T10:00:00.000Z");
    });
    (0, node_test_1.it)("computes topoff remaining and due", () => {
        const now = new Date("2026-01-25T12:00:00Z");
        const r = (0, math_1.computeTopoffStatus)({
            lastFullCharge: "2026-01-01T12:00:00.000Z",
            topoffIntervalDays: 20,
            now,
        });
        strict_1.default.equal(r.daysSinceFull, 24);
        strict_1.default.equal(r.topoffDaysRemaining, 0);
        strict_1.default.equal(r.topoffDue, true);
    });
    (0, node_test_1.it)("counts calendar days since full charge (yesterday = 1)", () => {
        const r = (0, math_1.computeTopoffStatus)({
            lastFullCharge: "2026-06-30T20:00:00.000Z",
            topoffIntervalDays: 20,
            now: new Date("2026-07-01T15:00:00.000Z"),
        });
        strict_1.default.equal(r.daysSinceFull, 1);
        strict_1.default.equal(r.topoffDaysRemaining, 19);
    });
    (0, node_test_1.it)("returns null topoff without full charge history", () => {
        const r = (0, math_1.computeTopoffStatus)({
            lastFullCharge: null,
            topoffIntervalDays: 20,
            now: new Date(),
        });
        strict_1.default.equal(r.daysSinceFull, null);
        strict_1.default.equal(r.topoffDue, null);
    });
});
(0, node_test_1.describe)("battery runtime compute", () => {
    (0, node_test_1.it)("estimates runtime days from night discharge", () => {
        strict_1.default.equal((0, math_1.estimateRuntimeDays)(80, 8), 10);
        strict_1.default.equal((0, math_1.estimateRuntimeDays)(80, null), null);
    });
    (0, node_test_1.it)("no_source without soc mapping", () => {
        const r = (0, math_1.noSourceResult)(cfg());
        strict_1.default.equal(r.status, "no_source");
        strict_1.default.equal(r.avgNightDischargePct, null);
    });
});
(0, node_test_1.describe)("battery runtime persist", () => {
    (0, node_test_1.it)("roundtrips persist file", async () => {
        const dir = await fs.mkdtemp(path.join(os.tmpdir(), "br-"));
        const points = [socAt("2026-01-05", 22, 80), socAt("2026-01-06", 6, 70)];
        const result = (0, math_1.computeBatteryRuntimeLearning)({
            socPoints: points,
            powerPoints: [],
            secondsSinceFull: null,
            capacityKwh: 10,
            currentSocPct: 75,
            cfg: cfg(),
            sourceSocStateId: "sonnen.0.status.userSoc",
            sourcePowerStateId: "",
            now: new Date("2026-01-07T10:00:00"),
            sampleDays: 2,
        });
        await (0, persist_1.writeBatteryRuntimePersist)(dir, result, "2026-01-07T10:00:00.000Z");
        const read = await (0, persist_1.readBatteryRuntimePersist)(dir);
        strict_1.default.ok(read);
        strict_1.default.equal(read?.module, "battery_runtime_learning_v1");
    });
});
