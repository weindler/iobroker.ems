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
const evcc_button_trigger_1 = require("../runtime/evcc_button_trigger");
const write_allowlist_1 = require("./write_allowlist");
const ROOT = (0, node_path_1.join)(__dirname, "..", "..", "..", "..");
const SRC = (0, node_path_1.join)(ROOT, "src", "addons", "wallbox");
const ADMIN_JSON = (0, node_path_1.join)(ROOT, "admin", "jsonConfig.json");
const LP = "evcc.0.loadpoint.1";
function wallboxItems() {
    const cfg = JSON.parse((0, node_fs_1.readFileSync)(ADMIN_JSON, "utf8"));
    return cfg.items.wallboxTab.items;
}
function isHidden(item, data) {
    if (!item || typeof item.hidden !== "string" || !item.hidden.trim())
        return false;
    const fn = new Function("data", `return Boolean(${item.hidden});`);
    return Boolean(fn(data));
}
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
const BUTTON_FIELDS = [
    "wb_evcc_control_off_target",
    "wb_evcc_control_pv_target",
    "wb_evcc_control_min_target",
    "wb_evcc_control_now_target",
    "wb_evcc_control_max_current_target",
    "wb_evcc_control_phases_configured_target",
];
const STRING_LEGACY_FIELDS = [
    "wb_evcc_set_mode_target",
    "wb_evcc_mode_charge_value",
    "wb_evcc_mode_hold_value",
];
(0, node_test_1.describe)("EVCC admin/legacy cleanup v0.1.275", () => {
    (0, node_test_1.it)("T1: buttons hides string-mode and pvControl legacy fields", () => {
        const items = wallboxItems();
        const data = { wb_control_model: "evcc", wb_evcc_mode_control: "buttons" };
        for (const key of STRING_LEGACY_FIELDS) {
            strict_1.default.equal(isHidden(items[key], data), true, key);
        }
        strict_1.default.equal(isHidden(items.wb_evcc_control_pv_control_target, data), true);
        strict_1.default.equal(isHidden(items.wb_evcc_set_max_current_a_target, data), true);
        strict_1.default.equal(isHidden(items.wb_evcc_set_phase_target, data), true);
    });
    (0, node_test_1.it)("T2: buttons shows current button contract fields", () => {
        const items = wallboxItems();
        const data = { wb_control_model: "evcc", wb_evcc_mode_control: "buttons" };
        for (const key of BUTTON_FIELDS) {
            strict_1.default.equal(isHidden(items[key], data), false, key);
        }
        strict_1.default.equal(items.wb_evcc_control_off_target.label, "EVCC OFF (Write/Button)");
        strict_1.default.equal(items.wb_evcc_control_max_current_target.label, "EVCC maxCurrent (Write)");
        strict_1.default.equal(items.wb_evcc_control_phases_configured_target.label, "EVCC Phasen (Write)");
        strict_1.default.equal(items.wb_evcc_loadpoint_mode_state.label, "EVCC Modus / status.mode (Read)");
        const opts = items.wb_evcc_mode_control.options;
        strict_1.default.ok(opts?.some((o) => o.value === "buttons" && o.label.includes("empfohlen")));
        strict_1.default.ok(opts?.some((o) => o.value === "pv_control" && o.label.includes("Legacy")));
        strict_1.default.ok(opts?.some((o) => o.value === "string_mode" && o.label.includes("Legacy")));
    });
    (0, node_test_1.it)("T3: stored pvControl does not affect buttons contract", () => {
        const cfg = buttonCfg({
            wb_evcc_control_pv_control_target: `${LP}.control.pvControl`,
        });
        const contract = (0, evcc_mode_control_1.resolveEvccModeControlContract)(cfg);
        strict_1.default.equal(contract.resolvedVariant, "buttons");
        strict_1.default.equal(contract.writeContractReady, true);
        strict_1.default.ok(!contract.missing.includes("control.pvControl"));
        strict_1.default.equal(contract.detail.ignoredLegacyConfig && typeof contract.detail.ignoredLegacyConfig, "object");
        const ignored = contract.detail.ignoredLegacyConfig;
        strict_1.default.equal(ignored.pvControl, `${LP}.control.pvControl`);
        strict_1.default.ok(!contract.detail.activeInputs.pvControl);
        const snap = (0, control_mapping_1.buildWallboxControlMappingSnapshot)({
            config: cfg,
            telemetryCfg: { enabledStateId: "", maxCurrentAStateId: "", modeReadbackStateId: `${LP}.status.mode` },
            objectMetas: {},
        });
        strict_1.default.equal(snap.setMode, null);
        strict_1.default.equal(snap.evccControlContractReady, true);
        strict_1.default.equal(snap.evccModeControlVariant, "buttons");
    });
    (0, node_test_1.it)("T4: stored string-mode values do not affect buttons contract", () => {
        const cfg = buttonCfg({
            wb_evcc_set_mode_target: `${LP}.mode`,
            wb_evcc_mode_charge_value: "pv",
            wb_evcc_mode_hold_value: "off",
        });
        const contract = (0, evcc_mode_control_1.resolveEvccModeControlContract)(cfg);
        strict_1.default.equal(contract.writeContractReady, true);
        strict_1.default.ok(!contract.missing.includes("evcc_charge_mode_value"));
        strict_1.default.equal(contract.detail.requiresChargeModeValue, false);
        const ignored = contract.detail.ignoredLegacyConfig;
        strict_1.default.equal(ignored.setMode, `${LP}.mode`);
        strict_1.default.equal(ignored.chargeValue, "pv");
        strict_1.default.equal(ignored.holdValue, "off");
        const snap = (0, control_mapping_1.buildWallboxControlMappingSnapshot)({
            config: cfg,
            telemetryCfg: { enabledStateId: "", maxCurrentAStateId: "", modeReadbackStateId: `${LP}.status.mode` },
            objectMetas: {},
        });
        strict_1.default.equal(snap.setMode, null);
        strict_1.default.equal(snap.evccChargeModeValue, null);
        strict_1.default.ok(!snap.validationIssues.some((i) => i.includes("evcc_charge_mode_mapping_missing")));
        strict_1.default.equal(snap.liveEligible, false);
    });
    (0, node_test_1.it)("T5: pv_control shows required legacy fields and hides buttons", () => {
        const items = wallboxItems();
        const data = { wb_control_model: "evcc", wb_evcc_mode_control: "pv_control" };
        strict_1.default.equal(isHidden(items.wb_evcc_control_pv_control_target, data), false);
        strict_1.default.equal(isHidden(items.wb_evcc_control_max_current_target, data), false);
        strict_1.default.equal(isHidden(items.wb_evcc_control_phases_configured_target, data), false);
        strict_1.default.equal(isHidden(items.wb_evcc_control_off_target, data), true);
        strict_1.default.equal(isHidden(items.wb_evcc_set_mode_target, data), true);
        strict_1.default.equal(isHidden(items.wb_evcc_mode_charge_value, data), true);
    });
    (0, node_test_1.it)("T6: string_mode shows string fields and hides buttons/pvControl", () => {
        const items = wallboxItems();
        const data = { wb_control_model: "evcc", wb_evcc_mode_control: "string_mode" };
        for (const key of STRING_LEGACY_FIELDS) {
            strict_1.default.equal(isHidden(items[key], data), false, key);
        }
        strict_1.default.equal(isHidden(items.wb_evcc_set_max_current_a_target, data), false);
        strict_1.default.equal(isHidden(items.wb_evcc_control_off_target, data), true);
        strict_1.default.equal(isHidden(items.wb_evcc_control_pv_control_target, data), true);
    });
    (0, node_test_1.it)("T7: switching variant does not delete stored values", () => {
        const cfg = buttonCfg({
            wb_evcc_control_pv_control_target: `${LP}.control.pvControl`,
            wb_evcc_set_mode_target: `${LP}.mode`,
            wb_evcc_set_max_current_a_target: `${LP}.maxCurrent`,
            wb_evcc_mode_charge_value: "pv",
            wb_evcc_mode_hold_value: "off",
        });
        const asButtons = (0, evcc_mode_control_1.resolveEvccModeControlContract)(cfg);
        strict_1.default.equal(asButtons.writeContractReady, true);
        cfg.wb_evcc_mode_control = "pv_control";
        const asPv = (0, evcc_mode_control_1.resolveEvccModeControlContract)(cfg);
        strict_1.default.equal(cfg.wb_evcc_control_off_target, `${LP}.control.off`);
        strict_1.default.equal(cfg.wb_evcc_mode_charge_value, "pv");
        strict_1.default.equal(asPv.pvControlStateId, `${LP}.control.pvControl`);
        strict_1.default.equal(asPv.writeContractReady, true);
        cfg.wb_evcc_mode_control = "string_mode";
        const asString = (0, evcc_mode_control_1.resolveEvccModeControlContract)(cfg);
        strict_1.default.equal(cfg.wb_evcc_control_pv_control_target, `${LP}.control.pvControl`);
        strict_1.default.equal(asString.writeContractReady, true);
        cfg.wb_evcc_mode_control = "buttons";
        const back = (0, evcc_mode_control_1.resolveEvccModeControlContract)(cfg);
        strict_1.default.equal(back.writeContractReady, true);
        strict_1.default.equal(cfg.wb_evcc_control_pv_control_target, `${LP}.control.pvControl`);
        strict_1.default.equal(cfg.wb_evcc_mode_charge_value, "pv");
    });
    (0, node_test_1.it)("T8: auto with complete buttons resolves to buttons", () => {
        const cfg = buttonCfg({ wb_evcc_mode_control: "auto" });
        const contract = (0, evcc_mode_control_1.resolveEvccModeControlContract)(cfg);
        strict_1.default.equal(contract.requestedVariant, "auto");
        strict_1.default.equal(contract.resolvedVariant, "buttons");
        strict_1.default.equal(contract.writeContractReady, true);
        const items = wallboxItems();
        const data = { wb_control_model: "evcc", wb_evcc_mode_control: "auto" };
        strict_1.default.equal(isHidden(items.wb_evcc_control_off_target, data), false);
        strict_1.default.equal(isHidden(items.wb_evcc_set_mode_target, data), true);
        strict_1.default.equal(isHidden(items.wb_evcc_control_pv_control_target, data), true);
    });
    (0, node_test_1.it)("T9: button contract remains ready", () => {
        const contract = (0, evcc_mode_control_1.resolveEvccModeControlContract)(buttonCfg());
        strict_1.default.equal(contract.buttonsReady, true);
        strict_1.default.equal(contract.writeContractReady, true);
        const r = (0, dispatch_1.evaluateWallboxDispatchReadiness)(buttonCfg());
        strict_1.default.equal(r.controlMappingComplete, true);
        strict_1.default.equal(r.liveDispatchSupported, false);
    });
    (0, node_test_1.it)("T10: no new productive writes", () => {
        strict_1.default.equal(write_allowlist_1.EV_FOUNDATION_PHASE1_PLANNER_WRITES_ENABLED, false);
        strict_1.default.equal(write_allowlist_1.EV_FOUNDATION_PLANNER_WRITES_ENABLED, false);
        const executeSrc = (0, node_fs_1.readFileSync)((0, node_path_1.join)(SRC, "runtime", "execute.ts"), "utf8");
        strict_1.default.equal(executeSrc.includes("control.off"), false);
        strict_1.default.equal(executeSrc.includes("prepareEvccButtonTrigger"), false);
        const triggerSrc = (0, node_fs_1.readFileSync)((0, node_path_1.join)(SRC, "runtime", "evcc_button_trigger.ts"), "utf8");
        strict_1.default.match(triggerSrc, /liveReleased: false/);
        const trigger = (0, evcc_button_trigger_1.prepareEvccButtonTrigger)({
            contract: (0, evcc_mode_control_1.resolveEvccModeControlContract)(buttonCfg()),
            desiredPreparedState: "planned_now",
            feedbackMode: "pv",
        });
        strict_1.default.equal(trigger?.liveReleased, false);
    });
    (0, node_test_1.it)("T11: governance unchanged", async () => {
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
    (0, node_test_1.it)("T12: no go-e fallback on EVCC path", () => {
        const cfg = buttonCfg({
            wb_set_enabled_target: "go-e.0.allow_charging",
            wb_evcc_control_now_target: "go-e.0.allow_charging",
        });
        const ids = (0, evcc_control_config_1.collectConfiguredControlTargetStateIds)(cfg);
        strict_1.default.ok(ids.every((id) => !id.startsWith("go-e.")));
        strict_1.default.equal((0, evcc_control_config_1.resolveWallboxControlModel)(cfg), "evcc");
        const contract = (0, evcc_mode_control_1.resolveEvccModeControlContract)(cfg);
        strict_1.default.equal(contract.usesLegacyGoeFallback, false);
        strict_1.default.equal(contract.nowStateId, "");
    });
    (0, node_test_1.it)("T13: no Sonnen writes", () => {
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
        const tpl = (0, mapping_config_1.goeWallboxTemplateFlat)();
        strict_1.default.equal(tpl.wb_set_enabled_target, "go-e.0.allow_charging");
    });
});
