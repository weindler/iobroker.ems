import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { isForeignStateId } from "./history";

describe("pv_bias history ids", () => {
	it("detects foreign ioBroker state ids", () => {
		assert.equal(isForeignStateId("alias.0.PV.WR.Fronius.DAY_ENERGY"), true);
		assert.equal(isForeignStateId("pvforecast.0.summary.energy.today"), true);
	});

	it("treats relative ems states as own", () => {
		assert.equal(isForeignStateId("learning.pv_bias.frozen_today_kwh"), false);
	});
});
