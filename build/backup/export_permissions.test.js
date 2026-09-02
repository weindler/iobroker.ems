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
const export_permissions_js_1 = require("./export_permissions.js");
const retention_js_1 = require("./retention.js");
(0, node_test_1.describe)("export permissions", () => {
    let tmp = "";
    (0, node_test_1.beforeEach)(async () => {
        tmp = await fs.mkdtemp(path.join(os.tmpdir(), "ems-export-mode-"));
    });
    (0, node_test_1.afterEach)(async () => {
        await fs.rm(tmp, { recursive: true, force: true });
    });
    (0, node_test_1.it)("schreibt Archive 0644 in Verzeichnis 0755", async () => {
        const dir = path.join(tmp, "backup");
        const file = path.join(dir, "ems-light-test-backup-20260901T120000000Z.emsbackup");
        await (0, retention_js_1.writeAtomicArchive)(file, Buffer.from("pk"));
        const stFile = await fs.stat(file);
        const stDir = await fs.stat(dir);
        strict_1.default.equal(stFile.mode & 0o777, export_permissions_js_1.EXPORT_FILE_MODE);
        strict_1.default.equal(stDir.mode & 0o777, export_permissions_js_1.EXPORT_DIR_MODE);
    });
    (0, node_test_1.it)("korrigiert bestehende 0600-Dateien", async () => {
        const dir = path.join(tmp, "support");
        await fs.mkdir(dir, { recursive: true, mode: 0o700 });
        const file = path.join(dir, "old.emssupport");
        await fs.writeFile(file, "x", { mode: 0o600 });
        await (0, export_permissions_js_1.applyReadableExportDirs)([dir]);
        strict_1.default.equal((await fs.stat(dir)).mode & 0o777, export_permissions_js_1.EXPORT_DIR_MODE);
        strict_1.default.equal((await fs.stat(file)).mode & 0o777, export_permissions_js_1.EXPORT_FILE_MODE);
    });
    (0, node_test_1.it)("Admin-Download-Pfad enthält Dateiname und Endung", () => {
        strict_1.default.equal((0, export_permissions_js_1.adapterFileDownloadPath)("ems.0", "support", "ems-light-x.emssupport"), "/files/ems.0/support/ems-light-x.emssupport");
    });
});
