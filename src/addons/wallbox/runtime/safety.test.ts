import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
	emptyWallboxOwnership,
	grantWallboxOwnership,
	canSafeRestoreWallbox,
} from "./ownership.js";
import {
	emptyWallboxFault,
	raiseWallboxFault,
	clearWallboxFault,
	faultCodeForFeedbackStatus,
} from "./fault.js";
import { planWallboxSafeRestore } from "./restore.js";
import type { WallboxControlMappingSnapshot } from "./control_mapping.js";

const NOW_ISO = "2026-07-20T10:00:00.000Z";

function baseMapping(over: Partial<WallboxControlMappingSnapshot> = {}): WallboxControlMappingSnapshot {
	return {
		controlModel: "evcc",
		legacyMappingsPresent: false,
		evccMappingsPresent: true,
		setEnabled: null,
		setCurrentA: null,
		setChargePowerW: null,
		setMode: {
			role: "set_mode",
			configured: true,
			targetStateId: "evcc.0.loadpoint.1.mode",
			targetValueType: "string",
			targetKind: "evcc",
			semanticRole: "evcc_mode",
			allowedValuesRaw: null,
			readbackStateId: "evcc.0.loadpoint.1.mode",
			required: true,
			objectPresent: true,
			writable: true,
			commonType: "string",
			contractValid: true,
			validationReason: null,
		},
		setMaxCurrentA: null,
		setPhase: null,
		evccChargeModeValue: "pv",
		evccHoldModeValue: "off",
		chargeModeValueConfirmed: true,
		holdModeValueConfirmed: true,
		chargeControlRole: null,
		missingRoles: [],
		ambiguousPowerControl: false,
		mappingConflictReason: null,
		evccControlPathConfirmed: true,
		liveEligible: true,
		controlPathReason: "evcc_control_path_confirmed",
		validationIssues: [],
		controlContractModel: "evcc_string_mode",
		evccControlContractReady: false,
		legacyDirectControlPresent: false,
		...over,
	};
}

describe("wallbox ownership", () => {
	it("starts empty/inactive", () => {
		const o = emptyWallboxOwnership();
		assert.equal(o.active, false);
		assert.equal(canSafeRestoreWallbox(o), false);
	});

	it("grant marks ownership active with control model and timestamp", () => {
		const o = grantWallboxOwnership("evcc", "charge_start", NOW_ISO);
		assert.equal(o.active, true);
		assert.equal(o.controlModel, "evcc");
		assert.equal(o.writeScenario, "charge_start");
		assert.equal(o.startedAt, NOW_ISO);
		assert.equal(canSafeRestoreWallbox(o), true);
	});

	it("none control model cannot safe-restore", () => {
		const o = grantWallboxOwnership("none", null, NOW_ISO);
		assert.equal(canSafeRestoreWallbox(o), false);
	});
});

describe("wallbox fault/lockout", () => {
	it("starts empty/inactive", () => {
		const f = emptyWallboxFault();
		assert.equal(f.active, false);
		assert.equal(f.code, null);
	});

	it("raise sets active fault with code/message/timestamp", () => {
		const f = raiseWallboxFault("feedback_mismatch", "value mismatch", NOW_ISO);
		assert.equal(f.active, true);
		assert.equal(f.code, "feedback_mismatch");
		assert.equal(f.message, "value mismatch");
		assert.equal(f.since, NOW_ISO);
	});

	it("clear resets to empty", () => {
		const f = clearWallboxFault();
		assert.equal(f.active, false);
		assert.equal(f.code, null);
	});

	it("maps feedback statuses to fault codes, ignores non-terminal statuses", () => {
		assert.equal(faultCodeForFeedbackStatus("mismatch"), "feedback_mismatch");
		assert.equal(faultCodeForFeedbackStatus("timeout"), "feedback_timeout");
		assert.equal(faultCodeForFeedbackStatus("invalid"), "feedback_invalid");
		assert.equal(faultCodeForFeedbackStatus("matched"), null);
		assert.equal(faultCodeForFeedbackStatus("pending"), null);
		assert.equal(faultCodeForFeedbackStatus("not_required"), null);
	});
});

describe("wallbox safe restore plan", () => {
	it("no ownership → not required", () => {
		const plan = planWallboxSafeRestore(emptyWallboxOwnership(), baseMapping());
		assert.equal(plan.required, false);
		assert.equal(plan.reason, "no_ownership");
	});

	it("legacy_direct ownership is never restorable (never live-eligible in the first place)", () => {
		const ownership = grantWallboxOwnership("legacy_direct", "charge_start", NOW_ISO);
		const plan = planWallboxSafeRestore(ownership, baseMapping({ controlModel: "legacy_direct" }));
		assert.equal(plan.required, false);
		assert.equal(plan.reason, "control_model_not_restorable");
	});

	it("evcc ownership with confirmed hold mapping produces a restore write to the hold value", () => {
		const ownership = grantWallboxOwnership("evcc", "charge_start", NOW_ISO);
		const plan = planWallboxSafeRestore(ownership, baseMapping());
		assert.equal(plan.required, true);
		assert.equal(plan.possible, true);
		assert.equal(plan.operation?.targetStateId, "evcc.0.loadpoint.1.mode");
		assert.equal(plan.operation?.targetValue, "off");
	});

	it("evcc ownership without confirmed hold mapping cannot restore", () => {
		const ownership = grantWallboxOwnership("evcc", "charge_start", NOW_ISO);
		const plan = planWallboxSafeRestore(
			ownership,
			baseMapping({ holdModeValueConfirmed: false, evccHoldModeValue: null }),
		);
		assert.equal(plan.required, true);
		assert.equal(plan.possible, false);
		assert.equal(plan.operation, null);
		assert.equal(plan.reason, "hold_mapping_undefined");
	});
});
