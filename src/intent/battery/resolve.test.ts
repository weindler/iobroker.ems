import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { resolveBatteryIntent } from "./resolve.js";
import type { IobrokerBatterySnapshot } from "./types.js";
import type { EvccBatteryIntentSnapshot } from "../sources/evcc_battery.js";

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

describe("battery intent resolver", () => {
	it("disabled when addon inactive", () => {
		const r = resolveBatteryIntent({ now: NOW, previous: null, iobroker: null, evcc: null, override: null, active: false });
		assert.equal(r.intent_state, "disabled");
	});

	it("target soc 0 and 100 valid", () => {
		for (const soc of [0, 100]) {
			const iobroker: IobrokerBatterySnapshot = {
				observed_at: ISO,
				operating_request: null,
				target_soc_pct: iobrokerField(soc),
				grid_charge_request: null,
				ev_discharge_allowed: null,
				top_off_requested: null,
				manual_override: null,
				request_id: `b-${soc}`,
			};
			const r = resolveBatteryIntent({ now: NOW, previous: null, iobroker, evcc: null, override: null, active: true });
			assert.equal(r.target_soc_pct.value, soc);
		}
	});

	it("grid charge and top_off from request", () => {
		const iobroker: IobrokerBatterySnapshot = {
			observed_at: ISO,
			operating_request: iobrokerField("hold"),
			target_soc_pct: null,
			grid_charge_request: iobrokerField("deny"),
			ev_discharge_allowed: iobrokerField(false),
			top_off_requested: iobrokerField(true),
			manual_override: null,
			request_id: "b1",
		};
		const r = resolveBatteryIntent({ now: NOW, previous: null, iobroker, evcc: null, override: null, active: true });
		assert.equal(r.grid_charge_request.value, "deny");
		assert.equal(r.ev_discharge_allowed.value, false);
		assert.equal(r.top_off_requested.value, true);
	});

	it("override only in scope", () => {
		const iobroker: IobrokerBatterySnapshot = {
			observed_at: ISO,
			operating_request: iobrokerField("charge"),
			target_soc_pct: iobrokerField(80),
			grid_charge_request: null,
			ev_discharge_allowed: null,
			top_off_requested: null,
			manual_override: null,
			request_id: "b2",
		};
		const r = resolveBatteryIntent({
			now: NOW,
			previous: null,
			iobroker,
			evcc: null,
			override: { active: true, scope: ["target_soc_pct"], source: "iobroker", owner: "user" },
			active: true,
		});
		assert.equal(r.operating_request.value, "charge");
		assert.equal(r.target_soc_pct.value, 80);
	});

	it("evcc hold beats iobroker charge", () => {
		const iobroker: IobrokerBatterySnapshot = {
			observed_at: ISO,
			operating_request: iobrokerField("charge"),
			target_soc_pct: null,
			grid_charge_request: null,
			ev_discharge_allowed: null,
			top_off_requested: null,
			manual_override: null,
			request_id: "b3",
		};
		const evcc: EvccBatteryIntentSnapshot = {
			observed_at: ISO,
			operating_request: {
				value: "hold",
				status: "valid",
				origin: { source: "evcc", owner: "evcc", change_kind: "unknown" },
				observed_at: ISO,
			},
			ev_discharge_allowed: {
				value: false,
				status: "valid",
				origin: { source: "evcc", owner: "evcc", change_kind: "unknown" },
				observed_at: ISO,
			},
			grid_charge_request: null,
		};
		const r = resolveBatteryIntent({ now: NOW, previous: null, iobroker, evcc, override: null, active: true });
		assert.equal(r.operating_request.value, "hold");
		assert.equal(r.ev_discharge_allowed.value, false);
		assert.ok(r.source_summary.includes("evcc:evcc"));
	});
});
