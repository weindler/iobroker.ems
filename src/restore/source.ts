import * as fs from "node:fs/promises";
import * as path from "node:path";
import { realpath } from "node:fs/promises";
import { backupDir } from "../backup/retention";
import { OWN_EXPORT_FILE_RE } from "../backup/retention";

export type RestoreRootKind = "backup_dir" | "inbox";

export function restoreInboxDir(instanceDataDir: string): string {
	return path.join(instanceDataDir, "restore", "inbox");
}

export function restoreTransactionsDir(instanceDataDir: string): string {
	return path.join(instanceDataDir, "restore", "transactions");
}

/** Validiert Dateinamen — nur einfacher `.emsbackup`-Name. */
export function assertRestoreFileName(fileName: string): void {
	if (!fileName || fileName.includes("/") || fileName.includes("\\") || fileName.includes("\0")) {
		throw new Error("invalid restore file name");
	}
	if (fileName.includes("..")) {
		throw new Error("path traversal in restore file name");
	}
	if (fileName.startsWith(".tmp-")) {
		throw new Error("temp file not allowed");
	}
	if (!fileName.endsWith(".emsbackup")) {
		throw new Error("restore requires .emsbackup extension");
	}
	if (fileName.endsWith(".emssupport")) {
		throw new Error("support packages not restorable");
	}
	if (!OWN_EXPORT_FILE_RE.test(fileName)) {
		throw new Error("invalid restore file name pattern");
	}
}

export function resolveRestoreSourcePath(instanceDataDir: string, fileName: string): { path: string; rootKind: RestoreRootKind } {
	assertRestoreFileName(fileName);
	const candidates: Array<{ path: string; rootKind: RestoreRootKind; root: string }> = [
		{ path: path.join(backupDir(instanceDataDir), fileName), rootKind: "backup_dir", root: backupDir(instanceDataDir) },
		{ path: path.join(restoreInboxDir(instanceDataDir), fileName), rootKind: "inbox", root: restoreInboxDir(instanceDataDir) },
	];
	for (const c of candidates) {
		const resolved = path.resolve(c.path);
		const root = path.resolve(c.root);
		if (resolved.startsWith(root + path.sep) || resolved === root) {
			return { path: resolved, rootKind: c.rootKind };
		}
	}
	throw new Error("restore source path outside allowed root");
}

export async function assertRestoreSourceSafe(resolvedPath: string, allowedRoot: string): Promise<void> {
	const st = await fs.lstat(resolvedPath);
	if (st.isSymbolicLink()) {
		throw new Error("restore source symlink not allowed");
	}
	const realRoot = await realpath(allowedRoot).catch(() => path.resolve(allowedRoot));
	const realTarget = await realpath(resolvedPath).catch(() => path.resolve(resolvedPath));
	if (!realTarget.startsWith(realRoot + path.sep) && realTarget !== realRoot) {
		throw new Error("restore source realpath outside root");
	}
}

export async function readRestoreArchiveFile(instanceDataDir: string, fileName: string): Promise<{
	buffer: Buffer;
	rootKind: RestoreRootKind;
	sizeBytes: number;
	mtimeMs: number;
	resolvedPath: string;
}> {
	const { path: resolved, rootKind } = resolveRestoreSourcePath(instanceDataDir, fileName);
	const allowedRoot = rootKind === "backup_dir" ? backupDir(instanceDataDir) : restoreInboxDir(instanceDataDir);
	await assertRestoreSourceSafe(resolved, allowedRoot);
	const st = await fs.stat(resolved);
	const buffer = await fs.readFile(resolved);
	return { buffer, rootKind, sizeBytes: st.size, mtimeMs: st.mtimeMs, resolvedPath: resolved };
}
