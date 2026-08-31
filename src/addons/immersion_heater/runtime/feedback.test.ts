import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
	detectImmersionManualMismatch,
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

describe("Klima-/Ownership-Block: detectImmersionManualMismatch", () => {
	it("EMS wollte AUS, Feedback AN → manual_on", () => {
		assert.equal(
			detectImmersionManualMismatch({ prevCommandedStage: 0, prevFeedbackActive: true }),
			"manual_on",
		);
	});

	it("EMS wollte AN, Feedback AUS → manual_off", () => {
		assert.equal(
			detectImmersionManualMismatch({ prevCommandedStage: 1, prevFeedbackActive: false }),
			"manual_off",
		);
	});

	it("übereinstimmend (an/an, aus/aus) → kein Mismatch", () => {
		assert.equal(detectImmersionManualMismatch({ prevCommandedStage: 1, prevFeedbackActive: true }), "");
		assert.equal(detectImmersionManualMismatch({ prevCommandedStage: 0, prevFeedbackActive: false }), "");
	});

	it("Feedback noch unbekannt (erster Takt) → kein Mismatch", () => {
		assert.equal(detectImmersionManualMismatch({ prevCommandedStage: 0, prevFeedbackActive: null }), "");
	});

	it("gehaltenes ON (keine Flanke) ist kein neues manual_on", () => {
		assert.equal(
			detectImmersionManualMismatch({
				prevCommandedStage: 0,
				prevFeedbackActive: true,
				feedbackActiveBeforePrev: true,
			}),
			"",
		);
	});

	it("OFF→ON bei EMS-Soll AUS → genau ein manual_on", () => {
		assert.equal(
			detectImmersionManualMismatch({
				prevCommandedStage: 0,
				prevFeedbackActive: true,
				feedbackActiveBeforePrev: false,
			}),
			"manual_on",
		);
	});

	it("gehaltenes OFF bei EMS-Soll AN ist kein neues manual_off", () => {
		assert.equal(
			detectImmersionManualMismatch({
				prevCommandedStage: 1,
				prevFeedbackActive: false,
				feedbackActiveBeforePrev: false,
			}),
			"",
		);
	});

	it("ON→OFF bei EMS-Soll AN → manual_off", () => {
		assert.equal(
			detectImmersionManualMismatch({
				prevCommandedStage: 1,
				prevFeedbackActive: false,
				feedbackActiveBeforePrev: true,
			}),
			"manual_off",
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
