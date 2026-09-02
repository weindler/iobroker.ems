import * as fs from "node:fs/promises";
import * as path from "node:path";
import { realpath } from "node:fs/promises";
import { resolveEmsPaths, type PathResolverInput } from "../backup_integration/paths";
import { DIAGNOSTIC_DIR_MODE, DIAGNOSTIC_FILE_MODE } from "../persistence/atomic_write";

export const BACKUP_RETENTION_MAX = 10;
export const SUPPORT_RETENTION_MAX = 5;

const BACKUP_EXT = ".emsbackup";
const SUPPORT_EXT = ".emssupport";
const TEMP_PREFIX = ".tmp-";

/** Nur eigene Exportdateien (ems-light-*.{emsbackup,emssupport}). */
export const OWN_EXPORT_FILE_RE = /^ems-light-.+\.(emsbackup|emssupport)$/;

export function exportRootDir(input: PathResolverInput): string {
	return resolveEmsPaths(input).runtimeExportsDir;
}

export function backupDir(input: PathResolverInput): string {
	return path.join(exportRootDir(input), "backup");
}

export function supportDir(input: PathResolverInput): string {
	return path.join(exportRootDir(input), "support");
}

export function assertSafeFileName(name: string): void {
	if (!name || name.includes("..") || name.includes("/") || name.includes("\\") || name.includes("\0")) {
		throw new Error("invalid export file name");
	}
	if (!OWN_EXPORT_FILE_RE.test(name)) {
		throw new Error("invalid export file name pattern");
	}
}

export async function assertPathWithinExportRoot(resolvedPath: string, exportRoot: string): Promise<void> {
	const realRoot = await realpath(exportRoot).catch(() => path.resolve(exportRoot));
	const realTarget = await realpath(resolvedPath).catch(() => path.resolve(resolvedPath));
	if (!realTarget.startsWith(realRoot + path.sep) && realTarget !== realRoot) {
		throw new Error("path traversal blocked (realpath)");
	}
}

export function resolveExportPath(baseDir: string, fileName: string): string {
	assertSafeFileName(fileName);
	const resolved = path.resolve(baseDir, fileName);
	const base = path.resolve(baseDir);
	if (!resolved.startsWith(base + path.sep) && resolved !== base) {
		throw new Error("path traversal blocked");
	}
	return resolved;
}

export async function ensureExportDirs(input: PathResolverInput): Promise<void> {
	await fs.mkdir(backupDir(input), { recursive: true, mode: DIAGNOSTIC_DIR_MODE });
	await fs.mkdir(supportDir(input), { recursive: true, mode: DIAGNOSTIC_DIR_MODE });
	await fs.chmod(backupDir(input), DIAGNOSTIC_DIR_MODE).catch(() => undefined);
	await fs.chmod(supportDir(input), DIAGNOSTIC_DIR_MODE).catch(() => undefined);
}

export async function cleanupTempExports(input: PathResolverInput): Promise<void> {
	for (const dir of [backupDir(input), supportDir(input)]) {
		try {
			const files = await fs.readdir(dir);
			for (const f of files) {
				if (!f.startsWith(TEMP_PREFIX)) continue;
				const full = path.join(dir, f);
				const st = await fs.lstat(full);
				if (st.isSymbolicLink()) continue;
				await fs.unlink(full).catch(() => undefined);
			}
		} catch {
			// Verzeichnis fehlt
		}
	}
	const layout = resolveEmsPaths(input);
	try {
		const workParent = layout.runtimeExportsDir;
		const files = await fs.readdir(workParent);
		for (const f of files) {
			if (!f.startsWith(".work-")) continue;
			await fs.rm(path.join(workParent, f), { recursive: true, force: true }).catch(() => undefined);
		}
	} catch {
		// ignore
	}
}

function isOwnArchive(name: string, ext: string): boolean {
	return name.endsWith(ext) && !name.startsWith(TEMP_PREFIX) && OWN_EXPORT_FILE_RE.test(name);
}

async function listArchives(dir: string, ext: string): Promise<Array<{ name: string; mtimeMs: number }>> {
	try {
		const files = await fs.readdir(dir);
		const out: Array<{ name: string; mtimeMs: number }> = [];
		for (const name of files) {
			if (!isOwnArchive(name, ext)) continue;
			const full = path.join(dir, name);
			const st = await fs.lstat(full);
			if (st.isSymbolicLink()) continue;
			out.push({ name, mtimeMs: st.mtimeMs });
		}
		return out.sort((a, b) => a.mtimeMs - b.mtimeMs || a.name.localeCompare(b.name));
	} catch {
		return [];
	}
}

export async function enforceRetention(input: PathResolverInput): Promise<void> {
	const bDir = backupDir(input);
	const sDir = supportDir(input);
	const backups = await listArchives(bDir, BACKUP_EXT);
	while (backups.length > BACKUP_RETENTION_MAX) {
		const oldest = backups.shift();
		if (oldest) {
			const target = path.join(bDir, oldest.name);
			await assertPathWithinExportRoot(target, bDir).catch(() => undefined);
			await fs.unlink(target).catch(() => undefined);
		}
	}
	const supports = await listArchives(sDir, SUPPORT_EXT);
	while (supports.length > SUPPORT_RETENTION_MAX) {
		const oldest = supports.shift();
		if (oldest) {
			const target = path.join(sDir, oldest.name);
			await assertPathWithinExportRoot(target, sDir).catch(() => undefined);
			await fs.unlink(target).catch(() => undefined);
		}
	}
}

export async function writeAtomicArchive(targetPath: string, data: Buffer): Promise<void> {
	const dir = path.dirname(targetPath);
	await fs.mkdir(dir, { recursive: true, mode: DIAGNOSTIC_DIR_MODE });
	await fs.chmod(dir, DIAGNOSTIC_DIR_MODE).catch(() => undefined);
	const resolved = path.resolve(targetPath);
	await assertPathWithinExportRoot(resolved, dir);
	const tmp = path.join(dir, `${TEMP_PREFIX}${path.basename(targetPath)}.${process.pid}`);
	await fs.writeFile(tmp, data, { mode: DIAGNOSTIC_FILE_MODE });
	await fs.rename(tmp, targetPath);
	await fs.chmod(targetPath, DIAGNOSTIC_FILE_MODE).catch(() => undefined);
}

export { BACKUP_EXT, SUPPORT_EXT, TEMP_PREFIX };
