import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildWallboxControlMappingSnapshot } from "./control_mapping.js";
import type { WallboxControlObjectMeta } from "./control_object_meta.js";

function meta(
	id: string,
	commonType: "boolean" | "number" | "string",
	writable = true,
	allowedStateKeys: string[] | null = null,
): WallboxControlObjectMeta {
	return {
		stateId: id,
		objectPresent: true,
		writable,
		commonType,
		allowedStateKeys,
	};
}

const EVCC_MODE = "evcc.0.loadpoint.1.mode";
const EVCC_MAX_CURRENT = "evcc.0.loadpoint.1.maxCurrent";
const EVCC_ENABLED = "evcc.0.loadpoint.1.enabled";
const EVCC_MIN_CURRENT = "evcc.0.loadpoint.1.minCurrent";
const MODE_STATES = ["pv", "off", "now"];

function evccTelemetryCfg() {
	return {
		enabledStateId: "evcc.0.loadpoint.1.enabled",
		maxCurrentAStateId: "evcc.0.telemetry.maxCurrent",
		modeReadbackStateId: "evcc.0.loadpoint.1.mode",
	};
}

function validEvccConfig(over: Record<string, unknown> = {}) {
	return {
		wb_control_model: "evcc",
		wb_evcc_set_mode_target: EVCC_MODE,
		wb_evcc_set_max_current_a_target: EVCC_MAX_CURRENT,
		wb_evcc_mode_charge_value: "pv",
		wb_evcc_mode_hold_value: "off",
		...over,
	};
}

function validEvccMetas(over: Record<string, WallboxControlObjectMeta> = {}) {
	return {
		[EVCC_MODE]: meta(EVCC_MODE, "string", true, MODE_STATES),
		[EVCC_MAX_CURRENT]: meta(EVCC_MAX_CURRENT, "number"),
		...over,
	};
}

