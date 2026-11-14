import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
	decideEvccBatteryMode,
	EVCC_MODE_KEEPALIVE_MS,
	EVCC_OUTPUT_INITIAL,
	planEvccOutputStep,
} from "./evcc_output";

describe("evcc-Batteriemodus", () => {
	it("Netzladen → charge, Hold/Reserve → hold, sonst nichts", () => {
		assert.equal(decideEvccBatteryMode({ intent: { action: "grid_charge", energySource: "grid" }, externalAuthority: false }).mode, "charge");
		assert.equal(decideEvccBatteryMode({ intent: { action: "charge", energySource: "grid" }, externalAuthority: false }).mode, "charge");
		assert.equal(decideEvccBatteryMode({ intent: { action: "charge", energySource: "pv" }, externalAuthority: false }).mode, null);
		assert.equal(decideEvccBatteryMode({ intent: { action: "hold", energySource: "unknown" }, externalAuthority: false }).mode, "hold");
		assert.equal(decideEvccBatteryMode({ intent: { action: "protect_reserve", energySource: "unknown" }, externalAuthority: false }).mode, "hold");
		assert.equal(decideEvccBatteryMode({ intent: { action: "self_consumption", energySource: "unknown" }, externalAuthority: false }).mode, null);
	});

	it("externe Steuerung (Tibber/evcc) → EMS schreibt nichts", () => {
		const d = decideEvccBatteryMode({ intent: { action: "hold", energySource: "unknown" }, externalAuthority: true });
		assert.equal(d.mode, null);
	});

	it("Änderung sofort, gleicher Modus nur als Keepalive, Freigabe einmalig", () => {
		let st = EVCC_OUTPUT_INITIAL;
		let r = planEvccOutputStep("hold", st, 1_000);
		assert.equal(r.write, "hold");
		st = r.next;
		r = planEvccOutputStep("hold", st, 1_000 + EVCC_MODE_KEEPALIVE_MS - 1);
		assert.equal(r.write, null);
		r = planEvccOutputStep("hold", st, 1_000 + EVCC_MODE_KEEPALIVE_MS);
		assert.equal(r.write, "hold");
		st = r.next;
		r = planEvccOutputStep(null, st, 100_000);
		assert.equal(r.write, "normal");
		st = r.next;
		r = planEvccOutputStep(null, st, 110_000);
		assert.equal(r.write, null);
	});

	it("nie geschrieben und nichts gewünscht → nichts", () => {
		assert.equal(planEvccOutputStep(null, EVCC_OUTPUT_INITIAL, 5).write, null);
	});
});
