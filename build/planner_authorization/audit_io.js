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
exports.readAuthorizationAuditFile = exports.writeAuthorizationAuditAtomic = exports.appendAuditEntry = exports.emptyAuditFile = void 0;
const fs = __importStar(require("node:fs/promises"));
const path = __importStar(require("node:path"));
const constants_1 = require("./constants");
function emptyAuditFile() {
    return { schemaVersion: constants_1.TAKEOVER_AUTHORIZATION_AUDIT_SCHEMA_VERSION, entries: [] };
}
exports.emptyAuditFile = emptyAuditFile;
function appendAuditEntry(file, entry, maxEntries = constants_1.TAKEOVER_AUTHORIZATION_AUDIT_MAX_ENTRIES) {
    const entries = [...file.entries, entry];
    while (entries.length > maxEntries)
        entries.shift();
    return { schemaVersion: constants_1.TAKEOVER_AUTHORIZATION_AUDIT_SCHEMA_VERSION, entries };
}
exports.appendAuditEntry = appendAuditEntry;
async function writeAuthorizationAuditAtomic(dir, file) {
    await fs.mkdir(dir, { recursive: true, mode: 0o700 });
    const target = path.join(dir, constants_1.TAKEOVER_AUTHORIZATION_AUDIT_FILE);
    const tmp = `${target}.${process.pid}.${Date.now()}.tmp`;
    const json = `${JSON.stringify(file, null, 2)}\n`;
    if (Buffer.byteLength(json, "utf8") > constants_1.TAKEOVER_AUTHORIZATION_AUDIT_MAX_BYTES) {
        // Drop oldest until under budget
        let trimmed = file;
        while (Buffer.byteLength(JSON.stringify(trimmed, null, 2), "utf8") >
            constants_1.TAKEOVER_AUTHORIZATION_AUDIT_MAX_BYTES &&
            trimmed.entries.length > 1) {
            trimmed = { ...trimmed, entries: trimmed.entries.slice(1) };
        }
        const tj = `${JSON.stringify(trimmed, null, 2)}\n`;
        await fs.writeFile(tmp, tj, { mode: 0o600 });
    }
    else {
        await fs.writeFile(tmp, json, { mode: 0o600 });
    }
    await fs.rename(tmp, target);
}
exports.writeAuthorizationAuditAtomic = writeAuthorizationAuditAtomic;
async function readAuthorizationAuditFile(dir) {
    const target = path.join(dir, constants_1.TAKEOVER_AUTHORIZATION_AUDIT_FILE);
    try {
        const raw = await fs.readFile(target, "utf8");
        if (Buffer.byteLength(raw, "utf8") > constants_1.TAKEOVER_AUTHORIZATION_AUDIT_MAX_BYTES * 2) {
            return emptyAuditFile();
        }
        const parsed = JSON.parse(raw);
        if (parsed?.schemaVersion !== constants_1.TAKEOVER_AUTHORIZATION_AUDIT_SCHEMA_VERSION || !Array.isArray(parsed.entries)) {
            return emptyAuditFile();
        }
        return {
            schemaVersion: constants_1.TAKEOVER_AUTHORIZATION_AUDIT_SCHEMA_VERSION,
            entries: parsed.entries.slice(-constants_1.TAKEOVER_AUTHORIZATION_AUDIT_MAX_ENTRIES),
        };
    }
    catch {
        return emptyAuditFile();
    }
}
exports.readAuthorizationAuditFile = readAuthorizationAuditFile;
