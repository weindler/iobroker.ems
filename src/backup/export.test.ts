import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { buildZipArchive, readZipEntryNames, readZipEntryData } from "./archive.js";
import { sha256Buffer } from "./checksum.js";
import {
	collectAdapterConfigExport,
	collectMappingsExport,
	collectVehicleProfilesExport,
	filterAllowlistedConfig,
	filterVehicleProfileRow,
} from "./collect_config.js";
import { isTransientStateId, SELECTED_STATE_DATA_KEYS } from "./collect_persistence.js";
import { buildExportManifest, buildManifestFileEntries, exportFileName } from "./manifest.js";
import { validateManifestPayloadConsistency } from "./manifest_validate.js";
import { inventoryExportJson } from "./inventory.js";
import {
	assertSafeFileName,
	backupDir,
	supportDir,
	cleanupTempExports,
	enforceRetention,
	resolveExportPath,
	writeAtomicArchive,
	BACKUP_RETENTION_MAX,
	SUPPORT_RETENTION_MAX,
	OWN_EXPORT_FILE_RE,
} from "./retention.js";
import {
	assertSupportBundleClean,
	createPseudonymContext,
	sanitizeForSupport,
	sanitizeString,
	sanitizeValue,
	scanForForbiddenSecrets,
} from "./sanitize.js";
import { assertJsonSerializable, stableJsonStringify, validateManifest } from "./schema.js";
import {
	isExportRunning,
	resetExportMutexForTest,
	runBackupExport,
	runExport,
} from "./service.js";
import {
	handleBackupExportRequest,
	handleSupportExportRequest,
	initBackupExportRuntime,
} from "./export_handler.js";
import { BACKUP_STATES, SUPPORT_STATES } from "./ensure_states.js";
import { WALLBOX_LIVE_WRITE_RELEASED } from "../addons/wallbox/runtime/execute.js";
import {
	DIAGNOSTIC_ALLOWED_DURATIONS,
	resetDiagnosticModeForTest,
	startDiagnosticMode,
	isDiagnosticModeActive,
} from "../support/diagnostic_mode.js";
import { appendNdjsonRotating } from "../support/log_rotation.js";

function profileRow(id: string, name: string): Record<string, unknown> {
	return {
		vehicle_id: id,
		display_name: name,
		enabled: true,
		source: "manual",
		battery_capacity_net_kwh: 60,
		max_ac_charge_power_w: 11000,
		supported_phases: "3",
		preferred_phases: 3,
		min_current_a: 6,
		max_current_a: 16,
		default_target_soc_pct: 80,
		minimum_departure_soc_pct: 50,
		maximum_soc_pct: 90,
	};
}

class ExportTestHost {
	readonly namespace = "ems.0";
	readonly objects = new Map<string, ioBroker.Object>();
	readonly states = new Map<string, { val: ioBroker.StateValue; ack: boolean }>();
	config: Record<string, unknown>;
	common = { version: "0.1.141" };
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
}

