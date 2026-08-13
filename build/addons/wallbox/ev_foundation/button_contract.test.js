"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const strict_1 = __importDefault(require("node:assert/strict"));
const node_fs_1 = require("node:fs");
const node_path_1 = require("node:path");
const node_test_1 = require("node:test");
const execution_mode_1 = require("../../../execution_mode");
const tree_paths_1 = require("../../../tree_paths");
const mapping_config_1 = require("../../../mapping_config");
const evcc_control_config_1 = require("../evcc_control_config");
const evcc_mode_control_1 = require("../evcc_mode_control");
const dispatch_1 = require("../runtime/dispatch");
const control_mapping_1 = require("../runtime/control_mapping");
const control_object_meta_1 = require("../runtime/control_object_meta");
const evcc_button_trigger_1 = require("../runtime/evcc_button_trigger");
const evcc_config_1 = require("../evcc_config");
const evcc_telemetry_1 = require("../evcc_telemetry");
const catalog_1 = require("./catalog");
const capabilities_1 = require("./capabilities");
const config_1 = require("./config");
const external_1 = require("./external");
const model_1 = require("./model");
const vehicle_model_1 = require("./vehicle_model");
const write_allowlist_1 = require("./write_allowlist");
const SRC = (0, node_path_1.join)(__dirname, "..", "..", "..", "..", "src", "addons", "wallbox");
const NOW = new Date("2026-08-13T14:00:00.000Z");
const LP = "evcc.0.loadpoint.1";
function buttonCfg(over = {}) {
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
function buttonObj(id, over = {}) {
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
    };
}
function meta(id, commonType, writable = true, readable = true) {
    return {
        stateId: id,
        objectPresent: true,
        writable,
        readable,
        commonType,
        allowedStateKeys: null,
    };
}
function buttonMetas() {
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
function minEvccAdminConfig(over = {}) {
    return {
        wb_control_model: "evcc",
        wb_evcc_connection_state: catalog_1.EVCC_READ_CATALOG.connection,
        wb_evcc_connected_state: catalog_1.EVCC_READ_CATALOG.connected,
        wb_evcc_charging_state: catalog_1.EVCC_READ_CATALOG.charging,
        wb_evcc_charge_power_w_state: catalog_1.EVCC_READ_CATALOG.chargePower,
        wb_evcc_loadpoint_mode_state: `${LP}.status.mode`,
        ...over,
    };
}
function minForeign(over = {}) {
    return {
        [catalog_1.EVCC_READ_CATALOG.connection]: true,
        [catalog_1.EVCC_READ_CATALOG.connected]: true,
        [catalog_1.EVCC_READ_CATALOG.charging]: false,
        [catalog_1.EVCC_READ_CATALOG.chargePower]: 0,
        [`${LP}.status.mode`]: "now",
        ...over,
    };
}
function mockHost(states) {
    return {
        async getForeignStateAsync(id) {
            if (!(id in states))
                return null;
            return { val: states[id], ack: true };
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
async function load(admin, foreign) {
    const host = mockHost(foreign);
    const cfg = (0, evcc_config_1.wallboxEvccTelemetryConfigFromAdapter)(admin);
    const snap = await (0, evcc_telemetry_1.readEvccTelemetrySnapshot)(host, cfg, NOW);
    const foundation = (0, config_1.evFoundationConfigFromAdapter)(admin);
    const external = await (0, external_1.readExternalEvInformation)(host, foundation, {
        now: NOW,
        fallbackMaxAcKw: null,
        configDepartureAt: null,
        timezone: "Europe/Berlin",
    });
    const capabilities = (0, capabilities_1.resolveEvCapabilities)(cfg, snap, foundation, external);
    const built = (0, model_1.buildEvModelV1)({ snap, foundation, capabilities, adapterConfig: admin, external });
    const model = (0, vehicle_model_1.applyEvFoundationIntegration)(built, capabilities, admin);
    return { model, capabilities };
}
(0, node_test_1.describe)("EVCC button control contract v0.1.274", () => {
    (0, node_test_1.it)("T1: button contract with all four buttons is ready", () => {
        const contract = (0, evcc_mode_control_1.resolveEvccModeControlContract)(buttonCfg());
        strict_1.default.equal(contract.resolvedVariant, "buttons");
        strict_1.default.equal(contract.buttonsReady, true);
        strict_1.default.equal(contract.writeContractReady, true);
        strict_1.default.equal(contract.usesLegacyGoeFallback, false);
        const r = (0, dispatch_1.evaluateWallboxDispatchReadiness)(buttonCfg());
        strict_1.default.equal(r.controlMappingComplete, true);
        strict_1.default.equal(r.liveDispatchSupported, false);
    });
    (0, node_test_1.it)("T2: status.mode as feedback is valid", () => {
        const contract = (0, evcc_mode_control_1.resolveEvccModeControlContract)(buttonCfg());
        strict_1.default.equal(contract.modeFeedbackStateId, `${LP}.status.mode`);
        strict_1.default.equal((0, evcc_mode_control_1.isEvccModeFeedbackStateId)(contract.modeFeedbackStateId), true);
        const fb = (0, control_object_meta_1.validateEvccModeFeedbackMeta)(contract.modeFeedbackStateId, meta(`${LP}.status.mode`, "string", false, true));
        strict_1.default.equal(fb.valid, true);
    });
    (0, node_test_1.it)("T3: status.mode is never a write target", () => {
        const r = (0, control_object_meta_1.validateEvccControlTargetMeta)(`${LP}.status.mode`, "string", meta(`${LP}.status.mode`, "string", true, true), "set_mode");
        strict_1.default.equal(r.valid, false);
        strict_1.default.equal(r.reason, "mode_feedback_not_a_write_target");
        const btn = (0, control_object_meta_1.validateEvccButtonTargetMeta)(`${LP}.status.mode`, "now", meta(`${LP}.status.mode`, "string", true, true));
        strict_1.default.equal(btn.valid, false);
        strict_1.default.equal(btn.reason, "mode_feedback_not_a_write_target");
    });
    (0, node_test_1.it)("T4: button read=false/write=true is a valid write target", () => {
        const id = `${LP}.control.now`;
        const obj = buttonObj(id, { read: false, write: true, type: "boolean" });
        const m = (0, control_object_meta_1.metaFromObject)(id, obj);
        strict_1.default.equal(m.objectPresent, true);
        strict_1.default.equal(m.writable, true);
        strict_1.default.equal(m.readable, false);
        const v = (0, control_object_meta_1.validateEvccButtonTargetMeta)(id, "now", m);
        strict_1.default.equal(v.valid, true);
    });
    (0, node_test_1.it)("T5: missing OFF button is incomplete", () => {
        const contract = (0, evcc_mode_control_1.resolveEvccModeControlContract)(buttonCfg({ wb_evcc_control_off_target: "" }));
        strict_1.default.equal(contract.writeContractReady, false);
        strict_1.default.ok(contract.missing.includes("control.off"));
    });
    (0, node_test_1.it)("T6: missing PV button is incomplete", () => {
        const contract = (0, evcc_mode_control_1.resolveEvccModeControlContract)(buttonCfg({ wb_evcc_control_pv_target: "" }));
        strict_1.default.ok(contract.missing.includes("control.pv"));
        strict_1.default.equal(contract.buttonsReady, false);
    });
    (0, node_test_1.it)("T7: missing MIN button is incomplete", () => {
        const contract = (0, evcc_mode_control_1.resolveEvccModeControlContract)(buttonCfg({ wb_evcc_control_min_target: "" }));
        strict_1.default.ok(contract.missing.includes("control.min"));
    });
    (0, node_test_1.it)("T8: missing NOW button is incomplete", () => {
        const contract = (0, evcc_mode_control_1.resolveEvccModeControlContract)(buttonCfg({ wb_evcc_control_now_target: "" }));
        strict_1.default.ok(contract.missing.includes("control.now"));
    });
    (0, node_test_1.it)("T9: buttons variant does not require evcc_charge_mode_value", () => {
        const snap = (0, control_mapping_1.buildWallboxControlMappingSnapshot)({
            config: buttonCfg(),
            telemetryCfg: { enabledStateId: "", maxCurrentAStateId: "", modeReadbackStateId: `${LP}.status.mode` },
            objectMetas: buttonMetas(),
        });
        strict_1.default.equal(snap.evccModeControlVariant, "buttons");
        strict_1.default.ok(!snap.missingRoles.includes("evcc_charge_mode_value"));
        strict_1.default.ok(!snap.validationIssues.some((i) => i.includes("evcc_charge_mode_mapping_missing")));
        strict_1.default.equal(snap.liveEligible, false);
    });
    (0, node_test_1.it)("T10: buttons variant does not require pvControl", () => {
        const contract = (0, evcc_mode_control_1.resolveEvccModeControlContract)(buttonCfg());
        strict_1.default.equal(contract.pvControlStateId, "");
        strict_1.default.ok(!contract.missing.includes("control.pvControl"));
        strict_1.default.equal(contract.writeContractReady, true);
    });
    (0, node_test_1.it)("T11: stale pvControl does not affect button contract", () => {
        const contract = (0, evcc_mode_control_1.resolveEvccModeControlContract)(buttonCfg({
            wb_evcc_control_pv_control_target: `${LP}.control.pvControl`,
        }));
        strict_1.default.equal(contract.resolvedVariant, "buttons");
        strict_1.default.equal(contract.writeContractReady, true);
        strict_1.default.equal(contract.detail.pvControlIgnoredForButtons, true);
        strict_1.default.ok(!contract.missing.includes("control.pvControl"));
    });
    (0, node_test_1.it)("T12: writeable maxCurrent object is recognized", () => {
        const id = `${LP}.control.maxCurrent`;
        const m = (0, control_object_meta_1.metaFromObject)(id, {
            type: "state",
            common: { type: "number", read: true, write: true },
        });
        strict_1.default.equal(m.objectPresent, true);
        const v = (0, control_object_meta_1.validateEvccControlTargetMeta)(id, "number", m, "set_max_current_a");
        strict_1.default.equal(v.valid, true);
        strict_1.default.notEqual(v.reason, "target_object_missing");
        const snap = (0, control_mapping_1.buildWallboxControlMappingSnapshot)({
            config: buttonCfg(),
            telemetryCfg: { enabledStateId: "", maxCurrentAStateId: "", modeReadbackStateId: `${LP}.status.mode` },
            objectMetas: buttonMetas(),
        });
        strict_1.default.equal(snap.setMaxCurrentA?.targetStateId, id);
        strict_1.default.equal(snap.setMaxCurrentA?.objectPresent, true);
        strict_1.default.equal(snap.setMaxCurrentA?.contractValid, true);
        strict_1.default.notEqual(snap.setMaxCurrentA?.validationReason, "target_object_missing");
    });
    (0, node_test_1.it)("T13: writeable phasesConfigured object is recognized", () => {
        const id = `${LP}.control.phasesConfigured`;
        const snap = (0, control_mapping_1.buildWallboxControlMappingSnapshot)({
            config: buttonCfg(),
            telemetryCfg: { enabledStateId: "", maxCurrentAStateId: "", modeReadbackStateId: `${LP}.status.mode` },
            objectMetas: buttonMetas(),
        });
        strict_1.default.equal(snap.setPhase?.targetStateId, id);
        strict_1.default.equal(snap.setPhase?.contractValid, true);
    });
    (0, node_test_1.it)("T14: EVCC path never falls back to go-e", () => {
        const cfg = buttonCfg({
            wb_set_enabled_target: "go-e.0.allow_charging",
            wb_evcc_control_now_target: "go-e.0.allow_charging",
        });
        strict_1.default.equal((0, evcc_mode_control_1.pickEvccButtonStateId)(cfg, "now"), "");
        const ids = (0, evcc_control_config_1.collectConfiguredControlTargetStateIds)(cfg);
        strict_1.default.ok(ids.every((id) => !id.startsWith("go-e.")));
        strict_1.default.equal((0, evcc_control_config_1.resolveWallboxControlModel)(cfg), "evcc");
    });
    (0, node_test_1.it)("T15: legacy_direct remains unchanged", () => {
        const tpl = (0, mapping_config_1.goeWallboxTemplateFlat)();
        strict_1.default.equal(tpl.wb_set_enabled_target, "go-e.0.allow_charging");
        const r = (0, dispatch_1.evaluateWallboxDispatchReadiness)({
            wb_control_model: "legacy_direct",
            wb_set_enabled_target: "go-e.0.allow_charging",
            wb_set_current_a_target: "go-e.0.amperePV",
        });
        strict_1.default.equal(r.controlMappingComplete, true);
        strict_1.default.equal((0, evcc_control_config_1.resolveWallboxControlModel)({ wb_control_model: "legacy_direct" }), "legacy_direct");
    });
    (0, node_test_1.it)("T16: no productive writes", () => {
        strict_1.default.equal(write_allowlist_1.EV_FOUNDATION_PHASE1_PLANNER_WRITES_ENABLED, false);
        strict_1.default.equal(write_allowlist_1.EV_FOUNDATION_PLANNER_WRITES_ENABLED, false);
        const executeSrc = (0, node_fs_1.readFileSync)((0, node_path_1.join)(SRC, "runtime", "execute.ts"), "utf8");
        strict_1.default.equal(executeSrc.includes("control.off"), false);
        strict_1.default.equal(executeSrc.includes("control.now"), false);
        const trigger = (0, evcc_button_trigger_1.prepareEvccButtonTrigger)({
            contract: (0, evcc_mode_control_1.resolveEvccModeControlContract)(buttonCfg()),
            desiredPreparedState: "planned_now",
            feedbackMode: "pv",
        });
        strict_1.default.equal(trigger?.liveReleased, false);
        strict_1.default.equal(trigger?.periodic, false);
        strict_1.default.equal(trigger?.writeFalseAfterTrigger, false);
        strict_1.default.equal(trigger?.kind, "one_shot_true");
        strict_1.default.equal(trigger?.reason, "desired_differs_from_feedback");
        strict_1.default.equal((0, write_allowlist_1.isFuturePlannerWriteAllowed)(`${LP}.control.now`), true);
        const r = (0, dispatch_1.evaluateWallboxDispatchReadiness)(buttonCfg());
        strict_1.default.equal(r.liveDispatchSupported, false);
        strict_1.default.equal((0, evcc_control_config_1.hasEvccControlWriteMapping)(buttonCfg()), true);
    });
    (0, node_test_1.it)("T17: no Sonnen writes", () => {
        const files = [
            (0, node_path_1.join)(SRC, "evcc_mode_control.ts"),
            (0, node_path_1.join)(SRC, "runtime", "evcc_button_trigger.ts"),
            (0, node_path_1.join)(SRC, "runtime", "execute.ts"),
        ];
        for (const f of files) {
            const src = (0, node_fs_1.readFileSync)(f, "utf8");
            strict_1.default.equal(src.includes("batteryMode"), false, f);
            strict_1.default.equal(src.includes("batteryDischargeControl"), false, f);
        }
    });
    (0, node_test_1.it)("T18: governance unchanged", async () => {
        const store = {
            [tree_paths_1.GLOBAL.executionMode]: "dryrun",
            [(0, tree_paths_1.addonMode)("wallbox")]: "live",
        };
        const get = async (id) => ({ val: store[id] });
        strict_1.default.equal(await (0, execution_mode_1.isLiveWriteAllowed)(get, "wallbox"), false);
        store[tree_paths_1.GLOBAL.executionMode] = "live";
        store[(0, tree_paths_1.addonMode)("wallbox")] = "dryrun";
        strict_1.default.equal(await (0, execution_mode_1.isLiveWriteAllowed)(get, "wallbox"), false);
        store[(0, tree_paths_1.addonMode)("wallbox")] = "live";
        strict_1.default.equal(await (0, execution_mode_1.isLiveWriteAllowed)(get, "wallbox"), true);
    });
    (0, node_test_1.it)("T19: now + charging=false remains a valid observed state", async () => {
        const { model } = await load(minEvccAdminConfig(), minForeign({ [`${LP}.status.mode`]: "now" }));
        strict_1.default.equal(model.preparedEvState, "planned_now");
        strict_1.default.equal(model.charging, false);
        strict_1.default.equal(model.emsTakeoverActive, false);
        strict_1.default.equal(model.takeoverReason, null);
    });
    (0, node_test_1.it)("T20: preparedEvState semantics unchanged", async () => {
        const { model } = await load(minEvccAdminConfig(buttonCfg()), minForeign({ [`${LP}.status.mode`]: "pv" }));
        strict_1.default.equal(model.preparedEvState, "pv");
        strict_1.default.ok(!["external", "ems_takeover", "manual_override"].includes(model.preparedEvState));
        strict_1.default.equal(model.evccModeControlVariant, "buttons");
        strict_1.default.equal(model.evccModeButtonsReady, true);
        strict_1.default.equal(model.controlContractModel, "evcc_buttons");
    });
});
