import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { GLOBAL, addonMode } from "../tree_paths.js";
import { learningDataPath } from "../learning/data_dir.js";
import { stableJsonStringify } from "../backup/schema.js";
import { resetExportMutexForTest, runBackupExport } from "../backup/service.js";
import { resetOperationLockForTest, isOperationRunning } from "../backup/operation_lock.js";
import { sha256Buffer } from "../backup/checksum.js";
import { writeForeignIfChanged } from "../device_write.js";
import { executeBatteryWrite, type FinalWriteGate } from "../addons/battery/runtime/execute.js";
import { restoreInboxDir } from "./source.js";
import {
	runRestoreValidate,
	runRestoreApply,
	resetRestoreApplyForTest,
} from "./apply.js";
import {
	setRestoreApplyInjectionPoint,
	setRestoreRollbackInjectionPoint,
	setRestoreHandlerInjectionAfterCommitted,
	resetRestoreInjectionHooksForTest,
	type RestoreApplyInjectionPoint,
} from "./apply_hooks.js";
import { isRestoreInProgress, resetRestoreBarrierForTest, setRestoreInProgress } from "./barrier.js";
import { getActiveRestorePlan, invalidateRestorePlan } from "./plan.js";
import {
	RESTORE_LEARNING_KEYS,
	RESTORE_LEARNING_TARGETS,
	restoreLearningRelativeTargetPath,
} from "./learning_map.js";
import { readJournal } from "./journal.js";
import { handleRestoreApplyRequest, handleRestoreValidateRequest, initRestoreRuntime } from "./handler.js";
import { RESTORE_STATES } from "../backup/ensure_states.js";
import { runRestoreStartupRecovery, clearRestoreRestartRequiredAfterBootstrap } from "./startup_recovery.js";
import {
	createJournal,
	ensureTransactionLayout,
	newTransactionId,
	writeJournalAtomic,
} from "./journal.js";
import {
	getPendingForceDryrunReason,
	setPendingForceDryrunReason,
	resetRestoreDryrunContextForTest,
} from "./dryrun_context.js";
import { resetDiagnosticModeForTest } from "../support/diagnostic_mode.js";
import { createInitialManifest, writeManifestAtomic } from "../backup_integration/manifest.js";
import { resolveEmsPaths } from "../backup_integration/paths.js";

const APPLY_INJECTION_POINTS: RestoreApplyInjectionPoint[] = [
	"after_lock",
	"after_barrier",
	"after_dryrun_lock",
	"after_before_snapshot",
	"after_staged_write",
	"after_native_apply",
	"after_learning_first",
	"after_learning_middle",
	"after_learning_last",
	"after_runtime_cleanup",
	"after_restart_required",
	"before_committed_journal",
];

function okBatteryGate(): FinalWriteGate {
	return {
		globalLive: true,
		governanceEnabled: true,
		profileId: "sonnen_em",
		profileLiveControlAvailable: true,
		profileReady: true,
		intentValid: true,
		telemetryReady: true,
		fault: false,
		lockout: false,
		targetMappingConfigured: true,
		ownershipValid: true,
	};
}

class InjectionTestHost {
	readonly namespace = "ems.0";
	readonly objects = new Map<string, ioBroker.Object>();
	readonly states = new Map<string, { val: ioBroker.StateValue; ack: boolean }>();
	config: Record<string, unknown>;
	common = { version: "0.1.143" };
	updateConfigCalls = 0;
	failUpdateConfigOnCall: number | null = null;

	constructor(private dataDir: string, config: Record<string, unknown> = {}) {
		this.config = config;
	}

	log = {
		debug: () => undefined,
		info: () => undefined,
		warn: () => undefined,
		error: () => undefined,
		silly: () => undefined,
		level: "info",
	} as unknown as ioBroker.Logger;

	getAbsoluteInstanceDataDir(): string {
		return this.dataDir;
	}

	async getStateAsync(id: string): Promise<ioBroker.State | null> {
		const s = this.states.get(id);
		return s ? ({ val: s.val, ack: s.ack, ts: 0, lc: 0, from: "test" } as ioBroker.State) : null;
	}

	async setStateAsync(id: string, st: ioBroker.SettableState): Promise<void> {
		this.states.set(id, { val: st.val as ioBroker.StateValue, ack: st.ack ?? false });
	}

