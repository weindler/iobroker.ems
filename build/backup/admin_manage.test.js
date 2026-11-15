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
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const strict_1 = __importDefault(require("node:assert/strict"));
const node_test_1 = require("node:test");
const fs = __importStar(require("node:fs/promises"));
const os = __importStar(require("node:os"));
const path = __importStar(require("node:path"));
const admin_files_1 = require("./admin_files");
async function setup() {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "ems-manage-"));
    const deletedAdapterFiles = [];
    const host = {
        getAbsoluteInstanceDataDir: () => path.join(tmp, "ems.0"),
        namespace: "ems.0",
        writeFileAsync: async () => undefined,
        delFileAsync: async (_a, f) => {
            deletedAdapterFiles.push(f);
        },
    };
    const { resolveEmsPaths } = await import("../backup_integration/paths.js");
    const layout = resolveEmsPaths(host);
    const dir = path.join(layout.runtimeExportsDir, "backup");
    await fs.mkdir(dir, { recursive: true });
    for (const n of ["2026-11-10", "2026-11-11", "2026-11-12", "2026-11-13"]) {
        await fs.writeFile(path.join(dir, `ems-light-${n}T10-00-00-000Z.emsbackup`), "x".repeat(64));
    }
    return { tmp, host, dir, deletedAdapterFiles };
}
(0, node_test_1.describe)("backup verwalten", () => {
    (0, node_test_1.it)("listet neueste zuerst, lädt und löscht eine Datei", async () => {
        const { tmp, host, dir, deletedAdapterFiles } = await setup();
        try {
            const names = await (0, admin_files_1.listBackupFileNames)(host);
            strict_1.default.equal(names.length, 4);
            strict_1.default.ok(names[0].includes("2026-11-13"));
            const dl = await (0, admin_files_1.readBackupFileBase64)(host, names[0]);
            strict_1.default.ok(dl.ok && dl.sizeBytes === 64 && dl.downloadPath === `/files/ems.0/backup/${names[0]}`);
            const del = await (0, admin_files_1.deleteBackupFile)(host, names[3]);
            strict_1.default.ok(del.ok);
            strict_1.default.equal((await fs.readdir(dir)).length, 3);
            strict_1.default.ok(deletedAdapterFiles.includes(`backup/${names[3]}`));
        }
        finally {
            await fs.rm(tmp, { recursive: true, force: true });
        }
    });
    (0, node_test_1.it)("lehnt unsichere Dateinamen ab", async () => {
        const { tmp, host } = await setup();
        try {
            strict_1.default.equal((await (0, admin_files_1.deleteBackupFile)(host, "../x.emsbackup")).ok, false);
            strict_1.default.equal((await (0, admin_files_1.deleteBackupFile)(host, "evil.emsbackup")).ok, false);
            strict_1.default.equal((await (0, admin_files_1.readBackupFileBase64)(host, "ems-light-x.txt")).ok, false);
        }
        finally {
            await fs.rm(tmp, { recursive: true, force: true });
        }
    });
    (0, node_test_1.it)("löscht alle außer den neuesten N", async () => {
        const { tmp, host } = await setup();
        try {
            const r = await (0, admin_files_1.deleteOldBackups)(host, 2);
            strict_1.default.equal(r.deleted.length, 2);
            strict_1.default.equal(r.kept.length, 2);
            strict_1.default.ok(r.kept[0].includes("2026-11-13"));
            strict_1.default.equal((await (0, admin_files_1.deleteOldBackups)(host, 0)).kept.length, 1);
        }
        finally {
            await fs.rm(tmp, { recursive: true, force: true });
        }
    });
});
