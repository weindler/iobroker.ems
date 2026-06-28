import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
	GOVERNED_ADDON_REGISTRY,
	getAddonGovernance,
	governedAddonIds,
	isAddonAiOptimizationAllowed,
	isAddonEnabled,
} from "./index.js";

describe("addon governance config", () => {
	it("registers all four governed addons in order", () => {
		assert.deepEqual(governedAddonIds(), ["wallbox", "immersion_heater", "battery", "climate"]);
		assert.equal(GOVERNED_ADDON_REGISTRY.length, 4);
	});

	it("defaults enabled to true when config key missing", () => {
		for (const id of governedAddonIds()) {
			assert.equal(isAddonEnabled({}, id), true, id);
		}
	});

	it("reads explicit enabled values from config", () => {
		assert.equal(isAddonEnabled({ wallbox_enabled: false }, "wallbox"), false);
		assert.equal(isAddonEnabled({ immersion_heater_enabled: true }, "immersion_heater"), true);
		assert.equal(isAddonEnabled({ battery_enabled: 0 }, "battery"), false);
		assert.equal(isAddonEnabled({ climate_enabled: "false" }, "climate"), false);
	});

	it("defaults ai optimization to false", () => {
		for (const id of governedAddonIds()) {
			assert.equal(isAddonAiOptimizationAllowed({}, id), false, id);
		}
	});

	it("reads explicit ai optimization values", () => {
		assert.equal(getAddonGovernance({ wallbox_ai_optimization_allowed: true }, "wallbox").aiOptimizationAllowed, true);
		assert.equal(
			getAddonGovernance({ battery_ai_optimization_allowed: false }, "battery").aiOptimizationAllowed,
			false,
		);
	});

	it("keeps enabled and ai flags independent", () => {
		const gov = getAddonGovernance(
			{
				wallbox_enabled: false,
				wallbox_ai_optimization_allowed: true,
			},
			"wallbox",
		);
		assert.equal(gov.enabled, false);
		assert.equal(gov.aiOptimizationAllowed, true);
	});
});
