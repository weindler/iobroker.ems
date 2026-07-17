import * as fs from "node:fs/promises";
import * as path from "node:path";
import {
	TAKEOVER_AUTHORIZATION_AUDIT_FILE,
	TAKEOVER_AUTHORIZATION_AUDIT_MAX_BYTES,
	TAKEOVER_AUTHORIZATION_AUDIT_MAX_ENTRIES,
	TAKEOVER_AUTHORIZATION_AUDIT_SCHEMA_VERSION,
} from "./constants";
import type { PlannerAuthorizationAuditEntry } from "./types";

export interface AuthorizationAuditFile {
	schemaVersion: typeof TAKEOVER_AUTHORIZATION_AUDIT_SCHEMA_VERSION;
	entries: PlannerAuthorizationAuditEntry[];
}

export function emptyAuditFile(): AuthorizationAuditFile {
	return { schemaVersion: TAKEOVER_AUTHORIZATION_AUDIT_SCHEMA_VERSION, entries: [] };
}

export function appendAuditEntry(
	file: AuthorizationAuditFile,
	entry: PlannerAuthorizationAuditEntry,
	maxEntries = TAKEOVER_AUTHORIZATION_AUDIT_MAX_ENTRIES,
): AuthorizationAuditFile {
	const entries = [...file.entries, entry];
	while (entries.length > maxEntries) entries.shift();
	return { schemaVersion: TAKEOVER_AUTHORIZATION_AUDIT_SCHEMA_VERSION, entries };
}

export async function writeAuthorizationAuditAtomic(
	dir: string,
	file: AuthorizationAuditFile,
): Promise<void> {
	await fs.mkdir(dir, { recursive: true, mode: 0o700 });
	const target = path.join(dir, TAKEOVER_AUTHORIZATION_AUDIT_FILE);
	const tmp = `${target}.${process.pid}.${Date.now()}.tmp`;
	const json = `${JSON.stringify(file, null, 2)}\n`;
	if (Buffer.byteLength(json, "utf8") > TAKEOVER_AUTHORIZATION_AUDIT_MAX_BYTES) {
		// Drop oldest until under budget
		let trimmed = file;
		while (
			Buffer.byteLength(JSON.stringify(trimmed, null, 2), "utf8") >
				TAKEOVER_AUTHORIZATION_AUDIT_MAX_BYTES &&
			trimmed.entries.length > 1
		) {
			trimmed = { ...trimmed, entries: trimmed.entries.slice(1) };
		}
		const tj = `${JSON.stringify(trimmed, null, 2)}\n`;
		await fs.writeFile(tmp, tj, { mode: 0o600 });
	} else {
		await fs.writeFile(tmp, json, { mode: 0o600 });
	}
	await fs.rename(tmp, target);
}

export async function readAuthorizationAuditFile(dir: string): Promise<AuthorizationAuditFile> {
	const target = path.join(dir, TAKEOVER_AUTHORIZATION_AUDIT_FILE);
	try {
		const raw = await fs.readFile(target, "utf8");
		if (Buffer.byteLength(raw, "utf8") > TAKEOVER_AUTHORIZATION_AUDIT_MAX_BYTES * 2) {
			return emptyAuditFile();
		}
		const parsed = JSON.parse(raw) as AuthorizationAuditFile;
		if (parsed?.schemaVersion !== TAKEOVER_AUTHORIZATION_AUDIT_SCHEMA_VERSION || !Array.isArray(parsed.entries)) {
			return emptyAuditFile();
		}
		return {
			schemaVersion: TAKEOVER_AUTHORIZATION_AUDIT_SCHEMA_VERSION,
			entries: parsed.entries.slice(-TAKEOVER_AUTHORIZATION_AUDIT_MAX_ENTRIES),
		};
	} catch {
		return emptyAuditFile();
	}
}