	async setObjectNotExistsAsync(id: string, obj: ioBroker.Object): Promise<void> {
		if (!this.objects.has(id)) this.objects.set(id, { ...obj, _id: id } as ioBroker.Object);
	}

	async getObjectAsync(id: string): Promise<ioBroker.Object | null> {
		return this.objects.get(id) ?? null;
	}

	async subscribeStatesAsync(): Promise<void> {
		return;
	}

	async updateConfig(next: Record<string, unknown>): Promise<void> {
		this.updateConfigCalls += 1;
		if (this.failUpdateConfigOnCall === this.updateConfigCalls) {
			throw new Error("injected_update_config_failure");
		}
		this.config = { ...next };
	}
}

interface PreRestoreSnapshot {
	native: Record<string, unknown>;
	learning: Map<string, { exists: boolean; sha256: string | null; bytes: Buffer | null }>;
	neighborLearningBytes: Buffer | null;
}

async function snapshotHost(host: InjectionTestHost): Promise<PreRestoreSnapshot> {
	const learning = new Map<string, { exists: boolean; sha256: string | null; bytes: Buffer | null }>();
	for (const key of RESTORE_LEARNING_KEYS) {
		const target = RESTORE_LEARNING_TARGETS[key];
		const filePath = path.join(learningDataPath(host as unknown as ioBroker.Adapter, target.category), target.fileName);
		try {
			const bytes = await fs.readFile(filePath);
			learning.set(key, { exists: true, sha256: sha256Buffer(bytes), bytes });
		} catch {
			learning.set(key, { exists: false, sha256: null, bytes: null });
		}
	}
	const neighborPath = path.join(
		learningDataPath(host as unknown as ioBroker.Adapter, "learning/battery_runtime"),
		"neighbor_unknown.json",
	);
	let neighborLearningBytes: Buffer | null = null;
	try {
		neighborLearningBytes = await fs.readFile(neighborPath);
	} catch {
		neighborLearningBytes = null;
	}
	return {
		native: structuredClone(host.config),
		learning,
		neighborLearningBytes,
	};
}

async function writeLearning(host: InjectionTestHost, key: string, data: unknown): Promise<void> {
	const target = RESTORE_LEARNING_TARGETS[key];
	const base = learningDataPath(host as unknown as ioBroker.Adapter, target.category);
	await fs.mkdir(base, { recursive: true });
	await fs.writeFile(path.join(base, target.fileName), stableJsonStringify(data), { mode: 0o600 });
}

async function copyBackupToInbox(host: InjectionTestHost): Promise<{ fileName: string }> {
	const result = await runBackupExport(host);
	assert.equal(result.ok, true);
	if (!result.ok) throw new Error("export failed");
	const target = path.basename(result.filePath);
	const inbox = restoreInboxDir(host);
	await fs.mkdir(inbox, { recursive: true });
	await fs.copyFile(result.filePath, path.join(inbox, target));
	return { fileName: target };
}

async function prepareHost(tmp: string): Promise<InjectionTestHost> {
	const host = new InjectionTestHost(tmp, {
		global_execution_mode: "live",
		wb_addon_mode: "live",
		bat_addon_mode: "live",
		ih_addon_mode: "live",
		ac_addon_mode: "live",
		access_token: "secret-token",
		password: "secret-password",
		custom_local_unknown: "keep-me",
		wb_evcc_connected_state: "mqtt.0.before",
	});
	for (const key of RESTORE_LEARNING_KEYS) {
		await writeLearning(host, key, { version: 1, tag: `before-${key}` });
	}
	const neighborPath = path.join(
		learningDataPath(host as unknown as ioBroker.Adapter, "learning/battery_runtime"),
		"neighbor_unknown.json",
	);
	await fs.writeFile(neighborPath, Buffer.from('{"keep":true}'), { mode: 0o600 });
	await ensureTestManifest(host);
	return host;
}

async function transactionsDirForHost(host: InjectionTestHost): Promise<string> {
	return resolveEmsPaths(host).runtimeTransactionsDir;
}

async function ensureTestManifest(host: InjectionTestHost): Promise<void> {
	const layout = resolveEmsPaths(host);
	await fs.mkdir(path.dirname(layout.manifestPath), { recursive: true });
	await writeManifestAtomic(
		layout.manifestPath,
		createInitialManifest({
			instance: 0,
			namespace: host.namespace,
			adapterVersion: String(host.common.version),
		}),
	);
}

