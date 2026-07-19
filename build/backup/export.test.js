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
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const strict_1 = __importDefault(require("node:assert/strict"));
const fs = __importStar(require("node:fs/promises"));
const os = __importStar(require("node:os"));
const path = __importStar(require("node:path"));
const archive_js_1 = require("./archive.js");
const checksum_js_1 = require("./checksum.js");
const collect_config_js_1 = require("./collect_config.js");
const collect_persistence_js_1 = require("./collect_persistence.js");
const manifest_js_1 = require("./manifest.js");
const manifest_validate_js_1 = require("./manifest_validate.js");
const inventory_js_1 = require("./inventory.js");
const retention_js_1 = require("./retention.js");
const sanitize_js_1 = require("./sanitize.js");
const schema_js_1 = require("./schema.js");
const service_js_1 = require("./service.js");
const export_handler_js_1 = require("./export_handler.js");
const ensure_states_js_1 = require("./ensure_states.js");
const execute_js_1 = require("../addons/wallbox/runtime/execute.js");
const diagnostic_mode_js_1 = require("../support/diagnostic_mode.js");
const log_rotation_js_1 = require("../support/log_rotation.js");
function profileRow(id, name) {
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
    namespace = "ems.0";
    objects = new Map();
    states = new Map();
    config;
    common = { version: "0.1.141" };
    dataDir;
    constructor(dataDir, config = {}) {
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
    };
    getAbsoluteInstanceDataDir() {
        return this.dataDir;
    }
    async getStateAsync(id) {
        const s = this.states.get(id);
        return s ? { val: s.val, ack: s.ack, ts: 0, lc: 0, from: "test" } : null;
    }
    async setStateAsync(id, st) {
        this.states.set(id, { val: st.val, ack: st.ack ?? false });
    }
    async getObjectAsync(id) {
        return this.objects.get(id) ?? null;
    }
    async setObjectNotExistsAsync(id, obj) {
        if (!this.objects.has(id))
            this.objects.set(id, { ...obj, _id: id });
    }
}
(0, node_test_1.describe)("backup export v0.1.141", () => {
    let tmp;
    (0, node_test_1.beforeEach)(async () => {
        tmp = await fs.mkdtemp(path.join(os.tmpdir(), "ems-export-"));
        (0, service_js_1.resetExportMutexForTest)();
        (0, diagnostic_mode_js_1.resetDiagnosticModeForTest)();
    });
    (0, node_test_1.afterEach)(async () => {
        (0, service_js_1.resetExportMutexForTest)();
        (0, diagnostic_mode_js_1.resetDiagnosticModeForTest)();
    });
    (0, node_test_1.it)("exports empty default config backup", async () => {
        const host = new ExportTestHost(tmp, { global_execution_mode: "dryrun" });
        const result = await (0, service_js_1.runBackupExport)(host);
        strict_1.default.equal(result.ok, true);
        if (!result.ok)
            return;
        const buf = await fs.readFile(result.filePath);
        const names = (0, archive_js_1.readZipEntryNames)(buf);
        strict_1.default.ok(names.includes("manifest.json"));
        strict_1.default.ok(names.includes("config/adapter.json"));
    });
    (0, node_test_1.it)("exports full addon config and five vehicle profiles", async () => {
        const profiles = Array.from({ length: 5 }, (_, i) => profileRow(`car_${i + 1}`, `Car ${i + 1}`));
        const cfg = {
            global_execution_mode: "live",
            wb_addon_mode: "live",
            bat_addon_mode: "dryrun",
            wb_vehicle_profiles: profiles,
            wb_evcc_connected_state: "evcc.0.connected",
            api_key: "secret-should-drop",
        };
        const exported = (0, collect_config_js_1.collectAdapterConfigExport)(cfg);
        strict_1.default.equal(exported.restore_policy.apply_as, "dryrun");
        strict_1.default.equal(exported.configured_modes_at_export.global, "live");
        strict_1.default.equal(exported.allowed_native.api_key, undefined);
        const vp = (0, collect_config_js_1.collectVehicleProfilesExport)(cfg);
        strict_1.default.equal(vp.profiles.length, 5);
    });
    (0, node_test_1.it)("allowlist excludes secrets and unknown keys", () => {
        const out = (0, collect_config_js_1.filterAllowlistedConfig)({
            global_execution_mode: "dryrun",
            password: "x",
            random_unknown_field: 1,
            wb_addon_mode: "dryrun",
        });
        strict_1.default.equal(out.global_execution_mode, "dryrun");
        strict_1.default.equal(out.password, undefined);
        strict_1.default.equal(out.random_unknown_field, undefined);
    });
    (0, node_test_1.it)("vehicle profile allowlist drops unknown and nested fields", () => {
        const row = (0, collect_config_js_1.filterVehicleProfileRow)({
            vehicle_id: "car_1",
            display_name: "Car",
            unknown_harmless: "drop",
            unknown_secret: "drop",
            nested: { secret: "x" },
        });
        strict_1.default.equal(row.vehicle_id, "car_1");
        strict_1.default.equal(row.unknown_harmless, undefined);
        strict_1.default.equal(row.nested, undefined);
    });
    (0, node_test_1.it)("mapping export excludes unknown nested addon objects", () => {
        const out = (0, collect_config_js_1.collectMappingsExport)({
            wb_evcc_connected_state: "evcc.0.connected",
            mapping: {
                wallbox: { wb_power_target: "mqtt.0/power", unknown_nested: { api_key: "secret" } },
                unknown_addon: { foo: "bar" },
            },
        });
        const mapping = out.mapping;
        strict_1.default.ok(mapping.wallbox);
        strict_1.default.equal(mapping.wallbox.unknown_nested, undefined);
        strict_1.default.equal(mapping.unknown_addon, undefined);
    });
    (0, node_test_1.it)("transient states are classified", () => {
        strict_1.default.equal((0, collect_persistence_js_1.isTransientStateId)("command.inbox"), true);
        strict_1.default.equal((0, collect_persistence_js_1.isTransientStateId)("addons.wallbox.telemetry.soc_pct"), true);
        strict_1.default.equal((0, collect_persistence_js_1.isTransientStateId)("addons.wallbox.config.enabled"), false);
    });
    (0, node_test_1.it)("support bundle uses shared core and anonymizes secrets", async () => {
        const secret = "ACCESS_TOKEN_SECRET_XYZ_991_UNIQUE";
        const host = new ExportTestHost(tmp, {
            wb_evcc_connected_state: "mqtt.0.home/evcc/connected",
            wb_vehicle_profiles: [profileRow("vin123456789012345", "My Car")],
            access_token: secret,
        });
        const { runSupportBundleExport } = await Promise.resolve().then(() => __importStar(require("../support/index.js")));
        const result = await runSupportBundleExport(host);
        strict_1.default.equal(result.ok, true);
        if (!result.ok)
            return;
        const buf = await fs.readFile(result.filePath);
        const text = buf.toString("utf8");
        strict_1.default.ok(!text.includes("access_token"));
        strict_1.default.ok(!text.includes(secret));
    });
    (0, node_test_1.it)("sanitizer pseudonyms are stable within one bundle", () => {
        const ctx = (0, sanitize_js_1.createPseudonymContext)();
        const input = "mqtt.0.home/evcc/connected";
        const a = (0, sanitize_js_1.sanitizeValue)(input, ctx, "wb_evcc_connected_state");
        const b = (0, sanitize_js_1.sanitizeValue)(input, ctx, "wb_evcc_connected_state");
        strict_1.default.equal(a, b);
        strict_1.default.ok(String(a).startsWith("foreign_state_"));
    });
    (0, node_test_1.it)("sanitizer removes VIN and IP patterns from support scan", () => {
        const hit = (0, sanitize_js_1.scanForForbiddenSecrets)("vehicle VIN 1HGBH41JXMN109186 at 192.168.1.10");
        strict_1.default.ok(hit);
    });
    (0, node_test_1.it)("manifest validates safety block and restore policy", () => {
        const files = (0, manifest_js_1.buildManifestFileEntries)([{ path: "config/adapter.json", content: "{}" }]);
        const m = (0, manifest_js_1.buildExportManifest)({
            kind: "backup",
            adapterVersion: "0.1.141",
            instance: 0,
            namespace: "ems.0",
            files,
        });
        (0, schema_js_1.validateManifest)(m, "backup");
        strict_1.default.equal(m.safety.restore_must_start_dryrun, true);
        strict_1.default.equal(m.safety.automatic_live_resume_allowed, false);
        const supportFiles = (0, manifest_js_1.buildManifestFileEntries)([{ path: "summary/system.json", content: "{}" }]);
        const sm = (0, manifest_js_1.buildExportManifest)({
            kind: "support",
            adapterVersion: "0.1.141",
            instance: 0,
            namespace: "ems.0",
            files: supportFiles,
        });
        (0, schema_js_1.validateManifest)(sm, "support");
        strict_1.default.equal(sm.restore?.supported, false);
    });
    (0, node_test_1.it)("manifest payload consistency requires exact file set", () => {
        const payload = [{ path: "config/adapter.json", content: "{}\n" }];
        const files = (0, manifest_js_1.buildManifestFileEntries)(payload);
        const manifest = (0, manifest_js_1.buildExportManifest)({
            kind: "backup",
            adapterVersion: "0.1.141",
            instance: 0,
            namespace: "ems.0",
            files,
        });
        (0, manifest_validate_js_1.validateManifestPayloadConsistency)(manifest, payload);
        strict_1.default.throws(() => (0, manifest_validate_js_1.validateManifestPayloadConsistency)(manifest, [
            ...payload,
            { path: "extra.json", content: "{}\n" },
        ]));
    });
    (0, node_test_1.it)("zip checksums match manifest", async () => {
        const content = (0, schema_js_1.stableJsonStringify)({ ok: true });
        const entries = [{ path: "config/adapter.json", content }];
        const files = (0, manifest_js_1.buildManifestFileEntries)(entries);
        strict_1.default.equal(files[0].sha256, (0, checksum_js_1.sha256Buffer)(content));
        const zip = (0, archive_js_1.buildZipArchive)(entries);
        strict_1.default.ok(zip.length > 0);
    });
    (0, node_test_1.it)("blocks path traversal and invalid export file names", () => {
        strict_1.default.throws(() => (0, retention_js_1.assertSafeFileName)("../evil.emsbackup"));
        strict_1.default.throws(() => (0, retention_js_1.assertSafeFileName)("foreign-backup.emsbackup"));
        strict_1.default.throws(() => (0, retention_js_1.resolveExportPath)(tmp, "../outside.emsbackup"));
    });
    (0, node_test_1.it)("retention keeps exactly 10 backups and removes oldest own files", async () => {
        const dir = (0, retention_js_1.backupDir)(tmp);
        await fs.mkdir(dir, { recursive: true });
        await fs.writeFile(path.join(dir, "foreign-backup.emsbackup"), "keep-me");
        for (let i = 0; i < retention_js_1.BACKUP_RETENTION_MAX + 1; i++) {
            const name = (0, manifest_js_1.exportFileName)("backup", "0.1.141", `2026-07-12T13:00:0${String(i).padStart(1, "0")}.000Z`);
            await fs.writeFile(path.join(dir, name), "x");
            await new Promise((r) => setTimeout(r, 5));
        }
        await (0, retention_js_1.enforceRetention)(tmp);
        const left = (await fs.readdir(dir)).filter((f) => retention_js_1.OWN_EXPORT_FILE_RE.test(f));
        strict_1.default.equal(left.length, retention_js_1.BACKUP_RETENTION_MAX);
        strict_1.default.ok((await fs.readdir(dir)).includes("foreign-backup.emsbackup"));
    });
    (0, node_test_1.it)("retention keeps exactly 5 support packages", async () => {
        const dir = (0, retention_js_1.supportDir)(tmp);
        await fs.mkdir(dir, { recursive: true });
        for (let i = 0; i < retention_js_1.SUPPORT_RETENTION_MAX + 1; i++) {
            const name = (0, manifest_js_1.exportFileName)("support", "0.1.141", `2026-07-12T14:00:0${String(i).padStart(1, "0")}.000Z`);
            await fs.writeFile(path.join(dir, name), "x");
            await new Promise((r) => setTimeout(r, 5));
        }
        await (0, retention_js_1.enforceRetention)(tmp);
        const left = (await fs.readdir(dir)).filter((f) => f.endsWith(".emssupport") && retention_js_1.OWN_EXPORT_FILE_RE.test(f));
        strict_1.default.equal(left.length, retention_js_1.SUPPORT_RETENTION_MAX);
    });
    (0, node_test_1.it)("atomic write and temp cleanup", async () => {
        const dir = (0, retention_js_1.backupDir)(tmp);
        await fs.mkdir(dir, { recursive: true });
        const name = (0, manifest_js_1.exportFileName)("backup", "0.1.141", "2026-07-12T13:00:00.000Z");
        await (0, retention_js_1.writeAtomicArchive)(path.join(dir, name), Buffer.from("ok"));
        await fs.writeFile(path.join(dir, ".tmp-stale.emsbackup"), "stale");
        await (0, retention_js_1.cleanupTempExports)(tmp);
        const left = await fs.readdir(dir);
        strict_1.default.ok(left.includes(name));
        strict_1.default.ok(!left.some((f) => f.startsWith(".tmp-")));
    });
    (0, node_test_1.it)("parallel export is rejected", async () => {
        const host = new ExportTestHost(tmp);
        strict_1.default.equal((0, service_js_1.isExportRunning)(), false);
        const p1 = (0, service_js_1.runExport)(host, "backup");
        strict_1.default.equal((0, service_js_1.isExportRunning)(), true);
        const p2 = await (0, service_js_1.runExport)(host, "backup");
        strict_1.default.equal(p2.ok, false);
        if (!p2.ok)
            strict_1.default.equal(p2.error, "operation_already_running");
        const r1 = await p1;
        strict_1.default.equal(r1.ok, true);
    });
    (0, node_test_1.it)("diagnostic mode rejects invalid durations", () => {
        strict_1.default.equal((0, diagnostic_mode_js_1.startDiagnosticMode)(999).ok, false);
        strict_1.default.equal((0, diagnostic_mode_js_1.startDiagnosticMode)(45).ok, false);
        for (const d of diagnostic_mode_js_1.DIAGNOSTIC_ALLOWED_DURATIONS) {
            const started = (0, diagnostic_mode_js_1.startDiagnosticMode)(d);
            strict_1.default.equal(started.ok, true);
        }
    });
    (0, node_test_1.it)("diagnostic mode is off after adapter restart init", async () => {
        (0, diagnostic_mode_js_1.startDiagnosticMode)(15);
        strict_1.default.equal((0, diagnostic_mode_js_1.isDiagnosticModeActive)(), true);
        const host = new ExportTestHost(tmp);
        await (0, export_handler_js_1.initBackupExportRuntime)(host);
        strict_1.default.equal((0, diagnostic_mode_js_1.isDiagnosticModeActive)(), false);
        const mode = await host.getStateAsync(ensure_states_js_1.SUPPORT_STATES.diagnosticMode);
        strict_1.default.equal(mode?.val, false);
    });
    (0, node_test_1.it)("log rotation enforces size limits", async () => {
        const logDir = path.join(tmp, "logs");
        const big = "x".repeat(1024);
        for (let i = 0; i < 300; i++) {
            await (0, log_rotation_js_1.appendNdjsonRotating)(logDir, "errors", { n: i, big }, { maxFiles: 4, maxFileBytes: 256 * 1024, totalMaxBytes: 512 * 1024 });
        }
        const files = await fs.readdir(logDir);
        strict_1.default.ok(files.length <= 4);
    });
    (0, node_test_1.it)("inventory lists persistence classification", () => {
        const inv = (0, inventory_js_1.inventoryExportJson)();
        strict_1.default.ok(inv.sources.some((s) => s.id === "vehicle_rollforward" && s.category === "support_only"));
        strict_1.default.ok(inv.sources.some((s) => s.id === "adapter_config" && s.category === "restorable"));
        strict_1.default.ok(inv.sources.some((s) => s.id === "intent_persist" && s.category === "transient"));
        strict_1.default.ok(inv.sources.some((s) => s.id === "global_modes" && s.category === "transient"));
    });
    (0, node_test_1.it)("selected_state_data contains only learning file keys", () => {
        strict_1.default.deepEqual(collect_persistence_js_1.SELECTED_STATE_DATA_KEYS, [
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
    (0, node_test_1.it)("excludes active runtime state from restore files", async () => {
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
        await fs.writeFile(path.join(tmp, "intent", "intent_v1.json"), (0, schema_js_1.stableJsonStringify)({
            module: "intent_v1",
            issued_at: "2026-07-12T00:00:00Z",
            expires_at: "2026-07-12T01:00:00Z",
            wallbox: { active: true },
        }));
        await fs.mkdir(path.join(tmp, "global_modes"), { recursive: true });
        await fs.writeFile(path.join(tmp, "global_modes", "global_modes_v1.json"), (0, schema_js_1.stableJsonStringify)({ requested: "live", active: "live" }));
        await fs.mkdir(path.join(tmp, "learning/battery_runtime"), { recursive: true });
        await fs.writeFile(path.join(tmp, "learning/battery_runtime", "battery_runtime_learning_v1.json"), (0, schema_js_1.stableJsonStringify)({ samples: [1, 2] }));
        const result = await (0, service_js_1.runBackupExport)(host);
        strict_1.default.equal(result.ok, true);
        if (!result.ok)
            return;
        const buf = await fs.readFile(result.filePath);
        const adapter = JSON.parse((0, archive_js_1.readZipEntryData)(buf, "config/adapter.json").toString("utf8"));
        strict_1.default.equal(adapter.configured_modes_at_export.global, "live");
        strict_1.default.equal(adapter.configured_modes_at_export.wallbox, "live");
        strict_1.default.equal(adapter.restore_policy.apply_as, "dryrun");
        const selected = JSON.parse((0, archive_js_1.readZipEntryData)(buf, "persistence/selected_state_data.json").toString("utf8"));
        strict_1.default.deepEqual(Object.keys(selected).sort(), ["battery_runtime_learning_v1.json"]);
        for (const key of collect_persistence_js_1.SELECTED_STATE_DATA_KEYS) {
            if (key !== "battery_runtime_learning_v1.json") {
                strict_1.default.equal(selected[key], undefined);
            }
        }
        const restoreText = [
            (0, archive_js_1.readZipEntryData)(buf, "config/adapter.json").toString("utf8"),
            (0, archive_js_1.readZipEntryData)(buf, "config/mappings.json").toString("utf8"),
            (0, archive_js_1.readZipEntryData)(buf, "config/policies.json").toString("utf8"),
            (0, archive_js_1.readZipEntryData)(buf, "persistence/learning.json").toString("utf8"),
            (0, archive_js_1.readZipEntryData)(buf, "persistence/selected_state_data.json").toString("utf8"),
        ].join("\n");
        strict_1.default.ok(!restoreText.includes("intent_v1.json"));
        strict_1.default.ok(!restoreText.includes("global_modes_v1.json"));
        strict_1.default.ok(!restoreText.includes("command.inbox"));
        strict_1.default.ok(!restoreText.includes("issued_at"));
        strict_1.default.ok(!restoreText.includes("pending_feedback"));
        strict_1.default.ok(!restoreText.includes("active_ownership"));
        strict_1.default.ok(!restoreText.includes("daily_plan.dispatch"));
        const manifest = JSON.parse((0, archive_js_1.readZipEntryData)(buf, "manifest.json").toString("utf8"));
        strict_1.default.equal(manifest.safety.restore_must_start_dryrun, true);
        strict_1.default.equal(manifest.safety.automatic_live_resume_allowed, false);
        const { runSupportBundleExport } = await Promise.resolve().then(() => __importStar(require("../support/index.js")));
        const support = await runSupportBundleExport(host);
        strict_1.default.equal(support.ok, true);
        if (!support.ok)
            return;
        const sbuf = await fs.readFile(support.filePath);
        const sm = JSON.parse((0, archive_js_1.readZipEntryData)(sbuf, "manifest.json").toString("utf8"));
        strict_1.default.equal(sm.restore?.supported, false);
        const snap = (0, archive_js_1.readZipEntryData)(sbuf, "states/selected_snapshot.json").toString("utf8");
        strict_1.default.ok(!snap.includes("charge_now"));
    });
    (0, node_test_1.it)("export file names contain no personal data", () => {
        const name = (0, manifest_js_1.exportFileName)("backup", "0.1.141", "2026-07-12T13:00:00.000Z");
        strict_1.default.ok(name.endsWith(".emsbackup"));
        strict_1.default.ok(!name.includes("@"));
    });
    (0, node_test_1.it)("regression: WALLBOX_LIVE_WRITE_RELEASED stays false", () => {
        strict_1.default.equal(execute_js_1.WALLBOX_LIVE_WRITE_RELEASED, false);
    });
    (0, node_test_1.it)("assertJsonSerializable rejects secrets in support path", () => {
        strict_1.default.throws(() => (0, schema_js_1.assertJsonSerializable)({ api_key: "secret" }, "test"));
    });
    (0, node_test_1.it)("support secret scan rejects comprehensive leak patterns", () => {
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
            strict_1.default.ok((0, sanitize_js_1.scanForForbiddenSecrets)(leak), `expected hit for: ${leak}`);
        }
    });
    (0, node_test_1.it)("support export fails when serialized logs still contain forbidden values", async () => {
        const host = new ExportTestHost(tmp, { global_execution_mode: "dryrun" });
        const logDir = path.join((0, retention_js_1.supportDir)(tmp), "logs");
        await fs.mkdir(logDir, { recursive: true });
        await fs.writeFile(path.join(logDir, "errors-001.ndjson"), '{"detail":"password: \\"still-leaked\\""}\n', "utf8");
        const { runSupportBundleExport } = await Promise.resolve().then(() => __importStar(require("../support/index.js")));
        const result = await runSupportBundleExport(host);
        strict_1.default.equal(result.ok, false);
    });
    (0, node_test_1.it)("export triggers only on ack=false conscious request", async () => {
        const host = new ExportTestHost(tmp, { global_execution_mode: "dryrun" });
        await host.setStateAsync(ensure_states_js_1.BACKUP_STATES.lastFileName, { val: "old-success.emsbackup", ack: true });
        await (0, export_handler_js_1.handleBackupExportRequest)(host, true, true);
        strict_1.default.equal((await host.getStateAsync(ensure_states_js_1.BACKUP_STATES.running))?.val, undefined);
        await (0, export_handler_js_1.handleBackupExportRequest)(host, true, false);
        strict_1.default.equal((await host.getStateAsync(ensure_states_js_1.BACKUP_STATES.running))?.val, false);
        const lastName = await host.getStateAsync(ensure_states_js_1.BACKUP_STATES.lastFileName);
        if (lastName?.val && String(lastName.val).includes("ems-light")) {
            strict_1.default.notEqual(lastName.val, "old-success.emsbackup");
        }
    });
    (0, node_test_1.it)("failed support export does not publish stale success filename", async () => {
        const host = new ExportTestHost(tmp, { global_execution_mode: "dryrun" });
        await host.setStateAsync(ensure_states_js_1.BACKUP_STATES.lastFileName, { val: "ems-light-old.emssupport", ack: true });
        const logDir = path.join((0, retention_js_1.supportDir)(tmp), "logs");
        await fs.mkdir(logDir, { recursive: true });
        await fs.writeFile(path.join(logDir, "errors-001.ndjson"), '{"detail":"password: \\"still-leaked\\""}\n', "utf8");
        await (0, export_handler_js_1.handleSupportExportRequest)(host, true, false);
        const lastName = await host.getStateAsync(ensure_states_js_1.BACKUP_STATES.lastFileName);
        strict_1.default.equal(lastName?.val, "ems-light-old.emssupport");
    });
    (0, node_test_1.it)("sanitizeForSupport removes secret keys from objects", () => {
        const out = (0, sanitize_js_1.sanitizeForSupport)({ token: "x", wb_addon_mode: "dryrun" });
        strict_1.default.equal(out.token, undefined);
        strict_1.default.equal(out.wb_addon_mode, "dryrun");
    });
});
(0, node_test_1.describe)("export trigger completion", () => {
    let tmp;
    (0, node_test_1.beforeEach)(async () => {
        tmp = await fs.mkdtemp(path.join(os.tmpdir(), "ems-trigger-"));
        (0, service_js_1.resetExportMutexForTest)();
    });
    (0, node_test_1.afterEach)(async () => {
        (0, service_js_1.resetExportMutexForTest)();
    });
    (0, node_test_1.it)("backup success resets trigger and ignores ack=true retrigger", async () => {
        const host = new ExportTestHost(tmp, { global_execution_mode: "dryrun" });
        await (0, export_handler_js_1.handleBackupExportRequest)(host, true, false);
        const trig = await host.getStateAsync(ensure_states_js_1.BACKUP_STATES.exportRequest);
        strict_1.default.equal(trig?.val, false);
        strict_1.default.equal(trig?.ack, true);
        strict_1.default.equal((await host.getStateAsync(ensure_states_js_1.BACKUP_STATES.running))?.val, false);
        const filesBefore = await fs.readdir((0, retention_js_1.backupDir)(tmp)).catch(() => []);
        await (0, export_handler_js_1.handleBackupExportRequest)(host, false, true);
        await (0, export_handler_js_1.handleBackupExportRequest)(host, true, true);
        const filesAfter = await fs.readdir((0, retention_js_1.backupDir)(tmp)).catch(() => []);
        strict_1.default.equal(filesAfter.length, filesBefore.length);
    });
    (0, node_test_1.it)("backup failure resets trigger to ack=true val=false", async () => {
        const host = new ExportTestHost(tmp, { global_execution_mode: "dryrun" });
        await fs.mkdir(path.join(tmp, "learning/battery_runtime"), { recursive: true });
        await fs.writeFile(path.join(tmp, "learning/battery_runtime", "battery_runtime_learning_v1.json"), "x".repeat(3 * 1024 * 1024));
        await (0, export_handler_js_1.handleBackupExportRequest)(host, true, false);
        const trig = await host.getStateAsync(ensure_states_js_1.BACKUP_STATES.exportRequest);
        strict_1.default.equal(trig?.val, false);
        strict_1.default.equal(trig?.ack, true);
        strict_1.default.equal((await host.getStateAsync(ensure_states_js_1.BACKUP_STATES.running))?.val, false);
        strict_1.default.equal((await host.getStateAsync(ensure_states_js_1.BACKUP_STATES.status))?.val, "error");
    });
    (0, node_test_1.it)("support success resets trigger", async () => {
        const host = new ExportTestHost(tmp, { global_execution_mode: "dryrun" });
        await (0, export_handler_js_1.handleSupportExportRequest)(host, true, false);
        const trig = await host.getStateAsync(ensure_states_js_1.BACKUP_STATES.supportExportRequest);
        strict_1.default.equal(trig?.val, false);
        strict_1.default.equal(trig?.ack, true);
        strict_1.default.equal((await host.getStateAsync(ensure_states_js_1.BACKUP_STATES.running))?.val, false);
    });
    (0, node_test_1.it)("support failure resets trigger", async () => {
        const host = new ExportTestHost(tmp, { global_execution_mode: "dryrun" });
        const logDir = path.join((0, retention_js_1.supportDir)(tmp), "logs");
        await fs.mkdir(logDir, { recursive: true });
        await fs.writeFile(path.join(logDir, "errors-001.ndjson"), '{"Password":"leak"}\n');
        await (0, export_handler_js_1.handleSupportExportRequest)(host, true, false);
        const trig = await host.getStateAsync(ensure_states_js_1.BACKUP_STATES.supportExportRequest);
        strict_1.default.equal(trig?.val, false);
        strict_1.default.equal(trig?.ack, true);
        strict_1.default.equal((await host.getStateAsync(ensure_states_js_1.BACKUP_STATES.running))?.val, false);
    });
    (0, node_test_1.it)("adapter restart clears pending export requests", async () => {
        const host = new ExportTestHost(tmp, { global_execution_mode: "dryrun" });
        await host.setStateAsync(ensure_states_js_1.BACKUP_STATES.exportRequest, { val: true, ack: false });
        await host.setStateAsync(ensure_states_js_1.BACKUP_STATES.supportExportRequest, { val: true, ack: false });
        await (0, export_handler_js_1.initBackupExportRuntime)(host);
        const b = await host.getStateAsync(ensure_states_js_1.BACKUP_STATES.exportRequest);
        const s = await host.getStateAsync(ensure_states_js_1.BACKUP_STATES.supportExportRequest);
        strict_1.default.equal(b?.val, false);
        strict_1.default.equal(b?.ack, true);
        strict_1.default.equal(s?.val, false);
        strict_1.default.equal(s?.ack, true);
    });
});
(0, node_test_1.describe)("backup mappings export", () => {
    (0, node_test_1.it)("exports mapping keys without foreign values", () => {
        const out = (0, collect_config_js_1.collectMappingsExport)({ wb_evcc_connected_state: "evcc.0.connected", password: "nope" });
        strict_1.default.equal(out.wb_evcc_connected_state, "evcc.0.connected");
        strict_1.default.equal(out.password, undefined);
    });
});
