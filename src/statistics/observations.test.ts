import assert from "node:assert/strict";
import { it } from "node:test";
import { observeDay, meterComparison } from "./observations";
import { emptyDayRecord, emptyPersist } from "./persist";
import { energyCounterDeltaKwh, integrateImportCostEur, tibberDayCostEur } from "./compute";
import { netHomeGridCostEur } from "./grid_rewards";

it("retains negative energy prices and billed credits above the charging cost", () => {
	assert.deepEqual(integrateImportCostEur({ importPowerW: 1000, priceCtPerKwh: -10, dtSec: 3600 }), { costEur: -0.1, kwh: 1 });
	assert.equal(tibberDayCostEur({ accumulatedCostEur: -0.2, monthlyBaseEur: 0, monthlyGridFeeEur: 0, monthFraction: 1/30 }), -0.2);
	assert.equal(netHomeGridCostEur(1, 2.49), -1.49);
});

it("preserves the earliest measured daily SOC minimum and both meter directions", () => {
	const day = emptyDayRecord("2026-09-27");
	observeDay(day, new Date("2026-09-27T04:45:00Z"), 58, 100, 200);
	observeDay(day, new Date("2026-09-27T06:52:00Z"), 62, 100.5, 201);
	observeDay(day, new Date("2026-09-27T07:00:00Z"), 58, 100.5, 201);
	assert.deepEqual(day.batteryMinimum, { socPct: 58, atIso: "2026-09-27T04:45:00.000Z" });
	assert.equal(day.meter?.import?.firstKwh, 100);
	assert.equal(day.meter?.export?.lastKwh, 201);
	assert.deepEqual(energyCounterDeltaKwh(100, 99.98), { deltaKwh: 0, newBaseline: 100 });
});
it("compares calendar periods with signed differences and refuses incomplete prior data", () => {
	const data = emptyPersist(new Date("2026-09-27T10:00:00Z"));
	for (const key of ["2026-09-26", "2026-09-27"]) data.days[key] = emptyDayRecord(key);
	data.days["2026-09-26"].home.gridImportKwh = 5;
	data.days["2026-09-27"].home.gridImportKwh = 3;
	const result = meterComparison(data, "2026-09-27", "2026-09-27", "today");
	assert.equal(result.import.deltaKwh, -2);
	assert.equal(result.import.deltaPct, -40);
	assert.equal(result.export.deltaKwh, null);
	assert.equal(result.provisional, true);
	assert.match(result.noteDe, /nicht uhrzeitgleich/);
	assert.equal(meterComparison(data, "2024-03-31", "2024-03-31", "month_2024-03").previousTo, "2024-02-29");
});