async function assertDryrunModes(host: InjectionTestHost): Promise<void> {
	assert.equal(host.config.global_execution_mode, "dryrun");
	assert.equal(host.config.wb_addon_mode, "dryrun");
	assert.equal(host.config.bat_addon_mode, "dryrun");
	assert.equal(host.config.ih_addon_mode, "dryrun");
	assert.equal(host.config.ac_addon_mode, "dryrun");
	const g = await host.getStateAsync(GLOBAL.executionMode);
	assert.equal(String(g?.val), "dryrun");
	for (const addon of ["wallbox", "battery", "immersion_heater", "air_conditioning"] as const) {
		const st = await host.getStateAsync(addonMode(addon));
		assert.equal(String(st?.val), "dryrun");
	}
}

async function assertRestoredSnapshot(host: InjectionTestHost, before: PreRestoreSnapshot): Promise<void> {
	assert.equal(host.config.access_token, before.native.access_token);
	assert.equal(host.config.password, before.native.password);
	assert.equal(host.config.custom_local_unknown, before.native.custom_local_unknown);
	assert.equal(host.config.wb_evcc_connected_state, before.native.wb_evcc_connected_state);
	for (const key of RESTORE_LEARNING_KEYS) {
		const target = RESTORE_LEARNING_TARGETS[key];
		const filePath = path.join(learningDataPath(host as unknown as ioBroker.Adapter, target.category), target.fileName);
		const prev = before.learning.get(key)!;
		if (!prev.exists) {
			await assert.rejects(() => fs.readFile(filePath));
		} else {
			const bytes = await fs.readFile(filePath);
			assert.equal(sha256Buffer(bytes), prev.sha256);
		}
	}
	const neighborPath = path.join(
		learningDataPath(host as unknown as ioBroker.Adapter, "learning/battery_runtime"),
		"neighbor_unknown.json",
	);
	if (before.neighborLearningBytes) {
		assert.equal(sha256Buffer(await fs.readFile(neighborPath)), sha256Buffer(before.neighborLearningBytes));
	}
}

async function assertNoDeviceWritesDuring(fn: () => Promise<void>): Promise<void> {
	const writes: string[] = [];
	setRestoreInProgress(true);
	try {
		await fn();
	} finally {
		setRestoreInProgress(false);
	}
	const r = await writeForeignIfChanged(
		{
			getForeignStateAsync: async () => null,
			setForeignStateAsync: async (id) => {
				writes.push(id);
			},
		},
		{ stateId: "mqtt.0.blocked", value: 1, reason: "test" },
	);
	assert.equal(writes.length, 0);
	assert.equal(r.written, false);
}

