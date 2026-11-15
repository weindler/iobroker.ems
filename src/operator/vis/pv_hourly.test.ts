import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildVisPvHourly } from "./pv_hourly";

const tz = "Europe/Berlin";
// 15.11.2026 10:30 Berlin = 09:30 UTC
const now = new Date("2026-11-15T09:30:00Z");
const slot = (iso: string, w: number) => ({
	slot: { startIso: iso, endIso: new Date(Date.parse(iso) + 15 * 60_000).toISOString() },
	pvForecastPowerW: w,
});

describe("buildVisPvHourly", () => {
	it("fasst Viertelstunden zu Stunden zusammen (Ortszeit)", () => {
		// 11:00-12:00 Berlin = 10:00-11:00 UTC: 4 x 1000 W x 0,25 h = 1,0 kWh
		const slots = ["10:00", "10:15", "10:30", "10:45"].map((t) => slot(`2026-11-15T${t}:00Z`, 1000));
		const r = buildVisPvHourly({ now, timezone: tz, slots, measured: [] });
		const today = r.days[0]!;
		assert.equal(today.label, "Heute");
		assert.deepEqual(today.hours, [{ h: 11, f: 1, m: null }]);
		assert.equal(today.forecastKwh, 1);
	});
	it("trennt heute und morgen", () => {
		const slots = [slot("2026-11-16T10:00:00Z", 2000), slot("2026-11-16T10:15:00Z", 2000)];
		const r = buildVisPvHourly({ now, timezone: tz, slots, measured: [] });
		assert.equal(r.days[0]!.hours.length, 0);
		assert.equal(r.days[1]!.label, "Morgen");
		assert.equal(r.days[1]!.hours[0]!.f, 1);
	});
	it("zeigt gemessene Stunden von heute, aber keine aus der Zukunft", () => {
		const measured = [
			{ hourStartMs: Date.parse("2026-11-15T08:00:00Z"), avgW: 600 },
			{ hourStartMs: Date.parse("2026-11-15T12:00:00Z"), avgW: 900 },
		];
		const r = buildVisPvHourly({ now, timezone: tz, slots: [], measured });
		assert.deepEqual(r.days[0]!.hours, [{ h: 9, f: null, m: 0.6 }]);
		assert.equal(r.days[0]!.measuredKwh, 0.6);
	});
	it("lässt Nachtstunden ohne Ertrag weg und ignoriert kaputte Werte", () => {
		const slots = [slot("2026-11-15T22:00:00Z", 0), { slot: { startIso: "kaputt", endIso: "x" }, pvForecastPowerW: 500 }, slot("2026-11-15T10:00:00Z", -5)];
		const r = buildVisPvHourly({ now, timezone: tz, slots, measured: [] });
		assert.equal(r.days[0]!.hours.length, 0);
	});
});
