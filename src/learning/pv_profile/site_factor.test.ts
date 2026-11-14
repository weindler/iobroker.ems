import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { computeSiteFactors, siteFactorAt, type HourlyPvPoint } from "./site_factor";
import { clearSkyWeight, solarElevationDeg } from "../../operator/contributions/pv_shape";

const TZ = "Europe/Berlin";
const LAT = 48;
const LON = 13;
const DAY = 86_400_000;

function makeDays(n: number, nowMs: number, shade: (hourUtc: number) => number): HourlyPvPoint[] {
	const out: HourlyPvPoint[] = [];
	const startOfToday = Math.floor(nowMs / DAY) * DAY;
	for (let d = 1; d <= n; d++) {
		for (let h = 0; h < 24; h++) {
			const hourStartMs = startOfToday - d * DAY + h * 3_600_000;
			const cs = clearSkyWeight(solarElevationDeg(new Date(hourStartMs + 1_800_000), LAT, LON));
			out.push({ hourStartMs, avgW: 5000 * cs * shade(h) });
		}
	}
	return out;
}

describe("PV-Profil (Dach-Faktor je Stunde)", () => {
	const now = Date.parse("2026-06-20T12:00:00Z");

	it("zu wenig Tage → inaktiv, Faktor 1", () => {
		const p = computeSiteFactors(makeDays(3, now, () => 1), LAT, LON, TZ, now);
		assert.equal(p.active, false);
		assert.equal(siteFactorAt(p, now, TZ), 1);
		assert.match(p.noteDe, /3 von 5/);
	});

	it("neutrales Dach → Faktoren nahe 1", () => {
		const p = computeSiteFactors(makeDays(12, now, () => 1), LAT, LON, TZ, now);
		assert.equal(p.active, true);
		for (const f of p.factors) assert.ok(Math.abs(f - 1) < 0.05, String(f));
	});

	it("Verschattung am Nachmittag senkt den Faktor dort und hebt den Rest", () => {
		const p = computeSiteFactors(makeDays(20, now, (h) => (h >= 13 && h <= 15 ? 0.5 : 1)), LAT, LON, TZ, now);
		assert.equal(p.active, true);
		const afternoon = siteFactorAt(p, Date.parse("2026-06-20T14:30:00Z"), TZ); // 16:30 Ortszeit (UTC 13–15 verschattet)
		const noon = siteFactorAt(p, Date.parse("2026-06-20T10:30:00Z"), TZ);
		assert.ok(afternoon < noon);
		assert.ok(afternoon < 0.8);
	});
});
