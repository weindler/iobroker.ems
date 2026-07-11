import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { WallboxCommandCandidate } from "./command.js";
import { buildWallboxControlMappingSnapshot } from "./control_mapping.js";
import { buildWallboxWritePlan, WALLBOX_WRITE_SEQUENCE } from "./write_plan.js";

const NOW = new Date("2026-07-11T10:07:00.000Z");

function fullMapping() {
	return buildWallboxControlMappingSnapshot({
		config: {
			wb_set_enabled_target: "go-e.0.allow_charging",
			wb_set_enabled_enabled: true,
			wb_set_enabled_allowed: "[true,false,0,1]",
			wb_set_current_a_target: "go-e.0.amperePV",
			wb_set_current_a_enabled: true,
		},
		telemetryCfg: { enabledStateId: "evcc.0.enabled", chargePowerWStateId: "" },
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
			now: NOW,
		});
		assert.equal(plan.action, "none");
		assert.equal(plan.operations.length, 0);
		assert.equal(plan.actionable, false);
		assert.equal(plan.contractReady, true);
	});

	it("hold does not guess EVCC stop semantics", () => {
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
			now: NOW,
		});
		assert.equal(plan.action, "hold");
		assert.equal(plan.operations.length, 0);
		assert.equal(plan.contractReady, false);
		assert.equal(plan.blockReason, "hold_mapping_undefined");
	});

	it("charge start places setpoint before enable", () => {
		const plan = buildWallboxWritePlan({
			candidate: candidate(),
			mapping: fullMapping(),
			chargingEnabled: false,
			now: NOW,
		});
		assert.equal(plan.contractReady, true);
		assert.equal(plan.writeScenario, "charge_start");
		assert.equal(plan.operations.length, 2);
		assert.equal(plan.operations[0].role, "set_current_a");
		assert.equal(plan.operations[0].sequence, WALLBOX_WRITE_SEQUENCE.set_current_a);
		assert.equal(plan.operations[1].role, "set_enabled");
		assert.equal(plan.operations[1].sequence, WALLBOX_WRITE_SEQUENCE.set_enabled);
		assert.ok(plan.operations[0].sequence < plan.operations[1].sequence);
	});

	it("no enable write is planned before a valid setpoint on charge start", () => {
		const plan = buildWallboxWritePlan({
			candidate: candidate(),
			mapping: fullMapping(),
			chargingEnabled: false,
			now: NOW,
		});
		const enableIdx = plan.operations.findIndex((o) => o.role === "set_enabled");
		const chargeIdx = plan.operations.findIndex((o) => o.role === "set_current_a");
		assert.ok(chargeIdx >= 0);
		assert.ok(enableIdx > chargeIdx);
	});

	it("ongoing charge adjust plans only setpoint without enable", () => {
		const plan = buildWallboxWritePlan({
			candidate: candidate(),
			mapping: fullMapping(),
			chargingEnabled: true,
			now: NOW,
		});
		assert.equal(plan.writeScenario, "charge_adjust");
		assert.equal(plan.operations.length, 1);
		assert.equal(plan.operations[0].role, "set_current_a");
		assert.equal(plan.operations[0].targetValue, 16);
	});

	it("uses only configured state ids", () => {
		const plan = buildWallboxWritePlan({
			candidate: candidate(),
			mapping: fullMapping(),
			chargingEnabled: false,
			now: NOW,
		});
		for (const op of plan.operations) {
			assert.ok(op.targetStateId.startsWith("go-e."));
			assert.ok(!op.targetStateId.includes("hardcoded"));
		}
	});

	it("connected false produces no operations", () => {
		const plan = buildWallboxWritePlan({
			candidate: candidate({ connected: false, blocked: true, blockReason: "vehicle_disconnected" }),
			mapping: fullMapping(),
			chargingEnabled: false,
			now: NOW,
		});
		assert.equal(plan.operations.length, 0);
		assert.equal(plan.blockReason, "vehicle_disconnected");
	});

	it("soc 0 disconnected does not add soc error", () => {
		const plan = buildWallboxWritePlan({
			candidate: candidate({
				connected: false,
				targetPowerW: 0,
				targetCurrentA: null,
				blocked: true,
				blockReason: "vehicle_disconnected",
			}),
			mapping: fullMapping(),
			chargingEnabled: false,
			now: NOW,
		});
		assert.equal(plan.blockReason, "vehicle_disconnected");
	});

	it("blocked candidate produces no executable plan", () => {
		const plan = buildWallboxWritePlan({
			candidate: candidate({ blocked: true, technicallyReady: false, blockReason: "mapping_incomplete" }),
			mapping: fullMapping(),
			chargingEnabled: false,
			now: NOW,
		});
		assert.equal(plan.contractReady, false);
		assert.equal(plan.operations.length, 0);
	});

	it("missing enable role blocks contract", () => {
		const mapping = buildWallboxControlMappingSnapshot({
			config: { wb_set_current_a_target: "go-e.0.a", wb_set_current_a_enabled: true },
			telemetryCfg: { enabledStateId: "", chargePowerWStateId: "" },
		});
		const plan = buildWallboxWritePlan({
			candidate: candidate(),
			mapping,
			chargingEnabled: false,
			now: NOW,
		});
		assert.equal(plan.contractReady, false);
	});

	it("ambiguous same-target power mapping blocks contract", () => {
		const mapping = buildWallboxControlMappingSnapshot({
			config: {
				wb_set_enabled_target: "go-e.0.allow_charging",
				wb_set_enabled_enabled: true,
				wb_set_current_a_target: "go-e.0.amperePV",
				wb_set_current_a_enabled: true,
				wb_set_charge_power_w_target: "go-e.0.amperePV",
				wb_set_charge_power_w_enabled: true,
			},
			telemetryCfg: { enabledStateId: "", chargePowerWStateId: "" },
		});
		const plan = buildWallboxWritePlan({
			candidate: candidate(),
			mapping,
			chargingEnabled: false,
			now: NOW,
		});
		assert.equal(plan.contractReady, false);
		assert.equal(plan.blockReason, "ambiguous_power_control_mapping");
		assert.equal(plan.operations.length, 0);
	});

	it("rejects non-finite current", () => {
		const plan = buildWallboxWritePlan({
			candidate: candidate({ targetCurrentA: Number.NaN }),
			mapping: fullMapping(),
			chargingEnabled: false,
			now: NOW,
		});
		assert.equal(plan.contractReady, false);
		assert.equal(plan.blockReason, "invalid_target_current");
	});

	it("rejects negative power", () => {
		const mapping = buildWallboxControlMappingSnapshot({
			config: {
				wb_set_enabled_target: "go-e.0.allow_charging",
				wb_set_enabled_enabled: true,
				wb_set_charge_power_w_target: "go-e.0.p",
				wb_set_charge_power_w_enabled: true,
			},
			telemetryCfg: { enabledStateId: "", chargePowerWStateId: "evcc.0.p" },
		});
		const plan = buildWallboxWritePlan({
			candidate: candidate({ targetPowerW: -100, targetCurrentA: null }),
			mapping,
			chargingEnabled: false,
			now: NOW,
		});
		assert.equal(plan.contractReady, false);
	});

	it("readback from telemetry config for enable", () => {
		const plan = buildWallboxWritePlan({
			candidate: candidate(),
			mapping: fullMapping(),
			chargingEnabled: false,
			now: NOW,
		});
		const enableOp = plan.operations.find((o) => o.role === "set_enabled");
		assert.ok(enableOp);
		assert.equal(enableOp.readbackStateId, "evcc.0.enabled");
		assert.equal(enableOp.expectedReadbackValue, true);
	});

	it("feedback contract independent from write contract", () => {
		const plan = buildWallboxWritePlan({
			candidate: candidate(),
			mapping: fullMapping(),
			chargingEnabled: false,
			now: NOW,
		});
		assert.equal(plan.contractReady, true);
		assert.equal(plan.feedbackContractReady, false);
	});

	it("direct go-e path is not marked EVCC-compatible", () => {
		const plan = buildWallboxWritePlan({
			candidate: candidate(),
			mapping: fullMapping(),
			chargingEnabled: false,
			now: NOW,
		});
		assert.equal(plan.evccControlPathConfirmed, false);
	});

	it("stable operation order", () => {
		const a = buildWallboxWritePlan({
			candidate: candidate(),
			mapping: fullMapping(),
			chargingEnabled: false,
			now: NOW,
		});
		const b = buildWallboxWritePlan({
			candidate: candidate(),
			mapping: fullMapping(),
			chargingEnabled: false,
			now: NOW,
		});
		assert.deepEqual(
			a.operations.map((o) => [o.sequence, o.role, o.targetValue]),
			b.operations.map((o) => [o.sequence, o.role, o.targetValue]),
		);
	});
});
