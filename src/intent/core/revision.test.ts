import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { computeSemanticHash, semanticIntentChanged, nextRevision } from "./revision.js";
import { emptyResolvedWallboxIntent } from "../wallbox/types.js";
import type { ResolvedWallboxIntent } from "../wallbox/types.js";

function baseIntent(now: Date): ResolvedWallboxIntent {
	const i = emptyResolvedWallboxIntent(now);
	i.charge_strategy = {
		value: "pv",
		status: "valid",
		origin: { source: "evcc", owner: "evcc", change_kind: "unknown" },
		observed_at: now.toISOString(),
	};
	i.intent_state = "available";
	i.revision = 1;
	return i;
}

describe("intent revision", () => {
	it("same semantic hash for identical intents", () => {
		const now = new Date("2026-06-27T10:00:00Z");
		const a = baseIntent(now);
		const b = baseIntent(now);
		b.resolved_at = "2026-06-27T11:00:00Z";
		assert.equal(computeSemanticHash(a), computeSemanticHash(b));
	});
	it("observed_at change alone does not change semantic hash", () => {
		const now = new Date("2026-06-27T10:00:00Z");
		const a = baseIntent(now);
		const b = { ...baseIntent(now), charge_strategy: { ...a.charge_strategy, observed_at: "2026-06-28T00:00:00Z" } };
		assert.equal(semanticIntentChanged(a, b), false);
	});
	it("external plan observed_at change alone does not bump revision (no per-poll flapping)", () => {
		const now = new Date("2026-06-27T10:00:00Z");
		const prev = baseIntent(now);
		const next = baseIntent(now);
		next.external_planner_plan = {
			...next.external_planner_plan,
			observed_at: "2026-06-28T08:00:00Z",
		};
		assert.equal(semanticIntentChanged(prev, next), false);
		assert.equal(nextRevision(prev, next), prev.revision);
	});
	it("value change bumps revision", () => {
		const now = new Date("2026-06-27T10:00:00Z");
		const prev = baseIntent(now);
		const next = baseIntent(now);
		next.charge_strategy = { ...next.charge_strategy, value: "immediate" };
		assert.equal(nextRevision(prev, next), 2);
	});
	it("identical restart keeps revision", () => {
		const now = new Date("2026-06-27T10:00:00Z");
		const prev = baseIntent(now);
		const next = baseIntent(now);
		assert.equal(nextRevision(prev, next), prev.revision);
	});
});
