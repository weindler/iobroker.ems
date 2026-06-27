import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { processIobrokerThermalRequest } from "./iobroker_thermal.js";
import { processIobrokerBatteryRequest } from "./iobroker_battery.js";

const ADMIN = { defaultChargeStrategy: null, defaultTargetSocPct: null, timezone: "Europe/Berlin", manualOverrideMaxMinutes: null };
const NOW = new Date("2026-06-27T12:00:00Z");

function baseReq(id: string) {
	return {
		schema_version: 1,
		request_id: id,
		issued_at: NOW.toISOString(),
		owner: { type: "user" as const },
	};
}

describe("iobroker thermal request", () => {
	it("accepts valid request", () => {
		const out = processIobrokerThermalRequest({
			raw: JSON.stringify({ ...baseReq("th-1"), values: { operating_request: "force_on", priority: "before_ev" } }),
			ack: false,
			now: NOW,
			admin: ADMIN,
			lastRequestId: null,
			currentRevision: 0,
			existingSnapshot: null,
		});
		assert.equal(out.result.status, "accepted");
		assert.equal(out.snapshot?.operating_request?.value, "force_on");
	});

	it("duplicate request", () => {
		const raw = JSON.stringify({ ...baseReq("dup-th"), values: { operating_request: "auto" } });
		const input = { raw, ack: false, now: NOW, admin: ADMIN, lastRequestId: "dup-th", currentRevision: 1, existingSnapshot: null };
		assert.equal(processIobrokerThermalRequest(input).result.status, "duplicate");
	});

	it("ack true ignored", () => {
		assert.equal(
			processIobrokerThermalRequest({
				raw: "{}",
				ack: true,
				now: NOW,
				admin: ADMIN,
				lastRequestId: null,
				currentRevision: 0,
				existingSnapshot: null,
			}).result.status,
			"rejected_invalid",
		);
	});
});

describe("iobroker battery request", () => {
	it("accepts partial with invalid soc", () => {
		const out = processIobrokerBatteryRequest({
			raw: JSON.stringify({ ...baseReq("bat-1"), values: { operating_request: "hold", target_soc_pct: 150 } }),
			ack: false,
			now: NOW,
			admin: ADMIN,
			lastRequestId: null,
			currentRevision: 0,
			existingSnapshot: null,
		});
		assert.equal(out.result.status, "accepted_partial");
		assert.equal(out.snapshot?.operating_request?.value, "hold");
	});

	it("clear field", () => {
		const existing = {
			observed_at: NOW.toISOString(),
			operating_request: null,
			target_soc_pct: {
				value: 80,
				status: "valid" as const,
				origin: { source: "iobroker" as const, owner: "user" as const, change_kind: "manual_explicit" as const },
				observed_at: NOW.toISOString(),
			},
			grid_charge_request: null,
			ev_discharge_allowed: null,
			top_off_requested: null,
			manual_override: null,
			request_id: "old",
		};
		const out = processIobrokerBatteryRequest({
			raw: JSON.stringify({ ...baseReq("bat-clear"), clear_fields: ["target_soc_pct"] }),
			ack: false,
			now: NOW,
			admin: ADMIN,
			lastRequestId: null,
			currentRevision: 1,
			existingSnapshot: existing,
		});
		assert.equal(out.result.status, "accepted");
		assert.equal(out.snapshot?.target_soc_pct, null);
	});
});
