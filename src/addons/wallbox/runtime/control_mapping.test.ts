import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
	buildWallboxControlMappingSnapshot,
	classifyWallboxControlTargetKind,
} from "./control_mapping.js";

describe("wallbox control mapping snapshot", () => {
	it("reads configured legacy roles from config", () => {
		const snap = buildWallboxControlMappingSnapshot({
			config: {
				wb_set_enabled_target: "go-e.0.allow_charging",
				wb_set_enabled_enabled: true,
				wb_set_current_a_target: "go-e.0.amperePV",
				wb_set_current_a_enabled: true,
			},
			telemetryCfg: { enabledStateId: "evcc.0.enabled", chargePowerWStateId: "evcc.0.power" },
		});
		assert.equal(snap.controlModel, "legacy_goe");
		assert.equal(snap.setEnabled?.targetStateId, "go-e.0.allow_charging");
		assert.equal(snap.setEnabled?.targetKind, "goe_direct");
		assert.equal(snap.chargeControlRole, "set_current_a");
		assert.equal(snap.missingRoles.length, 0);
		assert.equal(snap.evccControlPathConfirmed, false);
	});

	it("blocks ambiguous same-target current and power mappings", () => {
		const snap = buildWallboxControlMappingSnapshot({
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
		assert.equal(snap.ambiguousPowerControl, true);
		assert.equal(snap.mappingConflictReason, "ambiguous_power_control_mapping");
		assert.equal(snap.chargeControlRole, null);
	});

	it("uses power role when current missing and targets differ", () => {
		const snap = buildWallboxControlMappingSnapshot({
			config: {
				wb_set_enabled_target: "go-e.0.allow_charging",
				wb_set_enabled_enabled: true,
				wb_set_charge_power_w_target: "go-e.0.power",
				wb_set_charge_power_w_enabled: true,
			},
			telemetryCfg: { enabledStateId: "", chargePowerWStateId: "evcc.0.power" },
		});
		assert.equal(snap.chargeControlRole, "set_charge_power_w");
		assert.equal(snap.ambiguousPowerControl, false);
	});

	it("reports missing enable role", () => {
		const snap = buildWallboxControlMappingSnapshot({
			config: { wb_set_current_a_target: "go-e.0.ampere", wb_set_current_a_enabled: true },
			telemetryCfg: { enabledStateId: "", chargePowerWStateId: "" },
		});
		assert.ok(snap.missingRoles.includes("set_enabled"));
	});

	it("confirms EVCC control path only when all write targets are evcc.*", () => {
		const snap = buildWallboxControlMappingSnapshot({
			config: {
				wb_set_enabled_target: "evcc.0.loadpoint.1.enabled",
				wb_set_enabled_enabled: true,
				wb_set_current_a_target: "evcc.0.loadpoint.1.minCurrent",
				wb_set_current_a_enabled: true,
			},
			telemetryCfg: { enabledStateId: "evcc.0.enabled", chargePowerWStateId: "" },
		});
		assert.equal(snap.evccControlPathConfirmed, true);
		assert.equal(classifyWallboxControlTargetKind("evcc.0.loadpoint.1.enabled"), "evcc");
	});

	it("does not treat direct go-e targets as EVCC-compatible", () => {
		const snap = buildWallboxControlMappingSnapshot({
			config: {
				wb_set_enabled_target: "go-e.0.allow_charging",
				wb_set_enabled_enabled: true,
				wb_set_current_a_target: "go-e.0.amperePV",
				wb_set_current_a_enabled: true,
			},
			telemetryCfg: { enabledStateId: "evcc.0.enabled", chargePowerWStateId: "" },
		});
		assert.equal(snap.evccControlPathConfirmed, false);
		assert.equal(classifyWallboxControlTargetKind("go-e.0.allow_charging"), "goe_direct");
	});
});
