import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildExternalWallboxPlan } from "./validation.js";

const ISO = "2026-06-27T12:00:00.000Z";

function field<T>(value: T | null, status: "valid" | "missing" | "invalid" | "expired") {
	return {
		value,
		status,
		origin: { source: "evcc" as const, owner: "evcc" as const, change_kind: "unknown" as const },
		observed_at: ISO,
		raw_value: value,
	};
}

describe("external wallbox planner plan", () => {
	it("missing plan time -> none", () => {
		const plan = buildExternalWallboxPlan(field(null, "missing"), field(80, "valid"), ISO);
		assert.equal(plan.state, "none");
		assert.equal(plan.target_soc_pct, 80);
		assert.equal(plan.ready_at, null);
	});

	it("null string raw -> none via missing deadline", () => {
		const deadline = field(null, "missing");
		(deadline as { raw_value: unknown }).raw_value = "null";
		const plan = buildExternalWallboxPlan(deadline, field(null, "missing"), ISO);
		assert.equal(plan.state, "none");
	});

	it("future valid plan -> active", () => {
		const plan = buildExternalWallboxPlan(
			field({ type: "departure" as const, at: "2026-06-27T20:00:00Z", timezone: "Europe/Berlin" }, "valid"),
			field(90, "valid"),
			ISO,
		);
		assert.equal(plan.state, "active");
		assert.equal(plan.ready_at, "2026-06-27T20:00:00Z");
	});

	it("expired plan -> expired", () => {
		const plan = buildExternalWallboxPlan(
			field({ type: "departure" as const, at: "2026-06-27T08:00:00Z", timezone: "Europe/Berlin" }, "expired"),
			field(90, "valid"),
			ISO,
		);
		assert.equal(plan.state, "expired");
	});

	it("invalid plan -> invalid", () => {
		const plan = buildExternalWallboxPlan(field(null, "invalid"), field(90, "valid"), ISO);
		assert.equal(plan.state, "invalid");
	});
});