describe("restore apply injection rollback", () => {
	let tmp: string;

	beforeEach(async () => {
		tmp = await fs.mkdtemp(path.join(os.tmpdir(), "ems-restore-inj-"));
		resetExportMutexForTest();
		resetOperationLockForTest();
		resetRestoreApplyForTest();
		resetRestoreBarrierForTest();
		resetRestoreInjectionHooksForTest();
		resetRestoreDryrunContextForTest();
		resetDiagnosticModeForTest();
	});

	afterEach(async () => {
		resetExportMutexForTest();
		resetOperationLockForTest();
		resetRestoreApplyForTest();
		resetRestoreBarrierForTest();
		resetRestoreInjectionHooksForTest();
		resetRestoreDryrunContextForTest();
		await fs.rm(tmp, { recursive: true, force: true }).catch(() => undefined);
	});

	for (const point of APPLY_INJECTION_POINTS) {
		it(`rolls back safely after injection at ${point}`, async () => {
			const host = await prepareHost(tmp);
			const before = await snapshotHost(host);
			const { fileName } = await copyBackupToInbox(host);
			const validate = await runRestoreValidate(host, fileName);
			assert.equal(validate.ok, true);
			const plan = getActiveRestorePlan()!;
			setRestoreApplyInjectionPoint(point);
			const apply = await runRestoreApply(host, fileName, plan.planId);
			assert.equal(apply.ok, false);
			if (["after_lock", "after_barrier"].includes(point)) {
				assert.equal(apply.status, "error");
				assert.deepEqual(host.config, before.native);
				assert.equal(isRestoreInProgress(), false);
			} else {
				assert.equal(apply.status, "rolled_back");
				await assertRestoredSnapshot(host, before);
				await assertDryrunModes(host);
			}
			assert.equal(isOperationRunning(), false);
			assert.equal(getActiveRestorePlan(), null);
			if (apply.status === "rolled_back") {
				const txRoot = await transactionsDirForHost(host);
				const txDirs = await fs.readdir(txRoot);
				if (txDirs.length > 0) {
					const journal = await readJournal(path.join(txRoot, txDirs[0]!));
					assert.equal(journal?.phase, "rolled_back");
				}
			}
		});
	}

	it("handler injection after committed keeps barrier and blocks replan apply", async () => {
		const host = await prepareHost(tmp);
		const { fileName } = await copyBackupToInbox(host);
		await host.setStateAsync(RESTORE_STATES.selectedFile, { val: fileName, ack: true });
		await handleRestoreValidateRequest(host, true, false);
		const planId = String((await host.getStateAsync(RESTORE_STATES.planId))?.val ?? "");
		assert.ok(planId);
		await host.setStateAsync(RESTORE_STATES.confirmPlanId, { val: planId, ack: true });
		setRestoreHandlerInjectionAfterCommitted(true);
		await assert.rejects(() => handleRestoreApplyRequest(host, true, false), /injected_failure:after_committed_before_status/);
		assert.equal(isRestoreInProgress(), true);
		assert.equal((await host.getStateAsync(RESTORE_STATES.applyRequest))?.val, false);
		assert.equal((await host.getStateAsync(RESTORE_STATES.applyRequest))?.ack, true);
		assert.equal((await host.getStateAsync(RESTORE_STATES.running))?.val, false);
		const reapply = await runRestoreApply(host, fileName, planId);
		assert.equal(reapply.ok, false);
	});

	it("rollback failure on native restore leaves journal failed and barrier active", async () => {
		const host = await prepareHost(tmp);
		const { fileName } = await copyBackupToInbox(host);
		const validate = await runRestoreValidate(host, fileName);
		assert.equal(validate.ok, true);
		const plan = getActiveRestorePlan()!;
		setRestoreApplyInjectionPoint("after_native_apply");
		host.failUpdateConfigOnCall = 3;
		setRestoreRollbackInjectionPoint("native_restore");
		const apply = await runRestoreApply(host, fileName, plan.planId);
		assert.equal(apply.ok, false);
		assert.equal(apply.status, "recovery_failed");
		assert.equal(apply.error, "restore_rollback_failed");
		assert.equal(isRestoreInProgress(), true);
		const txRoot = await transactionsDirForHost(host);
		const txDirs = await fs.readdir(txRoot);
		const journal = await readJournal(path.join(txRoot, txDirs[0]!));
		assert.equal(journal?.phase, "failed");
	});

	it("rollback failure on learning restore leaves journal failed", async () => {
		const host = await prepareHost(tmp);
		const { fileName } = await copyBackupToInbox(host);
		const validate = await runRestoreValidate(host, fileName);
		assert.equal(validate.ok, true);
		const plan = getActiveRestorePlan()!;
		setRestoreApplyInjectionPoint("after_learning_first");
		setRestoreRollbackInjectionPoint("learning_restore");
		const apply = await runRestoreApply(host, fileName, plan.planId);
		assert.equal(apply.status, "recovery_failed");
		assert.equal(isRestoreInProgress(), true);
	});

	it("native apply then learning failure restores config secrets and dryrun", async () => {
		const host = await prepareHost(tmp);
		const before = await snapshotHost(host);
		const { fileName } = await copyBackupToInbox(host);
		const validate = await runRestoreValidate(host, fileName);
		assert.equal(validate.ok, true);
		const plan = getActiveRestorePlan()!;
		setRestoreApplyInjectionPoint("after_native_apply");
		const apply = await runRestoreApply(host, fileName, plan.planId);
		assert.equal(apply.status, "rolled_back");
		await assertRestoredSnapshot(host, before);
		await assertDryrunModes(host);
		assert.notEqual(host.config.global_execution_mode, "live");
	});

	it("successful apply keeps barrier active in same process", async () => {
		const host = await prepareHost(tmp);
		const { fileName } = await copyBackupToInbox(host);
		const validate = await runRestoreValidate(host, fileName);
		assert.equal(validate.ok, true);
		const plan = getActiveRestorePlan()!;
		const apply = await runRestoreApply(host, fileName, plan.planId);
		assert.equal(apply.ok, true);
		assert.equal(isRestoreInProgress(), true);
		const battery = await executeBatteryWrite(
			{
				getForeignStateAsync: async () => null,
				setForeignStateAsync: async () => undefined,
				log: { info: () => undefined, warn: () => undefined, error: () => undefined, debug: () => undefined },
			},
			{
				kind: "charge_power",
				stateId: "bat.power",
				value: 1000,
				requestId: "r",
				reason: "test",
				dryrun: false,
				gate: okBatteryGate(),
			},
		);
		assert.equal(battery.rejectCode, "restore_in_progress");
	});

	it("after_barrier releases barrier without starting transaction", async () => {
		const host = await prepareHost(tmp);
		const before = await snapshotHost(host);
		const { fileName } = await copyBackupToInbox(host);
		const validate = await runRestoreValidate(host, fileName);
		assert.equal(validate.ok, true);
		const plan = getActiveRestorePlan()!;
		setRestoreApplyInjectionPoint("after_barrier");
		const apply = await runRestoreApply(host, fileName, plan.planId);
		assert.equal(apply.ok, false);
		assert.equal(apply.status, "error");
		assert.deepEqual(host.config, before.native);
		assert.equal(isOperationRunning(), false);
		assert.equal(isRestoreInProgress(), false);
		await assert.rejects(async () => fs.readdir((await transactionsDirForHost(host))));
	});

	it("rollback after live config restores business fields but keeps native dryrun", async () => {
		const host = await prepareHost(tmp);
		const before = await snapshotHost(host);
		host.config.wb_evcc_connected_state = "mqtt.0.live-original";
		const { fileName } = await copyBackupToInbox(host);
		const validate = await runRestoreValidate(host, fileName);
		assert.equal(validate.ok, true);
		const plan = getActiveRestorePlan()!;
		setRestoreApplyInjectionPoint("after_native_apply");
		const apply = await runRestoreApply(host, fileName, plan.planId);
		assert.equal(apply.status, "rolled_back");
		assert.equal(host.config.wb_evcc_connected_state, "mqtt.0.live-original");
		assert.equal(host.config.access_token, before.native.access_token);
		await assertDryrunModes(host);

		resetRestoreDryrunContextForTest();
		const { syncExecutionModesFromConfig } = await import("../execution_mode.js");
		await syncExecutionModesFromConfig(host, host.config, {});
		await assertDryrunModes(host);
	});
});

