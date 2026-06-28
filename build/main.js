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
const immersion_heater_1 = require("./addons/immersion_heater");
const dynamic_tariff_1 = require("./addons/dynamic_tariff");
const failsafe_1 = require("./addons/wallbox/failsafe");
const wallbox_1 = require("./addons/wallbox");
const ems_activity_1 = require("./ems_activity");
const failsafe_runner_1 = require("./failsafe_runner");
const registry_1 = require("./addons/registry");
const governance_1 = require("./addons/governance");
const dryrun_mirror_1 = require("./dryrun_mirror");
const execution_mode_1 = require("./execution_mode");
const inbox_1 = require("./inbox");
const mapping_config_1 = require("./mapping_config");
const mapping_sync_1 = require("./mapping_sync");
const ems_light_1 = require("./ems_light");
const policy_1 = require("./policy");
const intent_1 = require("./intent");
const pipeline_1 = require("./pipeline");
const status_wallbox_1 = require("./status_wallbox");
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
        const msg = obj;
        if (msg.command !== "applyGoeTemplate") {
            return;
        }
        msg.callback?.((0, mapping_config_1.goeWallboxTemplateFlat)());
    }
    async onReady() {
        try {
            await (0, execution_mode_1.ensureChannelTree)(this.setObjectNotExistsAsync.bind(this));
            await this.ensureBaseStates();
            await (0, execution_mode_1.ensureGlobalExecutionStates)(this);
            await this.ensureAddonStates();
            await (0, governance_1.ensureAddonGovernanceStates)(this);
            const adapterConfig = this.config && typeof this.config === "object" ? this.config : {};
            await (0, governance_1.syncAddonGovernanceFromConfig)(this, adapterConfig);
            await (0, execution_mode_1.syncExecutionModesFromConfig)(this, adapterConfig);
            await this.ensureWallboxMapping();
            await (0, status_wallbox_1.ensureWallboxStatusStates)(this);
            await (0, wallbox_1.initWallboxModule)(this);
            await (0, battery_1.initBatteryModule)(this);
            await (0, immersion_heater_1.initImmersionHeaterModule)(this);
            await (0, dynamic_tariff_1.initDynamicTariffModule)(this);
            (0, failsafe_runner_1.startFailsafeRunner)(this);
            await (0, ems_light_1.initEmsLightPhase1)(this);
            await this.subscribeStatesAsync(states_1.STATE.command.inbox);
            this.log.info("EMS adapter v0.1.2 ready — Failsafe Heizstab/Batterie/Wallbox (nur Live)");
            const inbox = await this.getStateAsync(states_1.STATE.command.inbox);
            if (inbox && !inbox.ack && inbox.val != null) {
                this.log.info("Processing pending command.inbox on start");
                await this.processInbox(inbox.val, inbox.ack);
            }
        }
        catch (e) {
            this.log.error(`onReady failed: ${e}`);
        }
    }
    onUnload(callback) {
        (0, ems_light_1.stopEmsLightPhase1)();
        (0, battery_1.stopBatteryModule)(null);
        (0, immersion_heater_1.stopImmersionHeaterModule)();
        (0, wallbox_1.stopWallboxModule)();
        (0, failsafe_runner_1.stopFailsafeRunner)();
        callback();
    }
    async onStateChange(id, state) {
        if (state) {
            (0, battery_1.handleBatteryAdapterStateChange)(this, id);
            (0, immersion_heater_1.handleImmersionHeaterStateChange)(this, id);
            (0, policy_1.handleGlobalModesStateChange)(this.namespace, id);
            (0, intent_1.handleIntentStateChange)(this.namespace, id, state);
            (0, wallbox_1.handleWallboxForeignStateChange)(this.namespace, id);
        }
        const inboxId = `${this.namespace}.${states_1.STATE.command.inbox}`;
        if (id !== inboxId || !state)
            return;
        await this.processInbox(state.val, state.ack);
    }
    async processInbox(val, ack) {
        if (ack)
            return;
        if (this.processingInbox)
            return;
        if (val === null || val === undefined || val === "") {
            return;
        }
        this.processingInbox = true;
        try {
            this.log.info(`command.inbox received: ${typeof val === "object" ? JSON.stringify(val) : String(val)}`);
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
        this.log.info(`command.inbox done: ${outcome.result}` +
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
    async ensureBaseStates() {
        const defs = [
            {
                _id: states_1.STATE.command.inbox,
                common: {
                    name: "Command inbox (JSON)",
                    type: "string",
                    role: "json",
                    read: true,
                    write: true,
                },
            },
            {
                _id: states_1.STATE.command.lastResult,
                common: {
                    name: "Last pipeline result (JSON)",
                    type: "string",
                    role: "json",
                    read: true,
                    write: false,
                },
            },
            {
                _id: states_1.STATE.audit.lastEvent,
                common: {
                    name: "Last audit event (global mirror)",
                    type: "string",
                    role: "json",
                    read: true,
                    write: false,
                },
            },
        ];
        for (const def of defs) {
            await this.setObjectNotExistsAsync(def._id, {
                type: "state",
                common: def.common,
                native: {},
            });
            if (def.defVal !== undefined) {
                const cur = await this.getStateAsync(def._id);
                if (cur?.val === undefined || cur.val === null) {
                    await this.setStateAsync(def._id, { val: def.defVal, ack: true });
                }
            }
        }
    }
    async ensureAddonStates() {
        for (const addonId of registry_1.EMS_ADDON_IDS) {
            const base = `addons.${addonId}`;
            const governed = (0, governance_1.governedAddonByRuntimeId)(addonId);
            await this.ensureState(`${base}.enabled`, {
                name: `${addonId} enabled`,
                type: "boolean",
                role: "switch",
                read: true,
                write: !governed,
                def: true,
            }, true);
            await this.ensureState(`${base}.available`, {
                name: `${addonId} available`,
                type: "boolean",
                role: "state",
                read: true,
                write: true,
                def: true,
            }, true);
            await this.ensureState(`${base}.mode`, {
                name: `${addonId} Ausführung (dryrun|live)`,
                type: "string",
                role: "text",
                read: true,
                write: true,
                def: "dryrun",
            }, "dryrun");
        }
    }
    async ensureWallboxMapping() {
        await (0, mapping_sync_1.ensureAddonMappingStates)(this, "wallbox", mapping_config_1.WALLBOX_ALL_MAPPING_IDS);
        await (0, mapping_sync_1.syncNativeMappingToStates)(this, "wallbox", mapping_config_1.wallboxMappingFromConfig);
    }
    async ensureState(relativeId, common, defaultVal) {
        await this.setObjectNotExistsAsync(relativeId, {
            type: "state",
            common,
            native: {},
        });
        if (defaultVal !== undefined) {
            const cur = await this.getStateAsync(relativeId);
            if (cur?.val === undefined || cur.val === null || cur.val === "") {
                await this.setStateAsync(relativeId, { val: defaultVal, ack: true });
            }
        }
    }
}
if (module !== undefined && module.parent) {
    module.exports = (options) => new Ems(options);
}
else {
    new Ems();
}