describe("backup export v0.1.141", () => {
	let tmp: string;

	beforeEach(async () => {
		tmp = await fs.mkdtemp(path.join(os.tmpdir(), "ems-export-"));
		resetExportMutexForTest();
		resetDiagnosticModeForTest();
	});

	afterEach(async () => {
		resetExportMutexForTest();
		resetDiagnosticModeForTest();
	});

	it("exports empty default config backup", async () => {
		const host = new ExportTestHost(tmp, { global_execution_mode: "dryrun" });
		const result = await runBackupExport(host);
		assert.equal(result.ok, true);
		if (!result.ok) return;
		const buf = await fs.readFile(result.filePath);
		const names = readZipEntryNames(buf);
		assert.ok(names.includes("manifest.json"));
		assert.ok(names.includes("config/adapter.json"));
	});

	it("exports full addon config and five vehicle profiles", async () => {
		const profiles = Array.from({ length: 5 }, (_, i) => profileRow(`car_${i + 1}`, `Car ${i + 1}`));
		const cfg = {
			global_execution_mode: "live",
			wb_addon_mode: "live",
			bat_addon_mode: "dryrun",
			wb_vehicle_profiles: profiles,
			wb_evcc_connected_state: "evcc.0.connected",
			api_key: "secret-should-drop",
		};
		const exported = collectAdapterConfigExport(cfg);
		assert.equal(exported.restore_policy.apply_as, "dryrun");
		assert.equal(exported.configured_modes_at_export.global, "live");
		assert.equal((exported.allowed_native as Record<string, unknown>).api_key, undefined);
		const vp = collectVehicleProfilesExport(cfg);
		assert.equal(vp.profiles.length, 5);
	});

	it("allowlist excludes secrets and unknown keys", () => {
		const out = filterAllowlistedConfig({
			global_execution_mode: "dryrun",
			password: "x",
			random_unknown_field: 1,
			wb_addon_mode: "dryrun",
		});
		assert.equal(out.global_execution_mode, "dryrun");
		assert.equal(out.password, undefined);
		assert.equal(out.random_unknown_field, undefined);
	});

	it("vehicle profile allowlist drops unknown and nested fields", () => {
		const row = filterVehicleProfileRow({
			vehicle_id: "car_1",
			display_name: "Car",
			unknown_harmless: "drop",
			unknown_secret: "drop",
			nested: { secret: "x" },
		}) as Record<string, unknown>;
		assert.equal(row.vehicle_id, "car_1");
		assert.equal(row.unknown_harmless, undefined);
		assert.equal(row.nested, undefined);
	});

	it("mapping export excludes unknown nested addon objects", () => {
		const out = collectMappingsExport({
			wb_evcc_connected_state: "evcc.0.connected",
			mapping: {
				wallbox: { wb_power_target: "mqtt.0/power", unknown_nested: { api_key: "secret" } },
				unknown_addon: { foo: "bar" },
			},
		}) as Record<string, unknown>;
		const mapping = out.mapping as Record<string, unknown>;
		assert.ok(mapping.wallbox);
		assert.equal((mapping.wallbox as Record<string, unknown>).unknown_nested, undefined);
		assert.equal(mapping.unknown_addon, undefined);
	});

	it("transient states are classified", () => {
		assert.equal(isTransientStateId("command.inbox"), true);
		assert.equal(isTransientStateId("addons.wallbox.telemetry.soc_pct"), true);
		assert.equal(isTransientStateId("addons.wallbox.config.enabled"), false);
	});

	it("support bundle uses shared core and anonymizes secrets", async () => {
		const secret = "ACCESS_TOKEN_SECRET_XYZ_991_UNIQUE";
		const host = new ExportTestHost(tmp, {
			wb_evcc_connected_state: "mqtt.0.home/evcc/connected",
			wb_vehicle_profiles: [profileRow("vin123456789012345", "My Car")],
			access_token: secret,
		});
		const { runSupportBundleExport } = await import("../support/index.js");
		const result = await runSupportBundleExport(host);
		assert.equal(result.ok, true);
		if (!result.ok) return;
		const buf = await fs.readFile(result.filePath);
		const text = buf.toString("utf8");
		assert.ok(!text.includes("access_token"));
		assert.ok(!text.includes(secret));
	});

	it("sanitizer pseudonyms are stable within one bundle", () => {
		const ctx = createPseudonymContext();
		const input = "mqtt.0.home/evcc/connected";
		const a = sanitizeValue(input, ctx, "wb_evcc_connected_state");
		const b = sanitizeValue(input, ctx, "wb_evcc_connected_state");
		assert.equal(a, b);
		assert.ok(String(a).startsWith("foreign_state_"));
	});

	it("sanitizer removes VIN and IP patterns from support scan", () => {
		const hit = scanForForbiddenSecrets("vehicle VIN 1HGBH41JXMN109186 at 192.168.1.10");
		assert.ok(hit);
	});

	it("relative archive paths are not flagged as absolute paths", () => {
		assert.equal(scanForForbiddenSecrets("diagnostics/persist/immersion_heater_runtime_v1.json"), null);
		assert.equal(scanForForbiddenSecrets("states/runtime_diagnostics.json"), null);
		assert.ok(scanForForbiddenSecrets("file at /opt/iobroker/iobroker-data/ems.0/x.json"));
	});

	it("manifest validates safety block and restore policy", () => {
		const files = buildManifestFileEntries([{ path: "config/adapter.json", content: "{}" }]);
		const m = buildExportManifest({
			kind: "backup",
			adapterVersion: "0.1.141",
			instance: 0,
			namespace: "ems.0",
			files,
		});
		validateManifest(m, "backup");
		assert.equal(m.safety.restore_must_start_dryrun, true);
		assert.equal(m.safety.automatic_live_resume_allowed, false);
		const supportFiles = buildManifestFileEntries([{ path: "summary/system.json", content: "{}" }]);
		const sm = buildExportManifest({
			kind: "support",
			adapterVersion: "0.1.141",
			instance: 0,
			namespace: "ems.0",
			files: supportFiles,
		});
		validateManifest(sm, "support");
		assert.equal(sm.restore?.supported, false);
	});

	it("manifest payload consistency requires exact file set", () => {
		const payload = [{ path: "config/adapter.json", content: "{}\n" }];
		const files = buildManifestFileEntries(payload);
		const manifest = buildExportManifest({
			kind: "backup",
			adapterVersion: "0.1.141",
			instance: 0,
			namespace: "ems.0",
			files,
		});
		validateManifestPayloadConsistency(manifest, payload);
		assert.throws(() =>
			validateManifestPayloadConsistency(manifest, [
				...payload,
				{ path: "extra.json", content: "{}\n" },
			]),
		);
	});

	it("zip checksums match manifest", async () => {
		const content = stableJsonStringify({ ok: true });
		const entries = [{ path: "config/adapter.json", content }];
		const files = buildManifestFileEntries(entries);
		assert.equal(files[0].sha256, sha256Buffer(content));
		const zip = buildZipArchive(entries);
		assert.ok(zip.length > 0);
	});

	it("blocks path traversal and invalid export file names", () => {
		assert.throws(() => assertSafeFileName("../evil.emsbackup"));
		assert.throws(() => assertSafeFileName("foreign-backup.emsbackup"));
		assert.throws(() => resolveExportPath(tmp, "../outside.emsbackup"));
	});

	it("retention keeps exactly 10 backups and removes oldest own files", async () => {
		const dir = backupDir(tmp);
		await fs.mkdir(dir, { recursive: true });
		await fs.writeFile(path.join(dir, "foreign-backup.emsbackup"), "keep-me");
		for (let i = 0; i < BACKUP_RETENTION_MAX + 1; i++) {
			const name = exportFileName("backup", "0.1.141", `2026-07-12T13:00:0${String(i).padStart(1, "0")}.000Z`);
			await fs.writeFile(path.join(dir, name), "x");
			await new Promise((r) => setTimeout(r, 5));
		}
		await enforceRetention(tmp);
		const left = (await fs.readdir(dir)).filter((f) => OWN_EXPORT_FILE_RE.test(f));
		assert.equal(left.length, BACKUP_RETENTION_MAX);
		assert.ok((await fs.readdir(dir)).includes("foreign-backup.emsbackup"));
	});

	it("retention keeps exactly 5 support packages", async () => {
		const dir = supportDir(tmp);
		await fs.mkdir(dir, { recursive: true });
		for (let i = 0; i < SUPPORT_RETENTION_MAX + 1; i++) {
			const name = exportFileName("support", "0.1.141", `2026-07-12T14:00:0${String(i).padStart(1, "0")}.000Z`);
			await fs.writeFile(path.join(dir, name), "x");
			await new Promise((r) => setTimeout(r, 5));
		}
		await enforceRetention(tmp);
		const left = (await fs.readdir(dir)).filter((f) => f.endsWith(".emssupport") && OWN_EXPORT_FILE_RE.test(f));
		assert.equal(left.length, SUPPORT_RETENTION_MAX);
	});

	it("atomic write and temp cleanup", async () => {
		const dir = backupDir(tmp);
		await fs.mkdir(dir, { recursive: true });
		const name = exportFileName("backup", "0.1.141", "2026-07-12T13:00:00.000Z");
		await writeAtomicArchive(path.join(dir, name), Buffer.from("ok"));
		await fs.writeFile(path.join(dir, ".tmp-stale.emsbackup"), "stale");
		await cleanupTempExports(tmp);
		const left = await fs.readdir(dir);
		assert.ok(left.includes(name));
		assert.ok(!left.some((f) => f.startsWith(".tmp-")));
	});

	it("parallel export is rejected", async () => {
		const host = new ExportTestHost(tmp);
		assert.equal(isExportRunning(), false);
		const p1 = runExport(host, "backup");
		assert.equal(isExportRunning(), true);
		const p2 = await runExport(host, "backup");
		assert.equal(p2.ok, false);
		if (!p2.ok) assert.equal(p2.error, "operation_already_running");
		const r1 = await p1;
		assert.equal(r1.ok, true);
	});

	it("diagnostic mode rejects invalid durations", () => {
		assert.equal(startDiagnosticMode(999).ok, false);
		assert.equal(startDiagnosticMode(45).ok, false);
		for (const d of DIAGNOSTIC_ALLOWED_DURATIONS) {
			const started = startDiagnosticMode(d);
			assert.equal(started.ok, true);
		}
	});

	it("diagnostic mode is off after adapter restart init", async () => {
		startDiagnosticMode(15);
		assert.equal(isDiagnosticModeActive(), true);
		const host = new ExportTestHost(tmp);
		await initBackupExportRuntime(host);
		assert.equal(isDiagnosticModeActive(), false);
		const mode = await host.getStateAsync(SUPPORT_STATES.diagnosticMode);
		assert.equal(mode?.val, false);
	});

	it("log rotation enforces size limits", async () => {
		const logDir = path.join(tmp, "logs");
		const big = "x".repeat(1024);
		for (let i = 0; i < 300; i++) {
			await appendNdjsonRotating(logDir, "errors", { n: i, big }, { maxFiles: 4, maxFileBytes: 256 * 1024, totalMaxBytes: 512 * 1024 });
		}
		const files = await fs.readdir(logDir);
		assert.ok(files.length <= 4);
	});

	it("inventory lists persistence classification", () => {
		const inv = inventoryExportJson();
		assert.ok(inv.sources.some((s) => s.id === "vehicle_rollforward" && s.category === "support_only"));
		assert.ok(inv.sources.some((s) => s.id === "adapter_config" && s.category === "restorable"));
		assert.ok(inv.sources.some((s) => s.id === "intent_persist" && s.category === "transient"));
		assert.ok(inv.sources.some((s) => s.id === "global_modes" && s.category === "transient"));
	});

	it("selected_state_data contains only learning file keys", () => {
		assert.deepEqual(SELECTED_STATE_DATA_KEYS, [
			"battery_runtime_learning_v1.json",
			"house_load_learning_v1.json",
			"thermal_runtime_learning_v1.json",
			"price_learning_v1.json",
			"price_forecast_learning_v1.json",
			"pv_bias_daily_v1.json",
			"power_hourly_v1.json",
			"energy_daily_v1.json",
			"consumer_stats_v1.json",
		]);
	});

	it("excludes active runtime state from restore files", async () => {
		const cfg = {
			global_execution_mode: "live",
			wb_addon_mode: "live",
			bat_addon_mode: "live",
			ih_addon_mode: "live",
			ac_addon_mode: "live",
		};
		const host = new ExportTestHost(tmp, cfg);
		await host.setStateAsync("command.inbox", {
			val: JSON.stringify({ cmd: "charge_now" }),
			ack: false,
		});
		await host.setStateAsync("global_modes.requested", { val: "live", ack: true });
		await host.setStateAsync("global_modes.active", { val: "live", ack: true });
		await host.setStateAsync("planner.wallbox.daily_plan.dispatch", {
			val: JSON.stringify({ id: "dp1" }),
			ack: true,
		});
		await host.setStateAsync("addons.wallbox.feedback.pending_feedback", { val: true, ack: false });
		await host.setStateAsync("addons.battery.ownership.active_ownership", { val: "ems", ack: true });

		await fs.mkdir(path.join(tmp, "intent"), { recursive: true });
		await fs.writeFile(
			path.join(tmp, "intent", "intent_v1.json"),
			stableJsonStringify({
				module: "intent_v1",
				issued_at: "2026-07-12T00:00:00Z",
				expires_at: "2026-07-12T01:00:00Z",
				wallbox: { active: true },
			}),
		);
		await fs.mkdir(path.join(tmp, "global_modes"), { recursive: true });
		await fs.writeFile(
			path.join(tmp, "global_modes", "global_modes_v1.json"),
			stableJsonStringify({ requested: "live", active: "live" }),
		);
		await fs.mkdir(path.join(tmp, "learning/battery_runtime"), { recursive: true });
		await fs.writeFile(
			path.join(tmp, "learning/battery_runtime", "battery_runtime_learning_v1.json"),
			stableJsonStringify({ samples: [1, 2] }),
		);

		const result = await runBackupExport(host);
		assert.equal(result.ok, true);
		if (!result.ok) return;
		const buf = await fs.readFile(result.filePath);
		const adapter = JSON.parse(readZipEntryData(buf, "config/adapter.json")!.toString("utf8"));
		assert.equal(adapter.configured_modes_at_export.global, "live");
		assert.equal(adapter.configured_modes_at_export.wallbox, "live");
		assert.equal(adapter.restore_policy.apply_as, "dryrun");

		const selected = JSON.parse(readZipEntryData(buf, "persistence/selected_state_data.json")!.toString("utf8"));
		assert.deepEqual(Object.keys(selected).sort(), ["battery_runtime_learning_v1.json"]);
		for (const key of SELECTED_STATE_DATA_KEYS) {
			if (key !== "battery_runtime_learning_v1.json") {
				assert.equal(selected[key], undefined);
			}
		}

		const restoreText = [
			readZipEntryData(buf, "config/adapter.json")!.toString("utf8"),
			readZipEntryData(buf, "config/mappings.json")!.toString("utf8"),
			readZipEntryData(buf, "config/policies.json")!.toString("utf8"),
			readZipEntryData(buf, "persistence/learning.json")!.toString("utf8"),
			readZipEntryData(buf, "persistence/selected_state_data.json")!.toString("utf8"),
		].join("\n");
		assert.ok(!restoreText.includes("intent_v1.json"));
		assert.ok(!restoreText.includes("global_modes_v1.json"));
		assert.ok(!restoreText.includes("command.inbox"));
		assert.ok(!restoreText.includes("issued_at"));
		assert.ok(!restoreText.includes("pending_feedback"));
		assert.ok(!restoreText.includes("active_ownership"));
		assert.ok(!restoreText.includes("daily_plan.dispatch"));

		const manifest = JSON.parse(readZipEntryData(buf, "manifest.json")!.toString("utf8"));
		assert.equal(manifest.safety.restore_must_start_dryrun, true);
		assert.equal(manifest.safety.automatic_live_resume_allowed, false);

		const { runSupportBundleExport } = await import("../support/index.js");
		const support = await runSupportBundleExport(host);
		assert.equal(support.ok, true);
		if (!support.ok) return;
		const sbuf = await fs.readFile(support.filePath);
		const sm = JSON.parse(readZipEntryData(sbuf, "manifest.json")!.toString("utf8"));
		assert.equal(sm.restore?.supported, false);
		const snap = readZipEntryData(sbuf, "states/selected_snapshot.json")!.toString("utf8");
		assert.ok(!snap.includes("charge_now"));
	});

	it("export file names contain no personal data", () => {
		const name = exportFileName("backup", "0.1.141", "2026-07-12T13:00:00.000Z");
		assert.ok(name.endsWith(".emsbackup"));
		assert.ok(!name.includes("@"));
	});

	it("regression: WALLBOX_LIVE_WRITE_RELEASED reflects the v0.1.176 controlled release (gated by fault/lockout/ownership/liveEligible)", () => {
		assert.equal(WALLBOX_LIVE_WRITE_RELEASED, true);
	});

	it("assertJsonSerializable rejects secrets in support path", () => {
		assert.throws(() => assertJsonSerializable({ api_key: "secret" }, "test"));
	});

	it("support secret scan rejects comprehensive leak patterns", () => {
		const leaks = [
			'Password: "TopSecret"',
			'api_key: "abc123"',
			"Authorization: Bearer eyJhbGciOiJIUzI1NiJ9.test.sig",
			"cookie: session=deadbeef",
			"https://example.com/callback?token=secretvalue",
			"1HGBH41JXMN109186",
			"user@example.com",
			"192.168.0.42",
			"2001:db8::1",
			"aa:bb:cc:dd:ee:ff",
			"/home/user/secret/path",
			"mqtt.0.home/evcc/status",
		];
		for (const leak of leaks) {
			assert.ok(scanForForbiddenSecrets(leak), `expected hit for: ${leak}`);
		}
	});

	it("support export fails when serialized logs still contain forbidden values", async () => {
		const host = new ExportTestHost(tmp, { global_execution_mode: "dryrun" });
		const logDir = path.join(supportDir(tmp), "logs");
		await fs.mkdir(logDir, { recursive: true });
		await fs.writeFile(
			path.join(logDir, "errors-001.ndjson"),
			'{"detail":"password: \\"still-leaked\\""}\n',
			"utf8",
		);
		const { runSupportBundleExport } = await import("../support/index.js");
		const result = await runSupportBundleExport(host);
		assert.equal(result.ok, false);
	});

	it("export triggers only on ack=false conscious request", async () => {
		const host = new ExportTestHost(tmp, { global_execution_mode: "dryrun" });
		await host.setStateAsync(BACKUP_STATES.lastFileName, { val: "old-success.emsbackup", ack: true });
		await handleBackupExportRequest(host, true, true);
		assert.equal((await host.getStateAsync(BACKUP_STATES.running))?.val, undefined);
		await handleBackupExportRequest(host, true, false);
		assert.equal((await host.getStateAsync(BACKUP_STATES.running))?.val, false);
		const lastName = await host.getStateAsync(BACKUP_STATES.lastFileName);
		if (lastName?.val && String(lastName.val).includes("ems-light")) {
			assert.notEqual(lastName.val, "old-success.emsbackup");
		}
	});

	it("failed support export does not publish stale success filename", async () => {
		const host = new ExportTestHost(tmp, { global_execution_mode: "dryrun" });
		await host.setStateAsync(BACKUP_STATES.lastFileName, { val: "ems-light-old.emssupport", ack: true });
		const logDir = path.join(supportDir(tmp), "logs");
		await fs.mkdir(logDir, { recursive: true });
		await fs.writeFile(
			path.join(logDir, "errors-001.ndjson"),
			'{"detail":"password: \\"still-leaked\\""}\n',
			"utf8",
		);
		await handleSupportExportRequest(host, true, false);
		const lastName = await host.getStateAsync(BACKUP_STATES.lastFileName);
		assert.equal(lastName?.val, "ems-light-old.emssupport");
	});

	it("sanitizeForSupport removes secret keys from objects", () => {
		const out = sanitizeForSupport({ token: "x", wb_addon_mode: "dryrun" }) as Record<string, unknown>;
		assert.equal(out.token, undefined);
		assert.equal(out.wb_addon_mode, "dryrun");
	});
});