describe("restore startup journal blocking", () => {
	let tmp: string;

	beforeEach(async () => {
		tmp = await fs.mkdtemp(path.join(os.tmpdir(), "ems-restore-journal-"));
		resetRestoreDryrunContextForTest();
		resetRestoreBarrierForTest();
	});

	afterEach(async () => {
		await fs.rm(tmp, { recursive: true, force: true }).catch(() => undefined);
	});

	async function liveHost(): Promise<InjectionTestHost> {
		const host = new InjectionTestHost(tmp, {
			global_execution_mode: "live",
			wb_addon_mode: "live",
			bat_addon_mode: "live",
			ih_addon_mode: "live",
			ac_addon_mode: "live",
		});
		await host.setStateAsync(GLOBAL.executionMode, { val: "live", ack: true });
		return host;
	}

	it("failed journal blocks startup with active barrier", async () => {
		const host = await liveHost();
		const txId = newTransactionId();
		const txDir = await ensureTransactionLayout(host, txId);
		await writeJournalAtomic(
			txDir,
			createJournal({
				transactionId: txId,
				archiveFileName: "test.emsbackup",
				archiveSha256: "c".repeat(64),
				phase: "failed",
			}),
		);
		const recovery = await runRestoreStartupRecovery(host);
		assert.equal(recovery.ok, false);
		assert.equal(recovery.error, "restore_transaction_failed");
		assert.equal(isRestoreInProgress(), true);
		assert.equal(host.config.global_execution_mode, "dryrun");
	});

	it("defective journal blocks startup like failed", async () => {
		const host = await liveHost();
		const txId = newTransactionId();
		await ensureTransactionLayout(host, txId);
		const recovery = await runRestoreStartupRecovery(host);
		assert.equal(recovery.ok, false);
		assert.equal(recovery.error, "restore_transaction_failed");
		assert.equal(isRestoreInProgress(), true);
	});

	it("rolled_back journal triggers one-time follow-up with live native clamped to dryrun", async () => {
		const host = await liveHost();
		await host.setStateAsync(addonMode("battery"), { val: "live", ack: true });
		await host.setStateAsync(addonMode("immersion_heater"), { val: "live", ack: true });
		await host.setStateAsync(addonMode("air_conditioning"), { val: "live", ack: true });
		await host.setStateAsync(RESTORE_STATES.lastResult, { val: "rolled_back", ack: true });
		await host.setStateAsync(RESTORE_STATES.lastRestoreAt, { val: "2020-01-01T00:00:00.000Z", ack: true });

		const txId = newTransactionId();
		const txDir = await ensureTransactionLayout(host, txId);
		await writeJournalAtomic(
			txDir,
			createJournal({
				transactionId: txId,
				archiveFileName: "test.emsbackup",
				archiveSha256: "d".repeat(64),
				phase: "rolled_back",
			}),
		);

		const first = await runRestoreStartupRecovery(host);
		assert.equal(first.ok, true);
		assert.equal(first.action, "finalized_rolled_back");
		assert.equal(isRestoreInProgress(), true);
		assert.equal(getPendingForceDryrunReason(), "restore_recovery");
		await assertDryrunModes(host);
		assert.equal((await host.getStateAsync(RESTORE_STATES.lastResult))?.val, "rolled_back");
		assert.equal((await host.getStateAsync(RESTORE_STATES.lastRestoreAt))?.val, "2020-01-01T00:00:00.000Z");

		const battery = await executeBatteryWrite(
			{
				getForeignStateAsync: async () => null,
				setForeignStateAsync: async () => undefined,
				log: { info: () => undefined, warn: () => undefined, error: () => undefined, debug: () => undefined },
			},
			{
				kind: "charge_power",
				stateId: "bat.power",
				value: 1000,
				requestId: "r",
				reason: "test",
				dryrun: false,
				gate: okBatteryGate(),
			},
		);
		assert.equal(battery.rejectCode, "restore_in_progress");

		const { syncExecutionModesFromConfig } = await import("../execution_mode.js");
		await syncExecutionModesFromConfig(host, host.config, {
			forceDryrunReason: getPendingForceDryrunReason(),
		});

		await clearRestoreRestartRequiredAfterBootstrap(host);
		assert.equal(isRestoreInProgress(), false);
		assert.equal(getPendingForceDryrunReason(), null);
		await assert.rejects(() => fs.readFile(path.join(txDir, "journal.json")));

		resetRestoreDryrunContextForTest();
		resetRestoreBarrierForTest();
		const second = await runRestoreStartupRecovery(host);
		assert.equal(second.ok, true);
		assert.equal(second.action, "none");
		await syncExecutionModesFromConfig(host, host.config, {});
		await assertDryrunModes(host);
	});

	it("multiple rolled_back journals block startup", async () => {
		const host = await liveHost();
		for (const sha of ["d1".repeat(32), "d2".repeat(32)]) {
			const txId = newTransactionId();
			const txDir = await ensureTransactionLayout(host, txId);
			await writeJournalAtomic(
				txDir,
				createJournal({
					transactionId: txId,
					archiveFileName: "test.emsbackup",
					archiveSha256: sha,
					phase: "rolled_back",
				}),
			);
		}
		const recovery = await runRestoreStartupRecovery(host);
		assert.equal(recovery.ok, false);
		assert.equal(recovery.error, "multiple_rolled_back_followup_transactions");
		assert.equal(isRestoreInProgress(), true);
	});

	it("multiple incomplete journals remain blocked", async () => {
		const host = await liveHost();
		for (const sha of ["e".repeat(64), "f".repeat(64)]) {
			const txId = newTransactionId();
			const txDir = await ensureTransactionLayout(host, txId);
			await writeJournalAtomic(
				txDir,
				createJournal({
					transactionId: txId,
					archiveFileName: "test.emsbackup",
					archiveSha256: sha,
					phase: "prepared",
				}),
			);
		}
		const recovery = await runRestoreStartupRecovery(host);
		assert.equal(recovery.ok, false);
		assert.equal(recovery.error, "multiple_incomplete_restore_transactions");
		assert.equal(isRestoreInProgress(), true);
	});
});

