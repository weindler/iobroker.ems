import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { resolveThermalIntent } from "./resolve.js";
import type { IobrokerThermalSnapshot } from "./types.js";

const NOW = new Date("2026-06-27T12:00:00Z");
const ISO = NOW.toISOString();

function iobrokerField<T>(value: T) {
	return {
		value,
		status: "valid" as const,
		origin: { source: "iobroker" as const, owner: "user" as const, change_kind: "manual_explicit" as const },
		observed_at: ISO,
		changed_at: ISO,
	};
}

describe("thermal intent resolver", () => {
	it("disabled when addon inactive", () => {
		const r = resolveThermalIntent({ now: NOW, previous: null, iobroker: null, override: null, active: false });
		assert.equal(r.intent_state, "disabled");
	});

	it("accepts valid operating_request from iobroker", () => {
		const iobroker: IobrokerThermalSnapshot = {
			observed_at: ISO,
			operating_request: iobrokerField("force_on"),
			target_temperature_c: null,
			ready_at: null,
			priority: null,
			manual_override: null,
			request_id: "t1",
		};
		const r = resolveThermalIntent({ now: NOW, previous: null, iobroker, override: null, active: true });
		assert.equal(r.operating_request.value, "force_on");
		assert.equal(r.intent_state, "partial");
	});

	it("override only affects scoped field", () => {
		const iobroker: IobrokerThermalSnapshot = {
			observed_at: ISO,
			operating_request: iobrokerField("auto"),
			target_temperature_c: iobrokerField(55),
			ready_at: null,
			priority: null,
			manual_override: null,
			request_id: "t2",
		};
		const r = resolveThermalIntent({
			now: NOW,
			previous: null,
			iobroker,
			override: { active: true, scope: ["operating_request"], source: "iobroker", owner: "user" },
			active: true,
		});
		assert.equal(r.operating_request.value, "auto");
		assert.equal(r.target_temperature_c.value, 55);
	});

	it("unknown operating mode stays unknown", () => {
		const iobroker: IobrokerThermalSnapshot = {
			observed_at: ISO,
			operating_request: iobrokerField("unknown"),
			target_temperature_c: null,
			ready_at: null,
			priority: null,
			manual_override: null,
			request_id: "t3",
		};
		const r = resolveThermalIntent({ now: NOW, previous: null, iobroker, override: null, active: true });
		assert.equal(r.operating_request.value, "unknown");
	});
});
