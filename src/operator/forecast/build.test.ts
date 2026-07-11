import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildPvContribution } from "../contributions/pv";
import { buildHouseLoadContribution } from "../contributions/house_load";
import { buildWeatherContribution } from "../contributions/weather";
import { buildGridSupplyContribution } from "../contributions/constraints";
import { operatorQuality } from "../quality";
import type { GridSupplyForecast } from "../types";
import { buildForecastPlan, forecastPlanRevisionPayload } from "./build";
import { buildBatteryContributions } from "../contributions/flexible/battery";
import { buildWallboxEvSessionContribution } from "../contributions/flexible/wallbox";
import { plannerModePolicyFromGlobalMode } from "../../planner/mode_policy";

function gridForecast(overrides: Partial<GridSupplyForecast> = {}): GridSupplyForecast {
	return {
		generatedAt: "2026-07-11T10:00:00.000Z",
		validUntil: null,
		source: "dynamic_tariff",
		currentPriceCtPerKwh: 24,
		gridImportAllowed: true,
		configuredMaxGridImportW: 11000,
		configuredHouseFuseLimitW: 13800,
		effectiveMaxGridImportW: 11000,
		slots: [
			{
				startIso: "2026-07-11T10:00:00.000Z",
				endIso: "2026-07-11T10:15:00.000Z",
				priceCtPerKwh: 20,
				importAllowed: true,
				maxImportPowerW: 11000,
				priceLabel: "normal",
				quality: operatorQuality("valid", "OK"),
			},
		],
		quality: operatorQuality("valid", "Grid OK"),
		reasonDe: "Grid OK",
		...overrides,
	};
}

function fullContributions(now: Date, opts: { pv?: boolean; house?: boolean; weather?: boolean; grid?: boolean } = {}) {
	const withPv = opts.pv !== false;
	const withHouse = opts.house !== false;
	const withWeather = opts.weather !== false;
	const withGrid = opts.grid !== false;

	const contributions = [];
	if (withPv) {
		contributions.push(
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
		);
	}
	if (withHouse) {
		contributions.push(
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
		);
	}
	if (withWeather) {
		contributions.push(
			buildWeatherContribution({
				now,
				learningStatus: "ready",
				learningHealth: "ok",
				confidencePct: 90,
				lastUpdate: now.toISOString(),
				forecastSource: "test",
				actualSource: "test",
				outdoorTempC: 22,
				cloudPct: 10,
				hourlyPoints: [],
				todayMinTempC: 18,
				todayMaxTempC: 24,
				tomorrowMinTempC: null,
				tomorrowMaxTempC: null,
				forecastHorizonStart: now.toISOString(),
				forecastHorizonEnd: null,
			}),
		);
	} else {
		contributions.push(
			buildWeatherContribution({
				now,
				learningStatus: "not_initialized",
				learningHealth: "error",
				confidencePct: null,
				lastUpdate: null,
				forecastSource: null,
				actualSource: null,
				outdoorTempC: null,
				cloudPct: null,
				hourlyPoints: [],
				todayMinTempC: null,
				todayMaxTempC: null,
				tomorrowMinTempC: null,
				tomorrowMaxTempC: null,
				forecastHorizonStart: null,
				forecastHorizonEnd: null,
			}),
		);
	}
	if (withGrid) {
		contributions.push(buildGridSupplyContribution(gridForecast()));
	}
	return contributions;
}