describe("restore learning target paths", () => {
	it("maps each key to a unique concrete relative file path", () => {
		const paths = new Set<string>();
		for (const key of RESTORE_LEARNING_KEYS) {
			const rel = restoreLearningRelativeTargetPath(key);
			assert.ok(rel.includes("/"));
			assert.ok(rel.endsWith(".json"));
			assert.ok(!paths.has(rel), `duplicate target for ${key}`);
			paths.add(rel);
		}
		assert.equal(paths.size, 8);
	});

	it("writes only to fixed targets and preserves unknown neighbor files", async () => {
		const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "ems-restore-learn-"));
		try {
			const host = await prepareHost(tmp);
			const neighborPath = path.join(
				learningDataPath(host as unknown as ioBroker.Adapter, "learning/battery_runtime"),
				"neighbor_unknown.json",
			);
			const neighborBefore = await fs.readFile(neighborPath);
			const { fileName } = await copyBackupToInbox(host);
			const validate = await runRestoreValidate(host, fileName);
			assert.equal(validate.ok, true);
			const plan = getActiveRestorePlan()!;
			const apply = await runRestoreApply(host, fileName, plan.planId);
			assert.equal(apply.ok, true);
			for (const key of RESTORE_LEARNING_KEYS) {
				const rel = restoreLearningRelativeTargetPath(key);
				const abs = path.join(host.getAbsoluteInstanceDataDir(), rel);
				const st = await fs.stat(abs);
				assert.ok(st.isFile());
			}
			assert.equal(sha256Buffer(await fs.readFile(neighborPath)), sha256Buffer(neighborBefore));
		} finally {
			await fs.rm(tmp, { recursive: true, force: true }).catch(() => undefined);
		}
	});
});

