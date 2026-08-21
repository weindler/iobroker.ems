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
		assert.ok(recencyWeight(0) > recencyWeight(10));
		assert.ok(recencyWeight(10) > recencyWeight(20));
		const avg = weightedAverage([10, 40], [1, 0.01]);
		assert.ok(avg !== null && avg < 15, `recent-weighted avg=${avg}`);
	});

	it("stündliche PV/Haus-Serien joinen trotz versetzter Timestamps", () => {
		const day0 = Date.parse("2026-01-15T00:00:00.000Z");
		const pv: PowerPoint[] = [];
		const house: PowerPoint[] = [];
		for (let h = 0; h < 48; h++) {
			const ts = day0 + h * 3_600_000;
			let pvW = 0;
			if (h >= 9 && h < 16) pvW = 4000;
			if (h >= 32 && h < 40) pvW = 3500;
			pv.push({ ts: ts + 120_000, powerW: pvW });
			house.push({ ts: ts + 480_000, powerW: 500 });
		}
		const net = buildPvHouseNetSeries(pv, house);
		assert.ok(net.length >= 20, `net points ${net.length}`);
		const bridges = findPvHouseNightBridges(net, {
			flutterMs: 3_600_000,
			bucketMs: 3_600_000,
			deficitW: 100,
		});
		assert.ok(bridges.length >= 1, `hourly bridges ${bridges.length}`);
		assert.equal(bridges[0]!.method, "pv_house");
	});

	it("onchange-PV mit 0 W + dichter Hauslast → Brücke (Last-Known)", () => {
		const day0 = Date.parse("2026-08-20T00:00:00.000Z");
		const house: PowerPoint[] = [];
		for (let h = 0; h < 36; h++) {
			house.push({ ts: day0 + h * 3_600_000, powerW: 400 });
		}
		/** Sparse onchange: Tag → 0 am Abend → wieder PV am Morgen. */
		const pv: PowerPoint[] = [
			{ ts: day0 + 10 * 3_600_000, powerW: 3000 },
			{ ts: day0 + 14 * 3_600_000, powerW: 2500 },
			{ ts: day0 + 19 * 3_600_000, powerW: 0 },
			{ ts: day0 + 31 * 3_600_000, powerW: 2000 },
		];
		const net = buildPvHouseNetSeries(pv, house);
		assert.ok(net.length >= 10, `net ${net.length}`);
		const bridges = findPvHouseNightBridges(net, {
			flutterMs: 3_600_000,
			bucketMs: 3_600_000,
			deficitW: 100,
		});
		assert.ok(bridges.length >= 1, `bridges ${bridges.length}`);
		assert.equal(bridges[0]!.method, "pv_house");
	});
});
