"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const strict_1 = __importDefault(require("node:assert/strict"));
const allowlist_js_1 = require("./allowlist.js");
const cleanup_js_1 = require("./cleanup.js");
const ensure_states_js_1 = require("../addons/air_conditioning/runtime/ensure_states.js");
const mapping_sync_js_1 = require("../mapping_sync.js");
const mapping_config_js_1 = require("../addons/air_conditioning/mapping_config.js");
const constants_js_1 = require("../addons/air_conditioning/constants.js");
const ensure_states_js_2 = require("../addons/wallbox/vehicles/ensure_states.js");
const normalize_js_1 = require("../addons/wallbox/vehicles/normalize.js");
const config_js_1 = require("../addons/wallbox/vehicles/config.js");
const ensure_states_js_3 = require("../planner_shadow/ensure_states.js");
class FakeCleanupHost {
    namespace = "ems.0";
    objects = new Map();
    config;
    deleted = [];
    constructor(config = {}) {
        this.config = config;
    }
    log = {
        info: () => undefined,
        warn: () => undefined,
        debug: () => undefined,
    };
    async setObjectNotExistsAsync(id, obj) {
        if (!this.objects.has(id)) {
            this.objects.set(id, { ...obj, _id: id });
        }
    }
    async getStateAsync() {
        return null;
    }
    async setStateAsync() {
        /* noop */
    }
    async getObjectAsync(id) {
        return this.objects.get(id) ?? null;
    }
    async delObjectAsync(id, options) {
        this.deleted.push(id);
        if (options?.recursive) {
            const prefix = `${id}.`;
            for (const key of [...this.objects.keys()]) {
                if (key === id || key.startsWith(prefix)) {
                    this.objects.delete(key);
                }
            }
            return;
        }
        this.objects.delete(id);
    }
    listRelativeObjectIds() {
        return [...this.objects.keys()];
    }
}
(0, node_test_1.describe)("surface cleanup allowlist", () => {
    (0, node_test_1.it)("allows only AC unit/mapping and vehicle folder roots", () => {
        strict_1.default.equal((0, allowlist_js_1.isAllowlistedCleanupRelativeId)("addons.air_conditioning.units.unit_3"), true);
        strict_1.default.equal((0, allowlist_js_1.isAllowlistedCleanupRelativeId)("addons.air_conditioning.mapping.unit_2_cmd_switch_on"), true);
        strict_1.default.equal((0, allowlist_js_1.isAllowlistedCleanupRelativeId)("addons.wallbox.vehicles.ford_explorer"), true);
        strict_1.default.equal((0, allowlist_js_1.isAllowlistedCleanupRelativeId)("planner.intent.allocation.wallbox.plan_json"), false);
        strict_1.default.equal((0, allowlist_js_1.isAllowlistedCleanupRelativeId)("learning.persistence.pv_bias_json"), false);
        strict_1.default.equal((0, allowlist_js_1.isAllowlistedCleanupRelativeId)("ems.0.addons.air_conditioning.units.unit_1"), false);
        strict_1.default.equal((0, allowlist_js_1.isAllowlistedCleanupRelativeId)("alias.0.foo"), false);
    });
});
(0, node_test_1.describe)("dynamic surface ensure + cleanup", () => {
    (0, node_test_1.it)("fresh install with empty config creates no AC unit folders", async () => {
        const host = new FakeCleanupHost({});
        await (0, mapping_sync_js_1.ensureAddonMappingStates)(host, constants_js_1.AC_ADDON_ID, (0, mapping_config_js_1.acMappingCommandsForConfiguredUnits)(host.config));
        await (0, ensure_states_js_1.ensureAcRuntimeStates)(host);
        const unitKeys = [...host.objects.keys()].filter((k) => k.startsWith("addons.air_conditioning.units.unit_"));
        strict_1.default.equal(unitKeys.length, 0);
        strict_1.default.ok(host.objects.has("addons.air_conditioning.units"));
        strict_1.default.ok(host.objects.has("addons.air_conditioning.runtime"));
    });
    (0, node_test_1.it)("creates configured unit and keeps disabled-but-mapped unit", async () => {
        const host = new FakeCleanupHost({
            ac_u1_enabled: true,
            ac_u2_enabled: false,
            ac_u2_feedback_switch_target: "smartthings.0.x.switch",
        });
        await (0, mapping_sync_js_1.ensureAddonMappingStates)(host, constants_js_1.AC_ADDON_ID, (0, mapping_config_js_1.acMappingCommandsForConfiguredUnits)(host.config));
        await (0, ensure_states_js_1.ensureAcRuntimeStates)(host);
        strict_1.default.ok(host.objects.has("addons.air_conditioning.units.unit_1"));
        strict_1.default.ok(host.objects.has("addons.air_conditioning.units.unit_2"));
        strict_1.default.equal(host.objects.has("addons.air_conditioning.units.unit_3"), false);
    });
    (0, node_test_1.it)("upgrade cleanup removes unconfigured AC placeholders and is idempotent", async () => {
        const host = new FakeCleanupHost({});
        // Simulate pre-4B1 over-ensure
        await (0, mapping_sync_js_1.ensureAddonMappingStates)(host, constants_js_1.AC_ADDON_ID, (0, mapping_config_js_1.acMappingCommands)());
        await (0, ensure_states_js_1.ensureAcRuntimeStates)({
            ...host,
            config: undefined,
            setObjectNotExistsAsync: host.setObjectNotExistsAsync.bind(host),
        }, { unitIndexes: [1, 2, 3, 4, 5] });
        strict_1.default.ok(host.objects.has("addons.air_conditioning.units.unit_5"));
        host.config = { ac_u1_enabled: true };
        const first = await (0, cleanup_js_1.runDynamicSurfaceCleanup)(host);
        strict_1.default.ok(first.deleted > 0);
        strict_1.default.ok(host.objects.has("addons.air_conditioning.units.unit_1"));
        strict_1.default.equal(host.objects.has("addons.air_conditioning.units.unit_5"), false);
        const before = host.objects.size;
        const second = await (0, cleanup_js_1.runDynamicSurfaceCleanup)(host);
        strict_1.default.equal(second.deleted, 0);
        strict_1.default.equal(host.objects.size, before);
    });
    (0, node_test_1.it)("does not delete configured disabled unit", async () => {
        const host = new FakeCleanupHost({
            ac_u1_enabled: false,
            ac_u1_room_temp_target: "temp.0.x",
        });
        await (0, ensure_states_js_1.ensureAcRuntimeStates)(host, { unitIndexes: [1] });
        const stats = await (0, cleanup_js_1.runDynamicSurfaceCleanup)(host);
        strict_1.default.ok(host.objects.has("addons.air_conditioning.units.unit_1"));
        strict_1.default.equal(host.deleted.includes("addons.air_conditioning.units.unit_1"), false);
        strict_1.default.ok(stats.skippedReasons.ac_configured_kept || stats.checked > 0);
    });
    (0, node_test_1.it)("empty vehicle table creates no profile folders; orphan profiles are cleaned", async () => {
        const host = new FakeCleanupHost({ wb_vehicle_profiles: [] });
        await (0, ensure_states_js_2.ensureWallboxVehicleProfileStates)(host, []);
        strict_1.default.ok(host.objects.has("addons.wallbox.vehicles"));
        strict_1.default.equal([...host.objects.keys()].some((k) => /^addons\.wallbox\.vehicles\.[^./]+$/.test(k)), false);
        const { profiles } = (0, normalize_js_1.normalizeWallboxVehicleProfiles)((0, config_js_1.wallboxVehicleProfilesConfigFromAdapter)({
            wb_vehicle_profiles: [{ vehicle_id: "old_car", display_name: "Old", enabled: false }],
        }).profiles, new Date().toISOString());
        await (0, ensure_states_js_2.ensureWallboxVehicleProfileStates)(host, profiles);
        strict_1.default.ok(host.objects.has("addons.wallbox.vehicles.old_car"));
        host.config = { wb_vehicle_profiles: [] };
        await (0, cleanup_js_1.runDynamicSurfaceCleanup)(host);
        strict_1.default.equal(host.objects.has("addons.wallbox.vehicles.old_car"), false);
    });
    (0, node_test_1.it)("keeps present disabled vehicle profile", async () => {
        const cfg = {
            wb_vehicle_profiles: [{ vehicle_id: "garage_car", display_name: "Garage", enabled: false }],
        };
        const host = new FakeCleanupHost(cfg);
        const { profiles } = (0, normalize_js_1.normalizeWallboxVehicleProfiles)((0, config_js_1.wallboxVehicleProfilesConfigFromAdapter)(cfg).profiles, new Date().toISOString());
        await (0, ensure_states_js_2.ensureWallboxVehicleProfileStates)(host, profiles);
        await (0, cleanup_js_1.runDynamicSurfaceCleanup)(host);
        strict_1.default.ok(host.objects.has("addons.wallbox.vehicles.garage_car"));
    });
    (0, node_test_1.it)("never deletes compatibility prefixes even if present", async () => {
        const host = new FakeCleanupHost({});
        await host.setObjectNotExistsAsync("planner.intent.allocation.wallbox.plan_json", {
            type: "state",
            common: { name: "x", type: "string", role: "json", read: true, write: false },
            native: {},
        });
        await (0, cleanup_js_1.runDynamicSurfaceCleanup)(host);
        strict_1.default.ok(host.objects.has("planner.intent.allocation.wallbox.plan_json"));
    });
    (0, node_test_1.it)("state budget: configured-only AC ensure is smaller than full 5-slot ensure", async () => {
        const empty = new FakeCleanupHost({});
        await (0, mapping_sync_js_1.ensureAddonMappingStates)(empty, constants_js_1.AC_ADDON_ID, (0, mapping_config_js_1.acMappingCommandsForConfiguredUnits)({}));
        await (0, ensure_states_js_1.ensureAcRuntimeStates)(empty);
        const emptyCount = empty.objects.size;
        const one = new FakeCleanupHost({ ac_u1_enabled: true });
        await (0, mapping_sync_js_1.ensureAddonMappingStates)(one, constants_js_1.AC_ADDON_ID, (0, mapping_config_js_1.acMappingCommandsForConfiguredUnits)(one.config));
        await (0, ensure_states_js_1.ensureAcRuntimeStates)(one);
        const oneCount = one.objects.size;
        const legacy = new FakeCleanupHost({});
        await (0, mapping_sync_js_1.ensureAddonMappingStates)(legacy, constants_js_1.AC_ADDON_ID, (0, mapping_config_js_1.acMappingCommands)());
        await (0, ensure_states_js_1.ensureAcRuntimeStates)(legacy, { unitIndexes: [1, 2, 3, 4, 5] });
        const legacyCount = legacy.objects.size;
        strict_1.default.ok(emptyCount < oneCount);
        strict_1.default.ok(oneCount < legacyCount);
        const savingsVsLegacy = legacyCount - emptyCount;
        strict_1.default.ok(savingsVsLegacy >= 200, `expected large placeholder savings, got ${savingsVsLegacy} (empty=${emptyCount} one=${oneCount} legacy=${legacyCount})`);
    });
    (0, node_test_1.it)("marks planner coordinator states as expert", async () => {
        const host = new FakeCleanupHost({});
        await (0, ensure_states_js_3.ensurePlannerCoordinatorStates)(host);
        const sample = host.objects.get("planner.coordinator.comparison_status");
        strict_1.default.equal(sample?.common?.expert, true);
    });
});