describe("wallbox control mapping snapshot", () => {
	it("evcc model without mapping is blocked", () => {
		const snap = buildWallboxControlMappingSnapshot({
			config: { wb_control_model: "evcc" },
			telemetryCfg: evccTelemetryCfg(),
			objectMetas: {},
		});
		assert.equal(snap.controlModel, "evcc");
		assert.equal(snap.evccControlPathConfirmed, false);
		assert.equal(snap.liveEligible, false);
		assert.ok(snap.missingRoles.includes("set_mode"));
		assert.ok(snap.missingRoles.includes("set_max_current_a"));
	});

	it("evcc model with maxCurrent and mode is confirmed and live-eligible", () => {
		const snap = buildWallboxControlMappingSnapshot({
			config: validEvccConfig(),
			telemetryCfg: evccTelemetryCfg(),
			objectMetas: validEvccMetas(),
		});
		assert.equal(snap.evccControlPathConfirmed, true);
		assert.equal(snap.liveEligible, true);
		assert.equal(snap.setMaxCurrentA?.semanticRole, "evcc_max_current");
		assert.equal(snap.setMode?.semanticRole, "evcc_mode");
		assert.equal(snap.controlPathReason, "evcc_control_path_confirmed");
	});

	it("minCurrent is not accepted as max current role", () => {
		const snap = buildWallboxControlMappingSnapshot({
			config: validEvccConfig({ wb_evcc_set_max_current_a_target: EVCC_MIN_CURRENT }),
			telemetryCfg: evccTelemetryCfg(),
			objectMetas: {
				[EVCC_MODE]: meta(EVCC_MODE, "string", true, MODE_STATES),
				[EVCC_MIN_CURRENT]: meta(EVCC_MIN_CURRENT, "number"),
			},
		});
		assert.equal(snap.evccControlPathConfirmed, false);
		assert.ok(snap.validationIssues.some((i) => i.includes("min_current_not_max_current")));
	});

	it("enabled is not accepted as mode role", () => {
		const snap = buildWallboxControlMappingSnapshot({
			config: validEvccConfig({ wb_evcc_set_mode_target: EVCC_ENABLED }),
			telemetryCfg: evccTelemetryCfg(),
			objectMetas: {
				[EVCC_ENABLED]: meta(EVCC_ENABLED, "boolean"),
				[EVCC_MAX_CURRENT]: meta(EVCC_MAX_CURRENT, "number"),
			},
		});
		assert.equal(snap.evccControlPathConfirmed, false);
		assert.ok(snap.validationIssues.some((i) => i.includes("enabled_not_evcc_mode")));
	});

	it("common.write alone on evcc namespace does not confirm semantics", () => {
		const snap = buildWallboxControlMappingSnapshot({
			config: validEvccConfig({
				wb_evcc_set_max_current_a_target: "evcc.0.loadpoint.1.enabled",
			}),
			telemetryCfg: evccTelemetryCfg(),
			objectMetas: {
				"evcc.0.loadpoint.1.enabled": meta("evcc.0.loadpoint.1.enabled", "boolean"),
				[EVCC_MODE]: meta(EVCC_MODE, "string", true, MODE_STATES),
			},
		});
		assert.equal(snap.evccControlPathConfirmed, false);
	});

	it("unknown charge mode value blocks confirmation", () => {
		const snap = buildWallboxControlMappingSnapshot({
			config: validEvccConfig({ wb_evcc_mode_charge_value: "unknown_mode" }),
			telemetryCfg: evccTelemetryCfg(),
			objectMetas: validEvccMetas(),
		});
		assert.equal(snap.chargeModeValueConfirmed, false);
		assert.equal(snap.evccControlPathConfirmed, false);
		assert.ok(snap.validationIssues.some((i) => i.includes("enum_value_not_allowed")));
	});

	it("go-e target is not confirmed as evcc path", () => {
		const snap = buildWallboxControlMappingSnapshot({
			config: {
				wb_control_model: "legacy_direct",
				wb_set_enabled_target: "go-e.0.allow_charging",
				wb_set_current_a_target: "go-e.0.amperePV",
			},
			telemetryCfg: { enabledStateId: "", maxCurrentAStateId: "", modeReadbackStateId: "" },
			objectMetas: {
				"go-e.0.allow_charging": meta("go-e.0.allow_charging", "boolean"),
				"go-e.0.amperePV": meta("go-e.0.amperePV", "number"),
			},
		});
		assert.equal(snap.evccControlPathConfirmed, false);
		assert.equal(snap.liveEligible, false);
		assert.equal(snap.controlPathReason, "legacy_direct_not_live_eligible");
	});

	it("legacy model is not live-eligible even when complete", () => {
		const snap = buildWallboxControlMappingSnapshot({
			config: {
				wb_control_model: "legacy_direct",
				wb_set_enabled_target: "go-e.0.allow_charging",
				wb_set_current_a_target: "go-e.0.amperePV",
			},
			telemetryCfg: { enabledStateId: "", maxCurrentAStateId: "", modeReadbackStateId: "" },
			objectMetas: {
				"go-e.0.allow_charging": meta("go-e.0.allow_charging", "boolean"),
				"go-e.0.amperePV": meta("go-e.0.amperePV", "number"),
			},
		});
		assert.equal(snap.liveEligible, false);
		assert.equal(snap.chargeControlRole, "set_current_a");
	});

	it("ambiguous same-target current and power mappings stay blocked", () => {
		const snap = buildWallboxControlMappingSnapshot({
			config: {
				wb_control_model: "legacy_direct",
				wb_set_enabled_target: "go-e.0.allow_charging",
				wb_set_current_a_target: "go-e.0.amperePV",
				wb_set_charge_power_w_target: "go-e.0.amperePV",
			},
			telemetryCfg: { enabledStateId: "", maxCurrentAStateId: "", modeReadbackStateId: "" },
			objectMetas: {},
		});
		assert.equal(snap.ambiguousPowerControl, true);
		assert.equal(snap.mappingConflictReason, "ambiguous_power_control_mapping");
	});

	it("non-writable evcc target blocks confirmation", () => {
		const snap = buildWallboxControlMappingSnapshot({
			config: validEvccConfig(),
			telemetryCfg: evccTelemetryCfg(),
			objectMetas: validEvccMetas({
				[EVCC_MAX_CURRENT]: meta(EVCC_MAX_CURRENT, "number", false),
			}),
		});
		assert.equal(snap.evccControlPathConfirmed, false);
		assert.ok(snap.validationIssues.some((i) => i.includes("target_not_writable")));
	});

	it("legacy config without explicit model defaults to none", () => {
		const snap = buildWallboxControlMappingSnapshot({
			config: {
				wb_set_enabled_target: "go-e.0.allow_charging",
				wb_set_current_a_target: "go-e.0.amperePV",
			},
			telemetryCfg: { enabledStateId: "", maxCurrentAStateId: "", modeReadbackStateId: "" },
			objectMetas: {},
		});
		assert.equal(snap.controlModel, "none");
		assert.equal(snap.controlPathReason, "control_model_not_selected");
		assert.equal(snap.legacyMappingsPresent, true);
	});
});
