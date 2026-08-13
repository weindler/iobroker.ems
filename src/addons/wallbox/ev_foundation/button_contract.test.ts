import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import { isLiveWriteAllowed } from "../../../execution_mode";
import { addonMode, GLOBAL } from "../../../tree_paths";
import { goeWallboxTemplateFlat } from "../../../mapping_config";
import {
	collectConfiguredControlTargetStateIds,
	hasEvccControlWriteMapping,
	resolveWallboxControlModel,
} from "../evcc_control_config";
import {
	isEvccModeFeedbackStateId,
	pickEvccButtonStateId,
	resolveEvccModeControlContract,
} from "../evcc_mode_control";
import { evaluateWallboxDispatchReadiness } from "../runtime/dispatch";
import { buildWallboxControlMappingSnapshot } from "../runtime/control_mapping";
import {
	metaFromObject,
	validateEvccButtonTargetMeta,
	validateEvccControlTargetMeta,
	validateEvccModeFeedbackMeta,
	type WallboxControlObjectMeta,
} from "../runtime/control_object_meta";
import { prepareEvccButtonTrigger } from "../runtime/evcc_button_trigger";
import { wallboxEvccTelemetryConfigFromAdapter } from "../evcc_config";
import { readEvccTelemetrySnapshot, type EvccTelemetryReadHost } from "../evcc_telemetry";
import { EVCC_READ_CATALOG } from "./catalog";
import { resolveEvCapabilities } from "./capabilities";
import { evFoundationConfigFromAdapter } from "./config";
import { readExternalEvInformation } from "./external";
import { buildEvModelV1 } from "./model";
import { applyEvFoundationIntegration } from "./vehicle_model";
import {
	EV_FOUNDATION_PHASE1_PLANNER_WRITES_ENABLED,
	EV_FOUNDATION_PLANNER_WRITES_ENABLED,
	isFuturePlannerWriteAllowed,
} from "./write_allowlist";

const SRC = join(__dirname, "..", "..", "..", "..", "src", "addons", "wallbox");
const NOW = new Date("2026-08-13T14:00:00.000Z");

const LP = "evcc.0.loadpoint.1";

function buttonCfg(over: Record<string, unknown> = {}): Record<string, unknown> {
	return {
		wb_control_model: "evcc",
		wb_evcc_mode_control: "buttons",
		wb_evcc_control_off_target: `${LP}.control.off`,
		wb_evcc_control_pv_target: `${LP}.control.pv`,
		wb_evcc_control_min_target: `${LP}.control.min`,
		wb_evcc_control_now_target: `${LP}.control.now`,
		wb_evcc_loadpoint_mode_state: `${LP}.status.mode`,
		wb_evcc_control_max_current_target: `${LP}.control.maxCurrent`,
		wb_evcc_control_phases_configured_target: `${LP}.control.phasesConfigured`,
		...over,
	};
}

function buttonObj(
	id: string,
	over: { write?: boolean; read?: boolean; type?: string } = {},
): ioBroker.Object {
	return {
		_id: id,
		type: "state",
		common: {
			name: id,
			type: over.type ?? "boolean",
			read: over.read ?? false,
			write: over.write ?? true,
			role: "button",
		},
		native: {},
	} as unknown as ioBroker.Object;
}

function meta(
	id: string,
	commonType: "boolean" | "number" | "string",
	writable = true,
	readable = true,
): WallboxControlObjectMeta {
	return {
		stateId: id,
		objectPresent: true,
		writable,
		readable,
		commonType,
		allowedStateKeys: null,
	};
}

function buttonMetas(): Record<string, WallboxControlObjectMeta> {
	return {
		[`${LP}.control.off`]: meta(`${LP}.control.off`, "boolean", true, false),
		[`${LP}.control.pv`]: meta(`${LP}.control.pv`, "boolean", true, false),
		[`${LP}.control.min`]: meta(`${LP}.control.min`, "boolean", true, false),
		[`${LP}.control.now`]: meta(`${LP}.control.now`, "boolean", true, false),
		[`${LP}.control.maxCurrent`]: meta(`${LP}.control.maxCurrent`, "number", true, true),
		[`${LP}.control.phasesConfigured`]: meta(`${LP}.control.phasesConfigured`, "number", true, true),
		[`${LP}.status.mode`]: meta(`${LP}.status.mode`, "string", false, true),
	};
}

