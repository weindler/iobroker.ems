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
const node_child_process_1 = require("node:child_process");
const fs = __importStar(require("node:fs/promises"));
const os = __importStar(require("node:os"));
const path = __importStar(require("node:path"));
const archive_js_1 = require("./archive.js");
const checksum_js_1 = require("./checksum.js");
const manifest_js_1 = require("./manifest.js");
const manifest_validate_js_1 = require("./manifest_validate.js");
const schema_js_1 = require("./schema.js");
const service_js_1 = require("./service.js");
function hasUnzip() {
    return (0, node_child_process_1.spawnSync)("unzip", ["-h"], { stdio: "ignore" }).status === 0;
}
class ZipTestHost {
    dataDir;
    namespace = "ems.0";
    objects = new Map();
    config = { global_execution_mode: "dryrun" };
    common = { version: "0.1.141" };
    constructor(dataDir) {
        this.dataDir = dataDir;
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
    async getStateAsync() {
        return null;
    }
    async setStateAsync() {
        return;
    }
    async setObjectNotExistsAsync(id, obj) {
        if (!this.objects.has(id))
            this.objects.set(id, { ...obj, _id: id });
    }
}
(0, node_test_1.describe)("independent ZIP compatibility", () => {
    let tmp;
    (0, node_test_1.beforeEach)(async () => {
        tmp = await fs.mkdtemp(path.join(os.tmpdir(), "ems-zip-"));
        (0, service_js_1.resetExportMutexForTest)();
    });
    (0, node_test_1.afterEach)(async () => {
        (0, service_js_1.resetExportMutexForTest)();
        await fs.rm(tmp, { recursive: true, force: true }).catch(() => undefined);
    });
    (0, node_test_1.it)("builds archive with empty, binary and utf8 payloads", () => {
        const utf8 = "Grüße — 日本語 — emoji 😀";
        const binary = Buffer.from([0x00, 0xff, 0x42, 0x89, 0x50]);
        const entries = [
            { path: "empty.txt", content: "" },
            { path: "utf8/data.json", content: (0, schema_js_1.stableJsonStringify)({ text: utf8 }) },
            { path: "binary/blob.bin", content: binary },
        ];
        const zip = (0, archive_js_1.buildZipArchive)(entries);
        strict_1.default.ok(zip.length > 0);
        for (const e of entries) {
            const buf = typeof e.content === "string" ? Buffer.from(e.content, "utf8") : e.content;
            const extracted = (0, archive_js_1.readZipEntryData)(zip, e.path);
            strict_1.default.ok(extracted);
            strict_1.default.equal(extracted.length, buf.length);
            strict_1.default.equal((0, checksum_js_1.sha256Buffer)(extracted), (0, checksum_js_1.sha256Buffer)(buf));
        }
    });
    (0, node_test_1.it)("rejects unsafe archive paths", () => {
        strict_1.default.throws(() => (0, manifest_validate_js_1.assertSafeArchivePath)("../evil"));
        strict_1.default.throws(() => (0, manifest_validate_js_1.assertSafeArchivePath)("/etc/passwd"));
        strict_1.default.throws(() => (0, manifest_validate_js_1.assertSafeArchivePath)("a\\b"));
        strict_1.default.throws(() => (0, archive_js_1.buildZipArchive)([
            { path: "ok.txt", content: "a" },
            { path: "ok.txt", content: "b" },
        ]));
    });
    (0, node_test_1.it)("manifest.json is not listed in files[]", () => {
        const payload = [{ path: "config/adapter.json", content: "{}\n" }];
        const files = (0, manifest_js_1.buildManifestFileEntries)(payload);
        const manifest = (0, manifest_js_1.buildExportManifest)({
            kind: "backup",
            adapterVersion: "0.1.141",
            instance: 0,
            namespace: "ems.0",
            files,
        });
        strict_1.default.ok(!manifest.files.some((f) => f.path === "manifest.json"));
        (0, manifest_validate_js_1.validateManifestPayloadConsistency)(manifest, payload);
    });
    (0, node_test_1.it)("support manifest declares restore.supported=false", () => {
        const files = (0, manifest_js_1.buildManifestFileEntries)([{ path: "summary/system.json", content: "{}\n" }]);
        const manifest = (0, manifest_js_1.buildExportManifest)({
            kind: "support",
            adapterVersion: "0.1.141",
            instance: 0,
            namespace: "ems.0",
            files,
        });
        (0, schema_js_1.validateManifest)(manifest, "support");
        strict_1.default.equal(manifest.restore?.supported, false);
    });
    (0, node_test_1.it)("unzip accepts .emsbackup and .emssupport and checksums match manifest", async (t) => {
        if (!hasUnzip()) {
            t.skip("unzip not available");
            return;
        }
        const host = new ZipTestHost(tmp);
        const backup = await (0, service_js_1.runBackupExport)(host);
        strict_1.default.equal(backup.ok, true);
        if (!backup.ok)
            return;
        const support = await (0, service_js_1.runExport)(host, "support", async () => [
            { path: "logs/errors.ndjson", content: '{"event":"test"}\n' },
        ]);
        strict_1.default.equal(support.ok, true);
        if (!support.ok)
            return;
        for (const result of [backup, support]) {
            if (!result.ok)
                continue;
            const archivePath = result.filePath;
            (0, node_child_process_1.execFileSync)("unzip", ["-t", archivePath], { stdio: "pipe" });
            const extractDir = await fs.mkdtemp(path.join(tmp, "extract-"));
            (0, node_child_process_1.execFileSync)("unzip", ["-o", archivePath, "-d", extractDir], { stdio: "pipe" });
            const buf = await fs.readFile(archivePath);
            const names = (0, archive_js_1.readZipEntryNames)(buf);
            strict_1.default.ok(names.includes("manifest.json"));
            const manifestRaw = await fs.readFile(path.join(extractDir, "manifest.json"), "utf8");
            const manifest = JSON.parse(manifestRaw);
            strict_1.default.ok(!manifest.files.some((f) => f.path === "manifest.json"));
            for (const fe of manifest.files) {
                const diskPath = path.join(extractDir, fe.path);
                const diskBuf = await fs.readFile(diskPath);
                strict_1.default.equal(diskBuf.length, fe.size_bytes);
                strict_1.default.equal((0, checksum_js_1.sha256Buffer)(diskBuf), fe.sha256);
            }
            const payloadEntries = manifest.files.map((f) => ({
                path: f.path,
                content: (0, archive_js_1.readZipEntryData)(buf, f.path),
            }));
            (0, manifest_validate_js_1.validateManifestPayloadConsistency)(manifest, payloadEntries);
            (0, manifest_validate_js_1.extractManifestFromArchiveEntries)([
                ...payloadEntries,
                { path: "manifest.json", content: manifestRaw },
            ]);
        }
    });
    (0, node_test_1.it)("crc mismatch is detectable via manifest sha256", async () => {
        const content = (0, schema_js_1.stableJsonStringify)({ ok: true });
        const payload = [{ path: "config/adapter.json", content }];
        const files = (0, manifest_js_1.buildManifestFileEntries)(payload);
        const manifest = (0, manifest_js_1.buildExportManifest)({
            kind: "backup",
            adapterVersion: "0.1.141",
            instance: 0,
            namespace: "ems.0",
            files,
        });
        manifest.files[0].sha256 = "0".repeat(64);
        strict_1.default.throws(() => (0, manifest_validate_js_1.validateManifestPayloadConsistency)(manifest, payload));
    });
});