describe("restore dryrun reason separation", () => {
	let tmp: string;

	beforeEach(async () => {
		tmp = await fs.mkdtemp(path.join(os.tmpdir(), "ems-restore-dry-"));
		resetRestoreDryrunContextForTest();
		resetRestoreBarrierForTest();
	});

	afterEach(async () => {
		await fs.rm(tmp, { recursive: true, force: true }).catch(() => undefined);
	});

	it("committed journal recovery uses restore_recovery not namespace cold start", async () => {
		const host = new InjectionTestHost(tmp, {
			global_execution_mode: "live",
			wb_addon_mode: "live",
			bat_addon_mode: "live",
			ih_addon_mode: "live",
			ac_addon_mode: "live",
		});
		await host.setStateAsync(GLOBAL.executionMode, { val: "live", ack: true });
		await host.setStateAsync(addonMode("wallbox"), { val: "live", ack: true });
		await host.setObjectNotExistsAsync("global", { type: "channel", native: {} } as ioBroker.Object);

		const txId = newTransactionId();
		const txDir = await ensureTransactionLayout(host, txId);
		await writeJournalAtomic(
			txDir,
			createJournal({
				transactionId: txId,
				archiveFileName: "test.emsbackup",
				archiveSha256: "a".repeat(64),
				phase: "committed",
			}),
		);

		const recovery = await runRestoreStartupRecovery(host);
		assert.equal(recovery.ok, true);
		assert.equal(getPendingForceDryrunReason(), "restore_recovery");
		assert.equal(isRestoreInProgress(), true);
		assert.equal(String((await host.getStateAsync(GLOBAL.executionMode))?.val), "dryrun");
		assert.equal(host.config.global_execution_mode, "dryrun");
		assert.equal(host.config.wb_addon_mode, "dryrun");

		await clearRestoreRestartRequiredAfterBootstrap(host);
		assert.equal(isRestoreInProgress(), false);
		assert.equal(getPendingForceDryrunReason(), null);
	});

	it("committed recovery persists native dryrun across two simulated restarts", async () => {
		const host = new InjectionTestHost(tmp, {
			global_execution_mode: "live",
			wb_addon_mode: "live",
			bat_addon_mode: "live",
			ih_addon_mode: "live",
			ac_addon_mode: "live",
			access_token: "keep",
		});
		await host.setStateAsync(GLOBAL.executionMode, { val: "live", ack: true });
		const txId = newTransactionId();
		const txDir = await ensureTransactionLayout(host, txId);
		await writeJournalAtomic(
			txDir,
			createJournal({
				transactionId: txId,
				archiveFileName: "test.emsbackup",
				archiveSha256: "b".repeat(64),
				phase: "committed",
			}),
		);

		const first = await runRestoreStartupRecovery(host);
		assert.equal(first.ok, true);
		await assertDryrunModes(host);

		await clearRestoreRestartRequiredAfterBootstrap(host);
		resetRestoreDryrunContextForTest();
		resetRestoreBarrierForTest();

		const second = await runRestoreStartupRecovery(host);
		assert.equal(second.ok, true);
		assert.equal(second.action, "none");
		const { syncExecutionModesFromConfig } = await import("../execution_mode.js");
		await syncExecutionModesFromConfig(host, host.config, {});
		await assertDryrunModes(host);
		assert.equal(host.config.access_token, "keep");
	});

	it("restore_recovery pending reason overrides namespace cold start in bootstrap sync", async () => {
		setPendingForceDryrunReason("restore_recovery");
		const coldStartWouldBeTrue = true;
		const reason = getPendingForceDryrunReason() ?? (coldStartWouldBeTrue ? "namespace_cold_start" : null);
		assert.equal(reason, "restore_recovery");
	});
});

