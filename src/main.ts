import * as utils from "@iobroker/adapter-core";
import { EMS_ADDON_IDS } from "./addons/registry";
import { writeDryrunMirror } from "./dryrun_mirror";
import { parseInboxValue } from "./inbox";
import { runCommandPipeline } from "./pipeline";
import { STATE } from "./states";
import type { CommandIntent } from "./types";

/** go-e wallbox default mapping (instance prefix added at runtime). */
const WALLBOX_MAPPING_DEFAULTS: Record<
	string,
	{ target: string; allowed_values?: string }
> = {
	set_enabled: { target: "go-e.0.allow_charging", allowed_values: "[true,false,0,1]" },
	set_current_a: { target: "go-e.0.ampere" },
	set_charge_power_w: { target: "go-e.0.ampere" },
	set_phase_switch_enabled: {
		target: "go-e.0.phaseSwitchModeEnabled",
		allowed_values: "[true,false]",
	},
};

class Ems extends utils.Adapter {
	private processingInbox = false;

	public constructor(options: Partial<utils.AdapterOptions> = {}) {
		super({
			...options,
			name: "ems",
		});
		this.on("ready", () => void this.onReady());
		this.on("stateChange", (id, state) => void this.onStateChange(id, state ?? null));
		this.on("unload", (callback) => void this.onUnload(callback));
	}

	private async onReady(): Promise<void> {
		try {
			await this.ensureBaseStates();
			await this.ensureAddonStates();
			await this.ensureWallboxMappingDefaults();
			await this.subscribeStatesAsync(STATE.command.inbox);
			this.log.info("EMS adapter v0.0.8 ready — dryrun flat states + mapping, no device writes");

			const inbox = await this.getStateAsync(STATE.command.inbox);
			if (inbox && !inbox.ack && inbox.val != null) {
				this.log.info("Processing pending command.inbox on start");
				await this.processInbox(inbox.val, inbox.ack);
			}
		} catch (e) {
			this.log.error(`onReady failed: ${e}`);
		}
	}

	private onUnload(callback: () => void): void {
		callback();
	}

	private async onStateChange(id: string, state: ioBroker.State | null): Promise<void> {
		const inboxId = `${this.namespace}.${STATE.command.inbox}`;
		if (id !== inboxId || !state) return;
		await this.processInbox(state.val, state.ack);
	}

	private async processInbox(val: unknown, ack: boolean | undefined): Promise<void> {
		if (ack) return;
		if (this.processingInbox) return;
		if (val === null || val === undefined || val === "") {
			return;
		}

		this.processingInbox = true;
		try {
			this.log.info(`command.inbox received: ${typeof val === "object" ? JSON.stringify(val) : String(val)}`);
			await this.handleInbox(val);
			await this.setStateAsync(STATE.command.inbox, {
				val: val as ioBroker.State["val"],
				ack: true,
			});
		} catch (e) {
			this.log.error(`handleInbox: ${e}`);
		} finally {
			this.processingInbox = false;
		}
	}

	private async handleInbox(val: unknown): Promise<void> {
		const intent = parseInboxValue(val);

		if (!intent) {
			const outcome = {
				result: "invalid_command" as const,
				reason: "json_parse",
				checks_passed: [] as string[],
				checks_failed: ["parse"] as string[],
			};
			await this.writeAudit({ ...outcome, intent: null });
			await this.setStateAsync(STATE.command.lastResult, {
				val: JSON.stringify(outcome),
				ack: true,
			});
			this.log.warn("command.inbox: invalid JSON");
			return;
		}

		const outcome = await runCommandPipeline(intent, {
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

		await this.setStateAsync(STATE.command.lastResult, {
			val: JSON.stringify(outcome),
			ack: true,
		});

		if (intent.addon_id) {
			await writeDryrunMirror(this, intent.addon_id, intent, outcome);
		}

		this.log.info(
			`command.inbox done: ${outcome.result}` +
				(outcome.target_state ? ` → ${outcome.target_state}` : ""),
		);
	}

	private async writeAudit(payload: Record<string, unknown>): Promise<void> {
		const event = {
			timestamp: new Date().toISOString(),
			...payload,
		};
		await this.setStateAsync(STATE.audit.lastEvent, {
			val: JSON.stringify(event),
			ack: true,
		});
		const addonId = (payload.intent as CommandIntent | null)?.addon_id;
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

	private async ensureBaseStates(): Promise<void> {
		const defs: Array<{ _id: string; common: ioBroker.StateCommon; defVal?: ioBroker.StateValue }> = [
			{
				_id: STATE.config.executionEnabled,
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
				_id: STATE.command.inbox,
				common: {
					name: "Command inbox (JSON)",
					type: "string",
					role: "json",
					read: true,
					write: true,
				},
			},
			{
				_id: STATE.command.lastResult,
				common: {
					name: "Last pipeline result (JSON)",
					type: "string",
					role: "json",
					read: true,
					write: false,
				},
			},
			{
				_id: STATE.audit.lastEvent,
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

	private async ensureAddonStates(): Promise<void> {
		for (const addonId of EMS_ADDON_IDS) {
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

	private async ensureWallboxMappingDefaults(): Promise<void> {
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

	private async ensureState(
		relativeId: string,
		common: ioBroker.StateCommon,
		defaultVal?: ioBroker.StateValue,
	): Promise<void> {
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
	module.exports = (options?: Partial<utils.AdapterOptions>): Ems => new Ems(options);
} else {
	new Ems();
}
