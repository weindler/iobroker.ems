import * as utils from "@iobroker/adapter-core";
import {
	handleBatteryAdapterStateChange,
	handleBatteryGridBalanceForeignStateChange,
	batteryUnloadRestore,
	stopBatteryModule,
} from "./addons/battery";
import {
	handleAirConditioningStateChange,
	stopAirConditioningModule,
} from "./addons/air_conditioning";
import {
	handleImmersionHeaterStateChange,
	stopImmersionHeaterModule,
} from "./addons/immersion_heater";
import { recordWallboxPipelineResult } from "./addons/wallbox/failsafe";
import {
	handleWallboxForeignStateChange,
	handleWallboxStateChange,
	stopWallboxModule,
} from "./addons/wallbox";
import { touchEmsActivity } from "./ems_activity";
import { stopFailsafeRunner } from "./failsafe_runner";
import { writeDryrunMirror } from "./dryrun_mirror";
import {
	handleExecutionModeStateChange,
	isLiveWriteAllowed,
} from "./execution_mode";
import { isBootstrapComplete } from "./bootstrap/barrier";
import { runAdapterBootstrap } from "./bootstrap/startup";
import { handleBackupStateChange, initBackupExportRuntime, isBackupRelatedState, stopDiagnosticMode } from "./backup/export_handler";
import { handleRestoreStateChange, initRestoreRuntime, isRestoreRelatedState } from "./restore/handler";
import { runRestoreStartupRecovery, clearRestoreRestartRequiredAfterBootstrap } from "./restore/startup_recovery";
import { isRestoreInProgress } from "./restore/barrier";
import { cleanupTempExports } from "./backup/retention";
import {
	runBackupIntegrationStartup,
	updateBootGuardAfterBootstrap,
	getBackupIntegrationContext,
} from "./backup_integration/startup";
import { markBootstrapCompletedForRearm, captureExecutionModeBaselineFromHost } from "./backup_integration/startup_rearm";
import { EXECUTION_MODE_ADDON_IDS } from "./execution_mode";
import { GLOBAL, addonMode } from "./tree_paths";
import { parseInboxValue } from "./inbox";
import { goeWallboxTemplateFlat } from "./mapping_config";
import { stopEmsLightPhase1 } from "./ems_light";
import { handlePlannerShadowStateChange, observePlannerTriggerStateChange } from "./planner_shadow/runtime";
import { handleEnergyDailyRollupStateChange } from "./learning/energy_daily_rollup";
import { handlePowerRollupStateChange } from "./learning/power_rollup";
import { handleGlobalModesStateChange } from "./policy";
import { handleIntentStateChange } from "./intent";
import { runCommandPipeline } from "./pipeline";
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
		if (!obj?.command) {
			return;
		}
		if (obj.command === "applyGoeTemplate") {
			// obj.callback is an ioBroker message token (string), not a JS function.
			if (obj.callback) {
				this.sendTo(obj.from, obj.command, goeWallboxTemplateFlat(), obj.callback);
			}
			return;
		}
		if (obj.command === "requestBackupExport") {
			void (async () => {
				try {
					const { handleBackupExportRequest } = await import("./backup/export_handler.js");
					await handleBackupExportRequest(this, true, false);
					const file = String((await this.getStateAsync("backup.last_file_name"))?.val ?? "");
					const err = String((await this.getStateAsync("backup.last_error"))?.val ?? "");
					const ready = (await this.getStateAsync("info.backup.export_register_ready"))?.val === true;
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
				} catch (e) {
					const error = e instanceof Error ? e.message : String(e);
					this.log.error(`requestBackupExport: ${error}`);
					if (obj.callback) {
						this.sendTo(obj.from, obj.command, { result: "error", error }, obj.callback);
					}
				}
			})().catch((e) => {
				this.log.error(
					`requestBackupExport unhandled: ${e instanceof Error ? e.message : String(e)}`,
				);
			});
		}
	}

	/**
	 * Init-Schritt isoliert ausführen: Ein Fehler in einem Modul (z. B. einem
	 * Add-on) darf nie die übrigen Module oder das Learning blockieren.
	 */
	private async step(label: string, fn: () => Promise<unknown>, timeoutMs = 30_000): Promise<void> {
		const started = Date.now();
		this.log.debug(`init step '${label}' starting`);
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
				this.log.debug(`init step '${label}' ok (${Date.now() - started}ms)`);
			}
		} catch (e) {
			if (timer) {
				clearTimeout(timer);
			}
			this.log.error(`init step '${label}' failed: ${e instanceof Error ? (e.stack ?? e.message) : e}`);
		}
	}

	private async onReady(): Promise<void> {
		const integrationCtx = await runBackupIntegrationStartup(this);

		const recovery = await runRestoreStartupRecovery(this);
		if (!recovery.ok) {
			this.log.error(`Restore startup recovery failed: ${recovery.error}`);
			return;
		}

		await runAdapterBootstrap(this, this.step.bind(this));

		if (!isBootstrapComplete()) {
			this.log.warn("EMS adapter: Bootstrap unvollständig — Geräte-Runtime bleibt gesperrt");
			return;
		}

		this.log.info("EMS adapter ready — Failsafe Heizstab/Batterie/Wallbox (nur Live)");

		await this.step("backup export init", async () => {
			await cleanupTempExports(this);
			await initBackupExportRuntime(this);
			await initRestoreRuntime(this);
			await clearRestoreRestartRequiredAfterBootstrap(this);
			markBootstrapCompletedForRearm();
			await captureExecutionModeBaselineFromHost(this, [
				GLOBAL.executionMode,
				...EXECUTION_MODE_ADDON_IDS.map((id) => addonMode(id)),
			]);
			const manifest = integrationCtx.manifest ?? getBackupIntegrationContext()?.manifest;
			if (manifest) {
				await updateBootGuardAfterBootstrap(this, manifest);
			}
		});

		await this.step("process pending inbox", async () => {
			const inbox = await this.getStateAsync(STATE.command.inbox);
			if (inbox && !inbox.ack && inbox.val != null) {
				this.log.debug("Processing pending command.inbox on start");
				await this.processInbox(inbox.val, inbox.ack);
			}
		});
	}

	private async onUnload(callback: () => void): Promise<void> {
		stopDiagnosticMode();
		await stopEmsLightPhase1();
		void batteryUnloadRestore(this as ioBroker.Adapter & { config: unknown }).catch(() => undefined);
		stopBatteryModule(null);
		stopImmersionHeaterModule();
		stopAirConditioningModule();
		stopWallboxModule();
		stopFailsafeRunner();
		callback();
	}

	private async onStateChange(id: string, state: ioBroker.State | null): Promise<void> {
		if (!isBootstrapComplete() || isRestoreInProgress()) {
			return;
		}
		if (state) {
			const rel = id.startsWith(`${this.namespace}.`) ? id.slice(this.namespace.length + 1) : id;
			if (isBackupRelatedState(rel)) {
				await handleBackupStateChange(this, rel, state.val, state.ack);
				return;
			}
			if (isRestoreRelatedState(rel)) {
				await handleRestoreStateChange(this, rel, state.val, state.ack);
				return;
			}
			await handleExecutionModeStateChange(this, id, state);
			if (rel === GLOBAL.executionMode) {
				void import("./planner_authorization/runtime.js")
					.then((m) => m.notifyPlannerAuthorizationExecutionMode(String(state.val ?? "dryrun")))
					.catch(() => undefined);
				void import("./planner_authority/runtime.js")
					.then((m) => m.notifyPlannerAuthorityExecutionMode(String(state.val ?? "dryrun")))
					.catch(() => undefined);
			}
			handleBatteryAdapterStateChange(this, id);
			handleBatteryGridBalanceForeignStateChange(this, id);
			handleImmersionHeaterStateChange(this, id);
			handleAirConditioningStateChange(this, id);
			handleGlobalModesStateChange(this.namespace, id);
			handleIntentStateChange(this.namespace, id, state);
			handleWallboxForeignStateChange(this.namespace, id);
			handleWallboxStateChange(this.namespace, id);
			handlePowerRollupStateChange(id, state);
			handleEnergyDailyRollupStateChange(id, state);
			if (await handlePlannerShadowStateChange(this, rel, state.val, state.ack)) {
				return;
			}
			observePlannerTriggerStateChange(rel, state.ack);
		}
		const inboxId = `${this.namespace}.${STATE.command.inbox}`;
		if (id !== inboxId || !state) return;
		await this.processInbox(state.val, state.ack);
	}

	private async processInbox(val: unknown, ack: boolean | undefined): Promise<void> {
		if (ack) return;
		if (isRestoreInProgress()) return;
		if (this.processingInbox) return;
		if (val === null || val === undefined || val === "") {
			return;
		}

		this.processingInbox = true;
		try {
			this.log.debug(`command.inbox received: ${typeof val === "object" ? JSON.stringify(val) : String(val)}`);
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
			getForeignState: (stateId) => this.getForeignStateAsync(stateId),
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

		this.log.debug(
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
}

if (module !== undefined && module.parent) {
	module.exports = (options?: Partial<utils.AdapterOptions>): Ems => new Ems(options);
} else {
	new Ems();
}
