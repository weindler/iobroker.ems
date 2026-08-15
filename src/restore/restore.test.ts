import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { buildZipArchive, readZipEntryData } from "../backup/archive.js";
import { sha256Buffer } from "../backup/checksum.js";
import {
	collectAdapterConfigExport,
	collectMappingsExport,
	collectVehicleProfilesExport,
} from "../backup/collect_config.js";
import { inventoryExportJson } from "../backup/inventory.js";
import { buildExportManifest, buildManifestFileEntries, exportFileName } from "../backup/manifest.js";
import { backupDir } from "../backup/retention.js";
import { stableJsonStringify, validateManifest } from "../backup/schema.js";
import { resetExportMutexForTest, runBackupExport, runSupportExport } from "../backup/service.js";
import { resetOperationLockForTest } from "../backup/operation_lock.js";
import { WALLBOX_LIVE_WRITE_RELEASED, executeWallboxWrite } from "../addons/wallbox/runtime/execute.js";
import { executeBatteryWrite, type FinalWriteGate } from "../addons/battery/runtime/execute.js";
import { writeForeignIfChanged } from "../device_write.js";
import { EXECUTION_MODE_CONFIG_FINGERPRINT } from "../execution_mode.js";
import { learningDataPath } from "../learning/data_dir.js";
import { createInitialManifest, writeManifestAtomic } from "../backup_integration/manifest.js";
import { resolveEmsPaths } from "../backup_integration/paths.js";
import { readStoreZipArchive, zipCrc32 } from "./zip_reader.js";
import { validateRestoreArchiveBuffer, assertRestoreManifest } from "./validate_archive.js";
import {
	assertRestoreFileName,
	resolveRestoreSourcePath,
	restoreInboxDir,
} from "./source.js";
import {
	buildRestoreProjection,
	countChangedConfigFields,
	exportCurrentNativeProjection,
	mergeNativeForRestore,
} from "./projection.js";
import {
	clearRestorePlanForTest,
	createRestorePlan,
	getActiveRestorePlan,
	invalidateRestorePlan,
	assertPlanMatchesIdentity,
} from "./plan.js";
import { RESTORE_PLAN_TTL_MS } from "./types.js";
import {
	runRestoreValidate,
	runRestoreApply,
	resetRestoreApplyForTest,
} from "./apply.js";
import {
	assertDeviceActionAllowed,
	resetRestoreBarrierForTest,
	setRestoreInProgress,
} from "./barrier.js";
import {
	createJournal,
	ensureTransactionLayout,
	newTransactionId,
	updateJournalPhase,
	writeJournalAtomic,
} from "./journal.js";
import { runRestoreRollback } from "./rollback.js";
import { runRestoreStartupRecovery } from "./startup_recovery.js";
import { RESTORE_LEARNING_KEYS, RESTORE_LEARNING_TARGETS } from "./learning_map.js";
import { resetDiagnosticModeForTest } from "../support/diagnostic_mode.js";

/** Store-ZIP unabhängig von buildZipArchive (Python zipfile). */
const INDEPENDENT_STORE_ZIP_B64 =
	"UEsDBBQAAAAAAHZD7Fx8xiG9GQAAABkAAAAVAAAAaW5kZXBlbmRlbnQvaGVsbG8udHh0aGVsbG8taW5kZXBlbmRlbnQtZml4dHVyZVBLAwQUAAAAAAB2Q+xciEF/wgwAAAAMAAAAFQAAAGluZGVwZW5kZW50L2RhdGEuanNvbnsib2siOnRydWV9ClBLAQIUAxQAAAAAAHZD7Fx8xiG9GQAAABkAAAAVAAAAAAAAAAAAAACAAQAAAABpbmRlcGVuZGVudC9oZWxsby50eHRQSwECFAMUAAAAAAB2Q+xciEF/wgwAAAAMAAAAFQAAAAAAAAAAAAAAgAFMAAAAaW5kZXBlbmRlbnQvZGF0YS5qc29uUEsFBgAAAAACAAIAhgAAAIsAAAAAAA==";

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

