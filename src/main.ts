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
					const ready = (await this.getStateAsync("backup.export_register_ready"))?.val === true;
					const payload = {
						result: err ? "error" : "ok",
						fileName: file,
						error: err,
						exportRegisterReady: ready,
						hint: "Host: ems-runtime.%INSTANCE%/exports/backup/ — zusätzlich unter Adapter-Dateien backup/ (Admin Download)",
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
			return;
		}
		if (obj.command === "startDiagnosticMode") {
			void (async () => {
				try {
					const msg = (obj.message && typeof obj.message === "object" ? obj.message : {}) as {
						durationMin?: number | string;
						diagnostic_duration_min?: number | string;
					};
					const raw = msg.durationMin ?? msg.diagnostic_duration_min ?? 60;
					const durationMin = typeof raw === "number" ? raw : Number(raw);
					const { handleDiagnosticModeRequest, syncDiagnosticStatus } = await import(
						"./backup/export_handler.js"
					);
					const started = await handleDiagnosticModeRequest(this, true, false, durationMin);
					await syncDiagnosticStatus(this);
					if (obj.callback) {
						if (started.ok) {
							this.sendTo(
								obj.from,
								obj.command,
								{
									result: "ok",
									active: true,
									durationMin: started.durationMin,
									expiresAt: started.expiresAt,
									hint: `Diagnosemodus ${started.durationMin} Min — endet automatisch ${started.expiresAt}`,
								},
								obj.callback,
							);
						} else {
							this.sendTo(
								obj.from,
								obj.command,
								{ result: "error", error: started.error },
								obj.callback,
							);
						}
					}
				} catch (e) {
					const error = e instanceof Error ? e.message : String(e);
					this.log.error(`startDiagnosticMode: ${error}`);
					if (obj.callback) {
						this.sendTo(obj.from, obj.command, { result: "error", error }, obj.callback);
					}
				}
			})();
			return;
		}
		if (obj.command === "stopDiagnosticMode") {
			void (async () => {
				try {
					const { handleDiagnosticStopRequest } = await import("./backup/export_handler.js");
					const stopped = await handleDiagnosticStopRequest(this);
					if (obj.callback) {
						this.sendTo(
							obj.from,
							obj.command,
							{
								result: "ok",
								active: false,
								wasActive: stopped.wasActive,
								hint: stopped.wasActive
									? "Diagnosemodus manuell beendet"
									: "Diagnosemodus war bereits aus",
							},
							obj.callback,
						);
					}
				} catch (e) {
					const error = e instanceof Error ? e.message : String(e);
					if (obj.callback) {
						this.sendTo(obj.from, obj.command, { result: "error", error }, obj.callback);
					}
				}
			})();
			return;
		}
		if (obj.command === "getDiagnosticModeStatus") {
			void (async () => {
				try {
					const { syncDiagnosticStatus } = await import("./backup/export_handler.js");
					const { diagnosticModeStatus } = await import("./support/diagnostic_mode.js");
					await syncDiagnosticStatus(this);
					const st = diagnosticModeStatus();
					if (obj.callback) {
						this.sendTo(
							obj.from,
							obj.command,
							{
								result: "ok",
								active: st.active,
								expiresAt: st.expiresAt,
								hint: st.active
									? `Aktiv — endet automatisch ${st.expiresAt}`
									: "Inaktiv (Auto-Ende oder gestoppt)",
							},
							obj.callback,
						);
					}
				} catch (e) {
					const error = e instanceof Error ? e.message : String(e);
					if (obj.callback) {
						this.sendTo(obj.from, obj.command, { result: "error", error }, obj.callback);
					}
				}
			})();
			return;
		}
		if (obj.command === "requestSupportExport") {
			void (async () => {
				try {
					const { handleSupportExportRequest } = await import("./backup/export_handler.js");
					await handleSupportExportRequest(this, true, false);
					const file = String((await this.getStateAsync("backup.last_file_name"))?.val ?? "");
					const err = String((await this.getStateAsync("backup.last_error"))?.val ?? "");
					const { readSupportFileBase64 } = await import("./backup/admin_files.js");
					const dl = err ? null : await readSupportFileBase64(this, file);
					const payload: Record<string, unknown> = {
						result: err ? "error" : "ok",
						fileName: file,
						error: err,
						hint: "Host: exports/support/ — Download: Adapter-Dateien support/ oder data-URL (klein)",
					};
					// Admin sendTo openUrl: Browser speichert/öffnet die Datei (nur wenn nicht zu groß).
					if (dl && dl.ok && dl.sizeBytes <= 6_000_000) {
						payload.openUrl = `data:application/octet-stream;base64,${dl.base64}`;
						payload.window = "_blank";
						payload.downloadFileName = dl.fileName;
						payload.base64 = dl.base64;
						payload.mimeType = dl.mimeType;
						payload.sizeBytes = dl.sizeBytes;
					} else if (dl && dl.ok) {
						payload.hint =
							`Datei ${dl.fileName} (${dl.sizeBytes} Bytes) — zu groß für Direkt-Download; unter Adapter-Dateien → support/ herunterladen`;
					}
					if (obj.callback) {
						this.sendTo(obj.from, obj.command, payload, obj.callback);
					}
				} catch (e) {
					const error = e instanceof Error ? e.message : String(e);
					this.log.error(`requestSupportExport: ${error}`);
					if (obj.callback) {
						this.sendTo(obj.from, obj.command, { result: "error", error }, obj.callback);
					}
				}
			})().catch((e) => {
				this.log.error(
					`requestSupportExport unhandled: ${e instanceof Error ? e.message : String(e)}`,
				);
			});
			return;
		}
		if (obj.command === "listRestoreFiles" || obj.command === "syncRestoreInbox") {
			void (async () => {
				try {
					const { listRestoreFileOptions } = await import("./backup/admin_files.js");
					const options = await listRestoreFileOptions(this);
					if (obj.callback) {
						if (obj.command === "syncRestoreInbox") {
							const files = options.filter((o) => o.value).map((o) => o.value);
							this.sendTo(
								obj.from,
								obj.command,
								{
									result: files.length ? "ok" : "empty",
									files,
									hint: files.length
										? `${files.length} Datei(en) verfügbar — unten „Backup-Datei wählen“`
										: "Keine .emsbackup — zuerst Export oder Upload",
								},
								obj.callback,
							);
						} else {
							this.sendTo(obj.from, obj.command, options, obj.callback);
						}
					}
				} catch (e) {
					this.log.warn(`listRestoreFiles: ${e instanceof Error ? e.message : String(e)}`);
					if (obj.callback) {
						if (obj.command === "syncRestoreInbox") {
							this.sendTo(
								obj.from,
								obj.command,
								{ result: "error", error: e instanceof Error ? e.message : String(e) },
								obj.callback,
							);
						} else {
							this.sendTo(obj.from, obj.command, [{ label: "Fehler beim Lesen", value: "" }], obj.callback);
						}
					}
				}
			})();
			return;
		}
		if (obj.command === "restoreUploadToInbox") {
			void (async () => {
				try {
					const msg = (obj.message && typeof obj.message === "object" ? obj.message : {}) as {
						fileName?: string;
						data?: string;
						restore_upload?: string;
					};
					const data = String(msg.data ?? msg.restore_upload ?? "");
					const { writeRestoreUploadToInbox } = await import("./backup/admin_files.js");
					const res = await writeRestoreUploadToInbox(this, String(msg.fileName ?? ""), data);
					if (res.ok) {
						await this.setStateAsync("backup.restore.selected_file", { val: res.fileName, ack: true });
					}
					if (obj.callback) {
						this.sendTo(obj.from, obj.command, res, obj.callback);
					}
				} catch (e) {
					const error = e instanceof Error ? e.message : String(e);
					if (obj.callback) {
						this.sendTo(obj.from, obj.command, { ok: false, error }, obj.callback);
					}
				}
			})();
			return;
		}
		if (obj.command === "restoreValidate") {
			void (async () => {
				try {
					const msg = (obj.message && typeof obj.message === "object" ? obj.message : {}) as {
						file?: string;
						restore_selected_file?: string;
					};
					const fileName = String(msg.file ?? msg.restore_selected_file ?? "").trim();
					if (!fileName) {
						if (obj.callback) {
							this.sendTo(obj.from, obj.command, { result: "error", error: "no_file_selected" }, obj.callback);
						}
						return;
					}
					await this.setStateAsync("backup.restore.selected_file", { val: fileName, ack: true });
					const { handleRestoreValidateRequest } = await import("./restore/handler.js");
					await handleRestoreValidateRequest(this, true, false);
					const status = String((await this.getStateAsync("backup.restore.status"))?.val ?? "");
					const planId = String((await this.getStateAsync("backup.restore.plan_id"))?.val ?? "");
					const err = String((await this.getStateAsync("backup.restore.last_error"))?.val ?? "");
					const summary = String((await this.getStateAsync("backup.restore.summary_json"))?.val ?? "");
					if (obj.callback) {
						this.sendTo(
							obj.from,
							obj.command,
							{
								result: status === "ready" ? "ok" : "error",
								status,
								planId,
								error: err,
								summaryJson: summary,
								hint: planId
									? `Validierung ok. Danach „Restore ausführen“ — Plan-ID wird automatisch verwendet (${planId}).`
									: "Validierung fehlgeschlagen",
							},
							obj.callback,
						);
					}
				} catch (e) {
					const error = e instanceof Error ? e.message : String(e);
					if (obj.callback) {
						this.sendTo(obj.from, obj.command, { result: "error", error }, obj.callback);
					}
				}
			})();
			return;
		}
		if (obj.command === "getAiStatus") {
			void (async () => {
				try {
					const { AI_STATES } = await import("./ai/index.js");
					const status = String((await this.getStateAsync(AI_STATES.status))?.val ?? "off");
					const callsToday = Number((await this.getStateAsync(AI_STATES.callsToday))?.val ?? 0);
					const callsLimit = Number((await this.getStateAsync(AI_STATES.callsLimit))?.val ?? 0);
					const costToday = Number((await this.getStateAsync(AI_STATES.costEstimateTodayEur))?.val ?? 0);
					const lastRunAt = String((await this.getStateAsync(AI_STATES.lastRunAt))?.val ?? "");
					const lastReason = String((await this.getStateAsync(AI_STATES.lastReasonDe))?.val ?? "");
					if (obj.callback) {
						this.sendTo(
							obj.from,
							obj.command,
							{
								result: "ok",
								status,
								hint:
									`Status: ${status} — Aufrufe heute: ${callsToday}/${callsLimit} — ` +
									`≈ ${costToday.toFixed(4)} € heute${lastRunAt ? ` — letzter Lauf ${lastRunAt}` : ""}` +
									(lastReason ? ` — ${lastReason}` : ""),
							},
							obj.callback,
						);
					}
				} catch (e) {
					const error = e instanceof Error ? e.message : String(e);
					if (obj.callback) {
						this.sendTo(obj.from, obj.command, { result: "error", error }, obj.callback);
					}
				}
			})();
			return;
		}
		if (obj.command === "aiOptimizeNow") {
			void (async () => {
				try {
					const { runAiOptimizationManual } = await import("./ai/index.js");
					const outcome = await runAiOptimizationManual(this as unknown as Parameters<typeof runAiOptimizationManual>[0]);
					if (obj.callback) {
						this.sendTo(
							obj.from,
							obj.command,
							{
								result: outcome.status === "ready" || outcome.status === "error" ? "ok" : "skipped",
								status: outcome.status,
								hint: outcome.reasonDe,
							},
							obj.callback,
						);
					}
				} catch (e) {
					const error = e instanceof Error ? e.message : String(e);
					this.log.error(`aiOptimizeNow: ${error}`);
					if (obj.callback) {
						this.sendTo(obj.from, obj.command, { result: "error", error }, obj.callback);
					}
				}
			})();
			return;
		}
		if (obj.command === "getPlanCompareStatus") {
			void (async () => {
				try {
					const { COMPARE_STATES } = await import("./ai/compare/index.js");
					const generatedAt = String((await this.getStateAsync(COMPARE_STATES.generatedAt))?.val ?? "");
					const activePlan = String((await this.getStateAsync(COMPARE_STATES.activePlan))?.val ?? "a");
					const deltaRaw = (await this.getStateAsync(COMPARE_STATES.deltaSummaryJson))?.val;
					let deltaHint = "Noch kein Vergleich berechnet.";
					if (typeof deltaRaw === "string" && deltaRaw) {
						try {
							const delta = JSON.parse(deltaRaw) as {
								decisionReasonDe?: string;
								deltaCostCt?: number;
								aiInvolvedAddonIds?: string[];
							};
							deltaHint = delta.decisionReasonDe ?? deltaHint;
						} catch {
							// deltaHint bleibt Default
						}
					}
					if (obj.callback) {
						this.sendTo(
							obj.from,
							obj.command,
							{
								result: "ok",
								activePlan,
								hint:
									`Rechnerisch günstiger: Plan ${activePlan.toUpperCase()} — ${deltaHint}` +
									(generatedAt ? ` — berechnet ${generatedAt}` : ""),
							},
							obj.callback,
						);
					}
				} catch (e) {
					const error = e instanceof Error ? e.message : String(e);
					if (obj.callback) {
						this.sendTo(obj.from, obj.command, { result: "error", error }, obj.callback);
					}
				}
			})();
			return;
		}
		if (obj.command === "restoreApply") {
			void (async () => {
				try {
					const msg = (obj.message && typeof obj.message === "object" ? obj.message : {}) as {
						file?: string;
						restore_selected_file?: string;
						planId?: string;
						restore_confirm_plan_id?: string;
					};
					const fileName = String(msg.file ?? msg.restore_selected_file ?? "").trim();
					let planId = String(msg.planId ?? msg.restore_confirm_plan_id ?? "").trim();
					if (!fileName) {
						if (obj.callback) {
							this.sendTo(
								obj.from,
								obj.command,
								{ result: "error", error: "no_file_selected" },
								obj.callback,
							);
						}
						return;
					}
					if (!planId) {
						const status = String((await this.getStateAsync("backup.restore.status"))?.val ?? "");
						const stored = String((await this.getStateAsync("backup.restore.plan_id"))?.val ?? "").trim();
						if (status === "ready" && stored) {
							planId = stored;
						}
					}
					if (!planId) {
						if (obj.callback) {
							this.sendTo(
								obj.from,
								obj.command,
								{
									result: "error",
									error: "zuerst „Backup validieren“ — danach Restore ohne Plan-ID-Feld",
								},
								obj.callback,
							);
						}
						return;
					}
					await this.setStateAsync("backup.restore.selected_file", { val: fileName, ack: true });
					await this.setStateAsync("backup.restore.confirm_plan_id", { val: planId, ack: true });
					const { handleRestoreApplyRequest } = await import("./restore/handler.js");
					await handleRestoreApplyRequest(this, true, false);
					const status = String((await this.getStateAsync("backup.restore.status"))?.val ?? "");
					const err = String((await this.getStateAsync("backup.restore.last_error"))?.val ?? "");
					if (obj.callback) {
						this.sendTo(
							obj.from,
							obj.command,
							{
								result: status.startsWith("success") ? "ok" : "error",
								status,
								error: err,
								hint: status.startsWith("success")
									? "Restore ok — Adapter-Neustart erforderlich (dryrun)."
									: err || status,
							},
							obj.callback,
						);
					}
				} catch (e) {
					const error = e instanceof Error ? e.message : String(e);
					if (obj.callback) {
						this.sendTo(obj.from, obj.command, { result: "error", error }, obj.callback);
					}
				}
			})();
			return;
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

		// Clear restore/stateChange gate BEFORE optional inits that can time out —
		// otherwise execution-mode / rearm handlers stay dead for the whole process.
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

		await this.step("backup export init", async () => {
			await cleanupTempExports(this);
			const { ensureAdapterFilesMeta } = await import("./backup/admin_files.js");
			await ensureAdapterFilesMeta(this);
			await initBackupExportRuntime(this);
			await initRestoreRuntime(this);
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
			const { isAiRelatedState, handleAiStateChange } = await import("./ai/index.js");
			if (isAiRelatedState(rel)) {
				await handleAiStateChange(this as unknown as Parameters<typeof handleAiStateChange>[0], rel, state.val, state.ack);
				return;
			}
			await handleExecutionModeStateChange(this, id, state);
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
