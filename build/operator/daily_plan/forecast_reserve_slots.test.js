"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const strict_1 = __importDefault(require("node:assert/strict"));
const forecast_reserve_slots_js_1 = require("./forecast_reserve_slots.js");
function minimalForecastPlan() {
    return {
        generatedAt: "2026-01-15T22:00:00.000Z",
        validUntil: null,
        revision: 1,
        timezone: "Europe/Berlin",
        horizonStart: "2026-01-15T22:00:00.000Z",
        horizonEnd: "2026-01-16T22:00:00.000Z",
        slotMinutes: 15,
        status: "ready",
        activeContributors: [],
        excludedContributors: [],
        days: [],
        contributions: [],
        quality: { status: "valid", reasonDe: "", confidencePct: 100 },
        reasonDe: "",
        slots: [
            {
                slot: { startIso: "2026-01-15T22:00:00.000Z", endIso: "2026-01-15T22:15:00.000Z" },
                pvPowerW: 0,
                houseLoadPowerW: 500,
                fixedBalancePowerW: null,
                gridPriceCtPerKwh: 30,
                gridImportAllowed: true,
                gridMaxImportPowerW: null,
                outdoorTempC: null,
                quality: { status: "valid", reasonDe: "", confidencePct: 100 },
                reasonDe: "",
            },
            {
                slot: { startIso: "2026-01-15T22:15:00.000Z", endIso: "2026-01-15T22:30:00.000Z" },
                pvPowerW: null,
                houseLoadPowerW: null,
                fixedBalancePowerW: null,
                gridPriceCtPerKwh: null,
                gridImportAllowed: true,
                gridMaxImportPowerW: null,
                outdoorTempC: null,
                quality: { status: "degraded", reasonDe: "", confidencePct: 0 },
                reasonDe: "",
            },
            {
                slot: { startIso: "2026-01-16T08:00:00.000Z", endIso: "2026-01-16T08:15:00.000Z" },
                pvPowerW: 3000,
                houseLoadPowerW: 400,
                fixedBalancePowerW: null,
                gridPriceCtPerKwh: 20,
                gridImportAllowed: true,
                gridMaxImportPowerW: null,
                outdoorTempC: null,
                quality: { status: "valid", reasonDe: "", confidencePct: 100 },
                reasonDe: "",
            },
        ],
    };
}
(0, node_test_1.describe)("forecast → ReserveFloorSlot bridge", () => {
    (0, node_test_1.it)("converts power (W) to per-slot energy (kWh) using slotMinutes", () => {
        const slots = (0, forecast_reserve_slots_js_1.buildReserveFloorSlotsFromForecastPlan)(minimalForecastPlan());
        strict_1.default.equal(slots.length, 3);
        // 500 W * 0.25 h = 0.125 kWh
        strict_1.default.equal(slots[0].houseKwh, 0.125);
        strict_1.default.equal(slots[0].pvKwh, 0);
        strict_1.default.equal(slots[2].pvKwh, 3000 / 1000 * 0.25);
    });
    (0, node_test_1.it)("treats missing (null) power as 0 kWh instead of throwing", () => {
        const slots = (0, forecast_reserve_slots_js_1.buildReserveFloorSlotsFromForecastPlan)(minimalForecastPlan());
        strict_1.default.equal(slots[1].pvKwh, 0);
        strict_1.default.equal(slots[1].houseKwh, 0);
    });
    (0, node_test_1.it)("carries the grid price through as importCt", () => {
        const slots = (0, forecast_reserve_slots_js_1.buildReserveFloorSlotsFromForecastPlan)(minimalForecastPlan());
        strict_1.default.equal(slots[0].importCt, 30);
        strict_1.default.equal(slots[1].importCt, null);
    });
    (0, node_test_1.it)("findCurrentSlotIdx anchors on nowMs, falling back to the last slot if now is past the horizon", () => {
        const slots = (0, forecast_reserve_slots_js_1.buildReserveFloorSlotsFromForecastPlan)(minimalForecastPlan());
        const idx0 = (0, forecast_reserve_slots_js_1.findCurrentSlotIdx)(slots, Date.parse("2026-01-15T22:00:00.000Z"));
        strict_1.default.equal(idx0, 0);
        const idxLast = (0, forecast_reserve_slots_js_1.findCurrentSlotIdx)(slots, Date.parse("2026-01-17T00:00:00.000Z"));
        strict_1.default.equal(idxLast, slots.length - 1);
    });
});
