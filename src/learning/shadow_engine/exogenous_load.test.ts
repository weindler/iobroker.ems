import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { emptyDayRecord } from "../day_telemetry/types";
import { splitExogenousLoad } from "./exogenous_load";
import { simulateReferenceNoEms } from "./simulate";

function fixtureDay(slotCount = 2) {
	return emptyDayRecord("2026-08-30", "Europe/Berlin", 0, slotCount * 15 * 60_000, slotCount);
}

describe("splitExogenousLoad — keine Doppelzählung steuerbarer Last", () => {
	it("exogen = Haus − Klima/Heizstab/EV; no_ems-Last = nicht Haus + extra", () => {
		const day = fixtureDay(2);
		day.buckets.houseTotalKwh = [5, 5];
		day.buckets.climateElecSharedKwh = [1, 1];
		day.buckets.immersionKwh = [0.5, 0.5];
		day.buckets.evChargedKwh = [1, 1];
		const split = splitExogenousLoad(day);
		assert.equal(split.exogenousKwh[0], 2.5);
		assert.equal(split.controllableKwh[0], 2.5);
		assert.equal(split.noEmsTotalLoadKwh[0], 5);
		assert.ok((split.noEmsTotalLoadKwh[0] ?? 0) < 5 + 1, "keine Doppelzählung");
	});

	it("fehlt eine Steuerbare, wird sie nicht als 0 erfunden", () => {
		const day = fixtureDay(1);
		day.buckets.houseTotalKwh = [4];
		day.buckets.climateElecSharedKwh = [1];
		day.buckets.immersionKwh = [null];
		day.buckets.evChargedKwh = [null];
		const split = splitExogenousLoad(day);
		assert.equal(split.exogenousKwh[0], 3);
		assert.equal(split.controllableKwh[0], 1);
		assert.equal(split.noEmsTotalLoadKwh[0], 4);
	});

	it("nutzt climateElecSharedKwh statt climateKwh (keine Indoor-Doppelzählung)", () => {
		const day = fixtureDay(1);
		day.buckets.houseTotalKwh = [3];
		day.buckets.climateKwh = [2];
		day.buckets.climateElecSharedKwh = [0.7];
		const split = splitExogenousLoad(day);
		assert.equal(split.controllableKwh[0], 0.7);
		assert.equal(split.exogenousKwh[0], 2.3);
	});

	it("klemmt exogen auf 0 bei Messinkonsistenz (Steuerbare > Haus)", () => {
		const day = fixtureDay(1);
		day.buckets.houseTotalKwh = [1];
		day.buckets.evChargedKwh = [3];
		const split = splitExogenousLoad(day);
		assert.equal(split.exogenousKwh[0], 0);
		assert.equal(split.noEmsTotalLoadKwh[0], 3);
	});
});

describe("simulateReferenceNoEms verwendet exogene Last, nicht Haus+Steuerbare", () => {
	it("Batterie sieht dieselbe Last wie die Hauslast, nicht Haus plus EV extra", () => {
		const day = fixtureDay(2);
		day.buckets.pvKwh = [0, 0];
		day.buckets.houseTotalKwh = [1, 1];
		day.buckets.evChargedKwh = [0.4, 0.4];
		day.buckets.priceCtPerKwh = [20, 20];
		const r = simulateReferenceNoEms(
			day,
			{
				usableCapacityKwh: 10,
				minSocPct: 5,
				maxSocPct: 100,
				maxChargeW: null,
				maxDischargeW: null,
				startSocPct: 50,
			},
			null,
		);
		assert.equal(r.evaluable, true);
		assert.match(r.assumptionsDe.join(" "), /Exogene Grundlast/);
	});
});