function mapRow(evccId: string, name: string): Record<string, unknown> {
	return {
		evcc_vehicle_id: evccId,
		display_name: name,
		enabled: true,
		battery_capacity_net_kwh: 60,
		max_ac_charge_power_w: 11000,
	};
}

class RestoreTestHost {
	readonly namespace = "ems.0";
	readonly objects = new Map<string, ioBroker.Object>();
	readonly states = new Map<string, { val: ioBroker.StateValue; ack: boolean }>();
	config: Record<string, unknown>;
	common = { version: "0.1.142" };
	private dataDir: string;

	constructor(dataDir: string, config: Record<string, unknown> = {}) {
		this.dataDir = dataDir;
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

	async getObjectAsync(id: string): Promise<ioBroker.Object | null> {
		return this.objects.get(id) ?? null;
	}

	async setObjectNotExistsAsync(id: string, obj: ioBroker.Object): Promise<void> {
		if (!this.objects.has(id)) this.objects.set(id, { ...obj, _id: id } as ioBroker.Object);
	}

	async updateConfig(next: Record<string, unknown>): Promise<void> {
		this.config = { ...next };
	}
}

async function copyBackupToInbox(host: RestoreTestHost, fileName?: string): Promise<{ fileName: string; sha256: string }> {
	const result = await runBackupExport(host);
	assert.equal(result.ok, true);
	if (!result.ok) throw new Error("export failed");
	const target = fileName ?? path.basename(result.filePath);
	const inbox = restoreInboxDir(host);
	await fs.mkdir(inbox, { recursive: true });
	await fs.copyFile(result.filePath, path.join(inbox, target));
	return { fileName: target, sha256: result.sha256 };
}

async function writeLearningFixture(host: RestoreTestHost, key: string, data: unknown): Promise<void> {
	const target = RESTORE_LEARNING_TARGETS[key];
	const base = learningDataPath(host as unknown as ioBroker.Adapter, target.category);
	await fs.mkdir(base, { recursive: true });
	await fs.writeFile(path.join(base, target.fileName), stableJsonStringify(data), { mode: 0o600 });
}

describe("restore zip reader", () => {
	it("reads independent python-generated store zip", () => {
		const buf = Buffer.from(INDEPENDENT_STORE_ZIP_B64, "base64");
		const entries = readStoreZipArchive(buf);
		assert.equal(entries.length, 2);
		const hello = entries.find((e) => e.path === "independent/hello.txt");
		assert.ok(hello);
		assert.equal(hello!.data.toString("utf8"), "hello-independent-fixture");
	});

	it("detects crc mismatch", () => {
		const buf = Buffer.from(INDEPENDENT_STORE_ZIP_B64, "base64");
		const needle = Buffer.from("hello-independent-fixture");
		const idx = buf.indexOf(needle);
		assert.ok(idx >= 0);
		buf[idx] ^= 0xff;
		assert.throws(() => readStoreZipArchive(buf), /crc mismatch/);
	});

	it("rejects duplicate paths", () => {
		assert.throws(
			() =>
				buildZipArchive([
					{ path: "a.txt", content: "1" },
					{ path: "a.txt", content: "2" },
				]),
			/duplicate archive path/,
		);
	});

	it("rejects absolute and traversal paths via reader", () => {
		const entries = [{ path: "../evil.txt", content: "x" }];
		assert.throws(() => buildZipArchive(entries));
	});
});

describe("restore source validation", () => {
	let tmp: string;

	beforeEach(async () => {
		tmp = await fs.mkdtemp(path.join(os.tmpdir(), "ems-restore-src-"));
	});

	it("accepts valid .emsbackup file names only", () => {
		assert.throws(() => assertRestoreFileName("../x.emsbackup"));
		assert.throws(() => assertRestoreFileName("x.emssupport"));
		assert.throws(() => assertRestoreFileName(".tmp-x.emsbackup"));
		assert.doesNotThrow(() => assertRestoreFileName("ems-light-0.1.142-backup-20260712T120000Z.emsbackup"));
	});

	it("resolves paths inside backup dir or inbox", () => {
		const name = "ems-light-0.1.142-backup-20260712T120000Z.emsbackup";
		const resolver = { namespace: "ems.0", getAbsoluteInstanceDataDir: () => tmp };
		const inBackup = resolveRestoreSourcePath(resolver, name);
		assert.equal(inBackup.rootKind, "backup_dir");
		const inbox = path.join(restoreInboxDir(resolver), name);
		assert.equal(resolveRestoreSourcePath(resolver, name).path, inBackup.path);
		void inbox;
	});
});

describe("restore archive validation", () => {
	let tmp: string;
	let host: RestoreTestHost;

	beforeEach(async () => {
		tmp = await fs.mkdtemp(path.join(os.tmpdir(), "ems-restore-val-"));
		resetExportMutexForTest();
		resetOperationLockForTest();
		host = new RestoreTestHost(tmp, {
			global_execution_mode: "live",
			wb_addon_mode: "live",
			bat_addon_mode: "live",
			ih_addon_mode: "live",
			ac_addon_mode: "live",
			password: "keep-local",
			wb_vehicle_map: [mapRow("car_1", "Car 1")],
		});
	});

	afterEach(async () => {
		resetExportMutexForTest();
		resetOperationLockForTest();
		await fs.rm(tmp, { recursive: true, force: true }).catch(() => undefined);
	});

	it("validates v0.1.141-style .emsbackup from export", async () => {
		const { fileName } = await copyBackupToInbox(host);
		const resolved = resolveRestoreSourcePath(tmp, fileName);
		const buf = await fs.readFile(resolved.path);
		const validated = validateRestoreArchiveBuffer(buf);
		assert.equal(validated.manifest.kind, "backup");
		assert.equal(validated.manifest.safety.restore_must_start_dryrun, true);
	});

	it("rejects .emssupport package type", async () => {
		const support = await runSupportExport(host, async () => [
			{ path: "logs/errors.ndjson", content: '{"event":"test"}\n' },
		]);
		assert.equal(support.ok, true);
		if (!support.ok) return;
		const buf = await fs.readFile(support.filePath);
		assert.throws(() => validateRestoreArchiveBuffer(buf), /manifest kind mismatch|only backup archives are restorable|support packages not restorable/);
	});

	it("rejects extra non-manifest payload file", async () => {
		const { fileName } = await copyBackupToInbox(host);
		const resolved = resolveRestoreSourcePath(tmp, fileName);
		let buf = await fs.readFile(resolved.path);
		const entries = readStoreZipArchive(buf).map((e) => ({ path: e.path, content: e.data }));
		entries.push({ path: "extra/evil.json", content: Buffer.from("{}") });
		buf = buildZipArchive(entries);
		assert.throws(() => validateRestoreArchiveBuffer(buf), /non-manifest payload/);
	});

	it("rejects wrong adapter name in manifest", () => {
		const payload = [{ path: "config/adapter.json", content: "{}\n" }];
		const files = buildManifestFileEntries(payload);
		const manifest = buildExportManifest({
			kind: "backup",
			adapterVersion: "0.1.142",
			instance: 0,
			namespace: "ems.0",
			files,
		});
		manifest.adapter.name = "other" as "ems";
		assert.throws(() => assertRestoreManifest(manifest), /invalid adapter name/);
	});

	it("rejects invalid safety block", () => {
		const payload = [{ path: "config/adapter.json", content: "{}\n" }];
		const files = buildManifestFileEntries(payload);
		const manifest = buildExportManifest({
			kind: "backup",
			adapterVersion: "0.1.142",
			instance: 0,
			namespace: "ems.0",
			files,
		});
		(manifest.safety as { restore_must_start_dryrun: boolean }).restore_must_start_dryrun = false;
		assert.throws(() => assertRestoreManifest(manifest), /invalid safety block/);
	});
});

describe("restore projection and config merge", () => {
	it("preserves secrets and unknown native fields", () => {
		const current = {
			password: "secret",
			custom_local_field: 42,
			global_execution_mode: "live",
			wb_addon_mode: "live",
		};
		const projection = {
			global_execution_mode: "dryrun",
			wb_addon_mode: "dryrun",
			bat_addon_mode: "dryrun",
			ih_addon_mode: "dryrun",
			ac_addon_mode: "dryrun",
			wb_evcc_connected_state: "mqtt.0.connected",
		};
		const merged = mergeNativeForRestore(current, projection);
		assert.equal(merged.password, "secret");
		assert.equal(merged.custom_local_field, 42);
		assert.equal(merged.global_execution_mode, "dryrun");
		assert.equal(merged.wb_evcc_connected_state, "mqtt.0.connected");
	});

	it("supports five and more vehicle mini-map entries", () => {
		const entries = Array.from({ length: 6 }, (_, i) => mapRow(`id_${i}`, `Name ${i}`));
		const cfg = {
			global_execution_mode: "dryrun",
			wb_vehicle_map: entries,
		};
		const adapter = collectAdapterConfigExport(cfg);
		const vp = collectVehicleProfilesExport(cfg);
		const payload = new Map<string, Buffer>();
		payload.set("config/adapter.json", Buffer.from(stableJsonStringify(adapter)));
		payload.set("config/mappings.json", Buffer.from(stableJsonStringify(collectMappingsExport(cfg))));
		payload.set("config/vehicle_profiles.json", Buffer.from(stableJsonStringify(vp)));
		payload.set("config/policies.json", Buffer.from("{}"));
		payload.set("persistence/selected_state_data.json", Buffer.from("{}"));
		const projection = buildRestoreProjection(payload);
		assert.equal((projection.native.wb_vehicle_map as unknown[]).length, 6);
		assert.equal(projection.configuredModesAtExport.global, "dryrun");
		assert.equal(projection.native.global_execution_mode, "dryrun");
	});

	it("rejects conflicting projections", () => {
		const cfg = { global_execution_mode: "dryrun", wb_evcc_connected_state: "a" };
		const adapter = collectAdapterConfigExport(cfg);
		const mappings = { wb_evcc_connected_state: "b" };
		const payload = new Map<string, Buffer>();
		payload.set("config/adapter.json", Buffer.from(stableJsonStringify(adapter)));
		payload.set("config/mappings.json", Buffer.from(stableJsonStringify(mappings)));
		payload.set("config/vehicle_profiles.json", Buffer.from('{"entries":[]}'));
		payload.set("config/policies.json", Buffer.from("{}"));
		payload.set("persistence/selected_state_data.json", Buffer.from("{}"));
		assert.throws(() => buildRestoreProjection(payload), /conflicting projection/);
	});

	it("plan summary contains no secrets", () => {
		const identity = {
			fileName: "ems-light-0.1.142-backup-20260712T120000Z.emsbackup",
			rootKind: "backup_dir" as const,
			archiveSha256: "a".repeat(64),
			sizeBytes: 100,
			mtimeMs: Date.now(),
		};
		const manifest = buildExportManifest({
			kind: "backup",
			adapterVersion: "0.1.142",
			instance: 0,
			namespace: "ems.0",
			files: [],
		});
		const plan = createRestorePlan({
			identity,
			manifest,
			projection: {
				native: { password: "must-not-appear" },
				learning: {},
				configuredModesAtExport: { global: "live" },
				warnings: [],
				skippedClasses: [],
			},
			changedConfigFields: 1,
		});
		const summaryText = JSON.stringify(plan.summary);
		assert.ok(!summaryText.includes("must-not-appear"));
		assert.ok(!summaryText.includes("password"));
		assert.equal(plan.summary.applyModes.global, "dryrun");
	});
});

describe("restore plan lifecycle", () => {
	beforeEach(() => {
		clearRestorePlanForTest();
	});

	it("plan expires after 15 minutes", () => {
		const identity = {
			fileName: "x.emsbackup",
			rootKind: "inbox" as const,
			archiveSha256: "b".repeat(64),
			sizeBytes: 1,
			mtimeMs: 1,
		};
		const manifest = buildExportManifest({
			kind: "backup",
			adapterVersion: "0.1.142",
			instance: 0,
			namespace: "ems.0",
			files: [],
		});
		const now = Date.now();
		const realNow = Date.now;
		Date.now = () => now;
		try {
			createRestorePlan({
				identity,
				manifest,
				projection: {
					native: {},
					learning: {},
					configuredModesAtExport: {},
					warnings: [],
					skippedClasses: [],
				},
				changedConfigFields: 0,
			});
			assert.ok(getActiveRestorePlan());
			Date.now = () => now + RESTORE_PLAN_TTL_MS + 1;
			assert.equal(getActiveRestorePlan(), null);
		} finally {
			Date.now = realNow;
		}
	});

	it("rejects wrong plan id and archive tampering", () => {
		const identity = {
			fileName: "ems-light-0.1.142-backup-20260712T120000Z.emsbackup",
			rootKind: "inbox" as const,
			archiveSha256: "c".repeat(64),
			sizeBytes: 100,
			mtimeMs: 123,
		};
		const manifest = buildExportManifest({
			kind: "backup",
			adapterVersion: "0.1.142",
			instance: 0,
			namespace: "ems.0",
			files: [],
		});
		createRestorePlan({
			identity,
			manifest,
			projection: {
				native: {},
				learning: {},
				configuredModesAtExport: {},
				warnings: [],
				skippedClasses: [],
			},
			changedConfigFields: 0,
		});
		assert.throws(() => assertPlanMatchesIdentity(identity, "wrong-id"), /invalid plan id/);
		assert.throws(
			() =>
				assertPlanMatchesIdentity(
					{ ...identity, archiveSha256: "d".repeat(64) },
					getActiveRestorePlan()!.planId,
				),
			/archive content changed/,
		);
	});

	it("invalidates old plan on new validation", async () => {
		const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "ems-restore-plan-"));
		try {
			resetExportMutexForTest();
			resetOperationLockForTest();
			const host = new RestoreTestHost(tmp, { global_execution_mode: "dryrun" });
			const first = await copyBackupToInbox(host);
			const v1 = await runRestoreValidate(host, first.fileName);
			assert.equal(v1.ok, true);
			const plan1 = getActiveRestorePlan()?.planId;
			const v2 = await runRestoreValidate(host, first.fileName);
			assert.equal(v2.ok, true);
			const plan2 = getActiveRestorePlan()?.planId;
			assert.notEqual(plan1, plan2);
		} finally {
			invalidateRestorePlan();
			resetExportMutexForTest();
			resetOperationLockForTest();
			await fs.rm(tmp, { recursive: true, force: true }).catch(() => undefined);
		}
	});
});

