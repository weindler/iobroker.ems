import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { classifyChargeSource, mergeChargeSource } from "./charge_source.js";

describe("charge source", () => {
	it("markiert EMS-Netzladen explizit als grid", () => {
		assert.equal(
			classifyChargeSource({
				chargingW: 2000,
				pvW: 500,
				houseW: 400,
				gridImportW: 0,
				emsGridChargeActive: true,
			}),
			"grid",
		);
	});

	it("markiert eindeutigen Surplus ohne Import als pv", () => {
		assert.equal(
			classifyChargeSource({
				chargingW: 1500,
				pvW: 3000,
				houseW: 800,
				gridImportW: 10,
				emsGridChargeActive: false,
			}),
			"pv",
		);
	});

	it("lässt Mischlagen unknown/mixed", () => {
		assert.equal(
			classifyChargeSource({
				chargingW: 800,
				pvW: 900,
				houseW: 700,
				gridImportW: 400,
				emsGridChargeActive: false,
			}),
			"mixed",
		);
		assert.equal(
			classifyChargeSource({
				chargingW: 100,
				pvW: null,
				houseW: null,
				gridImportW: null,
				emsGridChargeActive: false,
			}),
			"unknown",
		);
	});

	it("merged Slot-Konflikte zu mixed", () => {
		assert.equal(mergeChargeSource("pv", "grid"), "mixed");
		assert.equal(mergeChargeSource("unknown", "pv"), "pv");
		assert.equal(mergeChargeSource("pv", "unknown"), "pv");
	});
});
