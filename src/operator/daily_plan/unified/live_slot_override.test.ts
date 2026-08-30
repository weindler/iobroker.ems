/**
 * Live-PV/HL-Override: nur exakter aktueller Slot, keine startIso-Smear auf Segmente.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { operatorQuality } from "../../quality";
import type { ForecastPlanSlot } from "../../types";
import { OPERATOR_MS_PER_15MIN, isoAtTimezoneLocal, addDaysToDateKey } from "../../time";
import { buildDaySlotLayout } from "../../../learning/day_telemetry/slots";
import {
	buildPlannerKnowledgeSnapshot,
	withSnapshotId,
} from "../../../learning/day_telemetry/knowledge_snapshot";
import {
	buildUnifiedInputFromForecastContext,
	findCurrentFifteenMinuteSlot,
	findCurrentHouseLoadSlot,
} from "./from_forecast_context";

const TZ = "Europe/Berlin";
const Q = operatorQuality("valid", "fixture", 80);

function planSlot(
	startIso: string,
	endIso: string,
	opts: Partial<Omit<ForecastPlanSlot, "slot">> = {},
): ForecastPlanSlot {
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
function mixedMorningPlan(dateKey: string): ForecastPlanSlot[] {
	const layout = buildDaySlotLayout(dateKey, TZ);
	const slots: ForecastPlanSlot[] = [];
	for (const b of layout.slots) {
		const localHour = Number(
			new Intl.DateTimeFormat("en-US", {
				timeZone: TZ,
				hour: "numeric",
				hour12: false,
			})
				.formatToParts(new Date(b.startMs))
				.find((p) => p.type === "hour")?.value ?? "0",
		);
		const hour = localHour === 24 ? 0 : localHour;
		const dayPower = hour >= 6 && hour < 20 ? 800 + (hour - 6) * 50 : 0;
		slots.push(
			planSlot(new Date(b.startMs).toISOString(), new Date(b.endMs).toISOString(), {
				pvPowerW: dayPower,
				gridPriceCtPerKwh: 20 + (hour % 5),
			}),
		);
	}
	const morningStart = isoAtTimezoneLocal(dateKey, 6, 0, TZ);
	const morningEnd = isoAtTimezoneLocal(dateKey, 10, 0, TZ);
	const middayStart = isoAtTimezoneLocal(dateKey, 10, 0, TZ);
	const middayEnd = isoAtTimezoneLocal(dateKey, 14, 0, TZ);
	slots.push(planSlot(morningStart, morningEnd, { houseLoadPowerW: 900 }));
	slots.push(planSlot(middayStart, middayEnd, { houseLoadPowerW: 1100 }));
	return slots.sort((a, b) => {
		const c = a.slot.startIso.localeCompare(b.slot.startIso);
		return c !== 0 ? c : a.slot.endIso.localeCompare(b.slot.endIso);
	});
}

function assertStrictFifteenMinuteSeries(starts: number[]): void {
	assert.ok(starts.length > 0);
	const unique = new Set(starts);
	assert.equal(unique.size, starts.length, "Timestamps müssen eindeutig sein");
	for (let i = 1; i < starts.length; i++) {
		assert.ok(starts[i]! > starts[i - 1]!, "streng aufsteigend");
		assert.equal(starts[i]! - starts[i - 1]!, OPERATOR_MS_PER_15MIN, "Abstand 900000 ms");
	}
}

describe("live slot override (PV/HL)", () => {
	it("findCurrentFifteenMinuteSlot ignoriert Mehrstunden-Segmente", () => {
		const morning = isoAtTimezoneLocal("2026-08-30", 6, 0, TZ);
		const morningEnd = isoAtTimezoneLocal("2026-08-30", 10, 0, TZ);
		const slot730 = isoAtTimezoneLocal("2026-08-30", 7, 30, TZ);
		const slot745 = isoAtTimezoneLocal("2026-08-30", 7, 45, TZ);
		const windows = [
			{ startIso: morning, endIso: morningEnd },
			{ startIso: slot730, endIso: slot745 },
		];
		const nowMs = Date.parse(isoAtTimezoneLocal("2026-08-30", 7, 30, TZ)) + 60_000;
		const hit = findCurrentFifteenMinuteSlot(windows, nowMs);
		assert.deepEqual(hit, { startIso: slot730, endIso: slot745 });
	});

	it("Live-PV 07:30 Berlin nur auf 07:30–07:45; Morning-Segment ohne Override", () => {
		const dateKey = "2026-08-30";
		const now = new Date(Date.parse(isoAtTimezoneLocal(dateKey, 7, 30, TZ)) + 60_000);
		const forecastSlots = mixedMorningPlan(dateKey);
		const livePv = 1173;
		const liveHl = 800;
		const input = buildUnifiedInputFromForecastContext({
			now,
			timezone: TZ,
			globalMode: "balanced",
			forecastPlan: { slots: forecastSlots, days: [], contributions: [] },
			observedPvPowerW: livePv,
			observedHouseLoadPowerW: liveHl,
			observedPvAgeSec: 5,
			observedHouseAgeSec: 5,
		});

		const slot730 = isoAtTimezoneLocal(dateKey, 7, 30, TZ);
		const slot745 = isoAtTimezoneLocal(dateKey, 7, 45, TZ);
		const morningStart = isoAtTimezoneLocal(dateKey, 6, 0, TZ);
		const morningEnd = isoAtTimezoneLocal(dateKey, 10, 0, TZ);

		const pvNow = input.pv.slots.find(
			(s) => s.slot.startIso === slot730 && s.slot.endIso === slot745,
		);
		assert.ok(pvNow);
		assert.equal(pvNow!.observedPowerW, livePv);

		const morningPv = input.pv.slots.find(
			(s) => s.slot.startIso === morningStart && s.slot.endIso === morningEnd,
		);
		assert.ok(morningPv);
		assert.equal(morningPv!.observedPowerW, null);
		assert.equal(morningPv!.forecastPowerW, null);
		assert.equal(morningPv!.energyKwh, null);

		const slot600 = isoAtTimezoneLocal(dateKey, 6, 0, TZ);
		const slot615 = isoAtTimezoneLocal(dateKey, 6, 15, TZ);
		const pv600 = input.pv.slots.find(
			(s) => s.slot.startIso === slot600 && s.slot.endIso === slot615,
		);
		assert.ok(pv600);
		assert.equal(pv600!.observedPowerW, null);

		const hlMorning = input.houseLoad.slots.find(
			(s) => s.slot.startIso === morningStart && s.slot.endIso === morningEnd,
		);
		assert.ok(hlMorning);
		assert.equal(hlMorning!.observedPowerW, liveHl);

		const hlOnPvSlot = input.houseLoad.slots.find(
			(s) => s.slot.startIso === slot730 && s.slot.endIso === slot745,
		);
		assert.ok(hlOnPvSlot);
		assert.equal(hlOnPvSlot!.observedPowerW, null);

		const snap = withSnapshotId(buildPlannerKnowledgeSnapshot(input, now.toISOString()));
		const starts = snap.pvSlotKwh.map(([t]) => t);
		assertStrictFifteenMinuteSeries(starts);

		const segmentBoundaryHours = [0, 6, 10, 14, 18];
		for (const h of segmentBoundaryHours) {
			const ts = Date.parse(isoAtTimezoneLocal(dateKey, h, 0, TZ));
			const count = starts.filter((t) => t === ts).length;
			assert.ok(count <= 1, `keine Doppelung an ${h}:00 (count=${count})`);
		}

		const priceStarts = snap.priceSlots.map(([t]) => t);
		assert.equal(new Set(priceStarts).size, priceStarts.length, "priceSlots eindeutig");
	});

	it("ohne Live-Telemetrie: kein observed*, Forecast unverändert", () => {
		const dateKey = "2026-08-30";
		const now = new Date(Date.parse(isoAtTimezoneLocal(dateKey, 7, 30, TZ)) + 60_000);
		const forecastSlots = mixedMorningPlan(dateKey);
		const input = buildUnifiedInputFromForecastContext({
			now,
			timezone: TZ,
			globalMode: "balanced",
			forecastPlan: { slots: forecastSlots, days: [], contributions: [] },
		});
		assert.ok(input.pv.slots.every((s) => s.observedPowerW === null));
		assert.ok(input.houseLoad.slots.every((s) => s.observedPowerW === null));
		const withPower = input.pv.slots.filter((s) => s.forecastPowerW != null);
		assert.ok(withPower.length >= 48);
		assert.ok(withPower.every((s) => s.energyKwh === (s.forecastPowerW! / 1000) * 0.25));
	});

	it("findCurrentHouseLoadSlot trifft Segment, nicht 15-Min-PV-Fenster", () => {
		const dateKey = "2026-08-30";
		const slots = mixedMorningPlan(dateKey);
		const nowMs = Date.parse(isoAtTimezoneLocal(dateKey, 7, 30, TZ)) + 60_000;
		const hit = findCurrentHouseLoadSlot(slots, nowMs);
		assert.equal(hit?.startIso, isoAtTimezoneLocal(dateKey, 6, 0, TZ));
		assert.equal(hit?.endIso, isoAtTimezoneLocal(dateKey, 10, 0, TZ));
	});

	it("DST-Tage: 92/96/100 × 15-Min; Live-Match nur exakter Slot", () => {
		const cases: Array<{ date: string; count: number }> = [
			{ date: "2026-03-29", count: 92 },
			{ date: "2026-08-30", count: 96 },
			{ date: "2026-10-25", count: 100 },
		];
		for (const c of cases) {
			const layout = buildDaySlotLayout(c.date, TZ);
			assert.equal(layout.slotCount, c.count);
			const windows = layout.slots.map((s) => ({
				startIso: new Date(s.startMs).toISOString(),
				endIso: new Date(s.endMs).toISOString(),
			}));
			assert.ok(windows.every((w) => Date.parse(w.endIso) - Date.parse(w.startIso) === OPERATOR_MS_PER_15MIN));
			const mid = windows[Math.floor(windows.length / 2)]!;
			const nowMs = Date.parse(mid.startIso) + 30_000;
			assert.deepEqual(findCurrentFifteenMinuteSlot(windows, nowMs), mid);
		}
	});

	it("Forecast-Horizont >= 48h bleibt mit Live-Override erhalten", () => {
		const day0 = "2026-08-30";
		const slots: ForecastPlanSlot[] = [];
		for (let d = 0; d < 3; d++) {
			const key = addDaysToDateKey(day0, d);
			const dayStart = Date.parse(isoAtTimezoneLocal(key, 0, 0, TZ));
			const dayEnd = Date.parse(isoAtTimezoneLocal(addDaysToDateKey(key, 1), 0, 0, TZ));
			for (let t = dayStart; t < dayEnd; t += OPERATOR_MS_PER_15MIN) {
				slots.push(
					planSlot(new Date(t).toISOString(), new Date(t + OPERATOR_MS_PER_15MIN).toISOString(), {
						pvPowerW: 500,
						gridPriceCtPerKwh: 22,
					}),
				);
			}
		}
		const morningStart = isoAtTimezoneLocal(day0, 6, 0, TZ);
		const morningEnd = isoAtTimezoneLocal(day0, 10, 0, TZ);
		slots.push(planSlot(morningStart, morningEnd, { houseLoadPowerW: 700 }));

		const now = new Date(Date.parse(isoAtTimezoneLocal(day0, 7, 30, TZ)) + 60_000);
		const without = buildUnifiedInputFromForecastContext({
			now,
			timezone: TZ,
			globalMode: "balanced",
			forecastPlan: { slots, days: [], contributions: [] },
		});
		const withLive = buildUnifiedInputFromForecastContext({
			now,
			timezone: TZ,
			globalMode: "balanced",
			forecastPlan: { slots, days: [], contributions: [] },
			observedPvPowerW: 2000,
			observedHouseLoadPowerW: 600,
			observedPvAgeSec: 1,
			observedHouseAgeSec: 1,
		});
		assert.equal(without.pv.slots.length, withLive.pv.slots.length);
		assert.ok(without.pv.slots.length >= 48 * 4, `Horizont-Slots=${without.pv.slots.length}`);
		const horizonMs =
			Date.parse(withLive.time.horizonEndIso) - Date.parse(withLive.time.horizonStartIso);
		assert.ok(horizonMs >= 48 * 3_600_000);
	});
});
