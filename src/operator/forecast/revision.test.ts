import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildForecastPlan, forecastPlanRevisionPayload } from "./build.js";
import { forecastPlanSemanticRevisionHash } from "./revision.js";
import { buildPvContribution } from "../contributions/pv.js";
import { buildHouseLoadContribution } from "../contributions/house_load.js";
import { buildGridSupplyContribution } from "../contributions/constraints.js";
import { operatorQuality } from "../quality.js";
import type { GridSupplyForecast } from "../types.js";

function gridForecast(): GridSupplyForecast {
	return {
		generatedAt: "2026-07-11T10:00:00.000Z",
		validUntil: null,
		source: "dynamic_tariff",
		currentPriceCtPerKwh: 24,
		gridImportAllowed: true,
		configuredMaxGridImportW: 11000,
		configuredHouseFuseLimitW: 13800,
		effectiveMaxGridImportW: 11000,
		slots: [],
		quality: operatorQuality("valid", "Grid OK"),
		reasonDe: "Grid OK",
	};
}

function baseContributions(now: Date) {
	return [
		buildPvContribution({
			now,
			correctedTodayKwh: 15,
			correctedTomorrowKwh: 18,
			rawTodayKwh: 14,
			rawTomorrowKwh: 17,
			confidencePct: 80,
			status: "ready",
			lastUpdateTs: now.toISOString(),
			source: "learning.pv_bias",
			horizonDays: [
				{ dayIndex: 0, dateKey: "2026-07-11", correctedKwh: 15, confidencePct: 80 },
				{ dayIndex: 1, dateKey: "2026-07-12", correctedKwh: 18, confidencePct: 80 },
			],
		}),
		buildHouseLoadContribution({
			now,
			timezone: "UTC",
			status: "ready",
			confidence: 70,
			forecastToday: {
				date: "2026-07-11",
				season: "summer",
				weekday: "saturday",
				day_type: "weekend",
				segments: {
					midday: { avg_w: 1000, source: "p", fallback_level: "none", confidence: 70 },
				},
			},
			forecastTomorrow: null,
			lastUpdate: now.toISOString(),
		}),
		buildGridSupplyContribution(gridForecast()),
	];
}

describe("forecast plan revision", () => {
	const now = new Date("2026-07-11T10:00:00.000Z");

	it("identical inputs on two starts produce same semantic hash", () => {
		const planA = buildForecastPlan({ now, timezone: "UTC", contributions: baseContributions(now) });
		const planB = buildForecastPlan({
			now: new Date("2026-07-11T10:05:00.000Z"),
			timezone: "UTC",
			contributions: baseContributions(new Date("2026-07-11T10:05:00.000Z")),
		});
		assert.equal(forecastPlanSemanticRevisionHash(planA), forecastPlanSemanticRevisionHash(planB));
	});

	it("only generatedAt and horizonStart change does not affect semantic revision", () => {
		const plan1 = buildForecastPlan({ now, timezone: "UTC", contributions: baseContributions(now) });
		const plan2 = buildForecastPlan({
			now: new Date("2026-07-11T10:05:00.000Z"),
			timezone: "UTC",
			contributions: baseContributions(new Date("2026-07-11T10:05:00.000Z")),
		});
		assert.equal(forecastPlanRevisionPayload(plan1), forecastPlanRevisionPayload(plan2));
	});

	it("detail lastUpdate change does not bump semantic revision", () => {
		const contributionsA = baseContributions(now);
		const contributionsB = baseContributions(now);
		contributionsB[1] = buildHouseLoadContribution({
			now,
			timezone: "UTC",
			status: "ready",
			confidence: 70,
			forecastToday: {
				date: "2026-07-11",
				season: "summer",
				weekday: "saturday",
				day_type: "weekend",
				segments: {
					midday: { avg_w: 1000, source: "p", fallback_level: "none", confidence: 70 },
				},
			},
			forecastTomorrow: null,
			lastUpdate: "2026-07-11T09:00:00.000Z",
		});
		const planA = buildForecastPlan({ now, timezone: "UTC", contributions: contributionsA });
		const planB = buildForecastPlan({ now, timezone: "UTC", contributions: contributionsB });
		assert.equal(forecastPlanSemanticRevisionHash(planA), forecastPlanSemanticRevisionHash(planB));
	});

	it("slot ISO timestamps drift does not affect semantic hash", () => {
		const plan = buildForecastPlan({ now, timezone: "UTC", contributions: baseContributions(now) });
		const plan2: typeof plan = JSON.parse(JSON.stringify(plan));
		plan2.slots[0] = {
			...plan2.slots[0],
			slot: {
				startIso: "2026-07-11T10:15:00.000Z",
				endIso: "2026-07-11T10:30:00.000Z",
			},
		};
		assert.equal(forecastPlanSemanticRevisionHash(plan), forecastPlanSemanticRevisionHash(plan2));
	});

	it("slot quality and reasonDe drift does not affect semantic hash", () => {
		const plan = buildForecastPlan({ now, timezone: "UTC", contributions: baseContributions(now) });
		const plan2: typeof plan = JSON.parse(JSON.stringify(plan));
		plan2.slots[0] = {
			...plan2.slots[0],
			quality: operatorQuality("degraded", "Andere Meldung"),
			reasonDe: "Anderer Grund",
		};
		plan2.days[0] = {
			...plan2.days[0],
			quality: operatorQuality("missing", "Fehlend"),
			reasonDe: "Tag-Grund geändert",
		};
		assert.equal(forecastPlanSemanticRevisionHash(plan), forecastPlanSemanticRevisionHash(plan2));
	});

	it("slot change produces new semantic revision", () => {
		const plan1 = buildForecastPlan({ now, timezone: "UTC", contributions: baseContributions(now) });
		const changedGrid = gridForecast();
		changedGrid.slots = [
			{
				startIso: "2026-07-11T10:00:00.000Z",
				endIso: "2026-07-11T10:15:00.000Z",
				priceCtPerKwh: 99,
				importAllowed: true,
				maxImportPowerW: 11000,
				priceLabel: "expensive",
				quality: operatorQuality("valid", "OK"),
			},
		];
		const contributions = [...baseContributions(now).slice(0, 2), buildGridSupplyContribution(changedGrid)];
		const plan2 = buildForecastPlan({ now, timezone: "UTC", contributions });
		assert.notEqual(forecastPlanSemanticRevisionHash(plan1), forecastPlanSemanticRevisionHash(plan2));
	});
});
