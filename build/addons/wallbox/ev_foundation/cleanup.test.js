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
const evcc_config_1 = require("../evcc_config");
const evcc_telemetry_1 = require("../evcc_telemetry");
const evcc_control_config_1 = require("../evcc_control_config");
const dispatch_1 = require("../runtime/dispatch");
const control_mapping_1 = require("../runtime/control_mapping");
const catalog_1 = require("./catalog");
const capabilities_1 = require("./capabilities");
const config_1 = require("./config");
const external_1 = require("./external");
const model_1 = require("./model");
const vehicle_model_1 = require("./vehicle_model");
const write_allowlist_1 = require("./write_allowlist");
const mapping_config_1 = require("../../../mapping_config");
const NOW = new Date("2026-08-13T14:00:00.000Z");
const SRC = (0, node_path_1.join)(__dirname, "..", "..", "..", "..", "src", "addons", "wallbox");
const ADMIN_JSON = (0, node_path_1.join)(__dirname, "..", "..", "..", "..", "admin", "jsonConfig.json");
function minEvccAdminConfig(over = {}) {
    return {
        wb_control_model: "evcc",
        wb_evcc_connection_state: catalog_1.EVCC_READ_CATALOG.connection,
        wb_evcc_connected_state: catalog_1.EVCC_READ_CATALOG.connected,
        wb_evcc_charging_state: catalog_1.EVCC_READ_CATALOG.charging,
        wb_evcc_charge_power_w_state: catalog_1.EVCC_READ_CATALOG.chargePower,
        wb_evcc_loadpoint_mode_state: catalog_1.EVCC_READ_CATALOG.mode,
        wb_evcc_active_phases_state: catalog_1.EVCC_READ_CATALOG.phasesActive,
        wb_evcc_configured_phases_state: catalog_1.EVCC_READ_CATALOG.phasesConfigured,
        wb_evcc_max_current_a_state: catalog_1.EVCC_READ_CATALOG.maxCurrent,
        wb_evcc_min_current_a_state: catalog_1.EVCC_READ_CATALOG.minCurrent,
        ...over,
    };
}
function minForeign(over = {}) {
    return {
        [catalog_1.EVCC_READ_CATALOG.connection]: true,
        [catalog_1.EVCC_READ_CATALOG.connected]: true,
        [catalog_1.EVCC_READ_CATALOG.charging]: false,
        [catalog_1.EVCC_READ_CATALOG.chargePower]: 0,
        [catalog_1.EVCC_READ_CATALOG.mode]: "now",
        [catalog_1.EVCC_READ_CATALOG.phasesActive]: 1,
        [catalog_1.EVCC_READ_CATALOG.phasesConfigured]: 3,
        [catalog_1.EVCC_READ_CATALOG.maxCurrent]: 16,
        [catalog_1.EVCC_READ_CATALOG.minCurrent]: 6,
        ...over,
    };
}
function mockHost(states, ts = NOW.getTime(), lc = ts) {
    return {
        async getForeignStateAsync(id) {
            if (!(id in states))
                return null;
            return { val: states[id], ts, lc, ack: true };
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
async function load(admin, foreign, ts = NOW.getTime()) {
    const telemetryCfg = (0, evcc_config_1.wallboxEvccTelemetryConfigFromAdapter)(admin);
    const host = mockHost(foreign, ts);
    const snap = await (0, evcc_telemetry_1.readEvccTelemetrySnapshot)(host, telemetryCfg, NOW);
    const foundation = (0, config_1.evFoundationConfigFromAdapter)(admin);
    const external = await (0, external_1.readExternalEvInformation)(host, foundation, {
        now: NOW,
        fallbackMaxAcKw: foundation.maxAcChargePowerKw,
        configDepartureAt: foundation.departureAt,
        timezone: "UTC",
    });
    const capabilities = (0, capabilities_1.resolveEvCapabilities)(telemetryCfg, snap, foundation, external);
    const built = (0, model_1.buildEvModelV1)({ snap, foundation, capabilities, adapterConfig: admin, external });
    const model = (0, vehicle_model_1.applyEvFoundationIntegration)(built, capabilities, admin);
    return { model, capabilities, external, foundation };
}
function jsonConfigItems() {
    const raw = JSON.parse((0, node_fs_1.readFileSync)(ADMIN_JSON, "utf8"));
    return raw.items?.wallboxTab?.items ?? {};
}
function evalJsonConfigValidator(expr, data) {
    return Boolean(new Function("data", `"use strict"; return (${expr});`)(data));
}
(0, node_test_1.describe)("EV foundation v0.1.272 cleanup", () => {
    (0, node_test_1.it)("T1: empty minimumDepartureSocPct → null", () => {
        const cfg = (0, config_1.evFoundationConfigFromAdapter)(minEvccAdminConfig({ wb_ev_minimum_departure_soc_pct: "" }));
        strict_1.default.equal(cfg.minimumDepartureSocPct, null);
        strict_1.default.equal((0, config_1.parseOptionalAdminNumber)(""), null);
        strict_1.default.equal((0, config_1.parseOptionalAdminNumber)(null), null);
        strict_1.default.equal((0, config_1.parseOptionalAdminNumber)("   "), null);
    });
    (0, node_test_1.it)("T2: admin jsonConfig optional EV fields are text so empty does not fail validation", () => {
        const items = jsonConfigItems();
        for (const key of [
            "wb_ev_minimum_departure_soc_pct",
            "wb_ev_target_soc_pct",
            "wb_ev_battery_capacity_kwh",
            "wb_ev_max_ac_charge_power_kw",
            "wb_ev_charging_efficiency",
            "wb_ev_safety_margin_min",
        ]) {
            strict_1.default.equal(items[key]?.type, "text", `${key} must be text; jsonConfig number cannot be empty`);
            strict_1.default.ok(items[key]?.validator, `${key} must validate empty-or-range`);
            strict_1.default.equal(evalJsonConfigValidator(items[key].validator, { [key]: "" }), true, `${key} empty string must pass validator`);
            strict_1.default.equal(evalJsonConfigValidator(items[key].validator, { [key]: null }), true, `${key} null must pass validator`);
        }
        strict_1.default.equal(evalJsonConfigValidator(items.wb_ev_minimum_departure_soc_pct.validator, {
            wb_ev_minimum_departure_soc_pct: "abc",
        }), false);
        strict_1.default.equal(evalJsonConfigValidator(items.wb_ev_target_soc_pct.validator, { wb_ev_target_soc_pct: "90" }), true);
    });
    (0, node_test_1.it)("T3: empty optional number does not become 0", () => {
        const cfg = (0, config_1.evFoundationConfigFromAdapter)(minEvccAdminConfig({
            wb_ev_minimum_departure_soc_pct: "",
            wb_ev_battery_capacity_kwh: "",
            wb_ev_max_ac_charge_power_kw: null,
            wb_ev_charging_efficiency: "  ",
            wb_ev_safety_margin_min: undefined,
        }));
        strict_1.default.equal(cfg.minimumDepartureSocPct, null);
        strict_1.default.equal(cfg.batteryCapacityKWh, null);
        strict_1.default.equal(cfg.maxAcChargePowerKw, null);
        strict_1.default.equal(cfg.chargingEfficiency, null);
        strict_1.default.equal(cfg.safetyMarginMin, null);
        strict_1.default.notEqual(cfg.minimumDepartureSocPct, 0);
        strict_1.default.notEqual(cfg.batteryCapacityKWh, 0);
    });
    (0, node_test_1.it)("T4: target SOC 90 with departure min null is valid", async () => {
        const { model } = await load(minEvccAdminConfig({
            wb_ev_target_soc_pct: 90,
            wb_ev_minimum_departure_soc_pct: "",
            wb_ev_departure_at: "",
        }), minForeign());
        strict_1.default.equal(model.targetSocPct, 90);
        strict_1.default.equal(model.minimumDepartureSocPct, null);
        strict_1.default.equal(model.departureMinSocConfigured, false);
        strict_1.default.equal(model.departureAt, null);
    });
    (0, node_test_1.it)("T5: Tibber/external min SOC 25 is not departure min", async () => {
        const { model, external } = await load(minEvccAdminConfig({
            wb_ev_target_soc_pct: 90,
            wb_external_smart_charging_min_soc_state: "ha.0.tibber_min_soc",
        }), minForeign({ "ha.0.tibber_min_soc": 25 }));
        strict_1.default.equal(external.externalSmartChargingMinSocPct, 25);
        strict_1.default.equal(model.externalSmartChargingMinSocPct, 25);
        strict_1.default.equal(model.minimumDepartureSocPct, null);
        strict_1.default.equal(model.departureMinSocConfigured, false);
        strict_1.default.notEqual(model.minimumDepartureSocPct, 25);
    });
    (0, node_test_1.it)("T6: boolean grid-rewards state is not stale from unchanged age", async () => {
        const oldTs = NOW.getTime() - 6 * 60 * 60 * 1000;
        const { model, external } = await load(minEvccAdminConfig({
            wb_external_grid_rewards_active_state: "ha.0.grid_rewards",
        }), minForeign({ "ha.0.grid_rewards": false }), oldTs);
        strict_1.default.equal(model.gridRewardsActive, false);
        strict_1.default.notEqual(model.externalSourceQuality, "stale");
        strict_1.default.equal(external.freshnessSignalConfigured, false);
        strict_1.default.ok(model.externalSourceQuality === "ok" || model.externalSourceQuality === "unknown");
    });
    (0, node_test_1.it)("T7: explicit heartbeat/freshness can still become stale", async () => {
        const oldTs = NOW.getTime() - 2 * 60 * 60 * 1000;
        const { model } = await load(minEvccAdminConfig({
            wb_external_grid_rewards_active_state: "ha.0.grid_rewards",
            wb_external_source_updated_at_state: "ha.0.heartbeat",
            wb_external_source_stale_after_min: 30,
        }), minForeign({
            "ha.0.grid_rewards": false,
            "ha.0.heartbeat": "2026-08-13T11:00:00.000Z",
        }), oldTs);
        strict_1.default.equal(model.gridRewardsActive, false);
        strict_1.default.equal(model.externalSourceQuality, "stale");
        strict_1.default.equal(model.emsTakeoverActive, false);
    });
    (0, node_test_1.it)("T8: EVCC control model does not fall back to go-e mappings", () => {
        const cfg = {
            wb_control_model: "evcc",
            wb_set_enabled_target: "go-e.0.allow_charging",
            wb_set_current_a_target: "go-e.0.amperePV",
            wb_set_phase_switch_target: "go-e.0.phaseSwitchModeEnabled",
            wb_evcc_control_pv_control_target: "evcc.0.loadpoint.1.control.pvControl",
            wb_evcc_control_max_current_target: "evcc.0.loadpoint.1.control.maxCurrent",
            wb_evcc_control_phases_configured_target: "evcc.0.loadpoint.1.control.phasesConfigured",
        };
        const contract = (0, evcc_control_config_1.resolveEvccControlContractV1)(cfg);
        strict_1.default.equal(contract.ready, true);
        strict_1.default.equal(contract.usesLegacyGoeFallback, false);
        strict_1.default.equal(contract.pvControlStateId.startsWith("go-e."), false);
        const ids = (0, evcc_control_config_1.collectConfiguredControlTargetStateIds)(cfg);
        strict_1.default.ok(ids.every((id) => !id.startsWith("go-e.")));
        const snap = (0, control_mapping_1.buildWallboxControlMappingSnapshot)({
            config: cfg,
            telemetryCfg: { enabledStateId: "", maxCurrentAStateId: "", modeReadbackStateId: "" },
            objectMetas: {},
        });
        strict_1.default.equal(snap.controlModel, "evcc");
        strict_1.default.equal(snap.setCurrentA, null);
        strict_1.default.equal(snap.setEnabled, null);
        strict_1.default.equal(snap.evccControlContractReady, true);
        strict_1.default.equal(snap.liveEligible, false);
    });
    (0, node_test_1.it)("T9: legacy go-e mappings remain for legacy_direct", () => {
        const tpl = (0, mapping_config_1.goeWallboxTemplateFlat)();
        strict_1.default.equal(tpl.wb_set_current_a_target, "go-e.0.amperePV");
        strict_1.default.equal(tpl.wb_set_enabled_target, "go-e.0.allow_charging");
        const r = (0, dispatch_1.evaluateWallboxDispatchReadiness)({
            wb_control_model: "legacy_direct",
            wb_set_enabled_target: "go-e.0.allow_charging",
            wb_set_current_a_target: "go-e.0.amperePV",
        });
        strict_1.default.equal(r.controlMappingComplete, true);
        strict_1.default.equal((0, evcc_control_config_1.resolveWallboxControlModel)({ wb_control_model: "legacy_direct" }), "legacy_direct");
    });
    (0, node_test_1.it)("T10: EVCC write allowlist includes buttons plus pvControl/maxCurrent/phasesConfigured", () => {
        strict_1.default.ok(write_allowlist_1.EVCC_FUTURE_PLANNER_WRITE_SUFFIXES.includes("control.off"));
        strict_1.default.ok(write_allowlist_1.EVCC_FUTURE_PLANNER_WRITE_SUFFIXES.includes("control.pvControl"));
        strict_1.default.ok(write_allowlist_1.EVCC_FUTURE_PLANNER_WRITE_SUFFIXES.includes("control.maxCurrent"));
        strict_1.default.equal((0, write_allowlist_1.isFuturePlannerWriteAllowed)("evcc.0.loadpoint.1.control.off"), true);
        strict_1.default.equal((0, write_allowlist_1.isFuturePlannerWriteAllowed)("evcc.0.loadpoint.1.control.pvControl"), true);
        strict_1.default.equal((0, write_allowlist_1.isFuturePlannerWriteAllowed)("evcc.0.loadpoint.1.control.limitSoc"), false);
        strict_1.default.equal((0, write_allowlist_1.isFuturePlannerWriteAllowed)("go-e.0.amperePV"), false);
    });
    (0, node_test_1.it)("T11: no new productive EVCC writes", () => {
        strict_1.default.equal(write_allowlist_1.EV_FOUNDATION_PHASE1_PLANNER_WRITES_ENABLED, false);
        strict_1.default.equal(write_allowlist_1.EV_FOUNDATION_PLANNER_WRITES_ENABLED, false);
        const executeSrc = (0, node_fs_1.readFileSync)((0, node_path_1.join)(SRC, "runtime", "execute.ts"), "utf8");
        strict_1.default.equal(executeSrc.includes("control.pvControl"), false);
        const cfg = {
            wb_control_model: "evcc",
            wb_evcc_control_pv_control_target: "evcc.0.loadpoint.1.control.pvControl",
            wb_evcc_control_max_current_target: "evcc.0.loadpoint.1.control.maxCurrent",
            wb_evcc_control_phases_configured_target: "evcc.0.loadpoint.1.control.phasesConfigured",
        };
        strict_1.default.equal((0, evcc_control_config_1.resolveEvccControlContractV1)(cfg).ready, true);
        const readiness = (0, dispatch_1.evaluateWallboxDispatchReadiness)(cfg);
        strict_1.default.equal(readiness.controlMappingComplete, true);
        strict_1.default.equal(readiness.liveDispatchSupported, false);
        strict_1.default.equal((0, evcc_control_config_1.hasEvccControlWriteMapping)(cfg), true);
    });
    (0, node_test_1.it)("T12: no Sonnen writes", () => {
        const files = [
            (0, node_path_1.join)(SRC, "ev_foundation", "external", "index.ts"),
            (0, node_path_1.join)(SRC, "ev_foundation", "publish.ts"),
            (0, node_path_1.join)(SRC, "ev_foundation", "model.ts"),
            (0, node_path_1.join)(SRC, "runtime", "execute.ts"),
        ];
        for (const f of files) {
            const src = (0, node_fs_1.readFileSync)(f, "utf8");
            strict_1.default.equal(src.includes("batteryMode"), false, f);
            strict_1.default.equal(src.includes("batteryDischargeControl"), false, f);
        }
    });
    (0, node_test_1.it)("T13: no takeover from now/charging=false", async () => {
        const { model } = await load(minEvccAdminConfig(), minForeign());
        strict_1.default.equal(model.preparedEvState, "planned_now");
        strict_1.default.equal(model.charging, false);
        strict_1.default.equal(model.emsTakeoverActive, false);
        strict_1.default.equal(model.takeoverReason, null);
        strict_1.default.ok(!["external", "ems_takeover", "manual_override"].includes(model.preparedEvState));
    });
    (0, node_test_1.it)("T14: foundation remains usable with EVCC min config", async () => {
        const { model, capabilities } = await load(minEvccAdminConfig(), minForeign());
        strict_1.default.equal(capabilities.evccAvailable, true);
        strict_1.default.equal(model.vehicleConnected, true);
        strict_1.default.equal(model.dataQuality, "ok");
        strict_1.default.equal(model.vehicleModelSource, "ev_model_v1");
        strict_1.default.equal(model.vehicleModelReady, true);
    });
    (0, node_test_1.it)("T15: missing vehicle profiles do not blanket-block foundation", async () => {
        const { model } = await load(minEvccAdminConfig({ wb_vehicle_profiles: [] }), minForeign());
        strict_1.default.equal(model.vehicleModelReady, true);
        strict_1.default.equal(model.vehicleModelSource, "ev_model_v1");
        strict_1.default.notEqual(model.dataQuality, "unknown");
    });
    (0, node_test_1.it)("T16: governance unchanged", async () => {
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
});
