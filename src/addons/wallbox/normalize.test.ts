import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
	missingField,
	normalizeOptionalBool,
	normalizeOptionalNumber,
	normalizeOptionalSoc,
} from "./normalize";

describe("wallbox evcc normalize", () => {
	it("does not invent false for missing bool", () => {
		const r = normalizeOptionalBool(null);
		assert.equal(r.status, "missing");
		assert.equal(r.value, null);
	});

	it("does not invent 0 for missing number", () => {
		const r = normalizeOptionalNumber(undefined);
		assert.equal(r.status, "missing");
		assert.equal(r.value, null);
	});

	it("accepts explicit false and zero", () => {
		assert.equal(normalizeOptionalBool(false).value, false);
		assert.equal(normalizeOptionalBool(0).value, false);
		assert.equal(normalizeOptionalSoc(0).value, 0);
		assert.equal(normalizeOptionalSoc(0).status, "valid");
	});

	it("reads connected and charging booleans", () => {
		assert.equal(normalizeOptionalBool(true).value, true);
		assert.equal(normalizeOptionalBool("1").value, true);
		assert.equal(normalizeOptionalBool("false").value, false);
	});

	it("reads charge power as number", () => {
		const r = normalizeOptionalNumber(4200);
		assert.equal(r.status, "valid");
		assert.equal(r.value, 4200);
	});

	it("missingField stays missing", () => {
		const m = missingField<number>();
		assert.equal(m.status, "missing");
		assert.equal(m.value, null);
	});
});
