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
Object.defineProperty(exports, "__esModule", { value: true });
exports.legacyRuntimePathsRemain = exports.runRuntimeMigration = exports.readMigrationStatus = exports.emptyMigrationStatus = void 0;
const fs = __importStar(require("node:fs/promises"));
const path = __importStar(require("node:path"));
const atomic_write_1 = require("../persistence/atomic_write");
const schema_1 = require("../backup/schema");
function emptyMigrationStatus() {
    return {
        schema_version: 1,
        status: "pending",
        started_at: null,
        completed_at: null,
        last_error: null,
        moved_entries: [],
    };
}
exports.emptyMigrationStatus = emptyMigrationStatus;
async function readMigrationStatus(migrationStatusPath) {
    try {
        const raw = await fs.readFile(migrationStatusPath, "utf8");
        return JSON.parse(raw);
    }
    catch {
        return null;
    }
}
exports.readMigrationStatus = readMigrationStatus;
async function writeMigrationStatus(migrationStatusPath, record) {
    await (0, atomic_write_1.atomicWriteJson)(migrationStatusPath, record, schema_1.stableJsonStringify);
}
const RUNTIME_MOVE_SPECS = [
    { key: "intent", legacyRelative: "intent", targetRelative: "runtime/intent" },
    { key: "global_modes", legacyRelative: "global_modes", targetRelative: "runtime/global_modes" },
    { key: "immersion_heater", legacyRelative: "immersion_heater", targetRelative: "runtime/addons/immersion_heater" },
    { key: "air_conditioning", legacyRelative: "air_conditioning", targetRelative: "runtime/addons/air_conditioning" },
    { key: "exports", legacyRelative: "exports", targetRelative: "exports" },
    { key: "restore_inbox", legacyRelative: "restore/inbox", targetRelative: "restore/inbox" },
];
async function pathExists(p) {
    try {
        await fs.access(p);
        return true;
    }
    catch {
        return false;
    }
}
async function dirEmpty(p) {
    try {
        const entries = await fs.readdir(p);
        return entries.length === 0;
    }
    catch {
        return true;
    }
}
async function moveDirectoryAtomic(source, target) {
    if (!(await pathExists(source))) {
        return;
    }
    await fs.mkdir(path.dirname(target), { recursive: true, mode: 0o700 });
    if (await pathExists(target)) {
        if (await dirEmpty(target)) {
            await fs.rmdir(target).catch(() => undefined);
        }
        else {
            throw new Error(`migration_target_conflict:${target}`);
        }
    }
    await fs.rename(source, target);
}
async function runRuntimeMigration(layout, options = {}) {
    const existing = (await readMigrationStatus(layout.migrationStatusPath)) ?? emptyMigrationStatus();
    if (existing.status === "completed") {
        return { ok: true, status: "completed" };
    }
    const inProgress = {
        ...existing,
        status: "in_progress",
        started_at: existing.started_at ?? new Date().toISOString(),
        last_error: null,
    };
    await writeMigrationStatus(layout.migrationStatusPath, inProgress);
    try {
        const stagingRoot = path.join(layout.runtimeTempDir, "migration-staging");
        if (await pathExists(stagingRoot)) {
            await fs.rm(stagingRoot, { recursive: true, force: true });
        }
        const moved = [...existing.moved_entries];
        for (const spec of RUNTIME_MOVE_SPECS) {
            const legacy = path.join(layout.durableDataDir, spec.legacyRelative);
            const target = path.join(layout.runtimeDataDir, spec.targetRelative);
            if (!(await pathExists(legacy))) {
                continue;
            }
            if (await pathExists(target) && !(await dirEmpty(target))) {
                throw new Error(`migration_target_conflict:${spec.key}`);
            }
            await moveDirectoryAtomic(legacy, target);
            moved.push(spec.key);
        }
        if (!options.skipTransactions) {
            const legacyTx = layout.legacyTransactionsDir;
            const targetTx = layout.runtimeTransactionsDir;
            if (await pathExists(legacyTx)) {
                if (await pathExists(targetTx) && !(await dirEmpty(targetTx))) {
                    throw new Error("migration_target_conflict:restore_transactions");
                }
                await moveDirectoryAtomic(legacyTx, targetTx);
                moved.push("restore_transactions");
            }
            const legacyRestoreRoot = path.join(layout.durableDataDir, "restore");
            if (await pathExists(legacyRestoreRoot) && (await dirEmpty(legacyRestoreRoot))) {
                await fs.rmdir(legacyRestoreRoot).catch(() => undefined);
            }
        }
        const completed = {
            schema_version: 1,
            status: "completed",
            started_at: inProgress.started_at,
            completed_at: new Date().toISOString(),
            last_error: null,
            moved_entries: [...new Set(moved)],
        };
        await writeMigrationStatus(layout.migrationStatusPath, completed);
        return { ok: true, status: "completed" };
    }
    catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        const failed = {
            ...inProgress,
            status: "failed",
            last_error: msg,
        };
        await writeMigrationStatus(layout.migrationStatusPath, failed).catch(() => undefined);
        return { ok: false, status: "failed", error: msg };
    }
}
exports.runRuntimeMigration = runRuntimeMigration;
async function legacyRuntimePathsRemain(layout) {
    const remain = [];
    for (const spec of RUNTIME_MOVE_SPECS) {
        if (await pathExists(path.join(layout.durableDataDir, spec.legacyRelative))) {
            remain.push(spec.legacyRelative);
        }
    }
    if (await pathExists(layout.legacyTransactionsDir)) {
        remain.push("restore/transactions");
    }
    return remain;
}
exports.legacyRuntimePathsRemain = legacyRuntimePathsRemain;
