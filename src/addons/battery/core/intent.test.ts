import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { deviceIntentFromResolved, isChargingAction, isSafeDefaultAction } from "./intent.js";
import { emptyResolvedBatteryIntent } from "../../../intent/battery/types.js";

const NOW = new Date("2026-06-28T10:00:00Z");

function resolved(over: Partial<ReturnType<typeof emptyResolvedBatteryIntent>>) {
	return { ...emptyResolvedBatteryIntent(NOW, "main"), ...over };
}

function validField<T>(value: T) {
	return {
		value,
		status: "valid" as const,
		origin: { source: "iobroker" as const, owner: "user" as const, change_kind: "manual_explicit" as const },
		observed_at: NOW.toISOString(),
	};
}

describe("device intent translation", () => {
	it("charge request → charge action", () => {
		const r = deviceIntentFromResolved(resolved({ operating_request: validField("charge") }));
		assert.equal(r.rejected, null);
		assert.equal(r.intent?.action, "charge");
	});

	it("grid charge allow → grid_charge action", () => {
		const r = deviceIntentFromResolved(
			resolved({ operating_request: validField("charge"), grid_charge_request: validField("allow") }),
		);
		assert.equal(r.intent?.action, "grid_charge");
		assert.equal(r.intent?.energySource, "grid");
	});

	it("top_off → topoff action", () => {
		const r = deviceIntentFromResolved(resolved({ top_off_requested: validField(true) }));
		assert.equal(r.intent?.action, "topoff");
	});

	it("discharge structurally rejected", () => {
		const r = deviceIntentFromResolved(resolved({ operating_request: validField("discharge") }));
		assert.equal(r.intent, null);
		assert.equal(r.rejected, "discharge_not_supported");
	});

	it("classifies charging and safe-default actions", () => {
		assert.equal(isChargingAction("charge"), true);
		assert.equal(isChargingAction("topoff"), true);
		assert.equal(isChargingAction("self_consumption"), false);
		assert.equal(isSafeDefaultAction("self_consumption"), true);
	});
});
