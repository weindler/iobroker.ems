import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { WallboxCommandCandidate } from "./command.js";
import { buildWallboxControlMappingSnapshot } from "./control_mapping.js";
import {
	buildWallboxWritePlan,
	WALLBOX_EVCC_WRITE_SEQUENCE,
	WALLBOX_LEGACY_WRITE_SEQUENCE,
} from "./write_plan.js";
import type { WallboxControlObjectMeta } from "./control_object_meta.js";

const NOW = new Date("2026-07-11T10:07:00.000Z");

function meta(id: string, commonType: "boolean" | "number" | "string", allowedStateKeys: string[] | null = null): WallboxControlObjectMeta {
	return {
		stateId: id,
		objectPresent: true,
		writable: true,
		commonType,
		allowedStateKeys,
	};
}

const EVCC_MODE = "evcc.0.loadpoint.1.mode";
const EVCC_MAX_CURRENT = "evcc.0.loadpoint.1.maxCurrent";
const MODE_STATES = ["pv", "off", "now"];

function legacyTelemetryCfg() {
	return {
		enabledStateId: "evcc.0.enabled",
		maxCurrentAStateId: "",
		modeReadbackStateId: "",
	};
}

function evccTelemetryCfg() {
	return {
		enabledStateId: "evcc.0.loadpoint.1.enabled",
		maxCurrentAStateId: "evcc.0.telemetry.maxCurrent",
		modeReadbackStateId: EVCC_MODE,
	};
}

function fullMapping() {
	return buildWallboxControlMappingSnapshot({
		config: {
			wb_control_model: "legacy_direct",
			wb_set_enabled_target: "go-e.0.allow_charging",
			wb_set_enabled_enabled: true,
			wb_set_enabled_allowed: "[true,false,0,1]",
			wb_set_current_a_target: "go-e.0.amperePV",
			wb_set_current_a_enabled: true,
		},
		telemetryCfg: legacyTelemetryCfg(),
		objectMetas: {
			"go-e.0.allow_charging": meta("go-e.0.allow_charging", "boolean"),
			"go-e.0.amperePV": meta("go-e.0.amperePV", "number"),
		},
	});
}

function evccMapping() {
	return buildWallboxControlMappingSnapshot({
		config: {
			wb_control_model: "evcc",
			wb_evcc_set_mode_target: EVCC_MODE,
			wb_evcc_set_max_current_a_target: EVCC_MAX_CURRENT,
			wb_evcc_mode_charge_value: "pv",
			wb_evcc_mode_hold_value: "off",
		},
		telemetryCfg: evccTelemetryCfg(),
		objectMetas: {
			[EVCC_MODE]: meta(EVCC_MODE, "string", MODE_STATES),
			[EVCC_MAX_CURRENT]: meta(EVCC_MAX_CURRENT, "number"),
		},
	});
}

function candidate(over: Partial<WallboxCommandCandidate> = {}): WallboxCommandCandidate {
	return {
		action: "charge",
		targetPowerW: 3600,
		targetCurrentA: 16,
		energySource: "grid",
		connected: true,
		technicallyReady: true,
		dispatchRevision: 3,
		planRevision: 3,
		createdAt: NOW.toISOString(),
		blocked: false,
		blockReason: null,
		...over,
	};
}

