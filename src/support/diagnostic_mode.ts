import * as fs from "node:fs/promises";
import * as path from "node:path";
import { assertSupportBundleClean, sanitizeForSupport, scanForForbiddenSecrets } from "../backup/sanitize";
import type { ExportArchiveEntry } from "../backup/types";

export const DIAGNOSTIC_MAX_DURATION_MIN = 120;
export const DIAGNOSTIC_DEFAULT_DURATION_MIN = 60;
export const DIAGNOSTIC_ALLOWED_DURATIONS = [15, 30, 60, 120] as const;

export type DiagnosticEvent = {
	ts: string;
	level: "info" | "warn" | "error" | "debug";
	module: string;
	event: string;
	detail?: string;
};

let diagnosticActive = false;
let diagnosticExpiresAtMs = 0;
let diagnosticTimer: ReturnType<typeof setTimeout> | null = null;

export function isDiagnosticModeActive(now = Date.now()): boolean {
	if (!diagnosticActive) return false;
	if (now >= diagnosticExpiresAtMs) {
		diagnosticActive = false;
		diagnosticExpiresAtMs = 0;
		return false;
	}
	return true;
}

export function resetDiagnosticModeForTest(): void {
	diagnosticActive = false;
	diagnosticExpiresAtMs = 0;
	if (diagnosticTimer) {
		clearTimeout(diagnosticTimer);
		diagnosticTimer = null;
	}
}

export function resetDiagnosticOnStartup(): void {
	resetDiagnosticModeForTest();
}

export function startDiagnosticMode(
	durationMin: number,
	onExpire?: () => void,
): { ok: true; expiresAt: string } | { ok: false; error: string } {
	if (!Number.isFinite(durationMin)) {
		return { ok: false, error: "invalid_duration" };
	}
	const rounded = Math.round(durationMin);
	if (!DIAGNOSTIC_ALLOWED_DURATIONS.includes(rounded as (typeof DIAGNOSTIC_ALLOWED_DURATIONS)[number])) {
		return { ok: false, error: "invalid_duration" };
	}
	if (diagnosticTimer) clearTimeout(diagnosticTimer);
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

export function stopDiagnosticMode(): void {
	resetDiagnosticModeForTest();
}

export function diagnosticModeStatus(): { active: boolean; expiresAt: string } {
	return {
		active: isDiagnosticModeActive(),
		expiresAt: diagnosticExpiresAtMs > 0 ? new Date(diagnosticExpiresAtMs).toISOString() : "",
	};
}

import { resolveEmsPaths } from "../backup_integration/paths";

export type DiagnosticRecorderHost = {
	getAbsoluteInstanceDataDir?: () => string;
	namespace?: string;
	log?: { debug?: (m: string) => void };
};

function logsDir(host: DiagnosticRecorderHost): string {
	if (typeof host.getAbsoluteInstanceDataDir === "function" && host.namespace) {
		return path.join(resolveEmsPaths(host as ioBroker.Adapter).runtimeExportsDir, "support", "logs");
	}
	if (typeof host.getAbsoluteInstanceDataDir === "function") {
		return path.join(resolveEmsPaths(host.getAbsoluteInstanceDataDir()).runtimeExportsDir, "support", "logs");
	}
	return path.join("/tmp", "ems-support-logs");
}

export async function recordDiagnosticEvent(host: DiagnosticRecorderHost, event: DiagnosticEvent): Promise<void> {
	if (!isDiagnosticModeActive()) return;
	const { appendNdjsonRotating } = await import("./log_rotation");
	await appendNdjsonRotating(logsDir(host), "diagnostics", event, {
		maxFiles: 4,
		maxFileBytes: 512 * 1024,
		totalMaxBytes: 2 * 1024 * 1024,
	});
}

export async function recordErrorLog(host: DiagnosticRecorderHost, event: DiagnosticEvent): Promise<void> {
	const { appendNdjsonRotating } = await import("./log_rotation");
	await appendNdjsonRotating(logsDir(host), "errors", event, {
		maxFiles: 4,
		maxFileBytes: 256 * 1024,
		totalMaxBytes: 1024 * 1024,
	});
}

function sanitizeNdjsonContent(raw: string): string {
	const lines = raw.split("\n").filter((l) => l.trim().length > 0);
	const sanitized = lines.map((line) => {
		try {
			const obj = JSON.parse(line) as unknown;
			return JSON.stringify(sanitizeForSupport(obj));
		} catch {
			return JSON.stringify(sanitizeForSupport({ detail: line }));
		}
	});
	return sanitized.length > 0 ? `${sanitized.join("\n")}\n` : "";
}

export async function collectSupportLogEntries(host: DiagnosticRecorderHost): Promise<ExportArchiveEntry[]> {
	const dir = logsDir(host);
	const out: ExportArchiveEntry[] = [];
	try {
		const files = (await fs.readdir(dir)).filter((f) => f.endsWith(".ndjson")).sort();
		let idx = 1;
		for (const f of files) {
			const raw = await fs.readFile(path.join(dir, f), "utf8");
			const content = sanitizeNdjsonContent(raw);
			const archiveName = f.startsWith("diagnostics")
				? `logs/diagnostics-${String(idx).padStart(3, "0")}.ndjson`
				: `logs/errors.ndjson`;
			const hit = scanForForbiddenSecrets(content);
			if (hit) {
				throw new Error(`support log secret scan failed (${archiveName}): ${hit}`);
			}
			if (content.length > 0) {
				out.push({ path: archiveName, content });
			}
			if (f.startsWith("diagnostics")) idx += 1;
		}
	} catch (e) {
		if (e instanceof Error && e.message.includes("secret scan")) throw e;
		// kein Log-Verzeichnis
	}
	assertSupportBundleClean(out.map((e) => ({ path: e.path, content: String(e.content) })));
	return out;
}

export async function totalSupportLogBytes(host: DiagnosticRecorderHost): Promise<number> {
	try {
		const dir = logsDir(host);
		const files = await fs.readdir(dir);
		let total = 0;
		for (const f of files) {
			const st = await fs.stat(path.join(dir, f));
			total += st.size;
		}
		return total;
	} catch {
		return 0;
	}
}
