import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildOperatorLiveSurplus } from "./live_surplus.js";

const TZ = "UTC";
const NOW = new Date("2026-07-11T10:07:00.000Z");

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
