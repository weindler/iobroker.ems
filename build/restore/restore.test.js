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
const archive_js_1 = require("../backup/archive.js");
const collect_config_js_1 = require("../backup/collect_config.js");
const manifest_js_1 = require("../backup/manifest.js");
const schema_js_1 = require("../backup/schema.js");
const service_js_1 = require("../backup/service.js");
const operation_lock_js_1 = require("../backup/operation_lock.js");
const execute_js_1 = require("../addons/wallbox/runtime/execute.js");
const execute_js_2 = require("../addons/battery/runtime/execute.js");
const device_write_js_1 = require("../device_write.js");
const data_dir_js_1 = require("../learning/data_dir.js");
const manifest_js_2 = require("../backup_integration/manifest.js");
const paths_js_1 = require("../backup_integration/paths.js");
const zip_reader_js_1 = require("./zip_reader.js");
const validate_archive_js_1 = require("./validate_archive.js");
const source_js_1 = require("./source.js");
const projection_js_1 = require("./projection.js");
const plan_js_1 = require("./plan.js");
const types_js_1 = require("./types.js");
const apply_js_1 = require("./apply.js");
const barrier_js_1 = require("./barrier.js");
const journal_js_1 = require("./journal.js");
const startup_recovery_js_1 = require("./startup_recovery.js");
const learning_map_js_1 = require("./learning_map.js");
const diagnostic_mode_js_1 = require("../support/diagnostic_mode.js");
/** Store-ZIP unabhängig von buildZipArchive (Python zipfile). */
const INDEPENDENT_STORE_ZIP_B64 = "UEsDBBQAAAAAAHZD7Fx8xiG9GQAAABkAAAAVAAAAaW5kZXBlbmRlbnQvaGVsbG8udHh0aGVsbG8taW5kZXBlbmRlbnQtZml4dHVyZVBLAwQUAAAAAAB2Q+xciEF/wgwAAAAMAAAAFQAAAGluZGVwZW5kZW50L2RhdGEuanNvbnsib2siOnRydWV9ClBLAQIUAxQAAAAAAHZD7Fx8xiG9GQAAABkAAAAVAAAAAAAAAAAAAACAAQAAAABpbmRlcGVuZGVudC9oZWxsby50eHRQSwECFAMUAAAAAAB2Q+xciEF/wgwAAAAMAAAAFQAAAAAAAAAAAAAAgAFMAAAAaW5kZXBlbmRlbnQvZGF0YS5qc29uUEsFBgAAAAACAAIAhgAAAIsAAAAAAA==";
function okBatteryGate() {
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
function mapRow(evccId, name) {
    return {
        evcc_vehicle_id: evccId,
        display_name: name,
        enabled: true,
        battery_capacity_net_kwh: 60,
        max_ac_charge_power_w: 11000,
    };
}
class RestoreTestHost {
    namespace = "ems.0";
    objects = new Map();
    states = new Map();
    config;
    common = { version: "0.1.142" };
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
    async updateConfig(next) {
        this.config = { ...next };
    }
}
async function copyBackupToInbox(host, fileName) {
    const result = await (0, service_js_1.runBackupExport)(host);
    strict_1.default.equal(result.ok, true);
    if (!result.ok)
        throw new Error("export failed");
    const target = fileName ?? path.basename(result.filePath);
    const inbox = (0, source_js_1.restoreInboxDir)(host);
    await fs.mkdir(inbox, { recursive: true });
    await fs.copyFile(result.filePath, path.join(inbox, target));
    return { fileName: target, sha256: result.sha256 };
}
async function writeLearningFixture(host, key, data) {
    const target = learning_map_js_1.RESTORE_LEARNING_TARGETS[key];
    const base = (0, data_dir_js_1.learningDataPath)(host, target.category);
    await fs.mkdir(base, { recursive: true });
    await fs.writeFile(path.join(base, target.fileName), (0, schema_js_1.stableJsonStringify)(data), { mode: 0o600 });
}
(0, node_test_1.describe)("restore zip reader", () => {
    (0, node_test_1.it)("reads independent python-generated store zip", () => {
        const buf = Buffer.from(INDEPENDENT_STORE_ZIP_B64, "base64");
        const entries = (0, zip_reader_js_1.readStoreZipArchive)(buf);
        strict_1.default.equal(entries.length, 2);
        const hello = entries.find((e) => e.path === "independent/hello.txt");
        strict_1.default.ok(hello);
        strict_1.default.equal(hello.data.toString("utf8"), "hello-independent-fixture");
    });
    (0, node_test_1.it)("detects crc mismatch", () => {
        const buf = Buffer.from(INDEPENDENT_STORE_ZIP_B64, "base64");
        const needle = Buffer.from("hello-independent-fixture");
        const idx = buf.indexOf(needle);
        strict_1.default.ok(idx >= 0);
        buf[idx] ^= 0xff;
        strict_1.default.throws(() => (0, zip_reader_js_1.readStoreZipArchive)(buf), /crc mismatch/);
    });
    (0, node_test_1.it)("rejects duplicate paths", () => {
        strict_1.default.throws(() => (0, archive_js_1.buildZipArchive)([
            { path: "a.txt", content: "1" },
            { path: "a.txt", content: "2" },
        ]), /duplicate archive path/);
    });
    (0, node_test_1.it)("rejects absolute and traversal paths via reader", () => {
        const entries = [{ path: "../evil.txt", content: "x" }];
        strict_1.default.throws(() => (0, archive_js_1.buildZipArchive)(entries));
    });
});
(0, node_test_1.describe)("restore source validation", () => {
    let tmp;
    (0, node_test_1.beforeEach)(async () => {
        tmp = await fs.mkdtemp(path.join(os.tmpdir(), "ems-restore-src-"));
    });
    (0, node_test_1.it)("accepts valid .emsbackup file names only", () => {
        strict_1.default.throws(() => (0, source_js_1.assertRestoreFileName)("../x.emsbackup"));
        strict_1.default.throws(() => (0, source_js_1.assertRestoreFileName)("x.emssupport"));
        strict_1.default.throws(() => (0, source_js_1.assertRestoreFileName)(".tmp-x.emsbackup"));
        strict_1.default.doesNotThrow(() => (0, source_js_1.assertRestoreFileName)("ems-light-0.1.142-backup-20260712T120000Z.emsbackup"));
    });
    (0, node_test_1.it)("resolves paths inside backup dir or inbox", () => {
        const name = "ems-light-0.1.142-backup-20260712T120000Z.emsbackup";
        const resolver = { namespace: "ems.0", getAbsoluteInstanceDataDir: () => tmp };
        const inBackup = (0, source_js_1.resolveRestoreSourcePath)(resolver, name);
        strict_1.default.equal(inBackup.rootKind, "backup_dir");
        const inbox = path.join((0, source_js_1.restoreInboxDir)(resolver), name);
        strict_1.default.equal((0, source_js_1.resolveRestoreSourcePath)(resolver, name).path, inBackup.path);
        void inbox;
    });
});
(0, node_test_1.describe)("restore archive validation", () => {
    let tmp;
    let host;
    (0, node_test_1.beforeEach)(async () => {
        tmp = await fs.mkdtemp(path.join(os.tmpdir(), "ems-restore-val-"));
        (0, service_js_1.resetExportMutexForTest)();
        (0, operation_lock_js_1.resetOperationLockForTest)();
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
    (0, node_test_1.afterEach)(async () => {
        (0, service_js_1.resetExportMutexForTest)();
        (0, operation_lock_js_1.resetOperationLockForTest)();
        await fs.rm(tmp, { recursive: true, force: true }).catch(() => undefined);
    });
    (0, node_test_1.it)("validates v0.1.141-style .emsbackup from export", async () => {
        const { fileName } = await copyBackupToInbox(host);
        const resolved = (0, source_js_1.resolveRestoreSourcePath)(tmp, fileName);
        const buf = await fs.readFile(resolved.path);
        const validated = (0, validate_archive_js_1.validateRestoreArchiveBuffer)(buf);
        strict_1.default.equal(validated.manifest.kind, "backup");
        strict_1.default.equal(validated.manifest.safety.restore_must_start_dryrun, true);
    });
    (0, node_test_1.it)("rejects .emssupport package type", async () => {
        const support = await (0, service_js_1.runSupportExport)(host, async () => [
            { path: "logs/errors.ndjson", content: '{"event":"test"}\n' },
        ]);
        strict_1.default.equal(support.ok, true);
        if (!support.ok)
            return;
        const buf = await fs.readFile(support.filePath);
        strict_1.default.throws(() => (0, validate_archive_js_1.validateRestoreArchiveBuffer)(buf), /manifest kind mismatch|only backup archives are restorable|support packages not restorable/);
    });
    (0, node_test_1.it)("rejects extra non-manifest payload file", async () => {
        const { fileName } = await copyBackupToInbox(host);
        const resolved = (0, source_js_1.resolveRestoreSourcePath)(tmp, fileName);
        let buf = await fs.readFile(resolved.path);
        const entries = (0, zip_reader_js_1.readStoreZipArchive)(buf).map((e) => ({ path: e.path, content: e.data }));
        entries.push({ path: "extra/evil.json", content: Buffer.from("{}") });
        buf = (0, archive_js_1.buildZipArchive)(entries);
        strict_1.default.throws(() => (0, validate_archive_js_1.validateRestoreArchiveBuffer)(buf), /non-manifest payload/);
    });
    (0, node_test_1.it)("rejects wrong adapter name in manifest", () => {
        const payload = [{ path: "config/adapter.json", content: "{}\n" }];
        const files = (0, manifest_js_1.buildManifestFileEntries)(payload);
        const manifest = (0, manifest_js_1.buildExportManifest)({
            kind: "backup",
            adapterVersion: "0.1.142",
            instance: 0,
            namespace: "ems.0",
            files,
        });
        manifest.adapter.name = "other";
        strict_1.default.throws(() => (0, validate_archive_js_1.assertRestoreManifest)(manifest), /invalid adapter name/);
    });
    (0, node_test_1.it)("rejects invalid safety block", () => {
        const payload = [{ path: "config/adapter.json", content: "{}\n" }];
        const files = (0, manifest_js_1.buildManifestFileEntries)(payload);
        const manifest = (0, manifest_js_1.buildExportManifest)({
            kind: "backup",
            adapterVersion: "0.1.142",
            instance: 0,
            namespace: "ems.0",
            files,
        });
        manifest.safety.restore_must_start_dryrun = false;
        strict_1.default.throws(() => (0, validate_archive_js_1.assertRestoreManifest)(manifest), /invalid safety block/);
    });
});
(0, node_test_1.describe)("restore projection and config merge", () => {
    (0, node_test_1.it)("preserves secrets and unknown native fields", () => {
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
        const merged = (0, projection_js_1.mergeNativeForRestore)(current, projection);
        strict_1.default.equal(merged.password, "secret");
        strict_1.default.equal(merged.custom_local_field, 42);
        strict_1.default.equal(merged.global_execution_mode, "dryrun");
        strict_1.default.equal(merged.wb_evcc_connected_state, "mqtt.0.connected");
    });
    (0, node_test_1.it)("supports five and more vehicle mini-map entries", () => {
        const entries = Array.from({ length: 6 }, (_, i) => mapRow(`id_${i}`, `Name ${i}`));
        const cfg = {
            global_execution_mode: "dryrun",
            wb_vehicle_map: entries,
        };
        const adapter = (0, collect_config_js_1.collectAdapterConfigExport)(cfg);
        const vp = (0, collect_config_js_1.collectVehicleProfilesExport)(cfg);
        const payload = new Map();
        payload.set("config/adapter.json", Buffer.from((0, schema_js_1.stableJsonStringify)(adapter)));
        payload.set("config/mappings.json", Buffer.from((0, schema_js_1.stableJsonStringify)((0, collect_config_js_1.collectMappingsExport)(cfg))));
        payload.set("config/vehicle_profiles.json", Buffer.from((0, schema_js_1.stableJsonStringify)(vp)));
        payload.set("config/policies.json", Buffer.from("{}"));
        payload.set("persistence/selected_state_data.json", Buffer.from("{}"));
        const projection = (0, projection_js_1.buildRestoreProjection)(payload);
        strict_1.default.equal(projection.native.wb_vehicle_map.length, 6);
        strict_1.default.equal(projection.configuredModesAtExport.global, "dryrun");
        strict_1.default.equal(projection.native.global_execution_mode, "dryrun");
    });
    (0, node_test_1.it)("rejects conflicting projections", () => {
        const cfg = { global_execution_mode: "dryrun", wb_evcc_connected_state: "a" };
        const adapter = (0, collect_config_js_1.collectAdapterConfigExport)(cfg);
        const mappings = { wb_evcc_connected_state: "b" };
        const payload = new Map();
        payload.set("config/adapter.json", Buffer.from((0, schema_js_1.stableJsonStringify)(adapter)));
        payload.set("config/mappings.json", Buffer.from((0, schema_js_1.stableJsonStringify)(mappings)));
        payload.set("config/vehicle_profiles.json", Buffer.from('{"entries":[]}'));
        payload.set("config/policies.json", Buffer.from("{}"));
        payload.set("persistence/selected_state_data.json", Buffer.from("{}"));
        strict_1.default.throws(() => (0, projection_js_1.buildRestoreProjection)(payload), /conflicting projection/);
    });
    (0, node_test_1.it)("plan summary contains no secrets", () => {
        const identity = {
            fileName: "ems-light-0.1.142-backup-20260712T120000Z.emsbackup",
            rootKind: "backup_dir",
            archiveSha256: "a".repeat(64),
            sizeBytes: 100,
            mtimeMs: Date.now(),
        };
        const manifest = (0, manifest_js_1.buildExportManifest)({
            kind: "backup",
            adapterVersion: "0.1.142",
            instance: 0,
            namespace: "ems.0",
            files: [],
        });
        const plan = (0, plan_js_1.createRestorePlan)({
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
        strict_1.default.ok(!summaryText.includes("must-not-appear"));
        strict_1.default.ok(!summaryText.includes("password"));
        strict_1.default.equal(plan.summary.applyModes.global, "dryrun");
    });
});
(0, node_test_1.describe)("restore plan lifecycle", () => {
    (0, node_test_1.beforeEach)(() => {
        (0, plan_js_1.clearRestorePlanForTest)();
    });
    (0, node_test_1.it)("plan expires after 15 minutes", () => {
        const identity = {
            fileName: "x.emsbackup",
            rootKind: "inbox",
            archiveSha256: "b".repeat(64),
            sizeBytes: 1,
            mtimeMs: 1,
        };
        const manifest = (0, manifest_js_1.buildExportManifest)({
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
            (0, plan_js_1.createRestorePlan)({
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
            strict_1.default.ok((0, plan_js_1.getActiveRestorePlan)());
            Date.now = () => now + types_js_1.RESTORE_PLAN_TTL_MS + 1;
            strict_1.default.equal((0, plan_js_1.getActiveRestorePlan)(), null);
        }
        finally {
            Date.now = realNow;
        }
    });
    (0, node_test_1.it)("rejects wrong plan id and archive tampering", () => {
        const identity = {
            fileName: "ems-light-0.1.142-backup-20260712T120000Z.emsbackup",
            rootKind: "inbox",
            archiveSha256: "c".repeat(64),
            sizeBytes: 100,
            mtimeMs: 123,
        };
        const manifest = (0, manifest_js_1.buildExportManifest)({
            kind: "backup",
            adapterVersion: "0.1.142",
            instance: 0,
            namespace: "ems.0",
            files: [],
        });
        (0, plan_js_1.createRestorePlan)({
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
        strict_1.default.throws(() => (0, plan_js_1.assertPlanMatchesIdentity)(identity, "wrong-id"), /invalid plan id/);
        strict_1.default.throws(() => (0, plan_js_1.assertPlanMatchesIdentity)({ ...identity, archiveSha256: "d".repeat(64) }, (0, plan_js_1.getActiveRestorePlan)().planId), /archive content changed/);
    });
    (0, node_test_1.it)("invalidates old plan on new validation", async () => {
        const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "ems-restore-plan-"));
        try {
            (0, service_js_1.resetExportMutexForTest)();
            (0, operation_lock_js_1.resetOperationLockForTest)();
            const host = new RestoreTestHost(tmp, { global_execution_mode: "dryrun" });
            const first = await copyBackupToInbox(host);
            const v1 = await (0, apply_js_1.runRestoreValidate)(host, first.fileName);
            strict_1.default.equal(v1.ok, true);
            const plan1 = (0, plan_js_1.getActiveRestorePlan)()?.planId;
            const v2 = await (0, apply_js_1.runRestoreValidate)(host, first.fileName);
            strict_1.default.equal(v2.ok, true);
            const plan2 = (0, plan_js_1.getActiveRestorePlan)()?.planId;
            strict_1.default.notEqual(plan1, plan2);
        }
        finally {
            (0, plan_js_1.invalidateRestorePlan)();
            (0, service_js_1.resetExportMutexForTest)();
            (0, operation_lock_js_1.resetOperationLockForTest)();
            await fs.rm(tmp, { recursive: true, force: true }).catch(() => undefined);
        }
    });
});
(0, node_test_1.describe)("restore validate and apply", () => {
    let tmp;
    let host;
    (0, node_test_1.beforeEach)(async () => {
        tmp = await fs.mkdtemp(path.join(os.tmpdir(), "ems-restore-apply-"));
        (0, service_js_1.resetExportMutexForTest)();
        (0, operation_lock_js_1.resetOperationLockForTest)();
        (0, apply_js_1.resetRestoreApplyForTest)();
        (0, barrier_js_1.resetRestoreBarrierForTest)();
        (0, diagnostic_mode_js_1.resetDiagnosticModeForTest)();
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
        const layout = (0, paths_js_1.resolveEmsPaths)(host);
        await fs.mkdir(path.dirname(layout.manifestPath), { recursive: true });
        await (0, manifest_js_2.writeManifestAtomic)(layout.manifestPath, (0, manifest_js_2.createInitialManifest)({ instance: 0, namespace: host.namespace, adapterVersion: "0.1.143" }));
    });
    (0, node_test_1.afterEach)(async () => {
        (0, service_js_1.resetExportMutexForTest)();
        (0, operation_lock_js_1.resetOperationLockForTest)();
        (0, apply_js_1.resetRestoreApplyForTest)();
        (0, barrier_js_1.resetRestoreBarrierForTest)();
        (0, diagnostic_mode_js_1.resetDiagnosticModeForTest)();
        await fs.rm(tmp, { recursive: true, force: true }).catch(() => undefined);
    });
    (0, node_test_1.it)("validate does not change native config, learning, or runtime states", async () => {
        const beforeConfig = structuredClone(host.config);
        const beforeInbox = (await host.getStateAsync("command.inbox"))?.val;
        const learningPath = path.join((0, data_dir_js_1.learningDataPath)(host, "learning/battery_runtime"), "battery_runtime_learning_v1.json");
        const beforeLearning = await fs.readFile(learningPath, "utf8");
        const { fileName } = await copyBackupToInbox(host);
        const result = await (0, apply_js_1.runRestoreValidate)(host, fileName);
        strict_1.default.equal(result.ok, true);
        strict_1.default.deepEqual(host.config, beforeConfig);
        strict_1.default.equal((await host.getStateAsync("command.inbox"))?.val, beforeInbox);
        strict_1.default.equal(await fs.readFile(learningPath, "utf8"), beforeLearning);
    });
    (0, node_test_1.it)("apply requires valid plan and enforces dryrun modes", async () => {
        const { fileName } = await copyBackupToInbox(host);
        const validate = await (0, apply_js_1.runRestoreValidate)(host, fileName);
        strict_1.default.equal(validate.ok, true);
        const plan = (0, plan_js_1.getActiveRestorePlan)();
        strict_1.default.ok(plan);
        const apply = await (0, apply_js_1.runRestoreApply)(host, fileName, plan.planId);
        strict_1.default.equal(apply.ok, true);
        strict_1.default.equal(host.config.access_token, "local-token");
        strict_1.default.equal(host.config.custom_unknown, "stay");
        strict_1.default.equal(host.config.global_execution_mode, "dryrun");
        strict_1.default.equal(host.config.wb_addon_mode, "dryrun");
        strict_1.default.equal(host.config.bat_addon_mode, "dryrun");
        strict_1.default.equal(host.config.ih_addon_mode, "dryrun");
        strict_1.default.equal(host.config.ac_addon_mode, "dryrun");
        strict_1.default.equal((await host.getStateAsync("command.inbox"))?.val, "");
    });
    (0, node_test_1.it)("apply without plan is rejected", async () => {
        const { fileName } = await copyBackupToInbox(host);
        const apply = await (0, apply_js_1.runRestoreApply)(host, fileName, "missing-plan");
        strict_1.default.equal(apply.ok, false);
        strict_1.default.match(apply.error ?? "", /no valid restore plan|invalid plan id/);
    });
    (0, node_test_1.it)("apply detects swapped archive content", async () => {
        const { fileName } = await copyBackupToInbox(host);
        const validate = await (0, apply_js_1.runRestoreValidate)(host, fileName);
        strict_1.default.equal(validate.ok, true);
        const plan = (0, plan_js_1.getActiveRestorePlan)();
        const resolved = (0, source_js_1.resolveRestoreSourcePath)(tmp, fileName);
        await fs.writeFile(resolved.path, Buffer.from("corrupted"));
        const apply = await (0, apply_js_1.runRestoreApply)(host, fileName, plan.planId);
        strict_1.default.equal(apply.ok, false);
    });
});
(0, node_test_1.describe)("restore device write barrier", () => {
    (0, node_test_1.beforeEach)(() => (0, barrier_js_1.resetRestoreBarrierForTest)());
    (0, node_test_1.afterEach)(() => (0, barrier_js_1.resetRestoreBarrierForTest)());
    (0, node_test_1.it)("blocks foreign device writes during restore", async () => {
        (0, barrier_js_1.setRestoreInProgress)(true);
        strict_1.default.equal((0, barrier_js_1.assertDeviceActionAllowed)().ok, false);
        const writes = [];
        await (0, device_write_js_1.writeForeignIfChanged)({
            getForeignStateAsync: async () => null,
            setForeignStateAsync: async (id) => {
                writes.push(id);
            },
        }, { stateId: "mqtt.0.test", value: 1, reason: "test" });
        strict_1.default.equal(writes.length, 0);
    });
    (0, node_test_1.it)("blocks battery and wallbox writes during restore", async () => {
        (0, barrier_js_1.setRestoreInProgress)(true);
        const battery = await (0, execute_js_2.executeBatteryWrite)({
            getForeignStateAsync: async () => null,
            setForeignStateAsync: async () => undefined,
            log: { info: () => undefined, warn: () => undefined, error: () => undefined, debug: () => undefined },
        }, {
            kind: "charge_power",
            stateId: "bat.power",
            value: 1000,
            requestId: "r",
            reason: "test",
            dryrun: false,
            gate: okBatteryGate(),
        });
        strict_1.default.equal(battery.rejectCode, "restore_in_progress");
        const wallbox = await (0, execute_js_1.executeWallboxWrite)({
            getForeignStateAsync: async () => null,
            setForeignStateAsync: async () => undefined,
            log: { info: () => undefined, warn: () => undefined, error: () => undefined, debug: () => undefined },
        }, {
            candidate: { blocked: false },
            writePlan: {},
            phase: "live",
            liveRequested: true,
        });
        strict_1.default.equal(wallbox.reason, "restore_in_progress");
        strict_1.default.equal(execute_js_1.WALLBOX_LIVE_WRITE_RELEASED, true);
    });
});
(0, node_test_1.describe)("restore startup recovery", () => {
    let tmp;
    let host;
    (0, node_test_1.beforeEach)(async () => {
        tmp = await fs.mkdtemp(path.join(os.tmpdir(), "ems-restore-rec-"));
        (0, barrier_js_1.resetRestoreBarrierForTest)();
        (0, apply_js_1.resetRestoreApplyForTest)();
        host = new RestoreTestHost(tmp, {
            global_execution_mode: "live",
            wb_addon_mode: "live",
            bat_addon_mode: "live",
            ih_addon_mode: "live",
            ac_addon_mode: "live",
        });
    });
    (0, node_test_1.afterEach)(async () => {
        (0, barrier_js_1.resetRestoreBarrierForTest)();
        await fs.rm(tmp, { recursive: true, force: true }).catch(() => undefined);
    });
    (0, node_test_1.it)("rolls back incomplete prepared transaction on startup", async () => {
        const txId = (0, journal_js_1.newTransactionId)();
        const txDir = await (0, journal_js_1.ensureTransactionLayout)(host, txId);
        const beforeNative = (0, projection_js_1.exportCurrentNativeProjection)(host.config);
        await fs.writeFile(path.join(txDir, "before", "native_projection.json"), (0, schema_js_1.stableJsonStringify)(beforeNative), { mode: 0o600 });
        const journal = (0, journal_js_1.createJournal)({
            transactionId: txId,
            archiveFileName: "test.emsbackup",
            archiveSha256: "e".repeat(64),
            phase: "prepared",
        });
        await (0, journal_js_1.writeJournalAtomic)(txDir, journal);
        host.config.wb_evcc_connected_state = "mutated-during-crash";
        const result = await (0, startup_recovery_js_1.runRestoreStartupRecovery)(host);
        strict_1.default.equal(result.ok, true);
        if (result.ok)
            strict_1.default.equal(result.action, "rolled_back");
    });
    (0, node_test_1.it)("blocks runtime on multiple incomplete transactions", async () => {
        for (let i = 0; i < 2; i++) {
            const txId = (0, journal_js_1.newTransactionId)();
            const txDir = await (0, journal_js_1.ensureTransactionLayout)(host, txId);
            const journal = (0, journal_js_1.createJournal)({
                transactionId: txId,
                archiveFileName: "test.emsbackup",
                archiveSha256: "f".repeat(64),
                phase: "config_applied",
            });
            await (0, journal_js_1.writeJournalAtomic)(txDir, journal);
        }
        const result = await (0, startup_recovery_js_1.runRestoreStartupRecovery)(host);
        strict_1.default.equal(result.ok, false);
        strict_1.default.equal(result.error, "multiple_incomplete_restore_transactions");
    });
    (0, node_test_1.it)("finalizes committed transaction without re-applying config", async () => {
        const txId = (0, journal_js_1.newTransactionId)();
        const txDir = await (0, journal_js_1.ensureTransactionLayout)(host, txId);
        const journal = (0, journal_js_1.createJournal)({
            transactionId: txId,
            archiveFileName: "test.emsbackup",
            archiveSha256: "g".repeat(64),
            phase: "committed",
        });
        await (0, journal_js_1.writeJournalAtomic)(txDir, journal);
        host.config.global_execution_mode = "live";
        const result = await (0, startup_recovery_js_1.runRestoreStartupRecovery)(host);
        strict_1.default.equal(result.ok, true);
        if (result.ok)
            strict_1.default.equal(result.action, "finalized_committed");
        strict_1.default.equal(host.config.global_execution_mode, "dryrun");
    });
});
(0, node_test_1.describe)("restore learning keys", () => {
    (0, node_test_1.it)("maps exactly eight known learning keys", () => {
        strict_1.default.equal(learning_map_js_1.RESTORE_LEARNING_KEYS.length, 9);
        for (const key of learning_map_js_1.RESTORE_LEARNING_KEYS) {
            strict_1.default.ok(learning_map_js_1.RESTORE_LEARNING_TARGETS[key]);
            strict_1.default.ok(key.endsWith(".json"));
        }
    });
});
