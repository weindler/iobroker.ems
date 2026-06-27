import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { normalizeEvccMode, normalizeTargetSoc, normalizeDeadline } from "./normalize.js";

const TZ = "Europe/Berlin";

describe("wallbox intent normalize", () => {
	it("off -> off", () => {
		assert.equal(normalizeEvccMode("off").strategy, "off");
	});
	it("minpv -> min_pv", () => {
		assert.equal(normalizeEvccMode("minpv").strategy, "min_pv");
	});
	it("min_pv -> min_pv", () => {
		assert.equal(normalizeEvccMode("min_pv").strategy, "min_pv");
	});
	it("pv -> pv", () => {
		assert.equal(normalizeEvccMode("pv").strategy, "pv");
	});
	it("now -> immediate", () => {
		assert.equal(normalizeEvccMode("now").strategy, "immediate");
	});
	it("case insensitive", () => {
		assert.equal(normalizeEvccMode("  PV ").strategy, "pv");
	});
	it("unknown mode stays unknown with raw", () => {
		const r = normalizeEvccMode("weirdmode");
		assert.equal(r.strategy, "unknown");
		assert.equal(r.raw, "weirdmode");
	});
	it("target soc 0 is valid not missing", () => {
		const r = normalizeTargetSoc(0);
		assert.equal(r.value, 0);
		assert.equal(r.status, "valid");
	});
	it("target soc 100 valid", () => {
		assert.equal(normalizeTargetSoc(100).status, "valid");
	});
	it("target soc negative invalid", () => {
		assert.equal(normalizeTargetSoc(-1).status, "invalid");
	});
	it("target soc over 100 invalid", () => {
		assert.equal(normalizeTargetSoc(101).status, "invalid");
	});
	it("NaN invalid", () => {
		assert.equal(normalizeTargetSoc(NaN).status, "invalid");
	});
	it("ISO deadline normalized", () => {
		const now = new Date("2026-06-27T10:00:00Z");
		const r = normalizeDeadline("2026-06-27T18:00:00+02:00", TZ, now);
		assert.equal(r.status, "valid");
		assert.ok(r.value?.at);
	});
	it("unix seconds normalized", () => {
		const now = new Date("2026-01-01T00:00:00Z");
		const sec = Math.floor(new Date("2026-06-27T18:00:00Z").getTime() / 1000);
		const r = normalizeDeadline(sec, TZ, now);
		assert.equal(r.status, "valid");
	});
	it("unix ms normalized", () => {
		const now = new Date("2026-01-01T00:00:00Z");
		const ms = new Date("2026-06-27T18:00:00Z").getTime();
		const r = normalizeDeadline(ms, TZ, now);
		assert.equal(r.status, "valid");
	});
	it("invalid deadline", () => {
		const now = new Date();
		assert.equal(normalizeDeadline("not-a-date", TZ, now).status, "invalid");
	});
	it("past deadline expired", () => {
		const now = new Date("2026-06-27T12:00:00Z");
		const r = normalizeDeadline("2026-06-27T08:00:00Z", TZ, now);
		assert.equal(r.status, "expired");
	});
	it("null sentinel deadline is missing", () => {
		const now = new Date("2026-06-27T12:00:00Z");
		for (const raw of [null, "null", "undefined", "", "   "]) {
			const r = normalizeDeadline(raw, TZ, now);
			assert.equal(r.status, "missing", String(raw));
			assert.equal(r.value, null);
		}
	});
	it("future plan time is valid", () => {
		const now = new Date("2026-06-27T10:00:00Z");
		const r = normalizeDeadline("2026-06-27T18:00:00+02:00", TZ, now);
		assert.equal(r.status, "valid");
	});
});
