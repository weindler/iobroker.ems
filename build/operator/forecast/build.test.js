"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const strict_1 = __importDefault(require("node:assert/strict"));
const pv_1 = require("../contributions/pv");
const house_load_1 = require("../contributions/house_load");
const weather_1 = require("../contributions/weather");
const constraints_1 = require("../contributions/constraints");
const quality_1 = require("../quality");
const build_1 = require("./build");
const battery_1 = require("../contributions/flexible/battery");
const wallbox_1 = require("../contributions/flexible/wallbox");
const mode_policy_1 = require("../../planner/mode_policy");
function gridForecast(overrides = {}) {
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
                quality: (0, quality_1.operatorQuality)("valid", "OK"),
            },
        ],
        quality: (0, quality_1.operatorQuality)("valid", "Grid OK"),
        reasonDe: "Grid OK",
        ...overrides,
    };
}
function fullContributions(now, opts = {}) {
    const withPv = opts.pv !== false;
    const withHouse = opts.house !== false;
    const withWeather = opts.weather !== false;
    const withGrid = opts.grid !== false;
    const contributions = [];
    if (withPv) {
        contributions.push((0, pv_1.buildPvContribution)({
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
        }));
    }
    if (withHouse) {
        contributions.push((0, house_load_1.buildHouseLoadContribution)({
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
        }));
    }
    if (withWeather) {
        contributions.push((0, weather_1.buildWeatherContribution)({
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
        }));
    }
    else {
        contributions.push((0, weather_1.buildWeatherContribution)({
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
        }));
    }
    if (withGrid) {
        contributions.push((0, constraints_1.buildGridSupplyContribution)(gridForecast()));
    }
    return contributions;
}
(0, node_test_1.describe)("forecast plan build", () => {
    const now = new Date("2026-07-11T10:00:00.000Z");
    (0, node_test_1.it)("ready when pv and house load present with timezone", () => {
        const plan = (0, build_1.buildForecastPlan)({
            now,
            timezone: "UTC",
            contributions: fullContributions(now),
        });
        strict_1.default.equal(plan.status, "ready");
        strict_1.default.ok(plan.days.some((d) => d.pvEnergyKwh === 15));
        strict_1.default.ok(plan.days.some((d) => d.houseLoadEnergyKwh !== null));
        strict_1.default.equal(plan.days.find((d) => d.date === "2026-07-11")?.renewableBalanceKwh, 11);
    });
    (0, node_test_1.it)("degraded without weather", () => {
        const plan = (0, build_1.buildForecastPlan)({
            now,
            timezone: "UTC",
            contributions: fullContributions(now, { weather: false }),
        });
        strict_1.default.equal(plan.status, "degraded");
    });
    (0, node_test_1.it)("degraded without grid price", () => {
        const plan = (0, build_1.buildForecastPlan)({
            now,
            timezone: "UTC",
            contributions: fullContributions(now, { grid: false }),
        });
        strict_1.default.equal(plan.status, "degraded");
    });
    (0, node_test_1.it)("missing_inputs without pv", () => {
        const plan = (0, build_1.buildForecastPlan)({
            now,
            timezone: "UTC",
            contributions: fullContributions(now, { pv: false }),
        });
        strict_1.default.equal(plan.status, "missing_inputs");
    });
    (0, node_test_1.it)("missing_inputs without house load", () => {
        const plan = (0, build_1.buildForecastPlan)({
            now,
            timezone: "UTC",
            contributions: fullContributions(now, { house: false }),
        });
        strict_1.default.equal(plan.status, "missing_inputs");
    });
    (0, node_test_1.it)("does not balance with single-sided null values", () => {
        const contributions = fullContributions(now, { house: false, pv: true });
        const plan = (0, build_1.buildForecastPlan)({ now, timezone: "UTC", contributions });
        const day = plan.days.find((d) => d.date === "2026-07-11");
        strict_1.default.equal(day?.renewableBalanceKwh, null);
    });
    (0, node_test_1.it)("slot balance only when both pv and house load slot values exist", () => {
        const plan = (0, build_1.buildForecastPlan)({
            now,
            timezone: "UTC",
            contributions: fullContributions(now),
        });
        for (const slot of plan.slots) {
            if (slot.pvPowerW === null || slot.houseLoadPowerW === null) {
                strict_1.default.equal(slot.fixedBalancePowerW, null);
            }
        }
    });
    (0, node_test_1.it)("lists active and excluded contributors", () => {
        const plan = (0, build_1.buildForecastPlan)({
            now,
            timezone: "UTC",
            contributions: fullContributions(now, { weather: false }),
        });
        strict_1.default.ok(plan.activeContributors.some((c) => c.id === "pv_forecast"));
        strict_1.default.ok(plan.excludedContributors.some((e) => e.contributor.id === "weather_forecast"));
    });
    (0, node_test_1.it)("revision payload ignores generatedAt", () => {
        const contributions = fullContributions(now);
        const plan1 = (0, build_1.buildForecastPlan)({ now, timezone: "UTC", contributions });
        const plan2 = (0, build_1.buildForecastPlan)({
            now: new Date("2026-07-11T10:05:00.000Z"),
            timezone: "UTC",
            contributions,
        });
        strict_1.default.equal((0, build_1.forecastPlanRevisionPayload)(plan1), (0, build_1.forecastPlanRevisionPayload)(plan2));
    });
    (0, node_test_1.it)("sorts slots chronologically", () => {
        const grid = gridForecast({
            slots: [
                {
                    startIso: "2026-07-11T10:30:00.000Z",
                    endIso: "2026-07-11T10:45:00.000Z",
                    priceCtPerKwh: 30,
                    importAllowed: true,
                    maxImportPowerW: 11000,
                    priceLabel: "expensive",
                    quality: (0, quality_1.operatorQuality)("valid", "OK"),
                },
                {
                    startIso: "2026-07-11T10:00:00.000Z",
                    endIso: "2026-07-11T10:15:00.000Z",
                    priceCtPerKwh: 20,
                    importAllowed: true,
                    maxImportPowerW: 11000,
                    priceLabel: "normal",
                    quality: (0, quality_1.operatorQuality)("valid", "OK"),
                },
            ],
        });
        const contributions = [...fullContributions(now, { grid: false }), (0, constraints_1.buildGridSupplyContribution)(grid)];
        const plan = (0, build_1.buildForecastPlan)({ now, timezone: "UTC", contributions });
        const priceSlots = plan.slots.filter((s) => s.gridPriceCtPerKwh !== null);
        strict_1.default.equal(priceSlots.length, 2);
        strict_1.default.ok(priceSlots[0].slot.startIso < priceSlots[1].slot.startIso);
    });
    (0, node_test_1.it)("includes flexible contributions without changing fixed balance", () => {
        const contributions = [
            ...fullContributions(now),
            ...(0, battery_1.buildBatteryContributions)({
                now,
                addonEnabled: true,
                governanceEnabled: true,
                globalModeOff: false,
                modePolicy: (0, mode_policy_1.plannerModePolicyFromGlobalMode)("balanced"),
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
            (0, wallbox_1.buildWallboxEvSessionContribution)({
                now,
                addonEnabled: true,
                governanceEnabled: true,
                globalModeOff: false,
                modePolicy: (0, mode_policy_1.plannerModePolicyFromGlobalMode)("balanced"),
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
        const plan = (0, build_1.buildForecastPlan)({ now, timezone: "UTC", contributions });
        const day = plan.days.find((d) => d.date === "2026-07-11");
        strict_1.default.equal(day?.renewableBalanceKwh, 11);
        strict_1.default.ok(plan.contributions.some((c) => c.contributionId === "battery.charge"));
        strict_1.default.ok(plan.excludedContributors.some((e) => e.contributionId === "battery.discharge"));
        strict_1.default.ok(plan.excludedContributors.some((e) => e.contributionId === "wallbox.ev_session"));
    });
    (0, node_test_1.it)("unsupported battery discharge does not degrade plan", () => {
        const contributions = [
            ...fullContributions(now),
            ...(0, battery_1.buildBatteryContributions)({
                now,
                addonEnabled: true,
                governanceEnabled: true,
                globalModeOff: false,
                modePolicy: (0, mode_policy_1.plannerModePolicyFromGlobalMode)("balanced"),
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
        const plan = (0, build_1.buildForecastPlan)({ now, timezone: "UTC", contributions });
        strict_1.default.equal(plan.status, "ready");
    });
});