describe("forecast plan build", () => {
	const now = new Date("2026-07-11T10:00:00.000Z");

	it("ready when pv and house load present with timezone", () => {
		const plan = buildForecastPlan({
			now,
			timezone: "UTC",
			contributions: fullContributions(now),
		});
		assert.equal(plan.status, "ready");
		assert.ok(plan.days.some((d) => d.pvEnergyKwh === 15));
		assert.ok(plan.days.some((d) => d.houseLoadEnergyKwh !== null));
		assert.equal(plan.days.find((d) => d.date === "2026-07-11")?.renewableBalanceKwh, 11);
	});

	it("degraded without weather", () => {
		const plan = buildForecastPlan({
			now,
			timezone: "UTC",
			contributions: fullContributions(now, { weather: false }),
		});
		assert.equal(plan.status, "degraded");
	});

	it("degraded without grid price", () => {
		const plan = buildForecastPlan({
			now,
			timezone: "UTC",
			contributions: fullContributions(now, { grid: false }),
		});
		assert.equal(plan.status, "degraded");
	});

	it("missing_inputs without pv", () => {
		const plan = buildForecastPlan({
			now,
			timezone: "UTC",
			contributions: fullContributions(now, { pv: false }),
		});
		assert.equal(plan.status, "missing_inputs");
	});

	it("missing_inputs without house load", () => {
		const plan = buildForecastPlan({
			now,
			timezone: "UTC",
			contributions: fullContributions(now, { house: false }),
		});
		assert.equal(plan.status, "missing_inputs");
	});

	it("does not balance with single-sided null values", () => {
		const contributions = fullContributions(now, { house: false, pv: true });
		const plan = buildForecastPlan({ now, timezone: "UTC", contributions });
		const day = plan.days.find((d) => d.date === "2026-07-11");
		assert.equal(day?.renewableBalanceKwh, null);
	});

	it("slot balance only when both pv and house load slot values exist", () => {
		const plan = buildForecastPlan({
			now,
			timezone: "UTC",
			contributions: fullContributions(now),
		});
		for (const slot of plan.slots) {
			if (slot.pvPowerW === null || slot.houseLoadPowerW === null) {
				assert.equal(slot.fixedBalancePowerW, null);
			}
		}
	});

	it("lists active and excluded contributors", () => {
		const plan = buildForecastPlan({
			now,
			timezone: "UTC",
			contributions: fullContributions(now, { weather: false }),
		});
		assert.ok(plan.activeContributors.some((c) => c.id === "pv_forecast"));
		assert.ok(plan.excludedContributors.some((e) => e.contributor.id === "weather_forecast"));
	});

	it("revision payload ignores generatedAt", () => {
		const contributions = fullContributions(now);
		const plan1 = buildForecastPlan({ now, timezone: "UTC", contributions });
		const plan2 = buildForecastPlan({
			now: new Date("2026-07-11T10:05:00.000Z"),
			timezone: "UTC",
			contributions,
		});
		assert.equal(forecastPlanRevisionPayload(plan1), forecastPlanRevisionPayload(plan2));
	});

	it("sorts slots chronologically", () => {
		const grid = gridForecast({
			slots: [
				{
					startIso: "2026-07-11T10:30:00.000Z",
					endIso: "2026-07-11T10:45:00.000Z",
					priceCtPerKwh: 30,
					importAllowed: true,
					maxImportPowerW: 11000,
					priceLabel: "expensive",
					quality: operatorQuality("valid", "OK"),
				},
				{
					startIso: "2026-07-11T10:00:00.000Z",
					endIso: "2026-07-11T10:15:00.000Z",
					priceCtPerKwh: 20,
					importAllowed: true,
					maxImportPowerW: 11000,
					priceLabel: "normal",
					quality: operatorQuality("valid", "OK"),
				},
			],
		});
		const contributions = [...fullContributions(now, { grid: false }), buildGridSupplyContribution(grid)];
		const plan = buildForecastPlan({ now, timezone: "UTC", contributions });
		const priceSlots = plan.slots.filter((s) => s.gridPriceCtPerKwh !== null);
		assert.equal(priceSlots.length, 2);
		assert.ok(priceSlots[0].slot.startIso < priceSlots[1].slot.startIso);
	});

	it("includes flexible contributions without changing fixed balance", () => {
		const contributions = [
			...fullContributions(now),
			...buildBatteryContributions({
				now,
				addonEnabled: true,
				governanceEnabled: true,
				globalModeOff: false,
				modePolicy: plannerModePolicyFromGlobalMode("balanced"),
				gridForecast: gridForecast(),
				profileId: "sonnen_em",
				socPct: 50,
				capacityManualKwh: 10,
				capacityMappedKwh: null,
				capacitySource: "manual",
				minSocPct: 10,
				maxSocPct: 100,
				maxChargeW: 5000,
				chargeCapable: true,
				dischargeCapable: false,
				fault: false,
				lockout: false,
				telemetryValid: true,
				telemetryStale: false,
				mappingsReady: true,
				topOffRequested: false,
				ownershipActive: false,
				winterGridActive: false,
			}),
			buildWallboxEvSessionContribution({
				now,
				addonEnabled: true,
				governanceEnabled: true,
				globalModeOff: false,
				modePolicy: plannerModePolicyFromGlobalMode("balanced"),
				gridForecast: gridForecast(),
				connected: false,
				charging: false,
				vehicleSocPct: 0,
				planSocPct: null,
				planActive: false,
				sessionEnergyKwh: null,
				remainingEnergyKwh: null,
				vehicleCapacityKwh: null,
				deadlineIso: null,
				activePhases: null,
				maxCurrentA: null,
				evccConfigured: true,
			}),
		];
		const plan = buildForecastPlan({ now, timezone: "UTC", contributions });
		const day = plan.days.find((d) => d.date === "2026-07-11");
		assert.equal(day?.renewableBalanceKwh, 11);
		assert.ok(plan.contributions.some((c) => c.contributionId === "battery.charge"));
		assert.ok(plan.excludedContributors.some((e) => e.contributionId === "battery.discharge"));
		assert.ok(plan.excludedContributors.some((e) => e.contributionId === "wallbox.ev_session"));
	});

	it("unsupported battery discharge does not degrade plan", () => {
		const contributions = [
			...fullContributions(now),
			...buildBatteryContributions({
				now,
				addonEnabled: true,
				governanceEnabled: true,
				globalModeOff: false,
				modePolicy: plannerModePolicyFromGlobalMode("balanced"),
				gridForecast: gridForecast(),
				profileId: "sonnen_em",
				socPct: 50,
				capacityManualKwh: 10,
				capacityMappedKwh: null,
				capacitySource: "manual",
				minSocPct: 10,
				maxSocPct: 100,
				maxChargeW: 5000,
				chargeCapable: true,
				dischargeCapable: false,
				fault: false,
				lockout: false,
				telemetryValid: true,
				telemetryStale: false,
				mappingsReady: true,
				topOffRequested: false,
				ownershipActive: false,
				winterGridActive: false,
			}),
		];
		const plan = buildForecastPlan({ now, timezone: "UTC", contributions });
		assert.equal(plan.status, "ready");
	});
});
