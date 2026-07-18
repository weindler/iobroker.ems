import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
	AC_STATS_START_FEEDBACK_GRACE_MS,
	acStatsDeviceActive,
	closeAcUnitStatsSession,
} from "./stats_active";
import { emptyUnitPersist } from "./persist";

describe("acStatsDeviceActive", () => {
	it("counts after live start while feedback is still off (within grace)", () => {
		const up = emptyUnitPersist(2);
		up.lastStartAtMs = 1000;
		assert.equal(acStatsDeviceActive(up, false, false, 1000 + 5_000), true);
	});

	it("counts in dryrun while EMS session is open and feedback is off", () => {
		const up = emptyUnitPersist(2);
		up.lastStartAtMs = 1000;
		up.running = true;
		assert.equal(acStatsDeviceActive(up, false, true, 1000 + 3600_000), true);
	});

	it("stops counting after stop was confirmed", () => {
		const up = emptyUnitPersist(2);
		up.lastStartAtMs = 1000;
		up.lastStopAtMs = 2000;
		assert.equal(acStatsDeviceActive(up, false, false, 3000), false);
	});

	it("counts when feedback is on regardless of stop timestamps", () => {
		const up = emptyUnitPersist(2);
		up.lastStartAtMs = 1000;
		up.lastStopAtMs = 2000;
		assert.equal(acStatsDeviceActive(up, true, false, 9000), true);
	});

	it("does not sticky-count forever after start when feedback stays off", () => {
		const up = emptyUnitPersist(1);
		up.lastStartAtMs = 1000;
		const afterGrace = 1000 + AC_STATS_START_FEEDBACK_GRACE_MS + 1;
		assert.equal(acStatsDeviceActive(up, false, false, afterGrace), false);
	});

	it("closeAcUnitStatsSession ends open start without stop", () => {
		const up = emptyUnitPersist(1);
		up.lastStartAtMs = 1000;
		up.running = true;
		assert.equal(closeAcUnitStatsSession(up, 5000), true);
		assert.equal(up.running, false);
		assert.equal(up.lastStopAtMs, 5000);
		assert.equal(acStatsDeviceActive(up, false, false, 6000), false);
	});
});
