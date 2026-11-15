import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { brightskyHourlyKwh, emptyPvHourlyHistory, mergePvHistory } from "./pv_hourly_history";
import { buildVisPvHourly } from "./pv_hourly";

const H = 3_600_000;
const tz = "Europe/Berlin";

describe("pv_hourly_history", () => {
	it("friert vergangene Stunden ein und schreibt laufende/künftige fort", () => {
		const now = Date.parse("2026-11-15T10:20:00Z");
		const cur = Math.floor(now / H) * H;
		const prev = { version: 1 as const, f: { [String(cur - H)]: 1.2, [String(cur)]: 0.5 }, b: {} };
		const next = mergePvHistory(prev, now, new Map([[cur - H, 9], [cur, 0.9], [cur + H, 1.4]]), new Map());
		assert.equal(next.f[String(cur - H)], 1.2);
		assert.equal(next.f[String(cur)], 0.9);
		assert.equal(next.f[String(cur + H)], 1.4);
	});
	it("entfernt Einträge älter als 10 Tage", () => {
		const now = Date.parse("2026-11-15T10:20:00Z");
		const old = String(now - 11 * 24 * H);
		const next = mergePvHistory({ version: 1, f: { [old]: 1 }, b: { [old]: 1 } }, now, new Map(), new Map());
		assert.deepEqual(next, emptyPvHourlyHistory());
	});
	it("skaliert Brightsky-Einstrahlung auf die Tagesschätzung (nur Volltage)", () => {
		const day0 = Date.parse("2026-11-16T00:00:00+01:00");
		const pts = Array.from({ length: 24 }, (_, i) => ({ startMs: day0 + i * H, solar: i >= 9 && i <= 14 ? 1 : 0 }));
		const part = Array.from({ length: 10 }, (_, i) => ({ startMs: Date.parse("2026-11-15T14:00:00+01:00") + i * H, solar: 1 }));
		const out = brightskyHourlyKwh([...pts, ...part], new Map([["2026-11-16", 6], ["2026-11-15", 3]]), tz);
		const total = [...out.values()].reduce((s, v) => s + v, 0);
		assert.ok(Math.abs(total - 6) < 1e-9, String(total));
		assert.equal(out.get(day0 + 12 * H), 1);
		assert.equal(out.has(Date.parse("2026-11-15T14:00:00+01:00")), false);
	});
	it("baut die Stundenreihe aus Verlauf, Plan und Messung", () => {
		const now = new Date("2026-11-15T10:20:00Z");
		const cur = Math.floor(now.getTime() / H) * H;
		const r = buildVisPvHourly({
			now,
			timezone: tz,
			slots: [{ slot: { startIso: new Date(cur + H).toISOString(), endIso: new Date(cur + H + 15 * 60_000).toISOString() }, pvForecastPowerW: 2000 }],
			measured: [{ hourStartMs: cur - H, avgW: 800 }],
			forecastByHour: { [String(cur - H)]: 1.1 },
			brightskyByHour: { [String(cur + 2 * H)]: 0.7 },
		});
		const byT = new Map(r.series.map((p) => [p.t, p]));
		assert.deepEqual(byT.get(cur - H), { t: cur - H, f: 1.1, b: null, m: 0.8 });
		assert.equal(byT.get(cur + H)!.f, 0.5);
		assert.equal(byT.get(cur + 2 * H)!.b, 0.7);
	});
});