describe("wallbox write plan", () => {
	it("none produces valid empty noop plan", () => {
		const plan = buildWallboxWritePlan({
			candidate: candidate({ action: "none", blocked: true, blockReason: "dispatch_none" }),
			mapping: fullMapping(),
			chargingEnabled: false,
			chargeModeActive: null,
			now: NOW,
		});
		assert.equal(plan.action, "none");
		assert.equal(plan.operations.length, 0);
		assert.equal(plan.actionable, false);
		assert.equal(plan.contractReady, true);
	});

	it("hold does not guess EVCC stop semantics without hold mapping", () => {
		const plan = buildWallboxWritePlan({
			candidate: candidate({
				action: "hold",
				targetPowerW: 0,
				targetCurrentA: null,
				blocked: true,
				blockReason: "hold_requested",
				technicallyReady: true,
			}),
			mapping: fullMapping(),
			chargingEnabled: false,
			chargeModeActive: null,
			now: NOW,
		});
		assert.equal(plan.action, "hold");
		assert.equal(plan.operations.length, 0);
		assert.equal(plan.contractReady, false);
		assert.equal(plan.blockReason, "hold_mapping_undefined");
	});

	it("legacy charge start places setpoint before enable", () => {
		const plan = buildWallboxWritePlan({
			candidate: candidate(),
			mapping: fullMapping(),
			chargingEnabled: false,
			chargeModeActive: null,
			now: NOW,
		});
		assert.equal(plan.contractReady, true);
		assert.equal(plan.writeScenario, "charge_start");
		assert.equal(plan.operations.length, 2);
		assert.equal(plan.operations[0].role, "set_current_a");
		assert.equal(plan.operations[0].sequence, WALLBOX_LEGACY_WRITE_SEQUENCE.set_current_a);
		assert.equal(plan.operations[1].role, "set_enabled");
		assert.equal(plan.operations[1].sequence, WALLBOX_LEGACY_WRITE_SEQUENCE.set_enabled);
		assert.ok(plan.operations[0].sequence < plan.operations[1].sequence);
	});

	it("legacy ongoing charge adjust plans only setpoint without enable", () => {
		const plan = buildWallboxWritePlan({
			candidate: candidate(),
			mapping: fullMapping(),
			chargingEnabled: true,
			chargeModeActive: null,
			now: NOW,
		});
		assert.equal(plan.writeScenario, "charge_adjust");
		assert.equal(plan.operations.length, 1);
		assert.equal(plan.operations[0].role, "set_current_a");
		assert.equal(plan.operations[0].targetValue, 16);
	});

	it("evcc charge start places maxCurrent before mode", () => {
		const plan = buildWallboxWritePlan({
			candidate: candidate(),
			mapping: evccMapping(),
			chargingEnabled: false,
			chargeModeActive: false,
			now: NOW,
		});
		assert.equal(plan.contractReady, true);
		assert.equal(plan.writeScenario, "charge_start");
		assert.equal(plan.operations.length, 2);
		assert.equal(plan.operations[0].role, "set_max_current_a");
		assert.equal(plan.operations[0].sequence, WALLBOX_EVCC_WRITE_SEQUENCE.set_max_current_a);
		assert.equal(plan.operations[1].role, "set_mode");
		assert.equal(plan.operations[1].sequence, WALLBOX_EVCC_WRITE_SEQUENCE.set_mode);
		assert.equal(plan.operations[0].targetStateId, EVCC_MAX_CURRENT);
		assert.equal(plan.operations[1].targetValue, "pv");
	});

	it("evcc ongoing adjust plans only maxCurrent when charge mode active", () => {
		const plan = buildWallboxWritePlan({
			candidate: candidate(),
			mapping: evccMapping(),
			chargingEnabled: true,
			chargeModeActive: true,
			now: NOW,
		});
		assert.equal(plan.writeScenario, "charge_adjust");
		assert.equal(plan.operations.length, 1);
		assert.equal(plan.operations[0].role, "set_max_current_a");
		assert.ok(!plan.operations.some((o) => o.role === "set_enabled"));
		assert.ok(!plan.operations.some((o) => o.role === "set_mode"));
	});

	it("evcc does not use minCurrent target", () => {
		const mapping = buildWallboxControlMappingSnapshot({
			config: {
				wb_control_model: "evcc",
				wb_evcc_set_mode_target: EVCC_MODE,
				wb_evcc_set_max_current_a_target: "evcc.0.loadpoint.1.minCurrent",
				wb_evcc_mode_charge_value: "pv",
			},
			telemetryCfg: evccTelemetryCfg(),
			objectMetas: {
				[EVCC_MODE]: meta(EVCC_MODE, "string", MODE_STATES),
				"evcc.0.loadpoint.1.minCurrent": meta("evcc.0.loadpoint.1.minCurrent", "number"),
			},
		});
		const plan = buildWallboxWritePlan({
			candidate: candidate(),
			mapping,
			chargingEnabled: false,
			chargeModeActive: false,
			now: NOW,
		});
		assert.equal(plan.contractReady, false);
		assert.equal(plan.operations.length, 0);
	});

	it("missing charge mode mapping blocks evcc charge_start", () => {
		const mapping = buildWallboxControlMappingSnapshot({
			config: {
				wb_control_model: "evcc",
				wb_evcc_set_mode_target: EVCC_MODE,
				wb_evcc_set_max_current_a_target: EVCC_MAX_CURRENT,
			},
			telemetryCfg: evccTelemetryCfg(),
			objectMetas: {
				[EVCC_MODE]: meta(EVCC_MODE, "string", MODE_STATES),
				[EVCC_MAX_CURRENT]: meta(EVCC_MAX_CURRENT, "number"),
			},
		});
		const plan = buildWallboxWritePlan({
			candidate: candidate(),
			mapping,
			chargingEnabled: false,
			chargeModeActive: false,
			now: NOW,
		});
		assert.equal(plan.contractReady, false);
		assert.equal(plan.blockReason, "evcc_charge_mode_mapping_missing");
	});

	it("uses only configured state ids", () => {
		const plan = buildWallboxWritePlan({
			candidate: candidate(),
			mapping: fullMapping(),
			chargingEnabled: false,
			chargeModeActive: null,
			now: NOW,
		});
		for (const op of plan.operations) {
			assert.ok(op.targetStateId.startsWith("go-e."));
		}
	});

	it("connected false produces no operations", () => {
		const plan = buildWallboxWritePlan({
			candidate: candidate({ connected: false, blocked: true, blockReason: "vehicle_disconnected" }),
			mapping: fullMapping(),
			chargingEnabled: false,
			chargeModeActive: null,
			now: NOW,
		});
		assert.equal(plan.operations.length, 0);
		assert.equal(plan.blockReason, "vehicle_disconnected");
	});

	it("blocked candidate produces no executable plan", () => {
		const plan = buildWallboxWritePlan({
			candidate: candidate({ blocked: true, technicallyReady: false, blockReason: "mapping_incomplete" }),
			mapping: fullMapping(),
			chargingEnabled: false,
			chargeModeActive: null,
			now: NOW,
		});
		assert.equal(plan.contractReady, false);
		assert.equal(plan.operations.length, 0);
	});

	it("ambiguous same-target power mapping blocks contract", () => {
		const mapping = buildWallboxControlMappingSnapshot({
			config: {
				wb_control_model: "legacy_direct",
				wb_set_enabled_target: "go-e.0.allow_charging",
				wb_set_enabled_enabled: true,
				wb_set_current_a_target: "go-e.0.amperePV",
				wb_set_current_a_enabled: true,
				wb_set_charge_power_w_target: "go-e.0.amperePV",
				wb_set_charge_power_w_enabled: true,
			},
			telemetryCfg: legacyTelemetryCfg(),
			objectMetas: {},
		});
		const plan = buildWallboxWritePlan({
			candidate: candidate(),
			mapping,
			chargingEnabled: false,
			chargeModeActive: null,
			now: NOW,
		});
		assert.equal(plan.contractReady, false);
		assert.equal(plan.blockReason, "ambiguous_power_control_mapping");
	});

	it("evcc readback uses maxCurrent and mode not enabled", () => {
		const plan = buildWallboxWritePlan({
			candidate: candidate(),
			mapping: evccMapping(),
			chargingEnabled: false,
			chargeModeActive: false,
			now: NOW,
		});
		const maxOp = plan.operations.find((o) => o.role === "set_max_current_a");
		const modeOp = plan.operations.find((o) => o.role === "set_mode");
		assert.ok(maxOp);
		assert.ok(modeOp);
		assert.equal(maxOp.readbackStateId, "evcc.0.telemetry.maxCurrent");
		assert.equal(modeOp.readbackStateId, EVCC_MODE);
		assert.ok(!plan.operations.some((o) => o.readbackStateId?.includes("enabled")));
	});

	it("direct go-e path is not live-eligible", () => {
		const plan = buildWallboxWritePlan({
			candidate: candidate(),
			mapping: fullMapping(),
			chargingEnabled: false,
			chargeModeActive: null,
			now: NOW,
		});
		assert.equal(plan.evccControlPathConfirmed, false);
		assert.equal(plan.liveEligible, false);
	});

	it("evcc path can be live-eligible structurally", () => {
		const plan = buildWallboxWritePlan({
			candidate: candidate(),
			mapping: evccMapping(),
			chargingEnabled: false,
			chargeModeActive: false,
			now: NOW,
		});
		assert.equal(plan.contractReady, true);
		assert.equal(plan.evccControlPathConfirmed, true);
		assert.equal(plan.liveEligible, true);
	});

	it("feedback contract requires readback states", () => {
		const plan = buildWallboxWritePlan({
			candidate: candidate(),
			mapping: evccMapping(),
			chargingEnabled: false,
			chargeModeActive: false,
			now: NOW,
		});
		assert.equal(plan.feedbackContractReady, true);
	});

	it("legacy feedback contract independent when current has no readback", () => {
		const plan = buildWallboxWritePlan({
			candidate: candidate(),
			mapping: fullMapping(),
			chargingEnabled: false,
			chargeModeActive: null,
			now: NOW,
		});
		assert.equal(plan.contractReady, true);
		assert.equal(plan.feedbackContractReady, false);
	});
});
