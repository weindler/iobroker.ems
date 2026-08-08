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
const tree_paths_js_1 = require("../tree_paths.js");
const data_dir_js_1 = require("../learning/data_dir.js");
const schema_js_1 = require("../backup/schema.js");
const service_js_1 = require("../backup/service.js");
const operation_lock_js_1 = require("../backup/operation_lock.js");
const checksum_js_1 = require("../backup/checksum.js");
const device_write_js_1 = require("../device_write.js");
const execute_js_1 = require("../addons/battery/runtime/execute.js");
const source_js_1 = require("./source.js");
const apply_js_1 = require("./apply.js");
const apply_hooks_js_1 = require("./apply_hooks.js");
const barrier_js_1 = require("./barrier.js");
const plan_js_1 = require("./plan.js");
const learning_map_js_1 = require("./learning_map.js");
const journal_js_1 = require("./journal.js");
const handler_js_1 = require("./handler.js");
const ensure_states_js_1 = require("../backup/ensure_states.js");
const startup_recovery_js_1 = require("./startup_recovery.js");
const journal_js_2 = require("./journal.js");
const dryrun_context_js_1 = require("./dryrun_context.js");
const diagnostic_mode_js_1 = require("../support/diagnostic_mode.js");
const manifest_js_1 = require("../backup_integration/manifest.js");
const paths_js_1 = require("../backup_integration/paths.js");
const APPLY_INJECTION_POINTS = [
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
class InjectionTestHost {
    dataDir;
    namespace = "ems.0";
    objects = new Map();
    states = new Map();
    config;
    common = { version: "0.1.143" };
    updateConfigCalls = 0;
    failUpdateConfigOnCall = null;
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
    async setObjectNotExistsAsync(id, obj) {
        if (!this.objects.has(id))
            this.objects.set(id, { ...obj, _id: id });
    }
    async getObjectAsync(id) {
        return this.objects.get(id) ?? null;
    }
    async subscribeStatesAsync() {
        return;
    }
    async updateConfig(next) {
        this.updateConfigCalls += 1;
        if (this.failUpdateConfigOnCall === this.updateConfigCalls) {
            throw new Error("injected_update_config_failure");
        }
        this.config = { ...next };
    }
}
async function snapshotHost(host) {
    const learning = new Map();
    for (const key of learning_map_js_1.RESTORE_LEARNING_KEYS) {
        const target = learning_map_js_1.RESTORE_LEARNING_TARGETS[key];
        const filePath = path.join((0, data_dir_js_1.learningDataPath)(host, target.category), target.fileName);
        try {
            const bytes = await fs.readFile(filePath);
            learning.set(key, { exists: true, sha256: (0, checksum_js_1.sha256Buffer)(bytes), bytes });
        }
        catch {
            learning.set(key, { exists: false, sha256: null, bytes: null });
        }
    }
    const neighborPath = path.join((0, data_dir_js_1.learningDataPath)(host, "learning/battery_runtime"), "neighbor_unknown.json");
    let neighborLearningBytes = null;
    try {
        neighborLearningBytes = await fs.readFile(neighborPath);
    }
    catch {
        neighborLearningBytes = null;
    }
    return {
        native: structuredClone(host.config),
        learning,
        neighborLearningBytes,
    };
}
async function writeLearning(host, key, data) {
    const target = learning_map_js_1.RESTORE_LEARNING_TARGETS[key];
    const base = (0, data_dir_js_1.learningDataPath)(host, target.category);
    await fs.mkdir(base, { recursive: true });
    await fs.writeFile(path.join(base, target.fileName), (0, schema_js_1.stableJsonStringify)(data), { mode: 0o600 });
}
async function copyBackupToInbox(host) {
    const result = await (0, service_js_1.runBackupExport)(host);
    strict_1.default.equal(result.ok, true);
    if (!result.ok)
        throw new Error("export failed");
    const target = path.basename(result.filePath);
    const inbox = (0, source_js_1.restoreInboxDir)(host);
    await fs.mkdir(inbox, { recursive: true });
    await fs.copyFile(result.filePath, path.join(inbox, target));
    return { fileName: target };
}
async function prepareHost(tmp) {
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
    for (const key of learning_map_js_1.RESTORE_LEARNING_KEYS) {
        await writeLearning(host, key, { version: 1, tag: `before-${key}` });
    }
    const neighborPath = path.join((0, data_dir_js_1.learningDataPath)(host, "learning/battery_runtime"), "neighbor_unknown.json");
    await fs.writeFile(neighborPath, Buffer.from('{"keep":true}'), { mode: 0o600 });
    await ensureTestManifest(host);
    return host;
}
async function transactionsDirForHost(host) {
    return (0, paths_js_1.resolveEmsPaths)(host).runtimeTransactionsDir;
}
async function ensureTestManifest(host) {
    const layout = (0, paths_js_1.resolveEmsPaths)(host);
    await fs.mkdir(path.dirname(layout.manifestPath), { recursive: true });
    await (0, manifest_js_1.writeManifestAtomic)(layout.manifestPath, (0, manifest_js_1.createInitialManifest)({
        instance: 0,
        namespace: host.namespace,
        adapterVersion: String(host.common.version),
    }));
}
async function assertDryrunModes(host) {
    strict_1.default.equal(host.config.global_execution_mode, "dryrun");
    strict_1.default.equal(host.config.wb_addon_mode, "dryrun");
    strict_1.default.equal(host.config.bat_addon_mode, "dryrun");
    strict_1.default.equal(host.config.ih_addon_mode, "dryrun");
    strict_1.default.equal(host.config.ac_addon_mode, "dryrun");
    const g = await host.getStateAsync(tree_paths_js_1.GLOBAL.executionMode);
    strict_1.default.equal(String(g?.val), "dryrun");
    for (const addon of ["wallbox", "battery", "immersion_heater", "air_conditioning"]) {
        const st = await host.getStateAsync((0, tree_paths_js_1.addonMode)(addon));
        strict_1.default.equal(String(st?.val), "dryrun");
    }
}
async function assertRestoredSnapshot(host, before) {
    strict_1.default.equal(host.config.access_token, before.native.access_token);
    strict_1.default.equal(host.config.password, before.native.password);
    strict_1.default.equal(host.config.custom_local_unknown, before.native.custom_local_unknown);
    strict_1.default.equal(host.config.wb_evcc_connected_state, before.native.wb_evcc_connected_state);
    for (const key of learning_map_js_1.RESTORE_LEARNING_KEYS) {
        const target = learning_map_js_1.RESTORE_LEARNING_TARGETS[key];
        const filePath = path.join((0, data_dir_js_1.learningDataPath)(host, target.category), target.fileName);
        const prev = before.learning.get(key);
        if (!prev.exists) {
            await strict_1.default.rejects(() => fs.readFile(filePath));
        }
        else {
            const bytes = await fs.readFile(filePath);
            strict_1.default.equal((0, checksum_js_1.sha256Buffer)(bytes), prev.sha256);
        }
    }
    const neighborPath = path.join((0, data_dir_js_1.learningDataPath)(host, "learning/battery_runtime"), "neighbor_unknown.json");
    if (before.neighborLearningBytes) {
        strict_1.default.equal((0, checksum_js_1.sha256Buffer)(await fs.readFile(neighborPath)), (0, checksum_js_1.sha256Buffer)(before.neighborLearningBytes));
    }
}
async function assertNoDeviceWritesDuring(fn) {
    const writes = [];
    (0, barrier_js_1.setRestoreInProgress)(true);
    try {
        await fn();
    }
    finally {
        (0, barrier_js_1.setRestoreInProgress)(false);
    }
    const r = await (0, device_write_js_1.writeForeignIfChanged)({
        getForeignStateAsync: async () => null,
        setForeignStateAsync: async (id) => {
            writes.push(id);
        },
    }, { stateId: "mqtt.0.blocked", value: 1, reason: "test" });
    strict_1.default.equal(writes.length, 0);
    strict_1.default.equal(r.written, false);
}
(0, node_test_1.describe)("restore apply injection rollback", () => {
    let tmp;
    (0, node_test_1.beforeEach)(async () => {
        tmp = await fs.mkdtemp(path.join(os.tmpdir(), "ems-restore-inj-"));
        (0, service_js_1.resetExportMutexForTest)();
        (0, operation_lock_js_1.resetOperationLockForTest)();
        (0, apply_js_1.resetRestoreApplyForTest)();
        (0, barrier_js_1.resetRestoreBarrierForTest)();
        (0, apply_hooks_js_1.resetRestoreInjectionHooksForTest)();
        (0, dryrun_context_js_1.resetRestoreDryrunContextForTest)();
        (0, diagnostic_mode_js_1.resetDiagnosticModeForTest)();
    });
    (0, node_test_1.afterEach)(async () => {
        (0, service_js_1.resetExportMutexForTest)();
        (0, operation_lock_js_1.resetOperationLockForTest)();
        (0, apply_js_1.resetRestoreApplyForTest)();
        (0, barrier_js_1.resetRestoreBarrierForTest)();
        (0, apply_hooks_js_1.resetRestoreInjectionHooksForTest)();
        (0, dryrun_context_js_1.resetRestoreDryrunContextForTest)();
        await fs.rm(tmp, { recursive: true, force: true }).catch(() => undefined);
    });
    for (const point of APPLY_INJECTION_POINTS) {
        (0, node_test_1.it)(`rolls back safely after injection at ${point}`, async () => {
            const host = await prepareHost(tmp);
            const before = await snapshotHost(host);
            const { fileName } = await copyBackupToInbox(host);
            const validate = await (0, apply_js_1.runRestoreValidate)(host, fileName);
            strict_1.default.equal(validate.ok, true);
            const plan = (0, plan_js_1.getActiveRestorePlan)();
            (0, apply_hooks_js_1.setRestoreApplyInjectionPoint)(point);
            const apply = await (0, apply_js_1.runRestoreApply)(host, fileName, plan.planId);
            strict_1.default.equal(apply.ok, false);
            if (["after_lock", "after_barrier"].includes(point)) {
                strict_1.default.equal(apply.status, "error");
                strict_1.default.deepEqual(host.config, before.native);
                strict_1.default.equal((0, barrier_js_1.isRestoreInProgress)(), false);
            }
            else {
                strict_1.default.equal(apply.status, "rolled_back");
                await assertRestoredSnapshot(host, before);
                await assertDryrunModes(host);
            }
            strict_1.default.equal((0, operation_lock_js_1.isOperationRunning)(), false);
            strict_1.default.equal((0, plan_js_1.getActiveRestorePlan)(), null);
            if (apply.status === "rolled_back") {
                const txRoot = await transactionsDirForHost(host);
                const txDirs = await fs.readdir(txRoot);
                if (txDirs.length > 0) {
                    const journal = await (0, journal_js_1.readJournal)(path.join(txRoot, txDirs[0]));
                    strict_1.default.equal(journal?.phase, "rolled_back");
                }
            }
        });
    }
    (0, node_test_1.it)("handler injection after committed keeps barrier and blocks replan apply", async () => {
        const host = await prepareHost(tmp);
        const { fileName } = await copyBackupToInbox(host);
        await host.setStateAsync(ensure_states_js_1.RESTORE_STATES.selectedFile, { val: fileName, ack: true });
        await (0, handler_js_1.handleRestoreValidateRequest)(host, true, false);
        const planId = String((await host.getStateAsync(ensure_states_js_1.RESTORE_STATES.planId))?.val ?? "");
        strict_1.default.ok(planId);
        await host.setStateAsync(ensure_states_js_1.RESTORE_STATES.confirmPlanId, { val: planId, ack: true });
        (0, apply_hooks_js_1.setRestoreHandlerInjectionAfterCommitted)(true);
        await strict_1.default.rejects(() => (0, handler_js_1.handleRestoreApplyRequest)(host, true, false), /injected_failure:after_committed_before_status/);
        strict_1.default.equal((0, barrier_js_1.isRestoreInProgress)(), true);
        strict_1.default.equal((await host.getStateAsync(ensure_states_js_1.RESTORE_STATES.applyRequest))?.val, false);
        strict_1.default.equal((await host.getStateAsync(ensure_states_js_1.RESTORE_STATES.applyRequest))?.ack, true);
        strict_1.default.equal((await host.getStateAsync(ensure_states_js_1.RESTORE_STATES.running))?.val, false);
        const reapply = await (0, apply_js_1.runRestoreApply)(host, fileName, planId);
        strict_1.default.equal(reapply.ok, false);
    });
    (0, node_test_1.it)("rollback failure on native restore leaves journal failed and barrier active", async () => {
        const host = await prepareHost(tmp);
        const { fileName } = await copyBackupToInbox(host);
        const validate = await (0, apply_js_1.runRestoreValidate)(host, fileName);
        strict_1.default.equal(validate.ok, true);
        const plan = (0, plan_js_1.getActiveRestorePlan)();
        (0, apply_hooks_js_1.setRestoreApplyInjectionPoint)("after_native_apply");
        host.failUpdateConfigOnCall = 3;
        (0, apply_hooks_js_1.setRestoreRollbackInjectionPoint)("native_restore");
        const apply = await (0, apply_js_1.runRestoreApply)(host, fileName, plan.planId);
        strict_1.default.equal(apply.ok, false);
        strict_1.default.equal(apply.status, "recovery_failed");
        strict_1.default.equal(apply.error, "restore_rollback_failed");
        strict_1.default.equal((0, barrier_js_1.isRestoreInProgress)(), true);
        const txRoot = await transactionsDirForHost(host);
        const txDirs = await fs.readdir(txRoot);
        const journal = await (0, journal_js_1.readJournal)(path.join(txRoot, txDirs[0]));
        strict_1.default.equal(journal?.phase, "failed");
    });
    (0, node_test_1.it)("rollback failure on learning restore leaves journal failed", async () => {
        const host = await prepareHost(tmp);
        const { fileName } = await copyBackupToInbox(host);
        const validate = await (0, apply_js_1.runRestoreValidate)(host, fileName);
        strict_1.default.equal(validate.ok, true);
        const plan = (0, plan_js_1.getActiveRestorePlan)();
        (0, apply_hooks_js_1.setRestoreApplyInjectionPoint)("after_learning_first");
        (0, apply_hooks_js_1.setRestoreRollbackInjectionPoint)("learning_restore");
        const apply = await (0, apply_js_1.runRestoreApply)(host, fileName, plan.planId);
        strict_1.default.equal(apply.status, "recovery_failed");
        strict_1.default.equal((0, barrier_js_1.isRestoreInProgress)(), true);
    });
    (0, node_test_1.it)("native apply then learning failure restores config secrets and dryrun", async () => {
        const host = await prepareHost(tmp);
        const before = await snapshotHost(host);
        const { fileName } = await copyBackupToInbox(host);
        const validate = await (0, apply_js_1.runRestoreValidate)(host, fileName);
        strict_1.default.equal(validate.ok, true);
        const plan = (0, plan_js_1.getActiveRestorePlan)();
        (0, apply_hooks_js_1.setRestoreApplyInjectionPoint)("after_native_apply");
        const apply = await (0, apply_js_1.runRestoreApply)(host, fileName, plan.planId);
        strict_1.default.equal(apply.status, "rolled_back");
        await assertRestoredSnapshot(host, before);
        await assertDryrunModes(host);
        strict_1.default.notEqual(host.config.global_execution_mode, "live");
    });
    (0, node_test_1.it)("successful apply keeps barrier active in same process", async () => {
        const host = await prepareHost(tmp);
        const { fileName } = await copyBackupToInbox(host);
        const validate = await (0, apply_js_1.runRestoreValidate)(host, fileName);
        strict_1.default.equal(validate.ok, true);
        const plan = (0, plan_js_1.getActiveRestorePlan)();
        const apply = await (0, apply_js_1.runRestoreApply)(host, fileName, plan.planId);
        strict_1.default.equal(apply.ok, true);
        strict_1.default.equal((0, barrier_js_1.isRestoreInProgress)(), true);
        const battery = await (0, execute_js_1.executeBatteryWrite)({
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
    });
    (0, node_test_1.it)("after_barrier releases barrier without starting transaction", async () => {
        const host = await prepareHost(tmp);
        const before = await snapshotHost(host);
        const { fileName } = await copyBackupToInbox(host);
        const validate = await (0, apply_js_1.runRestoreValidate)(host, fileName);
        strict_1.default.equal(validate.ok, true);
        const plan = (0, plan_js_1.getActiveRestorePlan)();
        (0, apply_hooks_js_1.setRestoreApplyInjectionPoint)("after_barrier");
        const apply = await (0, apply_js_1.runRestoreApply)(host, fileName, plan.planId);
        strict_1.default.equal(apply.ok, false);
        strict_1.default.equal(apply.status, "error");
        strict_1.default.deepEqual(host.config, before.native);
        strict_1.default.equal((0, operation_lock_js_1.isOperationRunning)(), false);
        strict_1.default.equal((0, barrier_js_1.isRestoreInProgress)(), false);
        await strict_1.default.rejects(async () => fs.readdir((await transactionsDirForHost(host))));
    });
    (0, node_test_1.it)("rollback after live config restores business fields but keeps native dryrun", async () => {
        const host = await prepareHost(tmp);
        const before = await snapshotHost(host);
        host.config.wb_evcc_connected_state = "mqtt.0.live-original";
        const { fileName } = await copyBackupToInbox(host);
        const validate = await (0, apply_js_1.runRestoreValidate)(host, fileName);
        strict_1.default.equal(validate.ok, true);
        const plan = (0, plan_js_1.getActiveRestorePlan)();
        (0, apply_hooks_js_1.setRestoreApplyInjectionPoint)("after_native_apply");
        const apply = await (0, apply_js_1.runRestoreApply)(host, fileName, plan.planId);
        strict_1.default.equal(apply.status, "rolled_back");
        strict_1.default.equal(host.config.wb_evcc_connected_state, "mqtt.0.live-original");
        strict_1.default.equal(host.config.access_token, before.native.access_token);
        await assertDryrunModes(host);
        (0, dryrun_context_js_1.resetRestoreDryrunContextForTest)();
        const { syncExecutionModesFromConfig } = await Promise.resolve().then(() => __importStar(require("../execution_mode.js")));
        await syncExecutionModesFromConfig(host, host.config, {});
        await assertDryrunModes(host);
    });
});
(0, node_test_1.describe)("restore startup journal blocking", () => {
    let tmp;
    (0, node_test_1.beforeEach)(async () => {
        tmp = await fs.mkdtemp(path.join(os.tmpdir(), "ems-restore-journal-"));
        (0, dryrun_context_js_1.resetRestoreDryrunContextForTest)();
        (0, barrier_js_1.resetRestoreBarrierForTest)();
    });
    (0, node_test_1.afterEach)(async () => {
        await fs.rm(tmp, { recursive: true, force: true }).catch(() => undefined);
    });
    async function liveHost() {
        const host = new InjectionTestHost(tmp, {
            global_execution_mode: "live",
            wb_addon_mode: "live",
            bat_addon_mode: "live",
            ih_addon_mode: "live",
            ac_addon_mode: "live",
        });
        await host.setStateAsync(tree_paths_js_1.GLOBAL.executionMode, { val: "live", ack: true });
        return host;
    }
    (0, node_test_1.it)("failed journal blocks startup with active barrier", async () => {
        const host = await liveHost();
        const txId = (0, journal_js_2.newTransactionId)();
        const txDir = await (0, journal_js_2.ensureTransactionLayout)(host, txId);
        await (0, journal_js_2.writeJournalAtomic)(txDir, (0, journal_js_2.createJournal)({
            transactionId: txId,
            archiveFileName: "test.emsbackup",
            archiveSha256: "c".repeat(64),
            phase: "failed",
        }));
        const recovery = await (0, startup_recovery_js_1.runRestoreStartupRecovery)(host);
        strict_1.default.equal(recovery.ok, false);
        strict_1.default.equal(recovery.error, "restore_transaction_failed");
        strict_1.default.equal((0, barrier_js_1.isRestoreInProgress)(), true);
        strict_1.default.equal(host.config.global_execution_mode, "dryrun");
    });
    (0, node_test_1.it)("defective journal blocks startup like failed", async () => {
        const host = await liveHost();
        const txId = (0, journal_js_2.newTransactionId)();
        await (0, journal_js_2.ensureTransactionLayout)(host, txId);
        const recovery = await (0, startup_recovery_js_1.runRestoreStartupRecovery)(host);
        strict_1.default.equal(recovery.ok, false);
        strict_1.default.equal(recovery.error, "restore_transaction_failed");
        strict_1.default.equal((0, barrier_js_1.isRestoreInProgress)(), true);
    });
    (0, node_test_1.it)("rolled_back journal triggers one-time follow-up with live native clamped to dryrun", async () => {
        const host = await liveHost();
        await host.setStateAsync((0, tree_paths_js_1.addonMode)("battery"), { val: "live", ack: true });
        await host.setStateAsync((0, tree_paths_js_1.addonMode)("immersion_heater"), { val: "live", ack: true });
        await host.setStateAsync((0, tree_paths_js_1.addonMode)("air_conditioning"), { val: "live", ack: true });
        await host.setStateAsync(ensure_states_js_1.RESTORE_STATES.lastResult, { val: "rolled_back", ack: true });
        await host.setStateAsync(ensure_states_js_1.RESTORE_STATES.lastRestoreAt, { val: "2020-01-01T00:00:00.000Z", ack: true });
        const txId = (0, journal_js_2.newTransactionId)();
        const txDir = await (0, journal_js_2.ensureTransactionLayout)(host, txId);
        await (0, journal_js_2.writeJournalAtomic)(txDir, (0, journal_js_2.createJournal)({
            transactionId: txId,
            archiveFileName: "test.emsbackup",
            archiveSha256: "d".repeat(64),
            phase: "rolled_back",
        }));
        const first = await (0, startup_recovery_js_1.runRestoreStartupRecovery)(host);
        strict_1.default.equal(first.ok, true);
        strict_1.default.equal(first.action, "finalized_rolled_back");
        strict_1.default.equal((0, barrier_js_1.isRestoreInProgress)(), true);
        strict_1.default.equal((0, dryrun_context_js_1.getPendingForceDryrunReason)(), "restore_recovery");
        await assertDryrunModes(host);
        strict_1.default.equal((await host.getStateAsync(ensure_states_js_1.RESTORE_STATES.lastResult))?.val, "rolled_back");
        strict_1.default.equal((await host.getStateAsync(ensure_states_js_1.RESTORE_STATES.lastRestoreAt))?.val, "2020-01-01T00:00:00.000Z");
        const battery = await (0, execute_js_1.executeBatteryWrite)({
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
        const { syncExecutionModesFromConfig } = await Promise.resolve().then(() => __importStar(require("../execution_mode.js")));
        await syncExecutionModesFromConfig(host, host.config, {
            forceDryrunReason: (0, dryrun_context_js_1.getPendingForceDryrunReason)(),
        });
        await (0, startup_recovery_js_1.clearRestoreRestartRequiredAfterBootstrap)(host);
        strict_1.default.equal((0, barrier_js_1.isRestoreInProgress)(), false);
        strict_1.default.equal((0, dryrun_context_js_1.getPendingForceDryrunReason)(), null);
        await strict_1.default.rejects(() => fs.readFile(path.join(txDir, "journal.json")));
        (0, dryrun_context_js_1.resetRestoreDryrunContextForTest)();
        (0, barrier_js_1.resetRestoreBarrierForTest)();
        const second = await (0, startup_recovery_js_1.runRestoreStartupRecovery)(host);
        strict_1.default.equal(second.ok, true);
        strict_1.default.equal(second.action, "none");
        await syncExecutionModesFromConfig(host, host.config, {});
        await assertDryrunModes(host);
    });
    (0, node_test_1.it)("multiple rolled_back journals block startup", async () => {
        const host = await liveHost();
        for (const sha of ["d1".repeat(32), "d2".repeat(32)]) {
            const txId = (0, journal_js_2.newTransactionId)();
            const txDir = await (0, journal_js_2.ensureTransactionLayout)(host, txId);
            await (0, journal_js_2.writeJournalAtomic)(txDir, (0, journal_js_2.createJournal)({
                transactionId: txId,
                archiveFileName: "test.emsbackup",
                archiveSha256: sha,
                phase: "rolled_back",
            }));
        }
        const recovery = await (0, startup_recovery_js_1.runRestoreStartupRecovery)(host);
        strict_1.default.equal(recovery.ok, false);
        strict_1.default.equal(recovery.error, "multiple_rolled_back_followup_transactions");
        strict_1.default.equal((0, barrier_js_1.isRestoreInProgress)(), true);
    });
    (0, node_test_1.it)("multiple incomplete journals remain blocked", async () => {
        const host = await liveHost();
        for (const sha of ["e".repeat(64), "f".repeat(64)]) {
            const txId = (0, journal_js_2.newTransactionId)();
            const txDir = await (0, journal_js_2.ensureTransactionLayout)(host, txId);
            await (0, journal_js_2.writeJournalAtomic)(txDir, (0, journal_js_2.createJournal)({
                transactionId: txId,
                archiveFileName: "test.emsbackup",
                archiveSha256: sha,
                phase: "prepared",
            }));
        }
        const recovery = await (0, startup_recovery_js_1.runRestoreStartupRecovery)(host);
        strict_1.default.equal(recovery.ok, false);
        strict_1.default.equal(recovery.error, "multiple_incomplete_restore_transactions");
        strict_1.default.equal((0, barrier_js_1.isRestoreInProgress)(), true);
    });
});
(0, node_test_1.describe)("restore learning target paths", () => {
    (0, node_test_1.it)("maps each key to a unique concrete relative file path", () => {
        const paths = new Set();
        for (const key of learning_map_js_1.RESTORE_LEARNING_KEYS) {
            const rel = (0, learning_map_js_1.restoreLearningRelativeTargetPath)(key);
            strict_1.default.ok(rel.includes("/"));
            strict_1.default.ok(rel.endsWith(".json"));
            strict_1.default.ok(!paths.has(rel), `duplicate target for ${key}`);
            paths.add(rel);
        }
        strict_1.default.equal(paths.size, 11);
    });
    (0, node_test_1.it)("writes only to fixed targets and preserves unknown neighbor files", async () => {
        const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "ems-restore-learn-"));
        try {
            const host = await prepareHost(tmp);
            const neighborPath = path.join((0, data_dir_js_1.learningDataPath)(host, "learning/battery_runtime"), "neighbor_unknown.json");
            const neighborBefore = await fs.readFile(neighborPath);
            const { fileName } = await copyBackupToInbox(host);
            const validate = await (0, apply_js_1.runRestoreValidate)(host, fileName);
            strict_1.default.equal(validate.ok, true);
            const plan = (0, plan_js_1.getActiveRestorePlan)();
            const apply = await (0, apply_js_1.runRestoreApply)(host, fileName, plan.planId);
            strict_1.default.equal(apply.ok, true);
            for (const key of learning_map_js_1.RESTORE_LEARNING_KEYS) {
                const rel = (0, learning_map_js_1.restoreLearningRelativeTargetPath)(key);
                const abs = path.join(host.getAbsoluteInstanceDataDir(), rel);
                const st = await fs.stat(abs);
                strict_1.default.ok(st.isFile());
            }
            strict_1.default.equal((0, checksum_js_1.sha256Buffer)(await fs.readFile(neighborPath)), (0, checksum_js_1.sha256Buffer)(neighborBefore));
        }
        finally {
            await fs.rm(tmp, { recursive: true, force: true }).catch(() => undefined);
        }
    });
});
(0, node_test_1.describe)("restore dryrun reason separation", () => {
    let tmp;
    (0, node_test_1.beforeEach)(async () => {
        tmp = await fs.mkdtemp(path.join(os.tmpdir(), "ems-restore-dry-"));
        (0, dryrun_context_js_1.resetRestoreDryrunContextForTest)();
        (0, barrier_js_1.resetRestoreBarrierForTest)();
    });
    (0, node_test_1.afterEach)(async () => {
        await fs.rm(tmp, { recursive: true, force: true }).catch(() => undefined);
    });
    (0, node_test_1.it)("committed journal recovery uses restore_recovery not namespace cold start", async () => {
        const host = new InjectionTestHost(tmp, {
            global_execution_mode: "live",
            wb_addon_mode: "live",
            bat_addon_mode: "live",
            ih_addon_mode: "live",
            ac_addon_mode: "live",
        });
        await host.setStateAsync(tree_paths_js_1.GLOBAL.executionMode, { val: "live", ack: true });
        await host.setStateAsync((0, tree_paths_js_1.addonMode)("wallbox"), { val: "live", ack: true });
        await host.setObjectNotExistsAsync("global", { type: "channel", native: {} });
        const txId = (0, journal_js_2.newTransactionId)();
        const txDir = await (0, journal_js_2.ensureTransactionLayout)(host, txId);
        await (0, journal_js_2.writeJournalAtomic)(txDir, (0, journal_js_2.createJournal)({
            transactionId: txId,
            archiveFileName: "test.emsbackup",
            archiveSha256: "a".repeat(64),
            phase: "committed",
        }));
        const recovery = await (0, startup_recovery_js_1.runRestoreStartupRecovery)(host);
        strict_1.default.equal(recovery.ok, true);
        strict_1.default.equal((0, dryrun_context_js_1.getPendingForceDryrunReason)(), "restore_recovery");
        strict_1.default.equal((0, barrier_js_1.isRestoreInProgress)(), true);
        strict_1.default.equal(String((await host.getStateAsync(tree_paths_js_1.GLOBAL.executionMode))?.val), "dryrun");
        strict_1.default.equal(host.config.global_execution_mode, "dryrun");
        strict_1.default.equal(host.config.wb_addon_mode, "dryrun");
        await (0, startup_recovery_js_1.clearRestoreRestartRequiredAfterBootstrap)(host);
        strict_1.default.equal((0, barrier_js_1.isRestoreInProgress)(), false);
        strict_1.default.equal((0, dryrun_context_js_1.getPendingForceDryrunReason)(), null);
    });
    (0, node_test_1.it)("committed recovery persists native dryrun across two simulated restarts", async () => {
        const host = new InjectionTestHost(tmp, {
            global_execution_mode: "live",
            wb_addon_mode: "live",
            bat_addon_mode: "live",
            ih_addon_mode: "live",
            ac_addon_mode: "live",
            access_token: "keep",
        });
        await host.setStateAsync(tree_paths_js_1.GLOBAL.executionMode, { val: "live", ack: true });
        const txId = (0, journal_js_2.newTransactionId)();
        const txDir = await (0, journal_js_2.ensureTransactionLayout)(host, txId);
        await (0, journal_js_2.writeJournalAtomic)(txDir, (0, journal_js_2.createJournal)({
            transactionId: txId,
            archiveFileName: "test.emsbackup",
            archiveSha256: "b".repeat(64),
            phase: "committed",
        }));
        const first = await (0, startup_recovery_js_1.runRestoreStartupRecovery)(host);
        strict_1.default.equal(first.ok, true);
        await assertDryrunModes(host);
        await (0, startup_recovery_js_1.clearRestoreRestartRequiredAfterBootstrap)(host);
        (0, dryrun_context_js_1.resetRestoreDryrunContextForTest)();
        (0, barrier_js_1.resetRestoreBarrierForTest)();
        const second = await (0, startup_recovery_js_1.runRestoreStartupRecovery)(host);
        strict_1.default.equal(second.ok, true);
        strict_1.default.equal(second.action, "none");
        const { syncExecutionModesFromConfig } = await Promise.resolve().then(() => __importStar(require("../execution_mode.js")));
        await syncExecutionModesFromConfig(host, host.config, {});
        await assertDryrunModes(host);
        strict_1.default.equal(host.config.access_token, "keep");
    });
    (0, node_test_1.it)("restore_recovery pending reason overrides namespace cold start in bootstrap sync", async () => {
        (0, dryrun_context_js_1.setPendingForceDryrunReason)("restore_recovery");
        const coldStartWouldBeTrue = true;
        const reason = (0, dryrun_context_js_1.getPendingForceDryrunReason)() ?? (coldStartWouldBeTrue ? "namespace_cold_start" : null);
        strict_1.default.equal(reason, "restore_recovery");
    });
});
(0, node_test_1.describe)("restore status semantics", () => {
    let tmp;
    (0, node_test_1.beforeEach)(async () => {
        tmp = await fs.mkdtemp(path.join(os.tmpdir(), "ems-restore-status-"));
        (0, service_js_1.resetExportMutexForTest)();
        (0, operation_lock_js_1.resetOperationLockForTest)();
        (0, apply_js_1.resetRestoreApplyForTest)();
        (0, barrier_js_1.resetRestoreBarrierForTest)();
        (0, apply_hooks_js_1.resetRestoreInjectionHooksForTest)();
    });
    (0, node_test_1.afterEach)(async () => {
        (0, plan_js_1.invalidateRestorePlan)();
        await fs.rm(tmp, { recursive: true, force: true }).catch(() => undefined);
    });
    (0, node_test_1.it)("validate never sets restart_required or last_restore_at", async () => {
        const host = await prepareHost(tmp);
        await (0, handler_js_1.initRestoreRuntime)(host);
        await host.setStateAsync(ensure_states_js_1.RESTORE_STATES.lastRestoreAt, { val: "2020-01-01T00:00:00.000Z", ack: true });
        await host.setStateAsync(ensure_states_js_1.RESTORE_STATES.lastFileName, { val: "old.emsbackup", ack: true });
        const { fileName } = await copyBackupToInbox(host);
        await host.setStateAsync(ensure_states_js_1.RESTORE_STATES.selectedFile, { val: fileName, ack: true });
        await (0, handler_js_1.handleRestoreValidateRequest)(host, true, false);
        strict_1.default.equal((await host.getStateAsync(ensure_states_js_1.RESTORE_STATES.restartRequired))?.val, false);
        strict_1.default.equal((await host.getStateAsync(ensure_states_js_1.RESTORE_STATES.lastRestoreAt))?.val, "2020-01-01T00:00:00.000Z");
        strict_1.default.equal((await host.getStateAsync(ensure_states_js_1.RESTORE_STATES.lastFileName))?.val, "old.emsbackup");
    });
    (0, node_test_1.it)("failed apply reports rolled_back without updating last_restore_at", async () => {
        const host = await prepareHost(tmp);
        await (0, handler_js_1.initRestoreRuntime)(host);
        await host.setStateAsync(ensure_states_js_1.RESTORE_STATES.lastRestoreAt, { val: "2020-01-01T00:00:00.000Z", ack: true });
        await host.setStateAsync(ensure_states_js_1.RESTORE_STATES.lastFileName, { val: "old.emsbackup", ack: true });
        const { fileName } = await copyBackupToInbox(host);
        await host.setStateAsync(ensure_states_js_1.RESTORE_STATES.selectedFile, { val: fileName, ack: true });
        await (0, handler_js_1.handleRestoreValidateRequest)(host, true, false);
        const planId = String((await host.getStateAsync(ensure_states_js_1.RESTORE_STATES.planId))?.val ?? "");
        await host.setStateAsync(ensure_states_js_1.RESTORE_STATES.confirmPlanId, { val: planId, ack: true });
        (0, apply_hooks_js_1.setRestoreApplyInjectionPoint)("after_native_apply");
        await (0, handler_js_1.handleRestoreApplyRequest)(host, true, false);
        strict_1.default.equal((await host.getStateAsync(ensure_states_js_1.RESTORE_STATES.lastResult))?.val, "rolled_back");
        strict_1.default.equal((await host.getStateAsync(ensure_states_js_1.RESTORE_STATES.lastRestoreAt))?.val, "2020-01-01T00:00:00.000Z");
        strict_1.default.equal((await host.getStateAsync(ensure_states_js_1.RESTORE_STATES.lastFileName))?.val, "old.emsbackup");
        strict_1.default.equal((await host.getStateAsync(ensure_states_js_1.RESTORE_STATES.restartRequired))?.val, false);
    });
});
