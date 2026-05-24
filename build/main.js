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
const registry_1 = require("./addons/registry");
const inbox_1 = require("./inbox");
const pipeline_1 = require("./pipeline");
const states_1 = require("./states");
/** go-e wallbox default mapping (instance prefix added at runtime). */
const WALLBOX_MAPPING_DEFAULTS = {
    set_enabled: { target: "go-e.0.allow_charging", allowed_values: "[true,false,0,1]" },
    set_current_a: { target: "go-e.0.ampere" },
    set_charge_power_w: { target: "go-e.0.ampere" },
    set_phase_switch_enabled: {
        target: "go-e.0.phaseSwitchModeEnabled",
        allowed_values: "[true,false]",
    },
};
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
    }
    async onReady() {
        try {
            await this.ensureBaseStates();
            await this.ensureAddonStates();
            await this.ensureWallboxMappingDefaults();
            await this.subscribeStatesAsync(states_1.STATE.command.inbox);
            this.log.info("EMS adapter v0.0.7 ready — dryrun pipeline + mapping, no device writes");
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
        callback();
    }
    async onStateChange(id, state) {
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
        const outcome = await (0, pipeline_1.runCommandPipeline)(intent, {
            getState: (relativeId) => this.getStateAsync(relativeId),
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
            await this.setObjectNotExistsAsync(`dryrun.${intent.addon_id}.last_command`, {
                type: "state",
                common: {
                    name: `Last dryrun command (${intent.addon_id})`,
                    type: "string",
                    role: "json",
                    read: true,
                    write: false,
                },
                native: {},
            });
            await this.setStateAsync(`dryrun.${intent.addon_id}.last_command`, {
                val: JSON.stringify({
                    timestamp: new Date().toISOString(),
                    intent,
                    outcome,
                }),
                ack: true,
            });
        }
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
                _id: states_1.STATE.config.executionEnabled,
                common: {
                    name: "Global execution enabled",
                    type: "boolean",
                    role: "switch",
                    read: true,
                    write: true,
                    def: false,
                },
                defVal: false,
            },
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
            await this.ensureState(`${base}.enabled`, {
                name: `${addonId} enabled`,
                type: "boolean",
                role: "switch",
                read: true,
                write: true,
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
                name: `${addonId} mode (dryrun|live|disabled)`,
                type: "string",
                role: "text",
                read: true,
                write: true,
                def: "dryrun",
            }, "dryrun");
        }
    }
    async ensureWallboxMappingDefaults() {
        for (const [cmd, cfg] of Object.entries(WALLBOX_MAPPING_DEFAULTS)) {
            const base = `mapping.wallbox.${cmd}`;
            await this.ensureState(`${base}.enabled`, {
                name: `wallbox ${cmd} mapping enabled`,
                type: "boolean",
                role: "switch",
                read: true,
                write: true,
                def: true,
            }, true);
            await this.ensureState(`${base}.target_state`, {
                name: `wallbox ${cmd} target state id`,
                type: "string",
                role: "text",
                read: true,
                write: true,
            });
            const cur = await this.getStateAsync(`${base}.target_state`);
            if (!cur?.val || String(cur.val).trim() === "") {
                await this.setStateAsync(`${base}.target_state`, { val: cfg.target, ack: true });
            }
            if (cfg.allowed_values) {
                await this.ensureState(`${base}.allowed_values`, {
                    name: `wallbox ${cmd} allowed values (JSON array)`,
                    type: "string",
                    role: "json",
                    read: true,
                    write: true,
                });
                const av = await this.getStateAsync(`${base}.allowed_values`);
                if (!av?.val || String(av.val).trim() === "") {
                    await this.setStateAsync(`${base}.allowed_values`, {
                        val: cfg.allowed_values,
                        ack: true,
                    });
                }
            }
        }
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