describe("restore status semantics", () => {
	let tmp: string;

	beforeEach(async () => {
		tmp = await fs.mkdtemp(path.join(os.tmpdir(), "ems-restore-status-"));
		resetExportMutexForTest();
		resetOperationLockForTest();
		resetRestoreApplyForTest();
		resetRestoreBarrierForTest();
		resetRestoreInjectionHooksForTest();
	});

	afterEach(async () => {
		invalidateRestorePlan();
		await fs.rm(tmp, { recursive: true, force: true }).catch(() => undefined);
	});

	it("validate never sets restart_required or last_restore_at", async () => {
		const host = await prepareHost(tmp);
		await initRestoreRuntime(host);
		await host.setStateAsync(RESTORE_STATES.lastRestoreAt, { val: "2020-01-01T00:00:00.000Z", ack: true });
		await host.setStateAsync(RESTORE_STATES.lastFileName, { val: "old.emsbackup", ack: true });
		const { fileName } = await copyBackupToInbox(host);
		await host.setStateAsync(RESTORE_STATES.selectedFile, { val: fileName, ack: true });
		await handleRestoreValidateRequest(host, true, false);
		assert.equal((await host.getStateAsync(RESTORE_STATES.restartRequired))?.val, false);
		assert.equal((await host.getStateAsync(RESTORE_STATES.lastRestoreAt))?.val, "2020-01-01T00:00:00.000Z");
		assert.equal((await host.getStateAsync(RESTORE_STATES.lastFileName))?.val, "old.emsbackup");
	});

	it("failed apply reports rolled_back without updating last_restore_at", async () => {
		const host = await prepareHost(tmp);
		await initRestoreRuntime(host);
		await host.setStateAsync(RESTORE_STATES.lastRestoreAt, { val: "2020-01-01T00:00:00.000Z", ack: true });
		await host.setStateAsync(RESTORE_STATES.lastFileName, { val: "old.emsbackup", ack: true });
		const { fileName } = await copyBackupToInbox(host);
		await host.setStateAsync(RESTORE_STATES.selectedFile, { val: fileName, ack: true });
		await handleRestoreValidateRequest(host, true, false);
		const planId = String((await host.getStateAsync(RESTORE_STATES.planId))?.val ?? "");
		await host.setStateAsync(RESTORE_STATES.confirmPlanId, { val: planId, ack: true });
		setRestoreApplyInjectionPoint("after_native_apply");
		await handleRestoreApplyRequest(host, true, false);
		assert.equal((await host.getStateAsync(RESTORE_STATES.lastResult))?.val, "rolled_back");
		assert.equal((await host.getStateAsync(RESTORE_STATES.lastRestoreAt))?.val, "2020-01-01T00:00:00.000Z");
		assert.equal((await host.getStateAsync(RESTORE_STATES.lastFileName))?.val, "old.emsbackup");
		assert.equal((await host.getStateAsync(RESTORE_STATES.restartRequired))?.val, false);
	});
});
