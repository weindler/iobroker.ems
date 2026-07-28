import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
	estimateCoolingHours,
	estimateDehumidifyHours,
	outdoorDriveFactor,
} from "./climate_energy";

describe("climate_energy", () => {
	it("scales outdoor drive factor by forecast max vs likely threshold", () => {
		assert.equal(outdoorDriveFactor(25, 28), 0);
		assert.equal(outdoorDriveFactor(27, 28), 0.35);
		assert.equal(outdoorDriveFactor(30, 28), 0.55);
		assert.equal(outdoorDriveFactor(35, 28), 0.95);
	});

	it("estimates cooling hours from outdoor max when room is cool", () => {
		const r = estimateCoolingHours({
			outdoorMaxC: 35,
			outdoorLikelyTempC: 28,
			remainingHours: 8,
			learnedHours: null,
			roomTempC: 24,
			onTempC: 26,
			offTempC: 24,
		});
		assert.equal(r.likelyActive, true);
		assert.ok(r.expectedHours >= 2);
		assert.match(r.reasonDe, /Außen-Max/);
	});

	it("estimates dehumidify hours on hot days without humidity reading", () => {
		const r = estimateDehumidifyHours({
			outdoorMaxC: 34,
			outdoorLikelyTempC: 28,
			remainingHours: 8,
			learnedHours: null,
			roomHumidityPct: null,
			maxHumidityPct: 60,
			dryModeConfigured: true,
		});
		assert.equal(r.likelyActive, true);
		assert.ok(r.expectedHours > 0);
	});
});
