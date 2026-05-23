import * as utils from "@iobroker/adapter-core";
import { parseInbox, runDryrunPipeline } from "./pipeline";
import { STATE } from "./states";
import type { CommandIntent } from "./types";

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
			this.log.info("EMS adapter v0.0.5 ready — dryrun/audit only, no device writes");
		} catch (e) {
			this.log.error(`onReady failed: ${e}`);
		}
	}

	private onUnload(callback: () => void): void {
		callback();
	}

	private instanceId(): string {
		const parts = this.namespace.split(".");
		return parts[1] ?? "0";
	}

	private async onStateChange(id: string, state: ioBroker.State | null): Promise<void> {
		// Inbox: process only incoming commands (ack=false from Admin/EMS)
		const inboxId = `${this.namespace}.${STATE.command.inbox}`;
		if (id !== inboxId || !state) return;
		if (state.ack) return;
		if (this.processingInbox) return;

		const raw = state.val;
		if (typeof raw !== "string" || !raw.trim()) return;

		this.processingInbox = true;
		try {
			await this.handleInbox(raw);
			await this.setStateAsync(STATE.command.inbox, { val: raw, ack: true });
		} catch (e) {
			this.log.error(`handleInbox: ${e}`);
		} finally {
			this.processingInbox = false;
		}
	}

	private async handleInbox(raw: string): Promise<void> {
		const intent = parseInbox(raw);
		const iid = this.instanceId();

		if (!intent) {
			await this.writeAudit(iid, {
				result: "invalid_command",
				reason: "json_parse",
				intent: null,
			});
			return;
		}

		const outcome = runDryrunPipeline(intent);
		await this.writeAudit(iid, {
			result: outcome.result,
			reason: outcome.reason,
			intent,
			checks_passed: outcome.checks_passed,
			checks_failed: outcome.checks_failed,
		});

		await this.setStateAsync(STATE.command.lastResult, {
			val: JSON.stringify(outcome),
			ack: true,
		});
	}

	private async writeAudit(
		iid: string,
		payload: Record<string, unknown>,
	): Promise<void> {
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
		const defs: Array<{
			_id: string;
			common: ioBroker.StateCommon;
		}> = [
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
	module.exports = (options?: Partial<utils.AdapterOptions>): Ems => new Ems(options);
} else {
	new Ems();
}
