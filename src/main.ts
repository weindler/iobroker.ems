import * as utils from "@iobroker/adapter-core";
import {
	batteryUnloadRestore,
	handleBatteryAdapterStateChange,
	initBatteryModule,
	stopBatteryModule,
} from "./addons/battery";
import {
	handleImmersionHeaterStateChange,
	initImmersionHeaterModule,
	stopImmersionHeaterModule,
} from "./addons/immersion_heater";
import { initDynamicTariffModule } from "./addons/dynamic_tariff";
import { recordWallboxPipelineResult } from "./addons/wallbox/failsafe";
import {
	handleWallboxForeignStateChange,
	initWallboxModule,
	stopWallboxModule,
} from "./addons/wallbox";
import { touchEmsActivity } from "./ems_activity";
import { startFailsafeRunner, stopFailsafeRunner } from "./failsafe_runner";
import { EMS_ADDON_IDS } from "./addons/registry";
import { ensureAddonGovernanceStates, governedAddonByRuntimeId, syncAddonGovernanceFromConfig } from "./addons/governance";
import { writeDryrunMirror } from "./dryrun_mirror";
import {
	ensureChannelTree,
	ensureGlobalExecutionStates,
	isLiveWriteAllowed,
	syncExecutionModesFromConfig,
} from "./execution_mode";
import { parseInboxValue } from "./inbox";
import { goeWallboxTemplateFlat, wallboxMappingFromConfig, WALLBOX_ALL_MAPPING_IDS } from "./mapping_config";
import { ensureAddonMappingStates, syncNativeMappingToStates } from "./mapping_sync";
import { initEmsLightPhase1, stopEmsLightPhase1 } from "./ems_light";
import { handleEnergyDailyRollupStateChange } from "./learning/energy_daily_rollup";
import { handlePowerRollupStateChange } from "./learning/power_rollup";
import { handleGlobalModesStateChange } from "./policy";
import { handleIntentStateChange } from "./intent";
import { runCommandPipeline } from "./pipeline";
import { ensureWallboxStatusStates } from "./status_wallbox";
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
		this.on("message", (obj) => this.onMessage(obj));
	}

	private onMessage(obj: ioBroker.Message): void {
		const msg = obj as ioBroker.Message & {
			command?: string;
			callback?: (result: Record<string, string | boolean>) => void;
		};
		if (msg.command !== "applyGoeTemplate") {
			return;
		}
		msg.callback?.(goeWallboxTemplateFlat());
	}

	/**
	 * Init-Schritt isoliert ausführen: Ein Fehler in einem Modul (z. B. einem
	 * Add-on) darf nie die übrigen Module oder das Learning blockieren.
	 */
	private async step(label: string, fn: () => Promise<unknown>, timeoutMs = 30_000): Promise<void> {
		const started = Date.now();
		this.log.info(`init step '${label}' starting`);
		let timedOut = false;
		let timer: NodeJS.Timeout | null = null;
		try {
			await Promise.race([
				fn().catch((e) => {
					if (timedOut) {
						this.log.error(`init step '${label}' failed after timeout: ${e instanceof Error ? (e.stack ?? e.message) : e}`);
						return;
					}
					throw e;
				}),
				new Promise<void>((resolve) => {
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
				this.log.info(`init step '${label}' ok (${Date.now() - started}ms)`);
			}
		} catch (e) {
			if (timer) {
				clearTimeout(timer);
			}
			this.log.error(`init step '${label}' failed: ${e instanceof Error ? (e.stack ?? e.message) : e}`);
		}
	}

	private async onReady(): Promise<void> {
		const adapterConfig =
			this.config && typeof this.config === "object" ? (this.config as Record<string, unknown>) : {};

		await this.step("channel tree", () => ensureChannelTree(this.setObjectNotExistsAsync.bind(this)));
		await this.step("base states", () => this.ensureBaseStates());
		await this.step("global execution states", () => ensureGlobalExecutionStates(this));
		await this.step("addon states", () => this.ensureAddonStates());
		await this.step("governance states", () => ensureAddonGovernanceStates(this));
		await this.step("sync governance", () => syncAddonGovernanceFromConfig(this, adapterConfig));
		await this.step("sync execution modes", () => syncExecutionModesFromConfig(this, adapterConfig));
		await this.step("wallbox mapping", () => this.ensureWallboxMapping());
		await this.step("wallbox status states", () => ensureWallboxStatusStates(this));
		await this.step("wallbox module", () => initWallboxModule(this));
		await this.step("battery module", () => initBatteryModule(this));
		await this.step("immersion heater module", () => initImmersionHeaterModule(this));
		await this.step("dynamic tariff module", () => initDynamicTariffModule(this));
		await this.step("failsafe runner", async () => startFailsafeRunner(this));
		// EMS-Light/Learning explizit isoliert: muss unabhängig von Add-on-Fehlern laufen.
		await this.step("ems-light phase 1 (learning)", () => initEmsLightPhase1(this), 45_000);
		await this.step("subscribe command inbox", () => this.subscribeStatesAsync(STATE.command.inbox));

		this.log.info("EMS adapter ready — Failsafe Heizstab/Batterie/Wallbox (nur Live)");

		await this.step("process pending inbox", async () => {
			const inbox = await this.getStateAsync(STATE.command.inbox);
			if (inbox && !inbox.ack && inbox.val != null) {
				this.log.info("Processing pending command.inbox on start");
				await this.processInbox(inbox.val, inbox.ack);
			}
		});
	}

	private onUnload(callback: () => void): void {
		stopEmsLightPhase1();
		void batteryUnloadRestore(this as ioBroker.Adapter & { config: unknown }).catch(() => undefined);
		stopBatteryModule(null);
		stopImmersionHeaterModule();
		stopWallboxModule();
		stopFailsafeRunner();
		callback();
	}

	private async onStateChange(id: string, state: ioBroker.State | null): Promise<void> {
		if (state) {
			handleBatteryAdapterStateChange(this, id);
			handleImmersionHeaterStateChange(this, id);
			handleGlobalModesStateChange(this.namespace, id);
			handleIntentStateChange(this.namespace, id, state);
			handleWallboxForeignStateChange(this.namespace, id);
			handlePowerRollupStateChange(id, state);
			handleEnergyDailyRollupStateChange(id, state);
		}
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

		touchEmsActivity();

		const outcome = await runCommandPipeline(intent, {
			getState: (relativeId) => this.getStateAsync(relativeId),
			setForeignState: async (stateId, value) => {
				await this.setForeignStateAsync(stateId, { val: value, ack: true });
			},
			isLiveAllowed: (addonId) => isLiveWriteAllowed((id) => this.getStateAsync(id), addonId),
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

		const cfg =
			this.config && typeof this.config === "object"
				? (this.config as Record<string, unknown>)
				: {};
		recordWallboxPipelineResult(cfg, intent, outcome);

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
			const governed = governedAddonByRuntimeId(addonId);
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

	private async ensureWallboxMapping(): Promise<void> {
		await ensureAddonMappingStates(this, "wallbox", WALLBOX_ALL_MAPPING_IDS);
		await syncNativeMappingToStates(this, "wallbox", wallboxMappingFromConfig);
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
