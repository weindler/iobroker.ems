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
const path = __importStar(require("node:path"));
const os = __importStar(require("node:os"));
const atomic_write_js_1 = require("../persistence/atomic_write.js");
const paths_js_1 = require("./paths.js");
const migration_js_1 = require("./migration.js");
(0, node_test_1.describe)("persistence atomic_write", () => {
    (0, node_test_1.it)("writes atomically and ignores temp files by name", async () => {
        const dir = await fs.mkdtemp(path.join(os.tmpdir(), "atomic-"));
        const target = path.join(dir, "data.json");
        await (0, atomic_write_js_1.atomicWriteFile)(target, '{"ok":true}\n');
        const raw = await fs.readFile(target, "utf8");
        strict_1.default.equal(raw, '{"ok":true}\n');
        strict_1.default.equal((0, atomic_write_js_1.isAtomicTempFileName)(".tmp-data.json"), true);
    });
});
(0, node_test_1.describe)("runtime migration", () => {
    let durable = "";
    let layout;
    (0, node_test_1.before)(async () => {
        durable = await fs.mkdtemp(path.join(os.tmpdir(), "ems-mig-"));
        layout = (0, paths_js_1.resolveEmsPaths)({ namespace: "ems.0", getAbsoluteInstanceDataDir: () => durable });
        await fs.mkdir(path.join(durable, "intent"), { recursive: true });
        await fs.writeFile(path.join(durable, "intent", "intent_v1.json"), "{}\n");
    });
    (0, node_test_1.after)(async () => {
        await fs.rm(durable, { recursive: true, force: true }).catch(() => undefined);
        await fs.rm(layout.runtimeDataDir, { recursive: true, force: true }).catch(() => undefined);
    });
    (0, node_test_1.it)("moves intent from durable to runtime and removes legacy path", async () => {
        const result = await (0, migration_js_1.runRuntimeMigration)(layout);
        strict_1.default.equal(result.ok, true);
        strict_1.default.equal(await (0, migration_js_1.legacyRuntimePathsRemain)(layout).then((r) => r.includes("intent")), false);
        await strict_1.default.rejects(() => fs.access(path.join(durable, "intent")));
        const moved = await fs.readFile(path.join(layout.runtimeIntentDir, "intent_v1.json"), "utf8");
        strict_1.default.equal(moved, "{}\n");
    });
    (0, node_test_1.it)("is idempotent on second run", async () => {
        const second = await (0, migration_js_1.runRuntimeMigration)(layout);
        strict_1.default.equal(second.status, "completed");
    });
    (0, node_test_1.it)("does not overwrite existing valid runtime target on conflict", async () => {
        const conflictRoot = await fs.mkdtemp(path.join(os.tmpdir(), "ems-mig-conflict-"));
        const conflictLayout = (0, paths_js_1.resolveEmsPaths)({
            namespace: "ems.0",
            getAbsoluteInstanceDataDir: () => conflictRoot,
        });
        await fs.mkdir(path.join(conflictRoot, "exports"), { recursive: true });
        await fs.writeFile(path.join(conflictRoot, "exports", "legacy.txt"), "legacy\n");
        await fs.mkdir(conflictLayout.runtimeExportsDir, { recursive: true });
        await fs.writeFile(path.join(conflictLayout.runtimeExportsDir, "existing.txt"), "keep\n");
        const result = await (0, migration_js_1.runRuntimeMigration)(conflictLayout);
        strict_1.default.equal(result.ok, false);
        strict_1.default.match(result.error ?? "", /migration_target_conflict/);
        const legacy = await fs.readFile(path.join(conflictRoot, "exports", "legacy.txt"), "utf8");
        strict_1.default.equal(legacy, "legacy\n");
        const kept = await fs.readFile(path.join(conflictLayout.runtimeExportsDir, "existing.txt"), "utf8");
        strict_1.default.equal(kept, "keep\n");
        await fs.rm(conflictRoot, { recursive: true, force: true }).catch(() => undefined);
        await fs.rm(conflictLayout.runtimeDataDir, { recursive: true, force: true }).catch(() => undefined);
    });
});
