import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { learnEtaPaths, sessionsFromChargeSlots, etaForPath } from "./eta_path.js";
import { ETA_PATH_FALLBACK } from "./constants.js";

describe("eta path", () => {
	it("nutzt 92 % Fallback ohne Sessions", () => {
		const r = learnEtaPaths([]);
		assert.equal(r.etaPvUsable, false);
		assert.equal(r.etaGridUsable, false);
		assert.equal(etaForPath(r, "pv"), ETA_PATH_FALLBACK);
	});

	it("lernt nur aus eindeutigen Pfaden, nicht aus Tagesquotienten", () => {
		const sessions = Array.from({ length: 5 }, () => ({
			source: "pv" as const,
			chargeKwh: 4,
			dischargeKwh: 3.4,
		}));
		const r = learnEtaPaths(sessions);
		assert.equal(r.etaPvUsable, true);
		assert.ok(r.etaPvPath != null && r.etaPvPath > 0.8 && r.etaPvPath < 0.9);
	});

	it("bricht Sessions bei mixed/unknown ab", () => {
		const s = sessionsFromChargeSlots({
			chargedKwh: [2, 2, 0, 0],
			dischargedKwh: [0, 0, 1.5, 1.5],
			source: ["pv", "mixed", "unknown", "unknown"],
		});
		assert.equal(s.length, 0);
	});
});
