import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
	collectConfiguredControlTargetStateIds,
	hasEvccControlWriteMapping,
	resolveEvccControlContractV1,
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

	it("control v1 contract is ready only with all three evcc control.* targets", () => {
		const ready = resolveEvccControlContractV1({
			wb_evcc_control_pv_control_target: "evcc.0.loadpoint.1.control.pvControl",
			wb_evcc_control_max_current_target: "evcc.0.loadpoint.1.control.maxCurrent",
			wb_evcc_control_phases_configured_target: "evcc.0.loadpoint.1.control.phasesConfigured",
		});
		assert.equal(ready.ready, true);
		assert.equal(ready.usesLegacyGoeFallback, false);
	});

	it("control v1 never accepts go-e ids", () => {
		const contract = resolveEvccControlContractV1({
			wb_control_model: "evcc",
			wb_evcc_control_pv_control_target: "go-e.0.allow_charging",
			wb_evcc_control_max_current_target: "go-e.0.amperePV",
			wb_evcc_control_phases_configured_target: "go-e.0.phaseSwitchModeEnabled",
		});
		assert.equal(contract.ready, false);
		const ids = collectConfiguredControlTargetStateIds({
			wb_control_model: "evcc",
			wb_set_current_a_target: "go-e.0.amperePV",
			wb_evcc_control_pv_control_target: "go-e.0.allow_charging",
		});
		assert.ok(ids.every((id) => !id.startsWith("go-e.")));
	});
});