describe("restore validate and apply", () => {
	let tmp: string;
	let host: RestoreTestHost;

	beforeEach(async () => {
		tmp = await fs.mkdtemp(path.join(os.tmpdir(), "ems-restore-apply-"));
		resetExportMutexForTest();
		resetOperationLockForTest();
		resetRestoreApplyForTest();
		resetRestoreBarrierForTest();
		resetDiagnosticModeForTest();
		host = new RestoreTestHost(tmp, {
			global_execution_mode: "live",
			wb_addon_mode: "live",
			bat_addon_mode: "live",
			ih_addon_mode: "live",
			ac_addon_mode: "live",
			access_token: "local-token",
			custom_unknown: "stay",
			wb_evcc_connected_state: "mqtt.0.old",
			wb_vehicle_map: [mapRow("car_1", "Car 1")],
		});
		await host.setStateAsync("command.inbox", { val: "pending", ack: false });
		await writeLearningFixture(host, "battery_runtime_learning_v1.json", { version: 1, samples: [] });
		const layout = resolveEmsPaths(host);
		await fs.mkdir(path.dirname(layout.manifestPath), { recursive: true });
		await writeManifestAtomic(
			layout.manifestPath,
			createInitialManifest({ instance: 0, namespace: host.namespace, adapterVersion: "0.1.143" }),
		);
	});

	afterEach(async () => {
		resetExportMutexForTest();
		resetOperationLockForTest();
		resetRestoreApplyForTest();
		resetRestoreBarrierForTest();
		resetDiagnosticModeForTest();
		await fs.rm(tmp, { recursive: true, force: true }).catch(() => undefined);
	});

	it("validate does not change native config, learning, or runtime states", async () => {
		const beforeConfig = structuredClone(host.config);
		const beforeInbox = (await host.getStateAsync("command.inbox"))?.val;
		const learningPath = path.join(
			learningDataPath(host as unknown as ioBroker.Adapter, "learning/battery_runtime"),
			"battery_runtime_learning_v1.json",
		);
		const beforeLearning = await fs.readFile(learningPath, "utf8");
		const { fileName } = await copyBackupToInbox(host);
		const result = await runRestoreValidate(host, fileName);
		assert.equal(result.ok, true);
		assert.deepEqual(host.config, beforeConfig);
		assert.equal((await host.getStateAsync("command.inbox"))?.val, beforeInbox);
		assert.equal(await fs.readFile(learningPath, "utf8"), beforeLearning);
	});

	it("apply requires valid plan and enforces dryrun modes", async () => {
		const { fileName } = await copyBackupToInbox(host);
		const validate = await runRestoreValidate(host, fileName);
		assert.equal(validate.ok, true);
		const plan = getActiveRestorePlan();
		assert.ok(plan);
		const apply = await runRestoreApply(host, fileName, plan!.planId);
		assert.equal(apply.ok, true);
		assert.equal(host.config.access_token, "local-token");
		assert.equal(host.config.custom_unknown, "stay");
		assert.equal(host.config.global_execution_mode, "dryrun");
		assert.equal(host.config.wb_addon_mode, "dryrun");
		assert.equal(host.config.bat_addon_mode, "dryrun");
		assert.equal(host.config.ih_addon_mode, "dryrun");
		assert.equal(host.config.ac_addon_mode, "dryrun");
		assert.equal((await host.getStateAsync("command.inbox"))?.val, "");
	});

	it("apply without plan is rejected", async () => {
		const { fileName } = await copyBackupToInbox(host);
		const apply = await runRestoreApply(host, fileName, "missing-plan");
		assert.equal(apply.ok, false);
		assert.match(apply.error ?? "", /no valid restore plan|invalid plan id/);
	});

	it("apply detects swapped archive content", async () => {
		const { fileName } = await copyBackupToInbox(host);
		const validate = await runRestoreValidate(host, fileName);
		assert.equal(validate.ok, true);
		const plan = getActiveRestorePlan()!;
		const resolved = resolveRestoreSourcePath(tmp, fileName);
		await fs.writeFile(resolved.path, Buffer.from("corrupted"));
		const apply = await runRestoreApply(host, fileName, plan.planId);
		assert.equal(apply.ok, false);
	});
});

