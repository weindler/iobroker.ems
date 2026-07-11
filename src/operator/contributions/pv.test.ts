import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildPvContribution } from "./pv";

describe("pv contribution", () => {
	const now = new Date("2026-07-11T10:00:00.000Z");

	it("builds valid forecast for today and tomorrow", () => {
		const c = buildPvContribution({
			now,
			correctedTodayKwh: 18.5,
			correctedTomorrowKwh: 22.1,
			rawTodayKwh: 17,
			rawTomorrowKwh: 20,
			confidencePct: 82,
			status: "ready",
			lastUpdateTs: now.toISOString(),
			source: "learning.pv_bias",
			horizonDays: [
				{ dayIndex: 0, dateKey: "2026-07-11", correctedKwh: 18.5, confidencePct: 82 },
				{ dayIndex: 1, dateKey: "2026-07-12", correctedKwh: 22.1, confidencePct: 82 },
			],
		});
		assert.equal(c.contributor.id, "pv_forecast");
		assert.deepEqual(c.roles, ["supply"]);
		assert.equal(c.enabled, true);
		assert.equal(c.quality.status, "valid");
		assert.equal(c.details.correctedTodayKwh, 18.5);
		assert.equal(c.slots.length, 0);
	});

	it("accepts genuine zero yield", () => {
		const c = buildPvContribution({
			now,
			correctedTodayKwh: 0,
			correctedTomorrowKwh: null,
			rawTodayKwh: 0,
			rawTomorrowKwh: null,
			confidencePct: 70,
			status: "ready",
			lastUpdateTs: now.toISOString(),
			source: "learning.pv_bias",
			horizonDays: [{ dayIndex: 0, dateKey: "2026-07-11", correctedKwh: 0, confidencePct: 70 }],
		});
		assert.equal(c.enabled, true);
		assert.equal(c.details.correctedTodayKwh, 0);
	});

	it("marks missing forecast as missing not zero", () => {
		const c = buildPvContribution({
			now,
			correctedTodayKwh: null,
			correctedTomorrowKwh: null,
			rawTodayKwh: null,
			rawTomorrowKwh: null,
			confidencePct: null,
			status: "no_config",
			lastUpdateTs: null,
			source: "learning.pv_bias",
			horizonDays: [],
		});
		assert.equal(c.enabled, false);
		assert.equal(c.quality.status, "missing");
	});

	it("marks stale source as degraded", () => {
		const c = buildPvContribution({
			now,
			correctedTodayKwh: 10,
			correctedTomorrowKwh: null,
			rawTodayKwh: 10,
			rawTomorrowKwh: null,
			confidencePct: 50,
			status: "ready",
			lastUpdateTs: "2026-07-01T10:00:00.000Z",
			source: "learning.pv_bias",
			horizonDays: [{ dayIndex: 0, dateKey: "2026-07-11", correctedKwh: 10, confidencePct: 50 }],
		});
		assert.equal(c.quality.status, "degraded");
	});
});