function minEvccAdminConfig(over: Record<string, unknown> = {}): Record<string, unknown> {
	return {
		wb_control_model: "evcc",
		wb_evcc_connection_state: EVCC_READ_CATALOG.connection,
		wb_evcc_connected_state: EVCC_READ_CATALOG.connected,
		wb_evcc_charging_state: EVCC_READ_CATALOG.charging,
		wb_evcc_charge_power_w_state: EVCC_READ_CATALOG.chargePower,
		wb_evcc_loadpoint_mode_state: `${LP}.status.mode`,
		...over,
	};
}

function minForeign(over: Record<string, unknown> = {}): Record<string, unknown> {
	return {
		[EVCC_READ_CATALOG.connection]: true,
		[EVCC_READ_CATALOG.connected]: true,
		[EVCC_READ_CATALOG.charging]: false,
		[EVCC_READ_CATALOG.chargePower]: 0,
		[`${LP}.status.mode`]: "now",
		...over,
	};
}

function mockHost(states: Record<string, unknown>): EvccTelemetryReadHost {
	return {
		async getForeignStateAsync(id: string) {
			if (!(id in states)) return null;
			return { val: states[id] as ioBroker.StateValue, ack: true } as ioBroker.State;
		},
		async getStateAsync() {
			return null;
		},
		async setStateAsync() {
			return;
		},
		async setObjectNotExistsAsync() {
			return;
		},
	};
}

async function load(admin: Record<string, unknown>, foreign: Record<string, unknown>) {
	const host = mockHost(foreign);
	const cfg = wallboxEvccTelemetryConfigFromAdapter(admin);
	const snap = await readEvccTelemetrySnapshot(host, cfg, NOW);
	const foundation = evFoundationConfigFromAdapter(admin);
	const external = await readExternalEvInformation(host, foundation, {
		now: NOW,
		fallbackMaxAcKw: null,
		configDepartureAt: null,
		timezone: "Europe/Berlin",
	});
	const capabilities = resolveEvCapabilities(cfg, snap, foundation, external);
	const built = buildEvModelV1({ snap, foundation, capabilities, adapterConfig: admin, external });
	const model = applyEvFoundationIntegration(built, capabilities, admin);
	return { model, capabilities };
}

