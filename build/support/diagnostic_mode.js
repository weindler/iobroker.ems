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
exports.totalSupportLogBytes = exports.collectSupportLogEntries = exports.recordErrorLog = exports.recordDiagnosticEvent = exports.diagnosticModeStatus = exports.stopDiagnosticMode = exports.startDiagnosticMode = exports.resetDiagnosticOnStartup = exports.resetDiagnosticModeForTest = exports.isDiagnosticModeActive = exports.DIAGNOSTIC_ALLOWED_DURATIONS = exports.DIAGNOSTIC_DEFAULT_DURATION_MIN = exports.DIAGNOSTIC_MAX_DURATION_MIN = void 0;
const fs = __importStar(require("node:fs/promises"));
const path = __importStar(require("node:path"));
const sanitize_1 = require("../backup/sanitize");
exports.DIAGNOSTIC_MAX_DURATION_MIN = 120;
exports.DIAGNOSTIC_DEFAULT_DURATION_MIN = 60;
exports.DIAGNOSTIC_ALLOWED_DURATIONS = [15, 30, 60, 120];
let diagnosticActive = false;
let diagnosticExpiresAtMs = 0;
let diagnosticTimer = null;
function isDiagnosticModeActive(now = Date.now()) {
    if (!diagnosticActive)
        return false;
    if (now >= diagnosticExpiresAtMs) {
        diagnosticActive = false;
        diagnosticExpiresAtMs = 0;
        return false;
    }
    return true;
}
exports.isDiagnosticModeActive = isDiagnosticModeActive;
function resetDiagnosticModeForTest() {
    diagnosticActive = false;
    diagnosticExpiresAtMs = 0;
    if (diagnosticTimer) {
        clearTimeout(diagnosticTimer);
        diagnosticTimer = null;
    }
}
exports.resetDiagnosticModeForTest = resetDiagnosticModeForTest;
function resetDiagnosticOnStartup() {
    resetDiagnosticModeForTest();
}
exports.resetDiagnosticOnStartup = resetDiagnosticOnStartup;
function startDiagnosticMode(durationMin, onExpire) {
    if (!Number.isFinite(durationMin)) {
        return { ok: false, error: "invalid_duration" };
    }
    const rounded = Math.round(durationMin);
    if (!exports.DIAGNOSTIC_ALLOWED_DURATIONS.includes(rounded)) {
        return { ok: false, error: "invalid_duration" };
    }
    if (diagnosticTimer)
        clearTimeout(diagnosticTimer);
    diagnosticActive = true;
    diagnosticExpiresAtMs = Date.now() + rounded * 60_000;
    diagnosticTimer = setTimeout(() => {
        diagnosticActive = false;
        diagnosticExpiresAtMs = 0;
        diagnosticTimer = null;
        onExpire?.();
    }, rounded * 60_000);
    return { ok: true, expiresAt: new Date(diagnosticExpiresAtMs).toISOString() };
}
exports.startDiagnosticMode = startDiagnosticMode;
function stopDiagnosticMode() {
    resetDiagnosticModeForTest();
}
exports.stopDiagnosticMode = stopDiagnosticMode;
function diagnosticModeStatus() {
    return {
        active: isDiagnosticModeActive(),
        expiresAt: diagnosticExpiresAtMs > 0 ? new Date(diagnosticExpiresAtMs).toISOString() : "",
    };
}
exports.diagnosticModeStatus = diagnosticModeStatus;
function logsDir(host) {
    if (typeof host.getAbsoluteInstanceDataDir === "function") {
        return path.join(host.getAbsoluteInstanceDataDir(), "exports", "support", "logs");
    }
    return path.join("/tmp", "ems-support-logs");
}
async function recordDiagnosticEvent(host, event) {
    if (!isDiagnosticModeActive())
        return;
    const { appendNdjsonRotating } = await Promise.resolve().then(() => __importStar(require("./log_rotation")));
    await appendNdjsonRotating(logsDir(host), "diagnostics", event, {
        maxFiles: 4,
        maxFileBytes: 512 * 1024,
        totalMaxBytes: 2 * 1024 * 1024,
    });
}
exports.recordDiagnosticEvent = recordDiagnosticEvent;
async function recordErrorLog(host, event) {
    const { appendNdjsonRotating } = await Promise.resolve().then(() => __importStar(require("./log_rotation")));
    await appendNdjsonRotating(logsDir(host), "errors", event, {
        maxFiles: 4,
        maxFileBytes: 256 * 1024,
        totalMaxBytes: 1024 * 1024,
    });
}
exports.recordErrorLog = recordErrorLog;
function sanitizeNdjsonContent(raw) {
    const lines = raw.split("\n").filter((l) => l.trim().length > 0);
    const sanitized = lines.map((line) => {
        try {
            const obj = JSON.parse(line);
            return JSON.stringify((0, sanitize_1.sanitizeForSupport)(obj));
        }
        catch {
            return JSON.stringify((0, sanitize_1.sanitizeForSupport)({ detail: line }));
        }
    });
    return sanitized.length > 0 ? `${sanitized.join("\n")}\n` : "";
}
async function collectSupportLogEntries(host) {
    const dir = logsDir(host);
    const out = [];
    try {
        const files = (await fs.readdir(dir)).filter((f) => f.endsWith(".ndjson")).sort();
        let idx = 1;
        for (const f of files) {
            const raw = await fs.readFile(path.join(dir, f), "utf8");
            const content = sanitizeNdjsonContent(raw);
            const archiveName = f.startsWith("diagnostics")
                ? `logs/diagnostics-${String(idx).padStart(3, "0")}.ndjson`
                : `logs/errors.ndjson`;
            const hit = (0, sanitize_1.scanForForbiddenSecrets)(content);
            if (hit) {
                throw new Error(`support log secret scan failed (${archiveName}): ${hit}`);
            }
            if (content.length > 0) {
                out.push({ path: archiveName, content });
            }
            if (f.startsWith("diagnostics"))
                idx += 1;
        }
    }
    catch (e) {
        if (e instanceof Error && e.message.includes("secret scan"))
            throw e;
        // kein Log-Verzeichnis
    }
    (0, sanitize_1.assertSupportBundleClean)(out.map((e) => ({ path: e.path, content: String(e.content) })));
    return out;
}
exports.collectSupportLogEntries = collectSupportLogEntries;
async function totalSupportLogBytes(host) {
    try {
        const dir = logsDir(host);
        const files = await fs.readdir(dir);
        let total = 0;
        for (const f of files) {
            const st = await fs.stat(path.join(dir, f));
            total += st.size;
        }
        return total;
    }
    catch {
        return 0;
    }
}
exports.totalSupportLogBytes = totalSupportLogBytes;
