"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
/**
 * Live-PV/HL-Override: nur exakter aktueller Slot, keine startIso-Smear auf Segmente.
 */
const node_test_1 = require("node:test");
const strict_1 = __importDefault(require("node:assert/strict"));
const quality_1 = require("../../quality");
const time_1 = require("../../time");
const slots_1 = require("../../../learning/day_telemetry/slots");
const knowledge_snapshot_1 = require("../../../learning/day_telemetry/knowledge_snapshot");
const from_forecast_context_1 = require("./from_forecast_context");
const TZ = "Europe/Berlin";
const Q = (0, quality_1.operatorQuality)("valid", "fixture", 80);
function planSlot(startIso, endIso, opts = {}) {
    return {
        slot: { startIso, endIso },
        pvPowerW: null,
        houseLoadPowerW: null,
        fixedBalancePowerW: null,
        gridPriceCtPerKwh: null,
        gridImportAllowed: true,
        gridMaxImportPowerW: null,
        outdoorTempC: null,
        quality: Q,
        reasonDe: "fixture",
        ...opts,
    };
}
/** 15-Min-PV-Serie für einen lokalen Tag + Morning-/Midday-Hauslast-Segmente. */
function mixedMorningPlan(dateKey) {
    const layout = (0, slots_1.buildDaySlotLayout)(dateKey, TZ);
    const slots = [];
    for (const b of layout.slots) {
        const localHour = Number(new Intl.DateTimeFormat("en-US", {
            timeZone: TZ,
            hour: "numeric",
            hour12: false,
        })
            .formatToParts(new Date(b.startMs))
            .find((p) => p.type === "hour")?.value ?? "0");
        const hour = localHour === 24 ? 0 : localHour;
        const dayPower = hour >= 6 && hour < 20 ? 800 + (hour - 6) * 50 : 0;
        slots.push(planSlot(new Date(b.startMs).toISOString(), new Date(b.endMs).toISOString(), {
            pvPowerW: dayPower,
            gridPriceCtPerKwh: 20 + (hour % 5),
        }));
    }
    const morningStart = (0, time_1.isoAtTimezoneLocal)(dateKey, 6, 0, TZ);
    const morningEnd = (0, time_1.isoAtTimezoneLocal)(dateKey, 10, 0, TZ);
    const middayStart = (0, time_1.isoAtTimezoneLocal)(dateKey, 10, 0, TZ);
    const middayEnd = (0, time_1.isoAtTimezoneLocal)(dateKey, 14, 0, TZ);
    slots.push(planSlot(morningStart, morningEnd, { houseLoadPowerW: 900 }));
    slots.push(planSlot(middayStart, middayEnd, { houseLoadPowerW: 1100 }));
    return slots.sort((a, b) => {
        const c = a.slot.startIso.localeCompare(b.slot.startIso);
        return c !== 0 ? c : a.slot.endIso.localeCompare(b.slot.endIso);
    });
}
function assertStrictFifteenMinuteSeries(starts) {
    strict_1.default.ok(starts.length > 0);
    const unique = new Set(starts);
    strict_1.default.equal(unique.size, starts.length, "Timestamps müssen eindeutig sein");
    for (let i = 1; i < starts.length; i++) {
        strict_1.default.ok(starts[i] > starts[i - 1], "streng aufsteigend");
        strict_1.default.equal(starts[i] - starts[i - 1], time_1.OPERATOR_MS_PER_15MIN, "Abstand 900000 ms");
    }
}
(0, node_test_1.describe)("live slot override (PV/HL)", () => {
    (0, node_test_1.it)("findCurrentFifteenMinuteSlot ignoriert Mehrstunden-Segmente", () => {
        const morning = (0, time_1.isoAtTimezoneLocal)("2026-08-30", 6, 0, TZ);
        const morningEnd = (0, time_1.isoAtTimezoneLocal)("2026-08-30", 10, 0, TZ);
        const slot730 = (0, time_1.isoAtTimezoneLocal)("2026-08-30", 7, 30, TZ);
        const slot745 = (0, time_1.isoAtTimezoneLocal)("2026-08-30", 7, 45, TZ);
        const windows = [
            { startIso: morning, endIso: morningEnd },
            { startIso: slot730, endIso: slot745 },
        ];
        const nowMs = Date.parse((0, time_1.isoAtTimezoneLocal)("2026-08-30", 7, 30, TZ)) + 60_000;
        const hit = (0, from_forecast_context_1.findCurrentFifteenMinuteSlot)(windows, nowMs);
        strict_1.default.deepEqual(hit, { startIso: slot730, endIso: slot745 });
    });
    (0, node_test_1.it)("Live-PV 07:30 Berlin nur auf 07:30–07:45; Morning-Segment ohne Override", () => {
        const dateKey = "2026-08-30";
        const now = new Date(Date.parse((0, time_1.isoAtTimezoneLocal)(dateKey, 7, 30, TZ)) + 60_000);
        const forecastSlots = mixedMorningPlan(dateKey);
        const livePv = 1173;
        const liveHl = 800;
        const input = (0, from_forecast_context_1.buildUnifiedInputFromForecastContext)({
            now,
            timezone: TZ,
            globalMode: "balanced",
            forecastPlan: { slots: forecastSlots, days: [], contributions: [] },
            observedPvPowerW: livePv,
            observedHouseLoadPowerW: liveHl,
            observedPvAgeSec: 5,
            observedHouseAgeSec: 5,
        });
        const slot730 = (0, time_1.isoAtTimezoneLocal)(dateKey, 7, 30, TZ);
        const slot745 = (0, time_1.isoAtTimezoneLocal)(dateKey, 7, 45, TZ);
        const morningStart = (0, time_1.isoAtTimezoneLocal)(dateKey, 6, 0, TZ);
        const morningEnd = (0, time_1.isoAtTimezoneLocal)(dateKey, 10, 0, TZ);
        const pvNow = input.pv.slots.find((s) => s.slot.startIso === slot730 && s.slot.endIso === slot745);
        strict_1.default.ok(pvNow);
        strict_1.default.equal(pvNow.observedPowerW, livePv);
        const morningPv = input.pv.slots.find((s) => s.slot.startIso === morningStart && s.slot.endIso === morningEnd);
        strict_1.default.ok(morningPv);
        strict_1.default.equal(morningPv.observedPowerW, null);
        strict_1.default.equal(morningPv.forecastPowerW, null);
        strict_1.default.equal(morningPv.energyKwh, null);
        const slot600 = (0, time_1.isoAtTimezoneLocal)(dateKey, 6, 0, TZ);
        const slot615 = (0, time_1.isoAtTimezoneLocal)(dateKey, 6, 15, TZ);
        const pv600 = input.pv.slots.find((s) => s.slot.startIso === slot600 && s.slot.endIso === slot615);
        strict_1.default.ok(pv600);
        strict_1.default.equal(pv600.observedPowerW, null);
        const hlMorning = input.houseLoad.slots.find((s) => s.slot.startIso === morningStart && s.slot.endIso === morningEnd);
        strict_1.default.ok(hlMorning);
        strict_1.default.equal(hlMorning.observedPowerW, liveHl);
        const hlOnPvSlot = input.houseLoad.slots.find((s) => s.slot.startIso === slot730 && s.slot.endIso === slot745);
        strict_1.default.ok(hlOnPvSlot);
        strict_1.default.equal(hlOnPvSlot.observedPowerW, null);
        const snap = (0, knowledge_snapshot_1.withSnapshotId)((0, knowledge_snapshot_1.buildPlannerKnowledgeSnapshot)(input, now.toISOString()));
        const starts = snap.pvSlotKwh.map(([t]) => t);
        assertStrictFifteenMinuteSeries(starts);
        const segmentBoundaryHours = [0, 6, 10, 14, 18];
        for (const h of segmentBoundaryHours) {
            const ts = Date.parse((0, time_1.isoAtTimezoneLocal)(dateKey, h, 0, TZ));
            const count = starts.filter((t) => t === ts).length;
            strict_1.default.ok(count <= 1, `keine Doppelung an ${h}:00 (count=${count})`);
        }
        const priceStarts = snap.priceSlots.map(([t]) => t);
        strict_1.default.equal(new Set(priceStarts).size, priceStarts.length, "priceSlots eindeutig");
    });
    (0, node_test_1.it)("ohne Live-Telemetrie: kein observed*, Forecast unverändert", () => {
        const dateKey = "2026-08-30";
        const now = new Date(Date.parse((0, time_1.isoAtTimezoneLocal)(dateKey, 7, 30, TZ)) + 60_000);
        const forecastSlots = mixedMorningPlan(dateKey);
        const input = (0, from_forecast_context_1.buildUnifiedInputFromForecastContext)({
            now,
            timezone: TZ,
            globalMode: "balanced",
            forecastPlan: { slots: forecastSlots, days: [], contributions: [] },
        });
        strict_1.default.ok(input.pv.slots.every((s) => s.observedPowerW === null));
        strict_1.default.ok(input.houseLoad.slots.every((s) => s.observedPowerW === null));
        const withPower = input.pv.slots.filter((s) => s.forecastPowerW != null);
        strict_1.default.ok(withPower.length >= 48);
        strict_1.default.ok(withPower.every((s) => s.energyKwh === (s.forecastPowerW / 1000) * 0.25));
    });
    (0, node_test_1.it)("findCurrentHouseLoadSlot trifft Segment, nicht 15-Min-PV-Fenster", () => {
        const dateKey = "2026-08-30";
        const slots = mixedMorningPlan(dateKey);
        const nowMs = Date.parse((0, time_1.isoAtTimezoneLocal)(dateKey, 7, 30, TZ)) + 60_000;
        const hit = (0, from_forecast_context_1.findCurrentHouseLoadSlot)(slots, nowMs);
        strict_1.default.equal(hit?.startIso, (0, time_1.isoAtTimezoneLocal)(dateKey, 6, 0, TZ));
        strict_1.default.equal(hit?.endIso, (0, time_1.isoAtTimezoneLocal)(dateKey, 10, 0, TZ));
    });
    (0, node_test_1.it)("DST-Tage: 92/96/100 × 15-Min; Live-Match nur exakter Slot", () => {
        const cases = [
            { date: "2026-03-29", count: 92 },
            { date: "2026-08-30", count: 96 },
            { date: "2026-10-25", count: 100 },
        ];
        for (const c of cases) {
            const layout = (0, slots_1.buildDaySlotLayout)(c.date, TZ);
            strict_1.default.equal(layout.slotCount, c.count);
            const windows = layout.slots.map((s) => ({
                startIso: new Date(s.startMs).toISOString(),
                endIso: new Date(s.endMs).toISOString(),
            }));
            strict_1.default.ok(windows.every((w) => Date.parse(w.endIso) - Date.parse(w.startIso) === time_1.OPERATOR_MS_PER_15MIN));
            const mid = windows[Math.floor(windows.length / 2)];
            const nowMs = Date.parse(mid.startIso) + 30_000;
            strict_1.default.deepEqual((0, from_forecast_context_1.findCurrentFifteenMinuteSlot)(windows, nowMs), mid);
        }
    });
    (0, node_test_1.it)("Forecast-Horizont >= 48h bleibt mit Live-Override erhalten", () => {
        const day0 = "2026-08-30";
        const slots = [];
        for (let d = 0; d < 3; d++) {
            const key = (0, time_1.addDaysToDateKey)(day0, d);
            const dayStart = Date.parse((0, time_1.isoAtTimezoneLocal)(key, 0, 0, TZ));
            const dayEnd = Date.parse((0, time_1.isoAtTimezoneLocal)((0, time_1.addDaysToDateKey)(key, 1), 0, 0, TZ));
            for (let t = dayStart; t < dayEnd; t += time_1.OPERATOR_MS_PER_15MIN) {
                slots.push(planSlot(new Date(t).toISOString(), new Date(t + time_1.OPERATOR_MS_PER_15MIN).toISOString(), {
                    pvPowerW: 500,
                    gridPriceCtPerKwh: 22,
                }));
            }
        }
        const morningStart = (0, time_1.isoAtTimezoneLocal)(day0, 6, 0, TZ);
        const morningEnd = (0, time_1.isoAtTimezoneLocal)(day0, 10, 0, TZ);
        slots.push(planSlot(morningStart, morningEnd, { houseLoadPowerW: 700 }));
        const now = new Date(Date.parse((0, time_1.isoAtTimezoneLocal)(day0, 7, 30, TZ)) + 60_000);
        const without = (0, from_forecast_context_1.buildUnifiedInputFromForecastContext)({
            now,
            timezone: TZ,
            globalMode: "balanced",
            forecastPlan: { slots, days: [], contributions: [] },
        });
        const withLive = (0, from_forecast_context_1.buildUnifiedInputFromForecastContext)({
            now,
            timezone: TZ,
            globalMode: "balanced",
            forecastPlan: { slots, days: [], contributions: [] },
            observedPvPowerW: 2000,
            observedHouseLoadPowerW: 600,
            observedPvAgeSec: 1,
            observedHouseAgeSec: 1,
        });
        strict_1.default.equal(without.pv.slots.length, withLive.pv.slots.length);
        strict_1.default.ok(without.pv.slots.length >= 48 * 4, `Horizont-Slots=${without.pv.slots.length}`);
        const fifteen = withLive.pv.slots.filter((s) => Date.parse(s.slot.endIso) - Date.parse(s.slot.startIso) === time_1.OPERATOR_MS_PER_15MIN);
        const starts = fifteen.map((s) => Date.parse(s.slot.startIso));
        const ends = fifteen.map((s) => Date.parse(s.slot.endIso));
        const spanMs = Math.max(...ends) - Math.min(...starts);
        strict_1.default.ok(spanMs >= 48 * 3_600_000, `15-Min-PV-Span=${spanMs}`);
        strict_1.default.equal(fifteen.filter((s) => s.observedPowerW != null).length, 1, "nur ein Live-PV-Override trotz Mehr-Tages-Horizont");
    });
});
