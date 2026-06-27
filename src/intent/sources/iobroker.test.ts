import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { processIobrokerWallboxRequest, parseIobrokerRequest } from "./iobroker.js";

const ADMIN = { defaultChargeStrategy: null, defaultTargetSocPct: null, timezone: "Europe/Berlin", manualOverrideMaxMinutes: 60 };
const NOW = new Date("2026-06-27T12:00:00Z");

function validRequest(overrides: Record<string, unknown> = {}) {
	return {
		schema_version: 1,
		request_id: "req-1",
		issued_at: "2026-06-27T12:00:00Z",
		owner: { type: "user", id: "local_user" },
		values: { charge_strategy: "immediate", target_soc_pct: 80 },
		...overrides,
	};
}

describe("iobroker intent request", () => {
	it("accepts valid request", () => {
		const out = processIobrokerWallboxRequest({
			raw: JSON.stringify(validRequest()),
			ack: false,
			now: NOW,
			admin: ADMIN,
			lastRequestId: null,
			currentRevision: 0,
			existingSnapshot: null,
		});
		assert.equal(out.result.status, "accepted");
		assert.equal(out.accepted, true);
	});
	it("rejects invalid json", () => {
		const out = processIobrokerWallboxRequest({
			raw: "{bad",
			ack: false,
			now: NOW,
			admin: ADMIN,
			lastRequestId: null,
			currentRevision: 0,
			existingSnapshot: null,
		});
		assert.equal(out.result.status, "rejected_invalid");
	});
	it("rejects missing request_id", () => {
		const p = parseIobrokerRequest({ schema_version: 1, issued_at: "x", owner: { type: "user" } });
		assert.equal(p.ok, false);
	});
	it("duplicate request_id", () => {
		const out = processIobrokerWallboxRequest({
			raw: JSON.stringify(validRequest()),
			ack: false,
			now: NOW,
			admin: ADMIN,
			lastRequestId: "req-1",
			currentRevision: 1,
			existingSnapshot: null,
		});
		assert.equal(out.result.status, "duplicate");
	});
	it("ignores ack=true", () => {
		const out = processIobrokerWallboxRequest({
			raw: JSON.stringify(validRequest()),
			ack: true,
			now: NOW,
			admin: ADMIN,
			lastRequestId: null,
			currentRevision: 0,
			existingSnapshot: null,
		});
		assert.equal(out.accepted, false);
		assert.ok(out.result.errors.includes("ack_true_ignored"));
	});
	it("clear_fields removes field", () => {
		const existing = {
			observed_at: NOW.toISOString(),
			charge_strategy: {
				value: "pv" as const,
				status: "valid" as const,
				origin: { source: "iobroker" as const, owner: "user" as const, change_kind: "manual_explicit" as const },
				observed_at: NOW.toISOString(),
			},
			target_soc_pct: null,
			deadline: null,
			manual_override: null,
			request_id: "old",
		};
		const out = processIobrokerWallboxRequest({
			raw: JSON.stringify(validRequest({ request_id: "req-2", values: {}, clear_fields: ["charge_strategy"] })),
			ack: false,
			now: NOW,
			admin: ADMIN,
			lastRequestId: null,
			currentRevision: 1,
			existingSnapshot: existing,
		});
		assert.equal(out.accepted, true);
		assert.equal(out.snapshot?.charge_strategy, null);
	});
});
