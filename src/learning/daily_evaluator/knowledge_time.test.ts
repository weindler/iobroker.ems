import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { freshDay, makeSnapshot } from "./test_helpers.js";
import {
	priceRankPercentileAtDecisionTime,
	resolveKnowledgeSnapshotAt,
	resolveKnownPriceAtSlotStart,
} from "./knowledge_time.js";

describe("daily_evaluator knowledge_time", () => {
	it("resolveKnowledgeSnapshotAt: wählt letzten Snapshot <= Zeitpunkt, nie später", () => {
		const day = freshDay();
		const s1 = makeSnapshot({ id: "s1", tsIso: "2026-06-15T08:00:00.000Z" });
		const s2 = makeSnapshot({ id: "s2", tsIso: "2026-06-15T12:00:00.000Z" });
		const s3 = makeSnapshot({ id: "s3", tsIso: "2026-06-15T18:00:00.000Z" });
		day.forecastSnapshots.push(s1, s2, s3);

		const at10 = resolveKnowledgeSnapshotAt(day, Date.parse("2026-06-15T10:00:00.000Z"));
		assert.equal(at10?.id, "s1");

		const at15 = resolveKnowledgeSnapshotAt(day, Date.parse("2026-06-15T15:00:00.000Z"));
		assert.equal(at15?.id, "s2");

		const before = resolveKnowledgeSnapshotAt(day, Date.parse("2026-06-15T00:00:00.000Z"));
		assert.equal(before, null);
	});

	it("resolveKnownPriceAtSlotStart: exaktes Slot-Start-Match, kein Interpolieren", () => {
		const snap = makeSnapshot({
			priceSlots: [
				[Date.parse("2026-06-15T12:00:00.000Z"), 20],
				[Date.parse("2026-06-15T12:15:00.000Z"), 25],
			],
		});
		assert.equal(resolveKnownPriceAtSlotStart(snap, Date.parse("2026-06-15T12:00:00.000Z")), 20);
		assert.equal(resolveKnownPriceAtSlotStart(snap, Date.parse("2026-06-15T12:07:00.000Z")), null);
		assert.equal(resolveKnownPriceAtSlotStart(null, Date.parse("2026-06-15T12:00:00.000Z")), null);
	});

	it("priceRankPercentileAtDecisionTime: 0 = günstigstes, 1 exklusiv teuerstes bekanntes Fenster", () => {
		const snap = makeSnapshot({
			priceSlots: [10, 20, 30, 40, 50].map((ct, i) => [Date.parse("2026-06-15T00:00:00.000Z") + i * 900_000, ct] as [number, number]),
		});
		assert.equal(priceRankPercentileAtDecisionTime(snap, 10), 0);
		assert.equal(priceRankPercentileAtDecisionTime(snap, 50), 0.8);
		assert.equal(priceRankPercentileAtDecisionTime(snap, null), null);
	});

	it("priceRankPercentileAtDecisionTime: < 4 Slots → null (zu kurze Reihe)", () => {
		const snap = makeSnapshot({
			priceSlots: [
				[1, 10],
				[2, 20],
			],
		});
		assert.equal(priceRankPercentileAtDecisionTime(snap, 15), null);
	});
});
