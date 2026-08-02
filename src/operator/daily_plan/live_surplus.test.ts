import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { operatorQuality } from "../quality";
import { applyLiveSurplusFloorToCurrentSlot, buildOperatorLiveSurplus } from "./live_surplus.js";
import type { DailyPlanSlot } from "./types.js";

const TZ = "UTC";
const NOW = new Date("2026-07-11T10:07:00.000Z");

function slotStub(startIso: string, endIso: string, surplus: number | null): DailyPlanSlot {
	return {
		slot: { startIso, endIso },
		pvForecastPowerW: surplus,
		fixedHouseLoadPowerW: 0,
		fixedBalancePowerW: surplus,
		gridPriceCtPerKwh: 20,
		gridImportAllowed: true,
		configuredGridImportLimitW: 11000,
		remainingGridImportPowerW: 11000,
		availablePvSurplusPowerW: surplus,
		allocatedFlexiblePowerW: 0,
		allocatedPvPowerW: 0,
		allocatedGridPowerW: 0,
		allocatedBatteryPowerW: 0,
		remainingPvSurplusPowerW: surplus,
		remainingGridImportPowerWAfterAlloc: 11000,
		remainingBatteryDischargePowerW: 0,
		allocations: [],
		quality: operatorQuality("valid", "OK"),
		reasonDe: "test",
	};
}

describe("buildOperatorLiveSurplus (Roadmap Block 3.3 — Live-Cache statt altem Planner-Tick)", () => {
	it("PV über Hauslast -> surplusW gesetzt, deficitW 0", () => {
		const r = buildOperatorLiveSurplus({ pvPowerW: 3000, houseLoadW: 500, now: NOW, timezone: TZ });
		assert.equal(r.surplusW, 2500);
		assert.equal(r.deficitW, 0);
		assert.equal(r.status, "valid");
		assert.equal(r.slotStartIso, "2026-07-11T10:00:00.000Z");
	});

	it("Hauslast über PV -> deficitW gesetzt, surplusW 0", () => {
		const r = buildOperatorLiveSurplus({ pvPowerW: 200, houseLoadW: 900, now: NOW, timezone: TZ });
		assert.equal(r.surplusW, 0);
		assert.equal(r.deficitW, 700);
	});

	it("fehlende Live-Cache-Werte -> null statt erfundener 0, status missing", () => {
		const r = buildOperatorLiveSurplus({ pvPowerW: null, houseLoadW: 500, now: NOW, timezone: TZ });
		assert.equal(r.surplusW, null);
		assert.equal(r.deficitW, null);
		assert.equal(r.status, "missing");
	});

	it("slotStartIso folgt dem 15-Minuten-Raster der aktuellen Zeit", () => {
		const r = buildOperatorLiveSurplus({ pvPowerW: 1000, houseLoadW: 1000, now: NOW, timezone: TZ });
		assert.equal(r.slotStartIso, "2026-07-11T10:00:00.000Z");
	});
});

describe("applyLiveSurplusFloorToCurrentSlot", () => {
	it("raises only the current slot when live surplus exceeds forecast", () => {
		const slots = [
			slotStub("2026-07-11T10:00:00.000Z", "2026-07-11T10:15:00.000Z", 600),
			slotStub("2026-07-11T10:15:00.000Z", "2026-07-11T10:30:00.000Z", 800),
		];
		applyLiveSurplusFloorToCurrentSlot(slots, NOW.getTime(), 4200);
		assert.equal(slots[0].availablePvSurplusPowerW, 4200);
		assert.equal(slots[0].remainingPvSurplusPowerW, 4200);
		assert.equal(slots[1].availablePvSurplusPowerW, 800);
	});

	it("does not lower a higher forecast", () => {
		const slots = [slotStub("2026-07-11T10:00:00.000Z", "2026-07-11T10:15:00.000Z", 5000)];
		applyLiveSurplusFloorToCurrentSlot(slots, NOW.getTime(), 2000);
		assert.equal(slots[0].availablePvSurplusPowerW, 5000);
	});
});
