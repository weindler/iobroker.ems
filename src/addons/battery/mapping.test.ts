import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { batteryMappingFromConfig, isMappingConfigured, missingMappings } from "./mapping.js";

describe("battery mapping", () => {
	it("parses flat config keys", () => {
		const t = batteryMappingFromConfig({ bat_soc_target: "x.soc", bat_soc_enabled: true });
		assert.equal(t.soc_pct.targetState, "x.soc");
		assert.equal(t.soc_pct.enabled, true);
		assert.equal(isMappingConfigured(t, "soc_pct"), true);
	});

	it("operating_mode_read falls back to write target", () => {
		const t = batteryMappingFromConfig({ bat_operating_mode_target: "sonnen.0.EM_OperatingMode" });
		assert.equal(t.operating_mode_read.targetState, "sonnen.0.EM_OperatingMode");
	});

	it("missing required mappings reported", () => {
		const t = batteryMappingFromConfig({});
		assert.deepEqual(missingMappings(t, ["soc_pct", "power_w"]).sort(), ["power_w", "soc_pct"]);
	});

	it("disabled mapping not configured", () => {
		const t = batteryMappingFromConfig({ bat_soc_target: "x.soc", bat_soc_enabled: false });
		assert.equal(isMappingConfigured(t, "soc_pct"), false);
	});

	it("parses seconds_since_full_charge mapping", () => {
		const t = batteryMappingFromConfig({
			bat_seconds_since_full_target: "sonnen.0.latestData.secondsSinceFullCharge",
			bat_seconds_since_full_enabled: true,
		});
		assert.equal(t.seconds_since_full_charge.targetState, "sonnen.0.latestData.secondsSinceFullCharge");
		assert.equal(isMappingConfigured(t, "seconds_since_full_charge"), true);
	});
});
