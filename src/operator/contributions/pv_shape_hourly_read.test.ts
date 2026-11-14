import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readPvShapeHourlyPoints, type ContributionsReadHost } from "./read";

describe("readPvShapeHourlyPoints", () => {
	it("verschiebt Bright-Sky-Zeitstempel auf den Intervallbeginn (Stunde davor)", async () => {
		const values: Record<string, unknown> = {
			"brightsky.0.hourly.00.timestamp": "2026-11-14T13:00:00+00:00",
			"brightsky.0.hourly.00.cloud_cover": 56,
			"brightsky.0.hourly.00.solar_estimate": 2.135,
		};
		const host = {
			getForeignStateAsync: async (id: string) => (id in values ? { val: values[id] } : null),
		} as unknown as ContributionsReadHost;
		const points = await readPvShapeHourlyPoints(host, "brightsky.0.hourly");
		assert.equal(points.length, 1);
		assert.equal(points[0].hourStartIso, "2026-11-14T12:00:00.000Z");
		assert.equal(points[0].solarEstimateKwh, 2.135);
		assert.equal(points[0].cloudPct, 56);
	});
});
