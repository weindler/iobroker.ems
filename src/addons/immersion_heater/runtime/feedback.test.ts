import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
	externalOnStatus,
	feedbackStageFromReadings,
	normalizeFeedbackActive,
} from "./feedback.js";
import { immersionRuntimeWatchedForeignIds } from "./engine.js";
import { immersionDeviceConfigFromAdapter } from "../device_config.js";

describe("immersion feedback normalization", () => {
	it("normalizes boolean feedback", () => {
		assert.equal(normalizeFeedbackActive(true), true);
		assert.equal(normalizeFeedbackActive(false), false);
	});

	it("normalizes numeric feedback", () => {
		assert.equal(normalizeFeedbackActive(1), true);
		assert.equal(normalizeFeedbackActive(0), false);
		assert.equal(normalizeFeedbackActive(2300), true);
	});

	it("normalizes common string feedback", () => {
		for (const v of ["1", "true", "on", "On", "YES", "ein"]) {
			assert.equal(normalizeFeedbackActive(v), true, `expected ${v} active`);
		}
		for (const v of ["0", "false", "off", "OFF", "no", "aus"]) {
			assert.equal(normalizeFeedbackActive(v), false, `expected ${v} inactive`);
		}
	});

	it("treats unknown/empty as null (not silently inactive)", () => {
		assert.equal(normalizeFeedbackActive(null), null);
		assert.equal(normalizeFeedbackActive(undefined), null);
		assert.equal(normalizeFeedbackActive(""), null);
		assert.equal(normalizeFeedbackActive("garbage"), null);
	});
});

describe("immersion feedback stage", () => {
	it("returns 0 when nothing active", () => {
		assert.equal(feedbackStageFromReadings([{ index: 1, active: false }]), 0);
		assert.equal(feedbackStageFromReadings([{ index: 1, active: null }]), 0);
	});

	it("returns the active stage index", () => {
		assert.equal(feedbackStageFromReadings([{ index: 1, active: true }]), 1);
	});

	it("highest active index wins", () => {
		assert.equal(
			feedbackStageFromReadings([
				{ index: 1, active: true },
				{ index: 2, active: true },
				{ index: 3, active: false },
			]),
			2,
		);
	});
});

describe("immersion external-on classification", () => {
	it("feedback active while commanded off → external_on", () => {
		assert.equal(
			externalOnStatus({ commandedStage: 0, feedbackActive: true, powerActive: false }),
			"external_on",
		);
	});

	it("only power active while commanded off → unexpected_external_on", () => {
		assert.equal(
			externalOnStatus({ commandedStage: 0, feedbackActive: false, powerActive: true }),
			"unexpected_external_on",
		);
	});

	it("commanded on → no external status", () => {
		assert.equal(
			externalOnStatus({ commandedStage: 1, feedbackActive: true, powerActive: true }),
			null,
		);
	});

	it("commanded off and nothing active → no external status", () => {
		assert.equal(
			externalOnStatus({ commandedStage: 0, feedbackActive: false, powerActive: false }),
			null,
		);
	});
});

describe("immersion watched foreign ids", () => {
	it("deduplicates identical set/feedback states (subscribe once)", () => {
		const config = immersionDeviceConfigFromAdapter({
			ih_stage_1_set_state: "alias.0.relay",
			ih_stage_1_feedback_state: "alias.0.relay",
			ih_stage_1_nominal_power_w: 3000,
			ih_buffer_temp_c_target: "alias.0.temp",
			ih_actual_power_state: "alias.0.power",
		});
		const ids = immersionRuntimeWatchedForeignIds(config);
		const occurrences = ids.filter((id) => id === "alias.0.relay").length;
		assert.equal(occurrences, 1);
		assert.ok(ids.includes("alias.0.temp"));
		assert.ok(ids.includes("alias.0.power"));
	});

	it("includes the configured feedback state", () => {
		const config = immersionDeviceConfigFromAdapter({
			ih_stage_1_set_state: "alias.0.set",
			ih_stage_1_feedback_state: "alias.0.fb",
			ih_stage_1_nominal_power_w: 3000,
		});
		assert.ok(immersionRuntimeWatchedForeignIds(config).includes("alias.0.fb"));
	});
});
