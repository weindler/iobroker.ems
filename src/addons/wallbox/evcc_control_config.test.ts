import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
	collectConfiguredControlTargetStateIds,
	hasEvccControlWriteMapping,
	resolveWallboxControlModel,
} from "./evcc_control_config.js";

describe("evcc control config", () => {
	it("defaults new install to evcc control model", () => {
		assert.equal(resolveWallboxControlModel({}), "evcc");
	});

	it("existing legacy mappings without explicit model stay none", () => {
		assert.equal(
			resolveWallboxControlModel({ wb_set_enabled_target: "go-e.0.allow_charging" }),
			"none",
		);
	});

	it("explicit legacy_direct is honored", () => {
		assert.equal(
			resolveWallboxControlModel({
				wb_control_model: "legacy_direct",
				wb_set_enabled_target: "go-e.0.allow_charging",
			}),
			"legacy_direct",
		);
	});

	it("detects evcc control write mappings", () => {
		assert.equal(
			hasEvccControlWriteMapping({
				wb_evcc_set_mode_target: "evcc.0.loadpoint.1.mode",
			}),
			true,
		);
	});

	it("collects evcc target state ids", () => {
		const ids = collectConfiguredControlTargetStateIds({
			wb_control_model: "evcc",
			wb_evcc_set_mode_target: "evcc.0.loadpoint.1.mode",
			wb_evcc_set_max_current_a_target: "evcc.0.loadpoint.1.maxCurrent",
		});
		assert.deepEqual(ids.sort(), [
			"evcc.0.loadpoint.1.maxCurrent",
			"evcc.0.loadpoint.1.mode",
		]);
	});
});