describe("EVCC button control contract v0.1.274", () => {
	it("T1: button contract with all four buttons is ready", () => {
		const contract = resolveEvccModeControlContract(buttonCfg());
		assert.equal(contract.resolvedVariant, "buttons");
		assert.equal(contract.buttonsReady, true);
		assert.equal(contract.writeContractReady, true);
		assert.equal(contract.usesLegacyGoeFallback, false);
		const r = evaluateWallboxDispatchReadiness(buttonCfg());
		assert.equal(r.controlMappingComplete, true);
		assert.equal(r.liveDispatchSupported, false);
	});

	it("T2: status.mode as feedback is valid", () => {
		const contract = resolveEvccModeControlContract(buttonCfg());
		assert.equal(contract.modeFeedbackStateId, `${LP}.status.mode`);
		assert.equal(isEvccModeFeedbackStateId(contract.modeFeedbackStateId), true);
		const fb = validateEvccModeFeedbackMeta(
			contract.modeFeedbackStateId,
			meta(`${LP}.status.mode`, "string", false, true),
		);
		assert.equal(fb.valid, true);
	});

	it("T3: status.mode is never a write target", () => {
		const r = validateEvccControlTargetMeta(
			`${LP}.status.mode`,
			"string",
			meta(`${LP}.status.mode`, "string", true, true),
			"set_mode",
		);
		assert.equal(r.valid, false);
		assert.equal(r.reason, "mode_feedback_not_a_write_target");
		const btn = validateEvccButtonTargetMeta(
			`${LP}.status.mode`,
			"now",
			meta(`${LP}.status.mode`, "string", true, true),
		);
		assert.equal(btn.valid, false);
		assert.equal(btn.reason, "mode_feedback_not_a_write_target");
	});

	it("T4: button read=false/write=true is a valid write target", () => {
		const id = `${LP}.control.now`;
		const obj = buttonObj(id, { read: false, write: true, type: "boolean" });
		const m = metaFromObject(id, obj);
		assert.equal(m.objectPresent, true);
		assert.equal(m.writable, true);
		assert.equal(m.readable, false);
		const v = validateEvccButtonTargetMeta(id, "now", m);
		assert.equal(v.valid, true);
	});

	it("T5: missing OFF button is incomplete", () => {
		const contract = resolveEvccModeControlContract(buttonCfg({ wb_evcc_control_off_target: "" }));
		assert.equal(contract.writeContractReady, false);
		assert.ok(contract.missing.includes("control.off"));
	});

	it("T6: missing PV button is incomplete", () => {
		const contract = resolveEvccModeControlContract(buttonCfg({ wb_evcc_control_pv_target: "" }));
		assert.ok(contract.missing.includes("control.pv"));
		assert.equal(contract.buttonsReady, false);
	});

	it("T7: missing MIN button is incomplete", () => {
		const contract = resolveEvccModeControlContract(buttonCfg({ wb_evcc_control_min_target: "" }));
		assert.ok(contract.missing.includes("control.min"));
	});

	it("T8: missing NOW button is incomplete", () => {
		const contract = resolveEvccModeControlContract(buttonCfg({ wb_evcc_control_now_target: "" }));
		assert.ok(contract.missing.includes("control.now"));
	});

	it("T9: buttons variant does not require evcc_charge_mode_value", () => {
		const snap = buildWallboxControlMappingSnapshot({
			config: buttonCfg(),
			telemetryCfg: { enabledStateId: "", maxCurrentAStateId: "", modeReadbackStateId: `${LP}.status.mode` },
			objectMetas: buttonMetas(),
		});
		assert.equal(snap.evccModeControlVariant, "buttons");
		assert.ok(!snap.missingRoles.includes("evcc_charge_mode_value"));
		assert.ok(!snap.validationIssues.some((i) => i.includes("evcc_charge_mode_mapping_missing")));
		assert.equal(snap.liveEligible, false);
	});

	it("T10: buttons variant does not require pvControl", () => {
		const contract = resolveEvccModeControlContract(buttonCfg());
		assert.equal(contract.pvControlStateId, "");
		assert.ok(!contract.missing.includes("control.pvControl"));
		assert.equal(contract.writeContractReady, true);
	});

	it("T11: stale pvControl does not affect button contract", () => {
		const contract = resolveEvccModeControlContract(
			buttonCfg({
				wb_evcc_control_pv_control_target: `${LP}.control.pvControl`,
			}),
		);
		assert.equal(contract.resolvedVariant, "buttons");
		assert.equal(contract.writeContractReady, true);
		assert.equal(contract.detail.pvControlIgnoredForButtons, true);
		assert.ok(!contract.missing.includes("control.pvControl"));
	});

	it("T12: writeable maxCurrent object is recognized", () => {
		const id = `${LP}.control.maxCurrent`;
		const m = metaFromObject(id, {
			type: "state",
			common: { type: "number", read: true, write: true },
		} as unknown as ioBroker.Object);
		assert.equal(m.objectPresent, true);
		const v = validateEvccControlTargetMeta(id, "number", m, "set_max_current_a");
		assert.equal(v.valid, true);
		assert.notEqual(v.reason, "target_object_missing");
		const snap = buildWallboxControlMappingSnapshot({
			config: buttonCfg(),
			telemetryCfg: { enabledStateId: "", maxCurrentAStateId: "", modeReadbackStateId: `${LP}.status.mode` },
			objectMetas: buttonMetas(),
		});
		assert.equal(snap.setMaxCurrentA?.targetStateId, id);
		assert.equal(snap.setMaxCurrentA?.objectPresent, true);
		assert.equal(snap.setMaxCurrentA?.contractValid, true);
		assert.notEqual(snap.setMaxCurrentA?.validationReason, "target_object_missing");
	});

	it("T13: writeable phasesConfigured object is recognized", () => {
		const id = `${LP}.control.phasesConfigured`;
		const snap = buildWallboxControlMappingSnapshot({
			config: buttonCfg(),
			telemetryCfg: { enabledStateId: "", maxCurrentAStateId: "", modeReadbackStateId: `${LP}.status.mode` },
			objectMetas: buttonMetas(),
		});
		assert.equal(snap.setPhase?.targetStateId, id);
		assert.equal(snap.setPhase?.contractValid, true);
	});

	it("T14: EVCC path never falls back to go-e", () => {
		const cfg = buttonCfg({
			wb_set_enabled_target: "go-e.0.allow_charging",
			wb_evcc_control_now_target: "go-e.0.allow_charging",
		});
		assert.equal(pickEvccButtonStateId(cfg, "now"), "");
		const ids = collectConfiguredControlTargetStateIds(cfg);
		assert.ok(ids.every((id) => !id.startsWith("go-e.")));
		assert.equal(resolveWallboxControlModel(cfg), "evcc");
	});

	it("T15: legacy_direct remains unchanged", () => {
		const tpl = goeWallboxTemplateFlat();
		assert.equal(tpl.wb_set_enabled_target, "go-e.0.allow_charging");
		const r = evaluateWallboxDispatchReadiness({
			wb_control_model: "legacy_direct",
			wb_set_enabled_target: "go-e.0.allow_charging",
			wb_set_current_a_target: "go-e.0.amperePV",
		});
		assert.equal(r.controlMappingComplete, true);
		assert.equal(resolveWallboxControlModel({ wb_control_model: "legacy_direct" }), "legacy_direct");
	});

	it("T16: no productive writes", () => {
		assert.equal(EV_FOUNDATION_PHASE1_PLANNER_WRITES_ENABLED, false);
		assert.equal(EV_FOUNDATION_PLANNER_WRITES_ENABLED, false);
		const executeSrc = readFileSync(join(SRC, "runtime", "execute.ts"), "utf8");
		assert.equal(executeSrc.includes("control.off"), false);
		assert.equal(executeSrc.includes("control.now"), false);
		const trigger = prepareEvccButtonTrigger({
			contract: resolveEvccModeControlContract(buttonCfg()),
			desiredPreparedState: "planned_now",
			feedbackMode: "pv",
		});
		assert.equal(trigger?.liveReleased, false);
		assert.equal(trigger?.periodic, false);
		assert.equal(trigger?.writeFalseAfterTrigger, false);
		assert.equal(trigger?.kind, "one_shot_true");
		assert.equal(trigger?.reason, "desired_differs_from_feedback");
		assert.equal(isFuturePlannerWriteAllowed(`${LP}.control.now`), true);
		const r = evaluateWallboxDispatchReadiness(buttonCfg());
		assert.equal(r.liveDispatchSupported, false);
		assert.equal(hasEvccControlWriteMapping(buttonCfg()), true);
	});

	it("T17: no Sonnen writes", () => {
		const files = [
			join(SRC, "evcc_mode_control.ts"),
			join(SRC, "runtime", "evcc_button_trigger.ts"),
			join(SRC, "runtime", "execute.ts"),
		];
		for (const f of files) {
			const src = readFileSync(f, "utf8");
			assert.equal(src.includes("batteryMode"), false, f);
			assert.equal(src.includes("batteryDischargeControl"), false, f);
		}
	});

	it("T18: governance unchanged", async () => {
		const store: Record<string, string> = {
			[GLOBAL.executionMode]: "dryrun",
			[addonMode("wallbox")]: "live",
		};
		const get = async (id: string) => ({ val: store[id] } as ioBroker.State);
		assert.equal(await isLiveWriteAllowed(get, "wallbox"), false);
		store[GLOBAL.executionMode] = "live";
		store[addonMode("wallbox")] = "dryrun";
		assert.equal(await isLiveWriteAllowed(get, "wallbox"), false);
		store[addonMode("wallbox")] = "live";
		assert.equal(await isLiveWriteAllowed(get, "wallbox"), true);
	});

	it("T19: now + charging=false remains a valid observed state", async () => {
		const { model } = await load(minEvccAdminConfig(), minForeign({ [`${LP}.status.mode`]: "now" }));
		assert.equal(model.preparedEvState, "planned_now");
		assert.equal(model.charging, false);
		assert.equal(model.emsTakeoverActive, false);
		assert.equal(model.takeoverReason, null);
	});

	it("T20: preparedEvState semantics unchanged", async () => {
		const { model } = await load(minEvccAdminConfig(buttonCfg()), minForeign({ [`${LP}.status.mode`]: "pv" }));
		assert.equal(model.preparedEvState, "pv");
		assert.ok(!["external", "ems_takeover", "manual_override"].includes(model.preparedEvState));
		assert.equal(model.evccModeControlVariant, "buttons");
		assert.equal(model.evccModeButtonsReady, true);
		assert.equal(model.controlContractModel, "evcc_buttons");
	});
});
