"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const strict_1 = __importDefault(require("node:assert/strict"));
const build_js_1 = require("./build.js");
const revision_js_1 = require("./revision.js");
const pv_js_1 = require("../contributions/pv.js");
const house_load_js_1 = require("../contributions/house_load.js");
const constraints_js_1 = require("../contributions/constraints.js");
const quality_js_1 = require("../quality.js");
function gridForecast() {
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
        quality: (0, quality_js_1.operatorQuality)("valid", "Grid OK"),
        reasonDe: "Grid OK",
    };
}
function baseContributions(now) {
    return [
        (0, pv_js_1.buildPvContribution)({
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
        (0, house_load_js_1.buildHouseLoadContribution)({
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
        (0, constraints_js_1.buildGridSupplyContribution)(gridForecast()),
    ];
}
(0, node_test_1.describe)("forecast plan revision", () => {
    const now = new Date("2026-07-11T10:00:00.000Z");
    (0, node_test_1.it)("identical inputs on two starts produce same semantic hash", () => {
        const planA = (0, build_js_1.buildForecastPlan)({ now, timezone: "UTC", contributions: baseContributions(now) });
        const planB = (0, build_js_1.buildForecastPlan)({
            now: new Date("2026-07-11T10:05:00.000Z"),
            timezone: "UTC",
            contributions: baseContributions(new Date("2026-07-11T10:05:00.000Z")),
        });
        strict_1.default.equal((0, revision_js_1.forecastPlanSemanticRevisionHash)(planA), (0, revision_js_1.forecastPlanSemanticRevisionHash)(planB));
    });
    (0, node_test_1.it)("only generatedAt and horizonStart change does not affect semantic revision", () => {
        const plan1 = (0, build_js_1.buildForecastPlan)({ now, timezone: "UTC", contributions: baseContributions(now) });
        const plan2 = (0, build_js_1.buildForecastPlan)({
            now: new Date("2026-07-11T10:05:00.000Z"),
            timezone: "UTC",
            contributions: baseContributions(new Date("2026-07-11T10:05:00.000Z")),
        });
        strict_1.default.equal((0, build_js_1.forecastPlanRevisionPayload)(plan1), (0, build_js_1.forecastPlanRevisionPayload)(plan2));
    });
    (0, node_test_1.it)("detail lastUpdate change does not bump semantic revision", () => {
        const contributionsA = baseContributions(now);
        const contributionsB = baseContributions(now);
        contributionsB[1] = (0, house_load_js_1.buildHouseLoadContribution)({
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
        const planA = (0, build_js_1.buildForecastPlan)({ now, timezone: "UTC", contributions: contributionsA });
        const planB = (0, build_js_1.buildForecastPlan)({ now, timezone: "UTC", contributions: contributionsB });
        strict_1.default.equal((0, revision_js_1.forecastPlanSemanticRevisionHash)(planA), (0, revision_js_1.forecastPlanSemanticRevisionHash)(planB));
    });
    (0, node_test_1.it)("slot ISO timestamps drift does not affect semantic hash", () => {
        const plan = (0, build_js_1.buildForecastPlan)({ now, timezone: "UTC", contributions: baseContributions(now) });
        const plan2 = JSON.parse(JSON.stringify(plan));
        plan2.slots[0] = {
            ...plan2.slots[0],
            slot: {
                startIso: "2026-07-11T10:15:00.000Z",
                endIso: "2026-07-11T10:30:00.000Z",
            },
        };
        strict_1.default.equal((0, revision_js_1.forecastPlanSemanticRevisionHash)(plan), (0, revision_js_1.forecastPlanSemanticRevisionHash)(plan2));
    });
    (0, node_test_1.it)("slot quality and reasonDe drift does not affect semantic hash", () => {
        const plan = (0, build_js_1.buildForecastPlan)({ now, timezone: "UTC", contributions: baseContributions(now) });
        const plan2 = JSON.parse(JSON.stringify(plan));
        plan2.slots[0] = {
            ...plan2.slots[0],
            quality: (0, quality_js_1.operatorQuality)("degraded", "Andere Meldung"),
            reasonDe: "Anderer Grund",
        };
        plan2.days[0] = {
            ...plan2.days[0],
            quality: (0, quality_js_1.operatorQuality)("missing", "Fehlend"),
            reasonDe: "Tag-Grund geändert",
        };
        strict_1.default.equal((0, revision_js_1.forecastPlanSemanticRevisionHash)(plan), (0, revision_js_1.forecastPlanSemanticRevisionHash)(plan2));
    });
    (0, node_test_1.it)("slot change produces new semantic revision", () => {
        const plan1 = (0, build_js_1.buildForecastPlan)({ now, timezone: "UTC", contributions: baseContributions(now) });
        const changedGrid = gridForecast();
        changedGrid.slots = [
            {
                startIso: "2026-07-11T10:00:00.000Z",
                endIso: "2026-07-11T10:15:00.000Z",
                priceCtPerKwh: 99,
                importAllowed: true,
                maxImportPowerW: 11000,
                priceLabel: "expensive",
                quality: (0, quality_js_1.operatorQuality)("valid", "OK"),
            },
        ];
        const contributions = [...baseContributions(now).slice(0, 2), (0, constraints_js_1.buildGridSupplyContribution)(changedGrid)];
        const plan2 = (0, build_js_1.buildForecastPlan)({ now, timezone: "UTC", contributions });
        strict_1.default.notEqual((0, revision_js_1.forecastPlanSemanticRevisionHash)(plan1), (0, revision_js_1.forecastPlanSemanticRevisionHash)(plan2));
    });
});
