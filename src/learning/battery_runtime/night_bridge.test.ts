import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
	buildPvHouseNetSeries,
	findPvHouseNightBridges,
	findSustainedDeficitStart,
	recencyWeight,
	weightedAverage,
	NIGHT_BRIDGE_BUCKET_MS,
} from "./night_bridge";
import type { PowerPoint } from "./types";

const BUCKET = NIGHT_BRIDGE_BUCKET_MS;

function seriesFromHours(
	dayStartMs: number,
	hours: { h: number; pv: number; house: number }[],
): { pv: PowerPoint[]; house: PowerPoint[] } {
	const pv: PowerPoint[] = [];
	const house: PowerPoint[] = [];
	for (const row of hours) {
		const ts = dayStartMs + row.h * 3_600_000 + BUCKET / 2;
		pv.push({ ts, powerW: row.pv });
		house.push({ ts, powerW: row.house });
	}
	return { pv, house };
}

describe("night_bridge PV/Haus", () => {
	it("Abend: PV < Haus → Brückenstart; Morgen: PV > Haus → Brückenende", () => {
		/** 2026-08-20 00:00 lokal ≈ nutze UTC-Stunden als Näherung für Test. */
		const day0 = Date.parse("2026-08-20T00:00:00.000Z");
		const hours: { h: number; pv: number; house: number }[] = [];
		for (let h = 0; h < 48; h++) {
			let pv = 0;
			let house = 400;
			if (h >= 8 && h < 19) pv = 3000; // Tag 0 PV
			if (h >= 19 && h < 24) pv = 200; // Abend Defizit
			if (h >= 24 && h < 31) pv = 0; // Nacht
			if (h >= 31 && h < 40) pv = 2500; // Morgen Tag 1
			if (h >= 24 && h < 31) house = 350;
			hours.push({ h, pv, house });
		}
		const { pv, house } = seriesFromHours(day0, hours);
		const net = buildPvHouseNetSeries(pv, house);
		const bridges = findPvHouseNightBridges(net, { flutterMs: BUCKET, deficitW: 100 });
		assert.ok(bridges.length >= 1, `expected bridge, got ${bridges.length}`);
		const b = bridges[0]!;
		assert.equal(b.method, "pv_house");
		const startH = (b.startTs - day0) / 3_600_000;
		const endH = (b.endTs - day0) / 3_600_000;
		assert.ok(startH >= 18.5 && startH <= 21, `evening start h=${startH}`);
		assert.ok(endH >= 30.5 && endH <= 33, `morning end h=${endH}`);
		assert.ok((endH - startH) >= 8, `bridge hours ${endH - startH}`);
	});

	it("Flattern: einzelnes Defizit-Bucket reicht nicht", () => {
		const points = [
			{ ts: 1_000_000, netW: 500 },
			{ ts: 1_000_000 + BUCKET, netW: -500 },
			{ ts: 1_000_000 + 2 * BUCKET, netW: 500 },
		];
		const start = findSustainedDeficitStart(points, 0, 9e12, {
			flutterMs: 2 * BUCKET,
			deficitW: 100,
			bucketMs: BUCKET,
		});
		assert.equal(start, null);
	});

	it("Recency: jüngere Nächte stärker", () => {
		assert.ok(recencyWeight(0) > recencyWeight(14));
		assert.ok(recencyWeight(14) > recencyWeight(28));
		const avg = weightedAverage([10, 40], [1, 0.01]);
		assert.ok(avg !== null && avg < 15, `recent-weighted avg=${avg}`);
	});
});