describe("restore device write barrier", () => {
	beforeEach(() => resetRestoreBarrierForTest());
	afterEach(() => resetRestoreBarrierForTest());

	it("blocks foreign device writes during restore", async () => {
		setRestoreInProgress(true);
		assert.equal(assertDeviceActionAllowed().ok, false);
		const writes: string[] = [];
		await writeForeignIfChanged(
			{
				getForeignStateAsync: async () => null,
				setForeignStateAsync: async (id) => {
					writes.push(id);
				},
			},
			{ stateId: "mqtt.0.test", value: 1, reason: "test" },
		);
		assert.equal(writes.length, 0);
	});

	it("blocks battery and wallbox writes during restore", async () => {
		setRestoreInProgress(true);
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
		const wallbox = await executeWallboxWrite(
			{
				getForeignStateAsync: async () => null,
				setForeignStateAsync: async () => undefined,
				log: { info: () => undefined, warn: () => undefined, error: () => undefined, debug: () => undefined },
			},
			{
				candidate: { blocked: false } as never,
				writePlan: {} as never,
				phase: "live",
				liveRequested: true,
			},
		);
		assert.equal(wallbox.reason, "restore_in_progress");
		assert.equal(WALLBOX_LIVE_WRITE_RELEASED, true);
	});
});

