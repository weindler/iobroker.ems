"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getBootstrapRunContext = exports.resetBootstrapBarrierForTest = exports.bootstrapFailurePhase = exports.isBootstrapComplete = exports.runAdapterBootstrap = void 0;
const air_conditioning_1 = require("../addons/air_conditioning");
const battery_1 = require("../addons/battery");
const immersion_heater_1 = require("../addons/immersion_heater");
const measured_consumers_1 = require("../addons/measured_consumers");
const wallbox_1 = require("../addons/wallbox");
const governance_1 = require("../addons/governance");
const ems_light_1 = require("../ems_light");
const economics_feed_in_1 = require("../ems_light/economics_feed_in");
const economics_tariff_fees_1 = require("../ems_light/economics_tariff_fees");
const failsafe_runner_1 = require("../failsafe_runner");
const execution_mode_1 = require("../execution_mode");
const dryrun_context_1 = require("../restore/dryrun_context");
const tree_paths_1 = require("../tree_paths");
const states_1 = require("../states");
const cold_start_1 = require("./cold_start");
const barrier_1 = require("./barrier");
Object.defineProperty(exports, "bootstrapFailurePhase", { enumerable: true, get: function () { return barrier_1.bootstrapFailurePhase; } });
Object.defineProperty(exports, "isBootstrapComplete", { enumerable: true, get: function () { return barrier_1.isBootstrapComplete; } });
Object.defineProperty(exports, "resetBootstrapBarrierForTest", { enumerable: true, get: function () { return barrier_1.resetBootstrapBarrierForTest; } });
const context_1 = require("./context");
Object.defineProperty(exports, "getBootstrapRunContext", { enumerable: true, get: function () { return context_1.getBootstrapRunContext; } });
const ensure_static_tree_1 = require("./ensure_static_tree");
const persist_hydrate_1 = require("./persist_hydrate");
const reconcile_1 = require("./reconcile");
async function runCriticalStep(step, label, fn, strict) {
    try {
        await step(label, fn);
        return true;
    }
    catch (e) {
        (0, barrier_1.markBootstrapFailed)(label);
        if (strict) {
            throw e;
        }
        return false;
    }
}
/**
 * Verbindlicher Adapter-Startup A→F.
 * Phase A (Config) erfolgt vor dem Aufruf durch den Adapter.
 */
async function runAdapterBootstrap(host, step, options = {}) {
    (0, barrier_1.resetBootstrapBarrierForTest)();
    (0, context_1.endBootstrapRun)();
    const trace = options.trace;
    const strict = options.strictBootstrap ?? false;
    const adapterConfig = host.config && typeof host.config === "object" ? host.config : {};
    trace?.("A", "config_ready");
    const coldStart = await (0, cold_start_1.detectFullNamespaceColdStart)(host);
    const bootstrapCtx = (0, context_1.beginBootstrapRun)(coldStart);
    if (coldStart) {
        host.log.debug?.("Cold-Start-Recovery: leerer ems.0.*-Namespace erkannt");
    }
    trace?.("B", "static_state_tree");
    const staticOk = await runCriticalStep(step, "static state tree", () => (0, ensure_static_tree_1.ensureStaticStateTree)(host), strict);
    if (!staticOk) {
        host.log.error(`Bootstrap abgebrochen vor Runtime (Phase B fehlgeschlagen: ${(0, barrier_1.bootstrapFailurePhase)()})`);
        (0, context_1.endBootstrapRun)();
        return;
    }
    trace?.("C", "dynamic_vehicle_profiles_noop");
    await step("dynamic vehicle profiles (noop)", () => (0, ensure_static_tree_1.ensureDynamicVehicleProfiles)(host));
    trace?.("C2", "dynamic_surface_cleanup");
    await step("dynamic surface cleanup", () => (0, ensure_static_tree_1.cleanupDynamicPlaceholders)(host));
    trace?.("D", "persist_hydration");
    await step("persist hydration", () => (0, persist_hydrate_1.hydratePersistedState)(host));
    trace?.("sync", "governance_and_mappings");
    await step("sync governance", () => (0, governance_1.syncAddonGovernanceFromConfig)(host, adapterConfig));
    await step("sync execution modes", () => {
        const restoreReason = (0, dryrun_context_1.getPendingForceDryrunReason)();
        const forceDryrunReason = restoreReason ?? (bootstrapCtx.coldStartRecovery ? "namespace_cold_start" : null);
        return (0, execution_mode_1.syncExecutionModesFromConfig)(host, adapterConfig, { forceDryrunReason });
    });
    await step("sync mappings", () => (0, ensure_static_tree_1.syncAllMappingsFromConfig)(host));
    await step("sync economics feed-in", () => {
        const h = host;
        return (0, economics_feed_in_1.migrateAndSyncEconomicsFeedInFromConfig)({
            setObjectNotExistsAsync: host.setObjectNotExistsAsync.bind(host),
            getStateAsync: host.getStateAsync.bind(host),
            setStateAsync: host.setStateAsync.bind(host),
            extendObjectAsync: host.extendObjectAsync?.bind(host),
            config: adapterConfig,
            updateConfig: typeof h.updateConfig === "function" ? h.updateConfig.bind(host) : undefined,
            log: host.log,
        });
    });
    await step("sync economics tariff fees", () => (0, economics_tariff_fees_1.syncEconomicsTariffFeesFromConfig)({
        setObjectNotExistsAsync: host.setObjectNotExistsAsync.bind(host),
        getStateAsync: host.getStateAsync.bind(host),
        setStateAsync: host.setStateAsync.bind(host),
        extendObjectAsync: host.extendObjectAsync?.bind(host),
        config: adapterConfig,
        log: host.log,
    }));
    if ((0, barrier_1.bootstrapFailurePhase)()) {
        host.log.error(`Bootstrap abgebrochen vor Runtime (${(0, barrier_1.bootstrapFailurePhase)()})`);
        (0, context_1.endBootstrapRun)();
        return;
    }
    trace?.("E", "subscriptions");
    await step("wallbox runtime", () => (0, wallbox_1.startWallboxModuleRuntime)(host));
    await step("battery runtime", () => (0, battery_1.startBatteryModuleRuntime)(host));
    await step("immersion runtime", () => (0, immersion_heater_1.startImmersionHeaterModuleRuntime)(host));
    await step("air conditioning runtime", () => (0, air_conditioning_1.startAirConditioningModuleRuntime)(host));
    await step("measured consumers runtime", () => (0, measured_consumers_1.startMeasuredConsumersModuleRuntime)(host));
    trace?.("F", "runtime");
    await step("failsafe runner", async () => (0, failsafe_runner_1.startFailsafeRunner)(host));
    await step("ems-light runtime", () => (0, ems_light_1.startEmsLightPhase1Runtime)(host), 45_000);
    await step("subscribe command inbox", () => host.subscribeStatesAsync(states_1.STATE.command.inbox));
    await step("subscribe execution modes", async () => {
        await host.subscribeStatesAsync(tree_paths_1.GLOBAL.executionMode);
        for (const addonId of execution_mode_1.EXECUTION_MODE_ADDON_IDS) {
            await host.subscribeStatesAsync((0, tree_paths_1.addonMode)(addonId));
        }
    });
    (0, barrier_1.markBootstrapComplete)();
    trace?.("complete", "bootstrap_barrier_open");
    await step("post-bootstrap reconciliation", () => (0, reconcile_1.runPostBootstrapReconciliation)(host));
    (0, context_1.endBootstrapRun)();
}
exports.runAdapterBootstrap = runAdapterBootstrap;
