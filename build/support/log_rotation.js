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
exports.readAllNdjson = exports.appendNdjsonRotating = void 0;
const fs = __importStar(require("node:fs/promises"));
const path = __importStar(require("node:path"));
const sanitize_1 = require("../backup/sanitize");
const GLOBAL_SUPPORT_LOG_MAX = 3 * 1024 * 1024;
function currentLogFile(dir, prefix, files) {
    const numbered = files
        .filter((f) => f.startsWith(`${prefix}-`) && f.endsWith(".ndjson"))
        .sort();
    if (numbered.length === 0)
        return path.join(dir, `${prefix}-001.ndjson`);
    return path.join(dir, numbered[numbered.length - 1]);
}
async function listLogFiles(dir, prefix) {
    try {
        return (await fs.readdir(dir))
            .filter((f) => f.startsWith(`${prefix}-`) && f.endsWith(".ndjson"))
            .sort();
    }
    catch {
        return [];
    }
}
async function totalBytesInDir(dir) {
    try {
        const files = await fs.readdir(dir);
        let n = 0;
        for (const f of files) {
            n += (await fs.stat(path.join(dir, f))).size;
        }
        return n;
    }
    catch {
        return 0;
    }
}
async function appendNdjsonRotating(dir, prefix, record, opts) {
    await fs.mkdir(dir, { recursive: true });
    const ctx = (0, sanitize_1.createPseudonymContext)();
    const line = (0, sanitize_1.sanitizeString)(typeof record === "string" ? record : JSON.stringify(record), ctx) + "\n";
    const lineBuf = Buffer.from(line, "utf8");
    let files = await listLogFiles(dir, prefix);
    let target = currentLogFile(dir, prefix, files);
    let size = 0;
    try {
        size = (await fs.stat(target)).size;
    }
    catch {
        // neue Datei
    }
    if (size + lineBuf.length > opts.maxFileBytes) {
        const nextNum = files.length + 1;
        const nextName = `${prefix}-${String(nextNum).padStart(3, "0")}.ndjson`;
        target = path.join(dir, nextName);
        files = await listLogFiles(dir, prefix);
        while (files.length >= opts.maxFiles) {
            await fs.unlink(path.join(dir, files[0]));
            files.shift();
        }
    }
    await fs.appendFile(target, lineBuf);
    while ((await totalBytesInDir(dir)) > Math.min(opts.totalMaxBytes, GLOBAL_SUPPORT_LOG_MAX)) {
        files = await listLogFiles(dir, prefix);
        if (files.length === 0)
            break;
        await fs.unlink(path.join(dir, files[0]));
    }
}
exports.appendNdjsonRotating = appendNdjsonRotating;
async function readAllNdjson(dir) {
    try {
        const files = (await fs.readdir(dir)).filter((f) => f.endsWith(".ndjson")).sort();
        const lines = [];
        for (const f of files) {
            const raw = await fs.readFile(path.join(dir, f), "utf8");
            for (const line of raw.split("\n")) {
                if (line.trim())
                    lines.push(line);
            }
        }
        return lines;
    }
    catch {
        return [];
    }
}
exports.readAllNdjson = readAllNdjson;
