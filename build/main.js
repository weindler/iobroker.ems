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
const inbox_1 = require("./inbox");
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
    }
    async onReady() {
        try {
            await this.ensureBaseStates();
            await this.subscribeStatesAsync(states_1.STATE.command.inbox);
            this.log.info("EMS adapter v0.0.6 ready — dryrun/audit only, no device writes");
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
    instanceId() {
        const parts = this.namespace.split(".");
        return parts[1] ?? "0";
    }
    async onStateChange(id, state) {
        const inboxId = `${this.namespace}.${states_1.STATE.command.inbox}`;
        if (id !== inboxId || !state)
            return;
        await this.processInbox(state.val, state.ack);
    }
    /** Process inbox when ack=false (new command). Ignore ack=true. */
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
        const iid = this.instanceId();
        if (!intent) {
            const outcome = {
                result: "invalid_command",
                reason: "json_parse",
                checks_passed: [],
                checks_failed: ["parse"],
            };
            await this.writeAudit(iid, { ...outcome, intent: null });
            await this.setStateAsync(states_1.STATE.command.lastResult, {
                val: JSON.stringify(outcome),
                ack: true,
            });
            this.log.warn("command.inbox: invalid JSON");
            return;
        }
        const outcome = (0, pipeline_1.runDryrunPipeline)(intent);
        await this.writeAudit(iid, {
            result: outcome.result,
            reason: outcome.reason,
            intent,
            checks_passed: outcome.checks_passed,
            checks_failed: outcome.checks_failed,
        });
        await this.setStateAsync(states_1.STATE.command.lastResult, {
            val: JSON.stringify(outcome),
            ack: true,
        });
        this.log.info(`command.inbox done: ${outcome.result}`);
    }
    async writeAudit(iid, payload) {
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
            if (def._id.endsWith("execution_enabled")) {
                const cur = await this.getStateAsync(def._id);
                if (cur?.val === undefined || cur.val === null) {
                    await this.setStateAsync(def._id, { val: false, ack: true });
                }
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