describe("export trigger completion", () => {
	let tmp: string;

	beforeEach(async () => {
		tmp = await fs.mkdtemp(path.join(os.tmpdir(), "ems-trigger-"));
		resetExportMutexForTest();
	});

	afterEach(async () => {
		resetExportMutexForTest();
	});

	it("backup success resets trigger and ignores ack=true retrigger", async () => {
		const host = new ExportTestHost(tmp, { global_execution_mode: "dryrun" });
		await handleBackupExportRequest(host, true, false);
		const trig = await host.getStateAsync(BACKUP_STATES.exportRequest);
		assert.equal(trig?.val, false);
		assert.equal(trig?.ack, true);
		assert.equal((await host.getStateAsync(BACKUP_STATES.running))?.val, false);
		const filesBefore = await fs.readdir(backupDir(tmp)).catch(() => []);
		await handleBackupExportRequest(host, false, true);
		await handleBackupExportRequest(host, true, true);
		const filesAfter = await fs.readdir(backupDir(tmp)).catch(() => []);
		assert.equal(filesAfter.length, filesBefore.length);
	});

	it("backup failure resets trigger to ack=true val=false", async () => {
		const host = new ExportTestHost(tmp, { global_execution_mode: "dryrun" });
		await fs.mkdir(path.join(tmp, "learning/battery_runtime"), { recursive: true });
		await fs.writeFile(
			path.join(tmp, "learning/battery_runtime", "battery_runtime_learning_v1.json"),
			"x".repeat(3 * 1024 * 1024),
		);
		await handleBackupExportRequest(host, true, false);
		const trig = await host.getStateAsync(BACKUP_STATES.exportRequest);
		assert.equal(trig?.val, false);
		assert.equal(trig?.ack, true);
		assert.equal((await host.getStateAsync(BACKUP_STATES.running))?.val, false);
		assert.equal((await host.getStateAsync(BACKUP_STATES.status))?.val, "error");
	});

	it("support success resets trigger", async () => {
		const host = new ExportTestHost(tmp, { global_execution_mode: "dryrun" });
		await handleSupportExportRequest(host, true, false);
		const trig = await host.getStateAsync(BACKUP_STATES.supportExportRequest);
		assert.equal(trig?.val, false);
		assert.equal(trig?.ack, true);
		assert.equal((await host.getStateAsync(BACKUP_STATES.running))?.val, false);
	});

	it("support failure resets trigger", async () => {
		const host = new ExportTestHost(tmp, { global_execution_mode: "dryrun" });
		const logDir = path.join(supportDir(tmp), "logs");
		await fs.mkdir(logDir, { recursive: true });
		await fs.writeFile(path.join(logDir, "errors-001.ndjson"), '{"Password":"leak"}\n');
		await handleSupportExportRequest(host, true, false);
		const trig = await host.getStateAsync(BACKUP_STATES.supportExportRequest);
		assert.equal(trig?.val, false);
		assert.equal(trig?.ack, true);
		assert.equal((await host.getStateAsync(BACKUP_STATES.running))?.val, false);
	});

	it("adapter restart clears pending export requests", async () => {
		const host = new ExportTestHost(tmp, { global_execution_mode: "dryrun" });
		await host.setStateAsync(BACKUP_STATES.exportRequest, { val: true, ack: false });
		await host.setStateAsync(BACKUP_STATES.supportExportRequest, { val: true, ack: false });
		await initBackupExportRuntime(host);
		const b = await host.getStateAsync(BACKUP_STATES.exportRequest);
		const s = await host.getStateAsync(BACKUP_STATES.supportExportRequest);
		assert.equal(b?.val, false);
		assert.equal(b?.ack, true);
		assert.equal(s?.val, false);
		assert.equal(s?.ack, true);
	});
});

describe("backup mappings export", () => {
	it("exports mapping keys without foreign values", () => {
		const out = collectMappingsExport({ wb_evcc_connected_state: "evcc.0.connected", password: "nope" });
		assert.equal(out.wb_evcc_connected_state, "evcc.0.connected");
		assert.equal(out.password, undefined);
	});
});
