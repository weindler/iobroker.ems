"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const strict_1 = __importDefault(require("node:assert/strict"));
const grid_1 = require("./grid");
const tibber_parse_1 = require("../../learning/price_forecast/tibber_parse");
function baseInput(overrides = {}) {
    const now = new Date("2026-07-11T10:00:00.000Z");
    return {
        now,
        globalMode: "balanced",
        policyGridImportAllowed: true,
        configuredMaxGridImportW: 11000,
        configuredHouseFuseLimitW: 13800,
        currentPriceCtPerKwh: 24.5,
        fixedPriceCtPerKwh: null,
        dynamicSlots: [],
        ...overrides,
    };
}
(0, node_test_1.describe)("grid supply", () => {
    (0, node_test_1.it)("normalizes and sorts dynamic slots", () => {
        const t0 = Date.parse("2026-07-11T10:00:00.000Z");
        const t1 = t0 + tibber_parse_1.MS_PER_15MIN;
        const forecast = (0, grid_1.buildGridSupplyForecast)(baseInput({
            dynamicSlots: [
                { slotStartMs: t1, priceCtPerKwh: 30 },
                { slotStartMs: t0, priceCtPerKwh: 20 },
            ],
        }));
        strict_1.default.equal(forecast.source, "dynamic_tariff");
        strict_1.default.equal(forecast.slots.length, 2);
        strict_1.default.ok(forecast.slots[0].startIso < forecast.slots[1].startIso);
        strict_1.default.equal(forecast.slots[0].priceCtPerKwh, 20);
        strict_1.default.equal(forecast.slots[0].importAllowed, true);
    });
    (0, node_test_1.it)("discards invalid slot timestamps", () => {
        const forecast = (0, grid_1.buildGridSupplyForecast)(baseInput({
            dynamicSlots: [{ slotStartMs: Number.NaN, priceCtPerKwh: 10 }],
        }));
        strict_1.default.equal(forecast.slots.length, 0);
    });
    (0, node_test_1.it)("keeps missing prices as null", () => {
        const t0 = Date.parse("2026-07-11T10:00:00.000Z");
        const forecast = (0, grid_1.buildGridSupplyForecast)(baseInput({
            dynamicSlots: [{ slotStartMs: t0, priceCtPerKwh: Number.NaN }],
        }));
        strict_1.default.equal(forecast.slots.length, 1);
        strict_1.default.equal(forecast.slots[0].priceCtPerKwh, null);
    });
    (0, node_test_1.it)("policy blocks flexible grid import", () => {
        const forecast = (0, grid_1.buildGridSupplyForecast)(baseInput({ policyGridImportAllowed: false }));
        strict_1.default.equal(forecast.gridImportAllowed, false);
        strict_1.default.equal(forecast.quality.status, "disabled");
        strict_1.default.match(forecast.reasonDe, /Policy/);
    });
    (0, node_test_1.it)("off mode blocks flexible grid import", () => {
        strict_1.default.equal((0, grid_1.resolveFlexibleGridImportAllowed)("off", true), false);
        const forecast = (0, grid_1.buildGridSupplyForecast)(baseInput({ globalMode: "off" }));
        strict_1.default.equal(forecast.gridImportAllowed, false);
        strict_1.default.match(forecast.reasonDe, /off/i);
    });
    (0, node_test_1.it)("uses minimum valid import limit", () => {
        strict_1.default.equal((0, grid_1.computeEffectiveMaxGridImportW)(11000, 13800), 11000);
        strict_1.default.equal((0, grid_1.computeEffectiveMaxGridImportW)(null, 13800), 13800);
        strict_1.default.equal((0, grid_1.computeEffectiveMaxGridImportW)(11000, null), 11000);
        strict_1.default.equal((0, grid_1.computeEffectiveMaxGridImportW)(null, null), null);
    });
    (0, node_test_1.it)("fixed tariff fallback when configured", () => {
        const forecast = (0, grid_1.buildGridSupplyForecast)(baseInput({ fixedPriceCtPerKwh: 32.1, currentPriceCtPerKwh: null }));
        strict_1.default.equal(forecast.source, "fixed_tariff");
        strict_1.default.equal(forecast.currentPriceCtPerKwh, 32.1);
        strict_1.default.equal(forecast.slots.length, 0);
    });
    (0, node_test_1.it)("missing price source yields source none", () => {
        const forecast = (0, grid_1.buildGridSupplyForecast)(baseInput({ currentPriceCtPerKwh: null, fixedPriceCtPerKwh: null }));
        strict_1.default.equal(forecast.source, "none");
        strict_1.default.equal(forecast.quality.status, "missing");
    });
    (0, node_test_1.it)("converts grid slots to Price15Min for battery compatibility", () => {
        const t0 = Date.parse("2026-07-11T10:00:00.000Z");
        const forecast = (0, grid_1.buildGridSupplyForecast)(baseInput({
            dynamicSlots: [{ slotStartMs: t0, priceCtPerKwh: 18.2 }],
        }));
        const legacy = (0, grid_1.gridSlotsToPrice15Min)(forecast.slots);
        strict_1.default.equal(legacy.length, 1);
        strict_1.default.equal(legacy[0].slotStartMs, t0);
        strict_1.default.equal(legacy[0].priceCtPerKwh, 18.2);
    });
    (0, node_test_1.it)("revision payload changes on slot updates", () => {
        const t0 = Date.parse("2026-07-11T10:00:00.000Z");
        const a = (0, grid_1.buildGridSupplyForecast)(baseInput({ dynamicSlots: [{ slotStartMs: t0, priceCtPerKwh: 10 }] }));
        const b = (0, grid_1.buildGridSupplyForecast)(baseInput({ dynamicSlots: [{ slotStartMs: t0, priceCtPerKwh: 11 }] }));
        strict_1.default.notEqual((0, grid_1.gridSupplyRevisionPayload)(a), (0, grid_1.gridSupplyRevisionPayload)(b));
    });
});