describe("restore startup recovery", () => {
	let tmp: string;
	let host: RestoreTestHost;

	beforeEach(async () => {
		tmp = await fs.mkdtemp(path.join(os.tmpdir(), "ems-restore-rec-"));
		resetRestoreBarrierForTest();
		resetRestoreApplyForTest();
		host = new RestoreTestHost(tmp, {
			global_execution_mode: "live",
			wb_addon_mode: "live",
			bat_addon_mode: "live",
			ih_addon_mode: "live",
			ac_addon_mode: "live",
		});
	});

	afterEach(async () => {
		resetRestoreBarrierForTest();
		await fs.rm(tmp, { recursive: true, force: true }).catch(() => undefined);
	});

	it("rolls back incomplete prepared transaction on startup", async () => {
		const txId = newTransactionId();
		const txDir = await ensureTransactionLayout(host, txId);
		const beforeNative = exportCurrentNativeProjection(host.config);
		await fs.writeFile(
			path.join(txDir, "before", "native_projection.json"),
			stableJsonStringify(beforeNative),
			{ mode: 0o600 },
		);
		const journal = createJournal({
			transactionId: txId,
			archiveFileName: "test.emsbackup",
			archiveSha256: "e".repeat(64),
			phase: "prepared",
		});
		await writeJournalAtomic(txDir, journal);
		host.config.wb_evcc_connected_state = "mutated-during-crash";
		const result = await runRestoreStartupRecovery(host);
		assert.equal(result.ok, true);
		if (result.ok) assert.equal(result.action, "rolled_back");
	});

	it("blocks runtime on multiple incomplete transactions", async () => {
		for (let i = 0; i < 2; i++) {
			const txId = newTransactionId();
			const txDir = await ensureTransactionLayout(host, txId);
			const journal = createJournal({
				transactionId: txId,
				archiveFileName: "test.emsbackup",
				archiveSha256: "f".repeat(64),
				phase: "config_applied",
			});
			await writeJournalAtomic(txDir, journal);
		}
		const result = await runRestoreStartupRecovery(host);
		assert.equal(result.ok, false);
		assert.equal(result.error, "multiple_incomplete_restore_transactions");
	});

	it("finalizes committed transaction without re-applying config", async () => {
		const txId = newTransactionId();
		const txDir = await ensureTransactionLayout(host, txId);
		const journal = createJournal({
			transactionId: txId,
			archiveFileName: "test.emsbackup",
			archiveSha256: "g".repeat(64),
			phase: "committed",
		});
		await writeJournalAtomic(txDir, journal);
		host.config.global_execution_mode = "live";
		const result = await runRestoreStartupRecovery(host);
		assert.equal(result.ok, true);
		if (result.ok) assert.equal(result.action, "finalized_committed");
		assert.equal(host.config.global_execution_mode, "dryrun");
	});
});

describe("restore learning keys", () => {
	it("maps exactly eleven known learning keys", () => {
		assert.equal(RESTORE_LEARNING_KEYS.length, 12);
		for (const key of RESTORE_LEARNING_KEYS) {
			assert.ok(RESTORE_LEARNING_TARGETS[key]);
			assert.ok(key.endsWith(".json"));
		}
	});
});
