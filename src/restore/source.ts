import * as path from "node:path";
import { resolveEmsPaths, type PathResolverInput } from "../backup_integration/paths";
import { OWN_EXPORT_FILE_RE } from "../backup/retention";

export type RestoreRootKind = "backup_dir" | "inbox";

function layoutFromInstanceDataDir(instanceDataDir: string) {
	return resolveEmsPaths(instanceDataDir);
}

export function restoreInboxDir(input: PathResolverInput): string {
	return resolveEmsPaths(input).runtimeRestoreInboxDir;
}

export function restoreTransactionsDir(input: PathResolverInput): string {
	return resolveEmsPaths(input).runtimeTransactionsDir;
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

export function resolveRestoreSourcePath(input: PathResolverInput, fileName: string): { path: string; rootKind: RestoreRootKind } {
	assertRestoreFileName(fileName);
	const layout = resolveEmsPaths(input);
	const candidates: Array<{ path: string; rootKind: RestoreRootKind; root: string }> = [
		{
			path: path.join(layout.runtimeExportsDir, "backup", fileName),
			rootKind: "backup_dir",
			root: path.join(layout.runtimeExportsDir, "backup"),
		},
		{
			path: path.join(layout.runtimeRestoreInboxDir, fileName),
			rootKind: "inbox",
			root: layout.runtimeRestoreInboxDir,
		},
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
	const { realpath, lstat } = await import("node:fs/promises");
	const st = await lstat(resolvedPath);
	if (st.isSymbolicLink()) {
		throw new Error("restore source symlink not allowed");
	}
	const realRoot = await realpath(allowedRoot).catch(() => path.resolve(allowedRoot));
	const realTarget = await realpath(resolvedPath).catch(() => path.resolve(resolvedPath));
	if (!realTarget.startsWith(realRoot + path.sep) && realTarget !== realRoot) {
		throw new Error("restore source realpath outside root");
	}
}

export async function readRestoreArchiveFile(input: PathResolverInput, fileName: string): Promise<{
	buffer: Buffer;
	rootKind: RestoreRootKind;
	sizeBytes: number;
	mtimeMs: number;
	resolvedPath: string;
}> {
	const { path: resolved, rootKind } = resolveRestoreSourcePath(input, fileName);
	const layout = resolveEmsPaths(input);
	const allowedRoot =
		rootKind === "backup_dir"
			? path.join(layout.runtimeExportsDir, "backup")
			: layout.runtimeRestoreInboxDir;
	await assertRestoreSourceSafe(resolved, allowedRoot);
	const { stat, readFile } = await import("node:fs/promises");
	const st = await stat(resolved);
	const buffer = await readFile(resolved);
	return { buffer, rootKind, sizeBytes: st.size, mtimeMs: st.mtimeMs, resolvedPath: resolved };
}
