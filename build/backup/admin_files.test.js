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
const strict_1 = __importDefault(require("node:assert/strict"));
const node_test_1 = require("node:test");
const fs = __importStar(require("node:fs/promises"));
const os = __importStar(require("node:os"));
const path = __importStar(require("node:path"));
const admin_files_1 = require("./admin_files");
const source_1 = require("../restore/source");
(0, node_test_1.describe)("backup admin_files", () => {
    (0, node_test_1.it)("lists emsbackup from backup and inbox dirs", async () => {
        const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "ems-admin-files-"));
        try {
            const host = {
                getAbsoluteInstanceDataDir: () => path.join(tmp, "ems.0"),
                namespace: "ems.0",
            };
            const { resolveEmsPaths } = await Promise.resolve().then(() => __importStar(require("../backup_integration/paths.js")));
            const layout = resolveEmsPaths(host);
            await fs.mkdir(path.join(layout.runtimeExportsDir, "backup"), { recursive: true });
            await fs.mkdir(layout.runtimeRestoreInboxDir, { recursive: true });
            await fs.writeFile(path.join(layout.runtimeExportsDir, "backup", "ems-light-a.emsbackup"), "a");
            await fs.writeFile(path.join(layout.runtimeRestoreInboxDir, "ems-light-b.emsbackup"), "b");
            await fs.writeFile(path.join(layout.runtimeExportsDir, "backup", "ignore.txt"), "z");
            const opts = await (0, admin_files_1.listRestoreFileOptions)(host);
            strict_1.default.ok(opts.some((o) => o.value === "ems-light-a.emsbackup"));
            strict_1.default.ok(opts.some((o) => o.value === "ems-light-b.emsbackup"));
            strict_1.default.ok(!opts.some((o) => o.value === "ignore.txt"));
        }
        finally {
            await fs.rm(tmp, { recursive: true, force: true });
        }
    });
    (0, node_test_1.it)("writes upload into inbox with valid name", async () => {
        const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "ems-admin-up-"));
        try {
            const host = {
                getAbsoluteInstanceDataDir: () => path.join(tmp, "ems.0"),
                namespace: "ems.0",
            };
            const payload = Buffer.from("PK\x03\x04dummy-zip-content-for-test-xx").toString("base64");
            const res = await (0, admin_files_1.writeRestoreUploadToInbox)(host, "x.emsbackup", payload);
            strict_1.default.equal(res.ok, true);
            if (res.ok) {
                strict_1.default.match(res.fileName, /^ems-light-upload-.+\.emsbackup$/);
                const st = await fs.stat(path.join((0, source_1.restoreInboxDir)(host), res.fileName));
                strict_1.default.ok(st.size > 10);
            }
        }
        finally {
            await fs.rm(tmp, { recursive: true, force: true });
        }
    });
});
