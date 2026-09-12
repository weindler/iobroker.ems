import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { emptyDayRecord, emptyPersist, pruneStatisticsPersist } from "./persist";

describe("statistics persist retention", () => {
	it("bounds ordinary daily accounting while preserving a pending invoice", () => {
		const persist = emptyPersist(new Date("2026-09-12T12:00:00.000Z"));
		persist.days["2026-09-12"] = emptyDayRecord("2026-09-12");
		persist.days["2026-09-10"] = emptyDayRecord("2026-09-10");
		persist.days["2026-09-01"] = emptyDayRecord("2026-09-01");
		persist.days["2026-08-31"] = emptyDayRecord("2026-08-31");
		persist.days["2026-08-31"].publicSessions.push({
			id: "open-old",
			openedAtIso: "2026-08-31T10:00:00.000Z",
			closedAtIso: null,
			estimatedKwh: 20,
			invoiceKwh: null,
			invoiceEur: null,
			fuelPriceEurPerLSnapshot: null,
			status: "pending_invoice",
			noteDe: "offen",
		});

		const pruned = pruneStatisticsPersist(persist, "2026-09-12", 3);
		assert.deepEqual(Object.keys(pruned.days).sort(), ["2026-08-31", "2026-09-10", "2026-09-12"]);
	});

	it("retains only billing months that can still contribute to retained days", () => {
		const persist = emptyPersist(new Date("2026-09-12T12:00:00.000Z"));
		persist.monthRewardsBilling = {
			"2026-08": { creditEur: 2 },
			"2026-09": { creditEur: 3 },
		};
		const pruned = pruneStatisticsPersist(persist, "2026-09-12", 3);
		assert.deepEqual(Object.keys(pruned.monthRewardsBilling), ["2026-09"]);
	});
});
