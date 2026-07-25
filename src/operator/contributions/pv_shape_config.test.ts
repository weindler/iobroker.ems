import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { pvShapeConfigFromAdapter, pvShapeConfigReady } from "./pv_shape_config";

describe("pvShapeConfigFromAdapter", () => {
	it("defaults to disabled with empty mappings", () => {
		const cfg = pvShapeConfigFromAdapter({});
		assert.equal(cfg.enabled, false);
		assert.equal(cfg.brightskyHourlyPrefix, "");
		assert.equal(cfg.kwpState1, "");
		assert.equal(cfg.kwpState2, "");
	});

	it("reads configured values and trims strings", () => {
		const cfg = pvShapeConfigFromAdapter({
			pv_shape_enabled: true,
			pv_shape_brightsky_hourly_prefix: " brightsky.0.hourly ",
			pv_shape_kwp_state_1: "pvforecast.0.plants.pvNordWest.power.installed",
			pv_shape_kwp_state_2: "",
		});
		assert.equal(cfg.enabled, true);
		assert.equal(cfg.brightskyHourlyPrefix, "brightsky.0.hourly");
		assert.equal(cfg.kwpState1, "pvforecast.0.plants.pvNordWest.power.installed");
		assert.equal(cfg.kwpState2, "");
	});

	it("tolerates non-object config", () => {
		const cfg = pvShapeConfigFromAdapter(null);
		assert.equal(cfg.enabled, false);
	});
});

describe("pvShapeConfigReady", () => {
	it("requires enabled AND a configured hourly prefix", () => {
		assert.equal(pvShapeConfigReady({ enabled: false, brightskyHourlyPrefix: "brightsky.0.hourly", kwpState1: "", kwpState2: "" }), false);
		assert.equal(pvShapeConfigReady({ enabled: true, brightskyHourlyPrefix: "", kwpState1: "", kwpState2: "" }), false);
		assert.equal(pvShapeConfigReady({ enabled: true, brightskyHourlyPrefix: "brightsky.0.hourly", kwpState1: "", kwpState2: "" }), true);
	});
});
