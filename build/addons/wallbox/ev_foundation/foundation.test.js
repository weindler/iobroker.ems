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
const evcc_control_config_1 = require("../evcc_control_config");
const evcc_config_1 = require("../evcc_config");
const evcc_telemetry_1 = require("../evcc_telemetry");
const catalog_1 = require("./catalog");
const capabilities_1 = require("./capabilities");
const config_1 = require("./config");
const model_1 = require("./model");
const types_1 = require("./types");
const write_allowlist_1 = require("./write_allowlist");
const NOW = new Date("2026-08-13T10:00:00.000Z");
const SRC = (0, node_path_1.join)(__dirname, "..", "..", "..", "..", "src", "addons", "wallbox");
function minEvccAdminConfig(over = {}) {
    return {
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
function mockHost(states) {
    return {
        async getForeignStateAsync(id) {
            if (!(id in states))
                return null;
            return { val: states[id], ts: Date.now(), ack: true };
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
async function modelFrom(admin, foreign) {
    const telemetryCfg = (0, evcc_config_1.wallboxEvccTelemetryConfigFromAdapter)(admin);
    const snap = await (0, evcc_telemetry_1.readEvccTelemetrySnapshot)(mockHost(foreign), telemetryCfg, NOW);
    const foundation = (0, config_1.evFoundationConfigFromAdapter)(admin);
    const capabilities = (0, capabilities_1.resolveEvCapabilities)(telemetryCfg, snap, foundation);
    const model = (0, model_1.buildEvModelV1)({ snap, foundation, capabilities, adapterConfig: admin });
    return { telemetryCfg, snap, foundation, capabilities, model };
}
(0, node_test_1.describe)("EV foundation Phase 1", () => {
    (0, node_test_1.it)("T1: EVCC min config without HA/Tibber works", async () => {
        const { model, capabilities } = await modelFrom(minEvccAdminConfig(), {
            [catalog_1.EVCC_READ_CATALOG.connection]: true,
            [catalog_1.EVCC_READ_CATALOG.connected]: true,
            [catalog_1.EVCC_READ_CATALOG.charging]: false,
            [catalog_1.EVCC_READ_CATALOG.chargePower]: 0,
            [catalog_1.EVCC_READ_CATALOG.mode]: "pv",
            [catalog_1.EVCC_READ_CATALOG.phasesActive]: 1,
            [catalog_1.EVCC_READ_CATALOG.phasesConfigured]: 3,
            [catalog_1.EVCC_READ_CATALOG.maxCurrent]: 16,
            [catalog_1.EVCC_READ_CATALOG.minCurrent]: 6,
        });
        strict_1.default.equal(capabilities.evccAvailable, true);
        strict_1.default.equal(capabilities.homeAssistantDataSourceAvailable, false);
        strict_1.default.equal(capabilities.tibberGridRewardsViaVehicle, false);
        strict_1.default.equal(capabilities.tibberGridRewardsViaWallbox, false);
        strict_1.default.equal(model.vehicleConnected, true);
        strict_1.default.equal(model.charging, false);
        strict_1.default.equal(model.evccMode, "pv");
        strict_1.default.equal(model.preparedEvState, "pv");
        strict_1.default.equal(model.emsTakeoverActive, false);
        strict_1.default.equal(model.takeoverReason, null);
    });
    (0, node_test_1.it)("T2: missing vehicle SOC is unknown, not a fake value", async () => {
        const { model, capabilities, snap } = await modelFrom(minEvccAdminConfig(), {
            [catalog_1.EVCC_READ_CATALOG.connection]: true,
            [catalog_1.EVCC_READ_CATALOG.connected]: true,
            [catalog_1.EVCC_READ_CATALOG.charging]: false,
            [catalog_1.EVCC_READ_CATALOG.chargePower]: 0,
            [catalog_1.EVCC_READ_CATALOG.mode]: "off",
            [catalog_1.EVCC_READ_CATALOG.phasesActive]: 0,
            [catalog_1.EVCC_READ_CATALOG.phasesConfigured]: 3,
            [catalog_1.EVCC_READ_CATALOG.maxCurrent]: 16,
            [catalog_1.EVCC_READ_CATALOG.minCurrent]: 6,
        });
        strict_1.default.equal(snap.vehicle_soc_pct.status, "missing");
        strict_1.default.equal(snap.vehicle_soc_pct.value, null);
        strict_1.default.equal(model.vehicleSocPct, null);
        strict_1.default.equal(model.vehicleSocQuality, "unknown");
        strict_1.default.equal(capabilities.vehicleSocAvailable, false);
        strict_1.default.notEqual(model.vehicleSocPct, 0);
    });
    (0, node_test_1.it)("T3: connected=true and charging=false stay distinct", async () => {
        const { model } = await modelFrom(minEvccAdminConfig(), {
            [catalog_1.EVCC_READ_CATALOG.connection]: true,
            [catalog_1.EVCC_READ_CATALOG.connected]: true,
            [catalog_1.EVCC_READ_CATALOG.charging]: false,
            [catalog_1.EVCC_READ_CATALOG.chargePower]: 0,
            [catalog_1.EVCC_READ_CATALOG.mode]: "pv",
            [catalog_1.EVCC_READ_CATALOG.phasesActive]: 0,
            [catalog_1.EVCC_READ_CATALOG.phasesConfigured]: 1,
            [catalog_1.EVCC_READ_CATALOG.maxCurrent]: 16,
            [catalog_1.EVCC_READ_CATALOG.minCurrent]: 6,
        });
        strict_1.default.equal(model.vehicleConnected, true);
        strict_1.default.equal(model.charging, false);
        strict_1.default.notEqual(model.vehicleConnected, model.charging);
    });
    (0, node_test_1.it)("T4: vehicleDetectionActive=false does not override connected=true", async () => {
        const { model, snap } = await modelFrom(minEvccAdminConfig({
            wb_evcc_vehicle_detection_active_state: catalog_1.EVCC_READ_CATALOG.vehicleDetectionActive,
        }), {
            [catalog_1.EVCC_READ_CATALOG.connection]: true,
            [catalog_1.EVCC_READ_CATALOG.connected]: true,
            [catalog_1.EVCC_READ_CATALOG.charging]: false,
            [catalog_1.EVCC_READ_CATALOG.chargePower]: 0,
            [catalog_1.EVCC_READ_CATALOG.mode]: "pv",
            [catalog_1.EVCC_READ_CATALOG.phasesActive]: 1,
            [catalog_1.EVCC_READ_CATALOG.phasesConfigured]: 3,
            [catalog_1.EVCC_READ_CATALOG.maxCurrent]: 16,
            [catalog_1.EVCC_READ_CATALOG.minCurrent]: 6,
            [catalog_1.EVCC_READ_CATALOG.vehicleDetectionActive]: false,
        });
        strict_1.default.equal(snap.vehicle_detection_active.value, false);
        strict_1.default.equal(model.vehicleDetectionActive, false);
        strict_1.default.equal(model.vehicleConnected, true);
    });
    (0, node_test_1.it)("T5: phasesConfigured and phasesActive stay separate", async () => {
        const { model } = await modelFrom(minEvccAdminConfig(), {
            [catalog_1.EVCC_READ_CATALOG.connection]: true,
            [catalog_1.EVCC_READ_CATALOG.connected]: true,
            [catalog_1.EVCC_READ_CATALOG.charging]: true,
            [catalog_1.EVCC_READ_CATALOG.chargePower]: 2300,
            [catalog_1.EVCC_READ_CATALOG.mode]: "minpv",
            [catalog_1.EVCC_READ_CATALOG.phasesActive]: 1,
            [catalog_1.EVCC_READ_CATALOG.phasesConfigured]: 3,
            [catalog_1.EVCC_READ_CATALOG.maxCurrent]: 16,
            [catalog_1.EVCC_READ_CATALOG.minCurrent]: 6,
        });
        strict_1.default.equal(model.phasesConfigured, 3);
        strict_1.default.equal(model.phasesActive, 1);
        strict_1.default.notEqual(model.phasesConfigured, model.phasesActive);
        strict_1.default.equal(model.preparedEvState, "minpv");
    });
    (0, node_test_1.it)("T6: missing smart-plan capability is not an error", async () => {
        const { capabilities, model } = await modelFrom(minEvccAdminConfig(), {
            [catalog_1.EVCC_READ_CATALOG.connection]: true,
            [catalog_1.EVCC_READ_CATALOG.connected]: false,
            [catalog_1.EVCC_READ_CATALOG.charging]: false,
            [catalog_1.EVCC_READ_CATALOG.chargePower]: 0,
            [catalog_1.EVCC_READ_CATALOG.mode]: "off",
            [catalog_1.EVCC_READ_CATALOG.phasesActive]: 0,
            [catalog_1.EVCC_READ_CATALOG.phasesConfigured]: 3,
            [catalog_1.EVCC_READ_CATALOG.maxCurrent]: 16,
            [catalog_1.EVCC_READ_CATALOG.minCurrent]: 6,
        });
        strict_1.default.equal(capabilities.externalSmartPlanAvailable, false);
        strict_1.default.equal(model.externalSmartPlanAvailable, false);
        strict_1.default.equal(model.externalSmartPlanSlots, null);
        strict_1.default.equal(model.externalPlanRemainingEnergyKWh, null);
        strict_1.default.equal(model.dataQuality === "ok" || model.dataQuality === "degraded", true);
    });
    (0, node_test_1.it)("T7: missing Ford/Tibber/HA still yields a working EV model", async () => {
        const admin = minEvccAdminConfig();
        strict_1.default.equal("wb_tibber_grid_rewards_active_state" in admin, false);
        strict_1.default.equal("wb_external_vehicle_charge_state" in admin, false);
        strict_1.default.equal("wb_ha_data_source_enabled" in admin, false);
        const { model, capabilities } = await modelFrom(admin, {
            [catalog_1.EVCC_READ_CATALOG.connection]: true,
            [catalog_1.EVCC_READ_CATALOG.connected]: true,
            [catalog_1.EVCC_READ_CATALOG.charging]: true,
            [catalog_1.EVCC_READ_CATALOG.chargePower]: 11000,
            [catalog_1.EVCC_READ_CATALOG.mode]: "now",
            [catalog_1.EVCC_READ_CATALOG.phasesActive]: 3,
            [catalog_1.EVCC_READ_CATALOG.phasesConfigured]: 3,
            [catalog_1.EVCC_READ_CATALOG.maxCurrent]: 16,
            [catalog_1.EVCC_READ_CATALOG.minCurrent]: 6,
        });
        strict_1.default.equal(capabilities.evccAvailable, true);
        strict_1.default.equal(capabilities.homeAssistantDataSourceAvailable, false);
        strict_1.default.equal(model.preparedEvState, "planned_now");
        strict_1.default.equal(model.externalControlActive, null);
        strict_1.default.equal(model.gridRewardsActive, null);
        strict_1.default.equal(model.manualOverrideActive, null);
        strict_1.default.ok(!Object.keys(model).some((k) => k.toLowerCase().includes("ford")));
        strict_1.default.ok(!Object.keys(capabilities).some((k) => k.toLowerCase().includes("ford")));
    });
    (0, node_test_1.it)("T8: future write allowlist contains button and control.* states", () => {
        strict_1.default.deepEqual([...write_allowlist_1.EVCC_FUTURE_PLANNER_WRITE_SUFFIXES].sort(), [
            "control.maxCurrent",
            "control.min",
            "control.now",
            "control.off",
            "control.phasesConfigured",
            "control.pv",
            "control.pvControl",
        ]);
        strict_1.default.equal((0, write_allowlist_1.isFuturePlannerWriteAllowed)("evcc.0.loadpoint.1.control.pvControl"), true);
        strict_1.default.equal((0, write_allowlist_1.isFuturePlannerWriteAllowed)("evcc.0.loadpoint.1.control.maxCurrent"), true);
        strict_1.default.equal((0, write_allowlist_1.isFuturePlannerWriteAllowed)("evcc.0.loadpoint.1.control.phasesConfigured"), true);
        strict_1.default.equal((0, write_allowlist_1.isFuturePlannerWriteAllowed)("evcc.0.loadpoint.1.control.off"), true);
        strict_1.default.equal((0, write_allowlist_1.isFuturePlannerWriteAllowed)("evcc.0.loadpoint.1.control.now"), true);
        strict_1.default.equal((0, write_allowlist_1.encodePvControl)("off"), write_allowlist_1.EVCC_PV_CONTROL.off);
        strict_1.default.equal((0, write_allowlist_1.encodePvControl)("pv"), 1);
        strict_1.default.equal((0, write_allowlist_1.encodePvControl)("min"), 2);
        strict_1.default.equal((0, write_allowlist_1.encodePvControl)("now"), 3);
        strict_1.default.equal((0, write_allowlist_1.encodePhasesConfiguredWrite)("auto"), write_allowlist_1.EVCC_PHASES_CONFIGURED_WRITE.auto);
        strict_1.default.equal((0, write_allowlist_1.encodePhasesConfiguredWrite)("1p"), 1);
        strict_1.default.equal((0, write_allowlist_1.encodePhasesConfiguredWrite)("3p"), 3);
    });
    (0, node_test_1.it)("T9: taboo states are not written in this phase", () => {
        strict_1.default.equal(write_allowlist_1.EV_FOUNDATION_PHASE1_PLANNER_WRITES_ENABLED, false);
        for (const suffix of write_allowlist_1.EVCC_PLANNER_WRITE_TABOO_SUFFIXES) {
            strict_1.default.equal((0, write_allowlist_1.isPlannerWriteTaboo)(`evcc.0.loadpoint.1.${suffix}`), true);
            strict_1.default.equal((0, write_allowlist_1.isFuturePlannerWriteAllowed)(`evcc.0.loadpoint.1.${suffix}`), false);
            strict_1.default.equal((0, write_allowlist_1.classifyEvccPlannerWriteTarget)(`evcc.0.loadpoint.1.${suffix}`), "taboo");
        }
        strict_1.default.deepEqual([...evcc_control_config_1.WALLBOX_EVCC_CONTROL_ROLES], ["set_mode", "set_max_current_a", "set_phase"]);
        const executeSrc = (0, node_fs_1.readFileSync)((0, node_path_1.join)(SRC, "runtime", "execute.ts"), "utf8");
        const writePlanSrc = (0, node_fs_1.readFileSync)((0, node_path_1.join)(SRC, "runtime", "write_plan.ts"), "utf8");
        const publishSrc = (0, node_fs_1.readFileSync)((0, node_path_1.join)(SRC, "ev_foundation", "publish.ts"), "utf8");
        const modelSrc = (0, node_fs_1.readFileSync)((0, node_path_1.join)(SRC, "ev_foundation", "model.ts"), "utf8");
        for (const src of [executeSrc, writePlanSrc, publishSrc, modelSrc]) {
            strict_1.default.equal(src.includes("control.limitSoc"), false);
            strict_1.default.equal(src.includes("control.smartCostLimit"), false);
            strict_1.default.equal(src.includes("control.enableThreshold"), false);
            strict_1.default.equal(src.includes("control.disableThreshold"), false);
            strict_1.default.equal(src.includes("writeForeignIfChanged"), src === executeSrc);
        }
        strict_1.default.equal(writePlanSrc.includes("ev_foundation/write_allowlist"), false);
        strict_1.default.equal(executeSrc.includes("control.pvControl"), false);
    });
    (0, node_test_1.it)("T10: global/add-on governance is unchanged", async () => {
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
        const execModeSrc = (0, node_fs_1.readFileSync)((0, node_path_1.join)(SRC, "..", "..", "execution_mode.ts"), "utf8");
        strict_1.default.match(execModeSrc, /parseGlobalMode\(global\?\.val\) !== "live"/);
        strict_1.default.match(execModeSrc, /parseAddonMode\(addon\?\.val\) === "live"/);
    });
});
(0, node_test_1.describe)("EV foundation helpers", () => {
    (0, node_test_1.it)("prepared module states and takeover reasons exist as types only", () => {
        strict_1.default.deepEqual([...types_1.EV_MODULE_STATES], [
            "idle",
            "pv",
            "minpv",
            "planned_now",
            "external",
            "ems_takeover",
            "manual_override",
        ]);
        strict_1.default.deepEqual([...types_1.EV_TAKEOVER_REASONS], [
            "deadline_risk",
            "insufficient_external_plan",
            "economic_window_loss",
            "external_unavailable",
        ]);
        strict_1.default.equal((0, model_1.derivePreparedEvModuleState)("now"), "planned_now");
        strict_1.default.equal((0, model_1.derivePreparedEvModuleState)("now", true), "planned_now");
        strict_1.default.equal((0, model_1.derivePreparedEvModuleState)("now", false), "idle");
        strict_1.default.equal((0, model_1.derivePreparedEvModuleState)("off"), "idle");
        strict_1.default.ok(!["external", "ems_takeover", "manual_override"].includes((0, model_1.derivePreparedEvModuleState)("now")));
    });
    (0, node_test_1.it)("empty telemetry config has no invented mappings", () => {
        const empty = (0, evcc_config_1.emptyWallboxEvccTelemetryConfig)();
        strict_1.default.equal(empty.vehicleSocStateId, "");
        strict_1.default.equal(empty.connectionStateId, "");
        const cfg = (0, config_1.evFoundationConfigFromAdapter)({});
        strict_1.default.equal(cfg.evccIntegrationEnabled, true);
        strict_1.default.equal(cfg.batteryCapacityKWh, null);
        strict_1.default.equal(cfg.chargingEfficiency, null);
        strict_1.default.equal(cfg.externalControlType, "none");
    });
});
