import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
	metaFromObject,
	validateControlObjectMeta,
	validateEnumValueAgainstMeta,
	validateEvccControlTargetMeta,
} from "./control_object_meta.js";

describe("wallbox control object meta", () => {
	it("rejects missing object", () => {
		const r = validateControlObjectMeta(undefined, "boolean");
		assert.equal(r.valid, false);
		assert.equal(r.reason, "target_object_missing");
	});

	it("rejects non-writable target", () => {
		const r = validateControlObjectMeta(
			metaFromObject("evcc.0.loadpoint.1.enabled", {
				_type: "state",
				common: { type: "boolean", read: true, write: false },
			} as unknown as ioBroker.Object),
			"boolean",
		);
		assert.equal(r.valid, false);
		assert.equal(r.reason, "target_not_writable");
	});

	it("rejects wrong type", () => {
		const r = validateControlObjectMeta(
			metaFromObject("evcc.0.loadpoint.1.minCurrent", {
				_type: "state",
				common: { type: "string", read: true, write: true },
			} as unknown as ioBroker.Object),
			"number",
		);
		assert.equal(r.valid, false);
		assert.equal(r.reason, "target_type_mismatch");
	});

	it("rejects go-e target for evcc path", () => {
		const meta = metaFromObject("go-e.0.allow_charging", {
			_type: "state",
			common: { type: "boolean", read: true, write: true },
		} as unknown as ioBroker.Object);
		const r = validateEvccControlTargetMeta("go-e.0.allow_charging", "boolean", meta, "set_mode");
		assert.equal(r.valid, false);
		assert.equal(r.reason, "goe_target_not_evcc_compatible");
	});

	it("rejects enabled state as set_mode target", () => {
		const meta = metaFromObject("evcc.0.loadpoint.1.enabled", {
			_type: "state",
			common: { type: "boolean", read: true, write: true },
		} as unknown as ioBroker.Object);
		const r = validateEvccControlTargetMeta("evcc.0.loadpoint.1.enabled", "string", meta, "set_mode");
		assert.equal(r.valid, false);
		assert.equal(r.reason, "enabled_not_evcc_mode");
	});

	it("rejects minCurrent as set_max_current_a target", () => {
		const meta = metaFromObject("evcc.0.loadpoint.1.minCurrent", {
			_type: "state",
			common: { type: "number", read: true, write: true },
		} as unknown as ioBroker.Object);
		const r = validateEvccControlTargetMeta("evcc.0.loadpoint.1.minCurrent", "number", meta, "set_max_current_a");
		assert.equal(r.valid, false);
		assert.equal(r.reason, "min_current_not_max_current");
	});

	it("unknown enum value is rejected when states defined", () => {
		const meta = metaFromObject("evcc.0.loadpoint.1.mode", {
			_type: "state",
			common: {
				type: "string",
				read: true,
				write: true,
				states: { pv: "PV", off: "Aus" },
			},
		} as unknown as ioBroker.Object);
		const ok = validateEnumValueAgainstMeta("now", meta);
		assert.equal(ok.valid, false);
		assert.equal(ok.reason, "enum_value_not_allowed");
	});

	it("enum unconfirmed when common.states missing", () => {
		const meta = metaFromObject("evcc.0.loadpoint.1.mode", {
			_type: "state",
			common: { type: "string", read: true, write: true },
		} as unknown as ioBroker.Object);
		const r = validateEnumValueAgainstMeta("pv", meta);
		assert.equal(r.valid, false);
		assert.equal(r.reason, "enum_values_unconfirmed");
	});
});
