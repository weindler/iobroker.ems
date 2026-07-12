"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || function (mod) {
    if (mod && mod.__esModule) return mod;
    var result = {};
    if (mod != null) for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
    __setModuleDefault(result, mod);
    return result;
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const strict_1 = __importDefault(require("node:assert/strict"));
const fs = __importStar(require("node:fs/promises"));
const os = __importStar(require("node:os"));
const path = __importStar(require("node:path"));
const index_js_1 = require("../addons/battery/index.js");
const index_js_2 = require("../addons/air_conditioning/index.js");
const index_js_3 = require("../addons/immersion_heater/index.js");
const index_js_4 = require("../addons/wallbox/index.js");
const index_js_5 = require("../ems_light/index.js");
const failsafe_runner_js_1 = require("../failsafe_runner.js");
const execute_js_1 = require("../addons/wallbox/runtime/execute.js");
const baseline_js_1 = require("../addons/wallbox/vehicles/baseline.js");
const ensure_states_js_1 = require("../addons/wallbox/vehicles/ensure_states.js");
const types_js_1 = require("../addons/immersion_heater/runtime/types.js");
const manifest_js_1 = require("./manifest.js");
const ensure_static_tree_js_1 = require("./ensure_static_tree.js");
const context_js_1 = require("./context.js");
const persist_hydrate_js_1 = require("./persist_hydrate.js");
const reconcile_js_1 = require("./reconcile.js");
const startup_js_1 = require("./startup.js");
const ensure_evcc_states_js_1 = require("../addons/wallbox/ensure_evcc_states.js");
function defaultConfig(overrides = {}) {
    return {
        global_execution_mode: "dryrun",
        wb_addon_mode: "dryrun",
        bat_addon_mode: "dryrun",
        ih_addon_mode: "dryrun",
        ac_addon_mode: "dryrun",
        wb_vehicle_profiles: [],
        ...overrides,
    };
}
function profileRow(id, name) {
    return {
        vehicle_id: id,
        display_name: name,
        enabled: true,
        source: "manual",
        battery_capacity_net_kwh: 60,
        max_ac_charge_power_w: 11000,
        supported_phases: "3",
        preferred_phases: 3,
        min_current_a: 6,
        max_current_a: 16,
        default_target_soc_pct: 80,
        minimum_departure_soc_pct: 50,
        maximum_soc_pct: 90,
    };
}
function liveConfig(overrides = {}) {
    return defaultConfig({
        global_execution_mode: "live",
        wb_addon_mode: "live",
        bat_addon_mode: "live",
        ih_addon_mode: "live",
        ac_addon_mode: "live",
        ...overrides,
    });
}
function immersionConfig(overrides = {}) {
    return defaultConfig({
        ih_set_enabled_target: "relay.0.heater",
        ih_buffer_temp_c_target: "sensor.0.buffer_temp",
        ih_buffer_temp_c_enabled: true,
        ...overrides,
    });
}
class FakeBootstrapAdapter {
    namespace = "ems.0";
    objects = new Map();
    states = new Map();
    subscriptions = [];
    foreignSubscriptions = [];
    foreignWrites = [];
    foreignStates = new Map();
    config;
    common = { version: "0.1.140" };
    dataDir;
    constructor(dataDir, config = defaultConfig()) {
        this.dataDir = dataDir;
        this.config = config;
    }
    log = {
        debug: () => undefined,
        info: () => undefined,
        warn: () => undefined,
        error: () => undefined,
    };
    getAbsoluteInstanceDataDir() {
        return this.dataDir;
    }
    async setObjectNotExistsAsync(id, obj) {
        if (!this.objects.has(id)) {
            this.objects.set(id, { ...obj, _id: id });
        }
        if (obj.type === "state" && obj.common?.def !== undefined && !this.states.has(id)) {
            this.states.set(id, { val: obj.common.def, ack: true });
        }
    }
    async extendObjectAsync(id, obj) {
        const cur = this.objects.get(id);
        if (cur && obj.common) {
            cur.common = { ...cur.common, ...obj.common };
        }
    }
    async getObjectAsync(id) {
        return this.objects.get(id) ?? null;
    }
    async getStateAsync(id) {
        const s = this.states.get(id);
        return s ? { val: s.val, ack: s.ack, ts: 0, lc: 0, from: "test" } : null;
    }
    async setStateAsync(id, st) {
        this.states.set(id, { val: st.val, ack: st.ack ?? false });
    }
    async getForeignStateAsync(id) {
        const s = this.foreignStates.get(id);
        return s ? { val: s.val, ack: s.ack, ts: 0, lc: 0, from: "test" } : null;
    }
    async setForeignStateAsync(id, st) {
        this.foreignWrites.push({ id, val: st.val });
    }
    async subscribeStatesAsync(pattern) {
        if (!this.subscriptions.includes(pattern)) {
            this.subscriptions.push(pattern);
        }
    }
    async subscribeForeignStatesAsync(pattern) {
        if (!this.foreignSubscriptions.includes(pattern)) {
            this.foreignSubscriptions.push(pattern);
        }
    }
    async unsubscribeStatesAsync(_pattern) {
        return undefined;
    }
    async unsubscribeForeignStatesAsync(_pattern) {
        return undefined;
    }
    async getHistoryAsync() {
        return [];
    }
    hasObject(relativeId) {
        return this.objects.has(relativeId);
    }
}
async function strictStep(_label, fn) {
    await fn();
}
function stopAllRuntime() {
    (0, index_js_5.stopEmsLightPhase1)();
    (0, index_js_4.stopWallboxModule)();
    (0, index_js_1.stopBatteryModule)(null);
    (0, index_js_3.stopImmersionHeaterModule)();
    (0, index_js_2.stopAirConditioningModule)();
    (0, failsafe_runner_js_1.stopFailsafeRunner)();
    (0, startup_js_1.resetBootstrapBarrierForTest)();
    (0, context_js_1.endBootstrapRun)();
    (0, baseline_js_1.resetAllProfileSocPersistence)();
}
function assertCoreCategories(adapter) {
    for (const [category, ids] of Object.entries(manifest_js_1.BOOTSTRAP_CORE_STATE_CATEGORIES)) {
        for (const id of ids) {
            strict_1.default.ok(adapter.hasObject(id), `${category}: missing object ${id}`);
        }
    }
}
(0, node_test_1.describe)("bootstrap cold start recovery", () => {
    let tmp;
    (0, node_test_1.beforeEach)(async () => {
        tmp = await fs.mkdtemp(path.join(os.tmpdir(), "ems-bootstrap-"));
    });
    (0, node_test_1.afterEach)(() => {
        stopAllRuntime();
    });
    (0, node_test_1.it)("scenario A — empty namespace, empty vehicle profile list", async () => {
        const adapter = new FakeBootstrapAdapter(tmp, defaultConfig({ wb_vehicle_profiles: [] }));
        await (0, startup_js_1.runAdapterBootstrap)(adapter, strictStep);
        strict_1.default.equal((0, startup_js_1.isBootstrapComplete)(), true);
        assertCoreCategories(adapter);
        strict_1.default.equal(adapter.states.get("global.execution_mode")?.val, "dryrun");
        strict_1.default.equal(adapter.states.get("addons.wallbox.mode")?.val, "dryrun");
        strict_1.default.equal(adapter.foreignWrites.length, 0);
        strict_1.default.equal(execute_js_1.WALLBOX_LIVE_WRITE_RELEASED, false);
        for (const prefix of manifest_js_1.LEGACY_WALLBOX_VEHICLE_SLOT_PREFIXES) {
            for (const id of adapter.objects.keys()) {
                strict_1.default.ok(!id.startsWith(prefix), `legacy slot object must not exist: ${id}`);
            }
        }
        const vehicleChannels = [...adapter.objects.keys()].filter((id) => id.startsWith("addons.wallbox.vehicles."));
        strict_1.default.equal(vehicleChannels.length, 0, "no example vehicle profiles");
    });
    (0, node_test_1.it)("scenario B — one and five dynamic vehicle profiles", async () => {
        for (const count of [1, 5]) {
            stopAllRuntime();
            const dir = await fs.mkdtemp(path.join(os.tmpdir(), "ems-bootstrap-vp-"));
            const profiles = Array.from({ length: count }, (_, i) => profileRow(`car_${i + 1}`, `Car ${i + 1}`));
            const adapter = new FakeBootstrapAdapter(dir, defaultConfig({ wb_vehicle_profiles: profiles }));
            await (0, ensure_static_tree_js_1.ensureStaticStateTree)(adapter);
            await (0, ensure_static_tree_js_1.ensureDynamicVehicleProfiles)(adapter);
            for (const p of profiles) {
                const vid = String(p.vehicle_id);
                strict_1.default.ok(adapter.hasObject(`addons.wallbox.vehicles.${vid}.config.enabled`));
                strict_1.default.ok(adapter.hasObject(`addons.wallbox.vehicles.${vid}.telemetry.soc_pct`));
            }
            if (count >= 2) {
                const a = `addons.wallbox.vehicles.car_1.telemetry.soc_pct`;
                const b = `addons.wallbox.vehicles.car_2.telemetry.soc_pct`;
                strict_1.default.notEqual(a, b);
            }
        }
    });
    (0, node_test_1.it)("scenario C — idempotent second start preserves user values", async () => {
        const adapter = new FakeBootstrapAdapter(tmp);
        await (0, startup_js_1.runAdapterBootstrap)(adapter, strictStep);
        await adapter.setStateAsync("global.execution_mode", { val: "dryrun", ack: true });
        await adapter.setStateAsync("global_modes.requested", { val: "eco", ack: true });
        const snapshotObjects = new Map(adapter.objects);
        const snapshotStates = new Map(adapter.states);
        const snapshotSubs = [...adapter.subscriptions];
        stopAllRuntime();
        await (0, startup_js_1.runAdapterBootstrap)(adapter, strictStep);
        strict_1.default.equal(adapter.objects.size, snapshotObjects.size);
        strict_1.default.equal(adapter.states.get("global_modes.requested")?.val, "eco");
        strict_1.default.equal(adapter.states.get("global.execution_mode")?.val, "dryrun");
        for (const sub of snapshotSubs) {
            strict_1.default.ok(adapter.subscriptions.includes(sub), `subscription preserved: ${sub}`);
        }
    });
    (0, node_test_1.it)("scenario D — partial namespace fills gaps and keeps valid user values", async () => {
        const adapter = new FakeBootstrapAdapter(tmp);
        await adapter.setObjectNotExistsAsync("global.execution_mode", {
            type: "state",
            common: { name: "Global mode", type: "string", role: "value", read: true, write: true, def: "dryrun" },
            native: {},
        });
        await adapter.setStateAsync("global.execution_mode", { val: "dryrun", ack: true });
        await adapter.setObjectNotExistsAsync("global_modes.requested", {
            type: "state",
            common: { name: "Requested", type: "string", role: "value", read: true, write: true },
            native: {},
        });
        await adapter.setStateAsync("global_modes.requested", { val: "balanced", ack: true });
        await adapter.setStateAsync("learning.persistence.battery_runtime_json", {
            val: "{invalid-json",
            ack: true,
        });
        await (0, startup_js_1.runAdapterBootstrap)(adapter, strictStep);
        strict_1.default.equal((0, startup_js_1.isBootstrapComplete)(), true);
        strict_1.default.equal(adapter.states.get("global_modes.requested")?.val, "balanced");
        for (const id of (0, manifest_js_1.allBootstrapCoreStateIds)()) {
            strict_1.default.ok(adapter.hasObject(id), `filled missing core object ${id}`);
        }
        strict_1.default.equal(adapter.foreignWrites.length, 0);
    });
    (0, node_test_1.it)("scenario E — full phase order A→B→C→D→Sync→E→F→Complete", async () => {
        const order = [];
        const adapter = new FakeBootstrapAdapter(tmp);
        await (0, startup_js_1.runAdapterBootstrap)(adapter, strictStep, {
            trace: (phase, detail) => order.push(detail ? `${phase}:${detail}` : phase),
        });
        const phases = ["A:", "B:", "C:", "D:", "sync:", "E:", "F:", "complete:"];
        let lastIdx = -1;
        for (const prefix of phases) {
            const idx = order.findIndex((x) => x.startsWith(prefix));
            strict_1.default.ok(idx > lastIdx, `missing or out-of-order ${prefix} in ${order.join(" -> ")}`);
            lastIdx = idx;
        }
    });
    (0, node_test_1.it)("scenario F — empty namespace with live admin config clamps to dryrun", async () => {
        const cfg = liveConfig({ wb_vehicle_profiles: [] });
        const adapter = new FakeBootstrapAdapter(tmp, cfg);
        let coldStartDuringSync = null;
        await (0, startup_js_1.runAdapterBootstrap)(adapter, async (label, fn) => {
            await fn();
            if (label === "sync execution modes") {
                coldStartDuringSync = (0, startup_js_1.getBootstrapRunContext)()?.coldStartRecovery ?? null;
            }
        });
        strict_1.default.equal((0, startup_js_1.isBootstrapComplete)(), true);
        strict_1.default.equal(coldStartDuringSync, true);
        strict_1.default.equal((0, startup_js_1.getBootstrapRunContext)(), null);
        strict_1.default.equal(adapter.config.global_execution_mode, "live");
        strict_1.default.equal(adapter.config.wb_addon_mode, "live");
        strict_1.default.equal(adapter.states.get("global.execution_mode")?.val, "dryrun");
        strict_1.default.equal(adapter.states.get("addons.wallbox.mode")?.val, "dryrun");
        strict_1.default.equal(adapter.states.get("addons.battery.mode")?.val, "dryrun");
        strict_1.default.equal(adapter.states.get("addons.immersion_heater.mode")?.val, "dryrun");
        strict_1.default.equal(adapter.states.get("addons.air_conditioning.mode")?.val, "dryrun");
        strict_1.default.equal(adapter.states.get("execution.safety.global_execution_mode")?.val, "dryrun");
        strict_1.default.equal(adapter.foreignWrites.length, 0);
        strict_1.default.equal(execute_js_1.WALLBOX_LIVE_WRITE_RELEASED, false);
    });
    (0, node_test_1.it)("scenario F2 — second start with existing namespace is warm start", async () => {
        const cfg = liveConfig({ wb_vehicle_profiles: [] });
        const adapter = new FakeBootstrapAdapter(tmp, cfg);
        await (0, startup_js_1.runAdapterBootstrap)(adapter, strictStep);
        strict_1.default.equal(adapter.states.get("global.execution_mode")?.val, "dryrun");
        stopAllRuntime();
        let secondRunColdStart = null;
        const subsBefore = adapter.subscriptions.length;
        await (0, startup_js_1.runAdapterBootstrap)(adapter, async (label, fn) => {
            await fn();
            if (label === "sync execution modes") {
                secondRunColdStart = (0, startup_js_1.getBootstrapRunContext)()?.coldStartRecovery ?? null;
            }
        });
        strict_1.default.equal(secondRunColdStart, false);
        strict_1.default.equal(adapter.states.get("global.execution_mode")?.val, "dryrun");
        strict_1.default.equal(adapter.subscriptions.length, subsBefore);
    });
    (0, node_test_1.it)("scenario G — foreign input during bootstrap is reconciled after barrier", async () => {
        const adapter = new FakeBootstrapAdapter(tmp, defaultConfig({ wb_evcc_connected_state: "evcc.0.status.connected" }));
        let foreignSetDuringBootstrap = false;
        await (0, startup_js_1.runAdapterBootstrap)(adapter, async (label, fn) => {
            await fn();
            if (label === "wallbox runtime" && !foreignSetDuringBootstrap) {
                adapter.foreignStates.set("evcc.0.status.connected", { val: true, ack: true });
                foreignSetDuringBootstrap = true;
            }
        });
        strict_1.default.equal((0, startup_js_1.isBootstrapComplete)(), true);
        strict_1.default.equal(adapter.foreignWrites.length, 0);
        strict_1.default.equal(adapter.states.get(ensure_evcc_states_js_1.WALLBOX_EVCC_STATES.connected)?.val, true);
    });
    (0, node_test_1.it)("scenario G2 — post-bootstrap reconciliation picks up late foreign changes", async () => {
        const adapter = new FakeBootstrapAdapter(tmp, defaultConfig({ wb_evcc_connected_state: "evcc.0.status.connected" }));
        await (0, startup_js_1.runAdapterBootstrap)(adapter, strictStep);
        adapter.foreignStates.set("evcc.0.status.connected", { val: true, ack: true });
        await (0, reconcile_js_1.runPostBootstrapReconciliation)(adapter);
        strict_1.default.equal(adapter.states.get(ensure_evcc_states_js_1.WALLBOX_EVCC_STATES.connected)?.val, true);
        strict_1.default.equal(adapter.foreignWrites.length, 0);
    });
    (0, node_test_1.it)("scenario H — vehicle SOC persistence hydrated in Phase D before runtime", async () => {
        const profiles = [profileRow("car_1", "Car 1")];
        const adapter = new FakeBootstrapAdapter(tmp, defaultConfig({ wb_vehicle_profiles: profiles }));
        await (0, ensure_static_tree_js_1.ensureStaticStateTree)(adapter);
        await (0, ensure_static_tree_js_1.ensureDynamicVehicleProfiles)(adapter);
        const p = (0, ensure_states_js_1.vehicleStatePaths)("car_1");
        await adapter.setStateAsync(p.estimationBaselineSocPct, { val: 72, ack: true });
        await adapter.setStateAsync(p.estimationBaselineSocSource, { val: "direct", ack: true });
        await adapter.setStateAsync(p.estimationBaselineAt, { val: "2026-07-01T10:00:00.000Z", ack: true });
        await (0, persist_hydrate_js_1.hydratePersistedState)(adapter);
        const { getRollforwardAnchor } = await Promise.resolve().then(() => __importStar(require("../addons/wallbox/vehicles/baseline.js")));
        const anchor = getRollforwardAnchor("car_1");
        strict_1.default.ok(anchor);
        strict_1.default.equal(anchor?.socPct, 72);
        strict_1.default.equal(anchor?.rootSource, "direct");
    });
    (0, node_test_1.it)("scenario I — immersion foreign input during bootstrap reconciled after barrier", async () => {
        const adapter = new FakeBootstrapAdapter(tmp, immersionConfig());
        let foreignSetDuringBootstrap = false;
        const foreignWritesDuringBootstrap = [];
        await (0, startup_js_1.runAdapterBootstrap)(adapter, async (label, fn) => {
            await fn();
            if (label === "immersion runtime" && !foreignSetDuringBootstrap) {
                foreignWritesDuringBootstrap.push(...adapter.foreignWrites);
                adapter.foreignStates.set("sensor.0.buffer_temp", { val: 52.5, ack: true });
                foreignSetDuringBootstrap = true;
            }
        });
        strict_1.default.equal((0, startup_js_1.isBootstrapComplete)(), true);
        strict_1.default.equal(foreignSetDuringBootstrap, true);
        strict_1.default.equal(foreignWritesDuringBootstrap.length, 0);
        strict_1.default.equal(adapter.states.get(types_js_1.IMMERSION_RUNTIME_STATES.bufferTemperatureC)?.val, 52.5);
        const dupes = adapter.subscriptions.filter((s, i) => adapter.subscriptions.indexOf(s) !== i);
        strict_1.default.equal(dupes.length, 0, "no duplicate subscriptions");
    });
});
