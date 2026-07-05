import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { acStatsDeviceActive } from "./stats_active";
import { emptyUnitPersist } from "./persist";

describe("acStatsDeviceActive", () => {
	it("counts after live start while feedback is still off", () => {
		const up = emptyUnitPersist(2);
		up.lastStartAtMs = 1000;
		assert.equal(acStatsDeviceActive(up, false, false), true);
	});

	it("counts in dryrun while EMS session is open and feedback is off", () => {
		const up = emptyUnitPersist(2);
		up.lastStartAtMs = 1000;
		up.running = true;
		assert.equal(acStatsDeviceActive(up, false, true), true);
	});

	it("stops counting after stop was confirmed", () => {
		const up = emptyUnitPersist(2);
		up.lastStartAtMs = 1000;
		up.lastStopAtMs = 2000;
		assert.equal(acStatsDeviceActive(up, false, false), false);
	});

	it("counts when feedback is on regardless of stop timestamps", () => {
		const up = emptyUnitPersist(2);
		up.lastStartAtMs = 1000;
		up.lastStopAtMs = 2000;
		assert.equal(acStatsDeviceActive(up, true, false), true);
	});
});
