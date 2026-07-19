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
Object.defineProperty(exports, "__esModule", { value: true });
const utils = __importStar(require("@iobroker/adapter-core"));
const battery_1 = require("./addons/battery");
const air_conditioning_1 = require("./addons/air_conditioning");
const immersion_heater_1 = require("./addons/immersion_heater");
const failsafe_1 = require("./addons/wallbox/failsafe");
const wallbox_1 = require("./addons/wallbox");
const ems_activity_1 = require("./ems_activity");
const failsafe_runner_1 = require("./failsafe_runner");
const dryrun_mirror_1 = require("./dryrun_mirror");
const execution_mode_1 = require("./execution_mode");
const barrier_1 = require("./bootstrap/barrier");
const startup_1 = require("./bootstrap/startup");
const export_handler_1 = require("./backup/export_handler");
const handler_1 = require("./restore/handler");
const startup_recovery_1 = require("./restore/startup_recovery");
const barrier_2 = require("./restore/barrier");
const retention_1 = require("./backup/retention");
const startup_2 = require("./backup_integration/startup");
const startup_rearm_1 = require("./backup_integration/startup_rearm");
const execution_mode_2 = require("./execution_mode");
const tree_paths_1 = require("./tree_paths");
const inbox_1 = require("./inbox");
const mapping_config_1 = require("./mapping_config");
const ems_light_1 = require("./ems_light");
const runtime_1 = require("./planner_shadow/runtime");
const energy_daily_rollup_1 = require("./learning/energy_daily_rollup");
const power_rollup_1 = require("./learning/power_rollup");
const policy_1 = require("./policy");
const intent_1 = require("./intent");
const pipeline_1 = require("./pipeline");
const states_1 = require("./states");
class Ems extends utils.Adapter {
    processingInbox = false;
    constructor(options = {}) {
        super({
            ...options,
            name: "ems",
        });
        this.on("ready", () => void this.onReady());
        this.on("stateChange", (id, state) => void this.onStateChange(id, state ?? null));
        this.on("unload", (callback) => void this.onUnload(callback));
        this.on("message", (obj) => this.onMessage(obj));
    }
    onMessage(obj) {
        if (!obj?.command) {
            return;
        }
        if (obj.command === "applyGoeTemplate") {
            // obj.callback is an ioBroker message token (string), not a JS function.
            if (obj.callback) {
                this.sendTo(obj.from, obj.command, (0, mapping_config_1.goeWallboxTemplateFlat)(), obj.callback);
            }
            return;
        }
        if (obj.command === "requestBackupExport") {
            void (async () => {
                try {
                    const { handleBackupExportRequest } = await Promise.resolve().then(() => __importStar(require("./backup/export_handler.js")));
                    await handleBackupExportRequest(this, true, false);
                    const file = String((await this.getStateAsync("backup.last_file_name"))?.val ?? "");
                    const err = String((await this.getStateAsync("backup.last_error"))?.val ?? "");
                    const ready = (await this.getStateAsync("backup.export_register_ready"))?.val === true;
                    const payload = {
                        result: err ? "error" : "ok",
                        fileName: file,
                        error: err,
                        exportRegisterReady: ready,
                        hint: "ems-runtime.%INSTANCE%/exports/backup/",
                    };
                    if (obj.callback) {
                        this.sendTo(obj.from, obj.command, payload, obj.callback);
                    }
                }
                catch (e) {
                    const error = e instanceof Error ? e.message : String(e);
                    this.log.error(`requestBackupExport: ${error}`);
                    if (obj.callback) {
                        this.sendTo(obj.from, obj.command, { result: "error", error }, obj.callback);
                    }
                }
            })().catch((e) => {
                this.log.error(`requestBackupExport unhandled: ${e instanceof Error ? e.message : String(e)}`);
            });
            return;
        }
        if (obj.command === "requestSupportExport") {
            void (async () => {
                try {
                    const { handleSupportExportRequest } = await Promise.resolve().then(() => __importStar(require("./backup/export_handler.js")));
                    await handleSupportExportRequest(this, true, false);
                    const file = String((await this.getStateAsync("backup.last_file_name"))?.val ?? "");
                    const err = String((await this.getStateAsync("backup.last_error"))?.val ?? "");
                    const payload = {
                        result: err ? "error" : "ok",
                        fileName: file,
                        error: err,
                        hint: "ems-runtime.%INSTANCE%/exports/support/",
                    };
                    if (obj.callback) {
                        this.sendTo(obj.from, obj.command, payload, obj.callback);
                    }
                }
                catch (e) {
                    const error = e instanceof Error ? e.message : String(e);
                    this.log.error(`requestSupportExport: ${error}`);
                    if (obj.callback) {
                        this.sendTo(obj.from, obj.command, { result: "error", error }, obj.callback);
                    }
                }
            })().catch((e) => {
                this.log.error(`requestSupportExport unhandled: ${e instanceof Error ? e.message : String(e)}`);
            });
        }
    }
    /**
     * Init-Schritt isoliert ausführen: Ein Fehler in einem Modul (z. B. einem
     * Add-on) darf nie die übrigen Module oder das Learning blockieren.
     */
    async step(label, fn, timeoutMs = 30_000) {
        const started = Date.now();
        this.log.debug(`init step '${label}' starting`);
        let timedOut = false;
        let timer = null;
        try {
            await Promise.race([
                fn().catch((e) => {
                    if (timedOut) {
                        this.log.error(`init step '${label}' failed after timeout: ${e instanceof Error ? (e.stack ?? e.message) : e}`);
                        return;
                    }
                    throw e;
                }),
                new Promise((resolve) => {
                    timer = setTimeout(() => {
                        timedOut = true;
                        this.log.warn(`init step '${label}' timed out after ${timeoutMs}ms; continuing adapter startup`);
                        resolve();
                    }, timeoutMs);
                }),
            ]);
            if (timer) {
                clearTimeout(timer);
            }
            if (!timedOut) {
                this.log.debug(`init step '${label}' ok (${Date.now() - started}ms)`);
            }
        }
        catch (e) {
            if (timer) {
                clearTimeout(timer);
            }
            this.log.error(`init step '${label}' failed: ${e instanceof Error ? (e.stack ?? e.message) : e}`);
        }
    }
    async onReady() {
        const integrationCtx = await (0, startup_2.runBackupIntegrationStartup)(this);
        const recovery = await (0, startup_recovery_1.runRestoreStartupRecovery)(this);
        if (!recovery.ok) {
            this.log.error(`Restore startup recovery failed: ${recovery.error}`);
            return;
        }
        await (0, startup_1.runAdapterBootstrap)(this, this.step.bind(this));
        if (!(0, barrier_1.isBootstrapComplete)()) {
            this.log.warn("EMS adapter: Bootstrap unvollständig — Geräte-Runtime bleibt gesperrt");
            return;
        }
        this.log.info("EMS adapter ready — Failsafe Heizstab/Batterie/Wallbox (nur Live)");
        // Clear restore/stateChange gate BEFORE optional inits that can time out —
        // otherwise execution-mode / rearm handlers stay dead for the whole process.
        await (0, startup_recovery_1.clearRestoreRestartRequiredAfterBootstrap)(this);
        (0, startup_rearm_1.markBootstrapCompletedForRearm)();
        await (0, startup_rearm_1.captureExecutionModeBaselineFromHost)(this, [
            tree_paths_1.GLOBAL.executionMode,
            ...execution_mode_2.EXECUTION_MODE_ADDON_IDS.map((id) => (0, tree_paths_1.addonMode)(id)),
        ]);
        const manifest = integrationCtx.manifest ?? (0, startup_2.getBackupIntegrationContext)()?.manifest;
        if (manifest) {
            await (0, startup_2.updateBootGuardAfterBootstrap)(this, manifest);
        }
        await this.step("backup export init", async () => {
            await (0, retention_1.cleanupTempExports)(this);
            await (0, export_handler_1.initBackupExportRuntime)(this);
            await (0, handler_1.initRestoreRuntime)(this);
        });
        await this.step("process pending inbox", async () => {
            const inbox = await this.getStateAsync(states_1.STATE.command.inbox);
            if (inbox && !inbox.ack && inbox.val != null) {
                this.log.debug("Processing pending command.inbox on start");
                await this.processInbox(inbox.val, inbox.ack);
            }
        });
    }
    async onUnload(callback) {
        (0, export_handler_1.stopDiagnosticMode)();
        await (0, ems_light_1.stopEmsLightPhase1)();
        void (0, battery_1.batteryUnloadRestore)(this).catch(() => undefined);
        (0, battery_1.stopBatteryModule)(null);
        (0, immersion_heater_1.stopImmersionHeaterModule)();
        (0, air_conditioning_1.stopAirConditioningModule)();
        (0, wallbox_1.stopWallboxModule)();
        (0, failsafe_runner_1.stopFailsafeRunner)();
        callback();
    }
    async onStateChange(id, state) {
        if (!(0, barrier_1.isBootstrapComplete)() || (0, barrier_2.isRestoreInProgress)()) {
            return;
        }
        if (state) {
            const rel = id.startsWith(`${this.namespace}.`) ? id.slice(this.namespace.length + 1) : id;
            if ((0, export_handler_1.isBackupRelatedState)(rel)) {
                await (0, export_handler_1.handleBackupStateChange)(this, rel, state.val, state.ack);
                return;
            }
            if ((0, handler_1.isRestoreRelatedState)(rel)) {
                await (0, handler_1.handleRestoreStateChange)(this, rel, state.val, state.ack);
                return;
            }
            await (0, execution_mode_1.handleExecutionModeStateChange)(this, id, state);
            if (rel === tree_paths_1.GLOBAL.executionMode) {
                void Promise.resolve().then(() => __importStar(require("./planner_authorization/runtime.js"))).then((m) => m.notifyPlannerAuthorizationExecutionMode(String(state.val ?? "dryrun")))
                    .catch(() => undefined);
                void Promise.resolve().then(() => __importStar(require("./planner_authority/runtime.js"))).then((m) => m.notifyPlannerAuthorityExecutionMode(String(state.val ?? "dryrun")))
                    .catch(() => undefined);
            }
            (0, battery_1.handleBatteryAdapterStateChange)(this, id);
            (0, battery_1.handleBatteryGridBalanceForeignStateChange)(this, id);
            (0, immersion_heater_1.handleImmersionHeaterStateChange)(this, id);
            (0, air_conditioning_1.handleAirConditioningStateChange)(this, id);
            (0, policy_1.handleGlobalModesStateChange)(this.namespace, id);
            (0, intent_1.handleIntentStateChange)(this.namespace, id, state);
            (0, wallbox_1.handleWallboxForeignStateChange)(this.namespace, id);
            (0, wallbox_1.handleWallboxStateChange)(this.namespace, id);
            (0, power_rollup_1.handlePowerRollupStateChange)(id, state);
            (0, energy_daily_rollup_1.handleEnergyDailyRollupStateChange)(id, state);
            if (await (0, runtime_1.handlePlannerShadowStateChange)(this, rel, state.val, state.ack)) {
                return;
            }
            (0, runtime_1.observePlannerTriggerStateChange)(rel, state.ack);
        }
        const inboxId = `${this.namespace}.${states_1.STATE.command.inbox}`;
        if (id !== inboxId || !state)
            return;
        await this.processInbox(state.val, state.ack);
    }
    async processInbox(val, ack) {
        if (ack)
            return;
        if ((0, barrier_2.isRestoreInProgress)())
            return;
        if (this.processingInbox)
            return;
        if (val === null || val === undefined || val === "") {
            return;
        }
        this.processingInbox = true;
        try {
            this.log.debug(`command.inbox received: ${typeof val === "object" ? JSON.stringify(val) : String(val)}`);
            await this.handleInbox(val);
            await this.setStateAsync(states_1.STATE.command.inbox, {
                val: val,
                ack: true,
            });
        }
        catch (e) {
            this.log.error(`handleInbox: ${e}`);
        }
        finally {
            this.processingInbox = false;
        }
    }
    async handleInbox(val) {
        const intent = (0, inbox_1.parseInboxValue)(val);
        if (!intent) {
            const outcome = {
                result: "invalid_command",
                reason: "json_parse",
                checks_passed: [],
                checks_failed: ["parse"],
            };
            await this.writeAudit({ ...outcome, intent: null });
            await this.setStateAsync(states_1.STATE.command.lastResult, {
                val: JSON.stringify(outcome),
                ack: true,
            });
            this.log.warn("command.inbox: invalid JSON");
            return;
        }
        (0, ems_activity_1.touchEmsActivity)();
        const outcome = await (0, pipeline_1.runCommandPipeline)(intent, {
            getState: (relativeId) => this.getStateAsync(relativeId),
            getForeignState: (stateId) => this.getForeignStateAsync(stateId),
            setForeignState: async (stateId, value) => {
                await this.setForeignStateAsync(stateId, { val: value, ack: true });
            },
            isLiveAllowed: (addonId) => (0, execution_mode_1.isLiveWriteAllowed)((id) => this.getStateAsync(id), addonId),
        });
        await this.writeAudit({
            result: outcome.result,
            reason: outcome.reason,
            intent,
            checks_passed: outcome.checks_passed,
            checks_failed: outcome.checks_failed,
            mapping_id: outcome.mapping_id,
            target_state: outcome.target_state,
            planned_value: outcome.planned_value,
            addon_mode: outcome.addon_mode,
        });
        await this.setStateAsync(states_1.STATE.command.lastResult, {
            val: JSON.stringify(outcome),
            ack: true,
        });
        if (intent.addon_id) {
            await (0, dryrun_mirror_1.writeDryrunMirror)(this, intent.addon_id, intent, outcome);
        }
        const cfg = this.config && typeof this.config === "object"
            ? this.config
            : {};
        (0, failsafe_1.recordWallboxPipelineResult)(cfg, intent, outcome);
        this.log.debug(`command.inbox done: ${outcome.result}` +
            (outcome.target_state ? ` → ${outcome.target_state}` : ""));
    }
    async writeAudit(payload) {
        const event = {
            timestamp: new Date().toISOString(),
            ...payload,
        };
        await this.setStateAsync(states_1.STATE.audit.lastEvent, {
            val: JSON.stringify(event),
            ack: true,
        });
        const addonId = payload.intent?.addon_id;
        if (addonId) {
            await this.setObjectNotExistsAsync(`audit.${addonId}.last_event`, {
                type: "state",
                common: {
                    name: `Last audit (${addonId})`,
                    type: "string",
                    role: "json",
                    read: true,
                    write: false,
                },
                native: {},
            });
            await this.setStateAsync(`audit.${addonId}.last_event`, {
                val: JSON.stringify(event),
                ack: true,
            });
        }
    }
}
if (module !== undefined && module.parent) {
    module.exports = (options) => new Ems(options);
}
else {
    new Ems();
}
