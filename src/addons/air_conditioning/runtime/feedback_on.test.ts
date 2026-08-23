import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
	deriveHassClimateStateId,
	resolveAcDevicePowered,
	resolveAcFeedbackModeTarget,
} from "./feedback_on.js";
import type { AcUnitConfig } from "../types.js";

describe("AC LocalThings feedback_on", () => {
	it("state_boolean false + climate.state cool → on via mode", () => {
		const r = resolveAcDevicePowered({
			switchRaw: false,
			modeRaw: "cool",
			useModeFallback: true,
		});
		assert.equal(r.on, true);
		assert.equal(r.via, "mode");
		assert.equal(r.effectiveRaw, "cool");
	});

	it("state_boolean false + climate.state off → off", () => {
		const r = resolveAcDevicePowered({
			switchRaw: false,
			modeRaw: "off",
			useModeFallback: true,
		});
		assert.equal(r.on, false);
		assert.equal(r.via, "mode");
	});

	it("without mode fallback only switch counts", () => {
		const r = resolveAcDevicePowered({
			switchRaw: false,
			modeRaw: "cool",
			useModeFallback: false,
		});
		assert.equal(r.on, false);
		assert.equal(r.via, "none");
	});

	it("derives .state from .state_boolean mapping", () => {
		assert.equal(
			deriveHassClimateStateId("hass.0.entities.climate.x.state_boolean"),
			"hass.0.entities.climate.x.state",
		);
	});

	it("LocalThings uses feedback_mode or derived state id", () => {
		const unit = {
			index: 2,
			profileId: "samsung_localthings_hass",
		} as AcUnitConfig;
		const table = {
			unit_2_feedback_switch: {
				enabled: true,
				targetStateId: "hass.0.entities.climate.josef.state_boolean",
			},
		};
		assert.equal(
			resolveAcFeedbackModeTarget(table, unit, "hass.0.entities.climate.josef.state_boolean"),
			"hass.0.entities.climate.josef.state",
		);
		const withMode = {
			...table,
			unit_2_feedback_mode: {
				enabled: true,
				targetStateId: "hass.0.entities.climate.josef.state",
			},
		};
		assert.equal(
			resolveAcFeedbackModeTarget(withMode, unit, "hass.0.entities.climate.josef.state_boolean"),
			"hass.0.entities.climate.josef.state",
		);
	});
});
