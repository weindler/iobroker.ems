import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { operatorQuality } from "../quality";
import {
	applyLiveNowBalanceToCurrentSlot,
	buildOperatorLiveSurplus,
	slotBalanceIsConsistent,
} from "./live_surplus.js";
import type { DailyPlanSlot } from "./types.js";

const TZ = "UTC";
const NOW = new Date("2026-07-11T10:07:00.000Z");

function slotStub(startIso: string, endIso: string, pv: number, house: number): DailyPlanSlot {
	const bal = pv - house;
	const avail = Math.max(0, bal);
	return {
		slot: { startIso, endIso },
		pvForecastPowerW: pv,
		fixedHouseLoadPowerW: house,
		fixedBalancePowerW: bal,
		gridPriceCtPerKwh: 20,
		gridImportAllowed: true,
		configuredGridImportLimitW: 11000,
		remainingGridImportPowerW: 11000,
		availablePvSurplusPowerW: avail,
		allocatedFlexiblePowerW: 0,
		allocatedPvPowerW: 0,
		allocatedGridPowerW: 0,
		allocatedBatteryPowerW: 0,
		remainingPvSurplusPowerW: avail,
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

describe("applyLiveNowBalanceToCurrentSlot (Beta-Befund 002)", () => {
	it("setzt NOW konsistent live-live, Zukunft unverändert", () => {
		const slots = [
			slotStub("2026-07-11T10:00:00.000Z", "2026-07-11T10:15:00.000Z", 2000, 800),
			slotStub("2026-07-11T10:15:00.000Z", "2026-07-11T10:30:00.000Z", 2000, 800),
		];
		const ok = applyLiveNowBalanceToCurrentSlot(slots, NOW.getTime(), {
			pvPowerW: 5000,
			houseLoadW: 1000,
			pvAgeSec: 5,
			houseAgeSec: 5,
		});
		assert.equal(ok, true);
		assert.equal(slots[0]!.pvForecastPowerW, 5000);
		assert.equal(slots[0]!.fixedHouseLoadPowerW, 1000);
		assert.equal(slots[0]!.availablePvSurplusPowerW, 4000);
		assert.equal(slotBalanceIsConsistent(slots[0]!), true);
		assert.equal(slots[1]!.availablePvSurplusPowerW, 1200);
	});

	it("kein Mix mehr: Live-Surplus ohne Live-PV/HL wird nicht angewandt", () => {
		const slots = [slotStub("2026-07-11T10:00:00.000Z", "2026-07-11T10:15:00.000Z", 2000, 800)];
		const ok = applyLiveNowBalanceToCurrentSlot(slots, NOW.getTime(), {
			pvPowerW: null,
			houseLoadW: 1000,
		});
		assert.equal(ok, false);
		assert.equal(slots[0]!.availablePvSurplusPowerW, 1200);
	});
});
