import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildReserveFloorSlotsFromForecastPlan, findCurrentSlotIdx } from "./forecast_reserve_slots.js";
import type { ForecastPlan } from "../forecast/types";

function minimalForecastPlan(): ForecastPlan {
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
		quality: { status: "valid", reasonDe: "", confidencePct: 100 } as never,
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
				quality: { status: "valid", reasonDe: "", confidencePct: 100 } as never,
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
				quality: { status: "degraded", reasonDe: "", confidencePct: 0 } as never,
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
				quality: { status: "valid", reasonDe: "", confidencePct: 100 } as never,
				reasonDe: "",
			},
		],
	};
}

describe("forecast → ReserveFloorSlot bridge", () => {
	it("converts power (W) to per-slot energy (kWh) using slotMinutes", () => {
		const slots = buildReserveFloorSlotsFromForecastPlan(minimalForecastPlan());
		assert.equal(slots.length, 3);
		// 500 W * 0.25 h = 0.125 kWh
		assert.equal(slots[0]!.houseKwh, 0.125);
		assert.equal(slots[0]!.pvKwh, 0);
		assert.equal(slots[2]!.pvKwh, 3000 / 1000 * 0.25);
	});

	it("treats missing (null) power as 0 kWh instead of throwing", () => {
		const slots = buildReserveFloorSlotsFromForecastPlan(minimalForecastPlan());
		assert.equal(slots[1]!.pvKwh, 0);
		assert.equal(slots[1]!.houseKwh, 0);
	});

	it("carries the grid price through as importCt", () => {
		const slots = buildReserveFloorSlotsFromForecastPlan(minimalForecastPlan());
		assert.equal(slots[0]!.importCt, 30);
		assert.equal(slots[1]!.importCt, null);
	});

	it("findCurrentSlotIdx anchors on nowMs, falling back to the last slot if now is past the horizon", () => {
		const slots = buildReserveFloorSlotsFromForecastPlan(minimalForecastPlan());
		const idx0 = findCurrentSlotIdx(slots, Date.parse("2026-01-15T22:00:00.000Z"));
		assert.equal(idx0, 0);
		const idxLast = findCurrentSlotIdx(slots, Date.parse("2026-01-17T00:00:00.000Z"));
		assert.equal(idxLast, slots.length - 1);
	});
});
