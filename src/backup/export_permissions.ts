import * as fs from "node:fs/promises";
import * as path from "node:path";
import { DIAGNOSTIC_DIR_MODE, DIAGNOSTIC_FILE_MODE } from "../persistence/atomic_write";
import { backupDir, supportDir } from "./retention";
import { restoreInboxDir } from "../restore/source";
import type { PathResolverInput } from "../backup_integration/paths";

/** User-facing Exporte: lesbar für normalen ioBroker-/SFTP-Betrieb, nicht world-writable. */
export const EXPORT_DIR_MODE = DIAGNOSTIC_DIR_MODE;
export const EXPORT_FILE_MODE = DIAGNOSTIC_FILE_MODE;

export async function chmodExportPath(fullPath: string, dir: boolean): Promise<void> {
	await fs.chmod(fullPath, dir ? EXPORT_DIR_MODE : EXPORT_FILE_MODE).catch(() => undefined);
}

export async function ensureDirReadable(dirPath: string): Promise<void> {
	await fs.mkdir(dirPath, { recursive: true, mode: EXPORT_DIR_MODE });
	await chmodExportPath(dirPath, true);
}

async function walkExportTree(root: string): Promise<void> {
	let entries: import("node:fs").Dirent[];
	try {
		entries = await fs.readdir(root, { withFileTypes: true });
	} catch {
		return;
	}
	await chmodExportPath(root, true);
	for (const ent of entries) {
		if (ent.name === "." || ent.name === "..") continue;
		const full = path.join(root, ent.name);
		try {
			const st = await fs.lstat(full);
			if (st.isSymbolicLink()) continue;
			if (st.isDirectory()) {
				await walkExportTree(full);
			} else if (st.isFile()) {
				await chmodExportPath(full, false);
			}
		} catch {
			// Eintrag verschwunden
		}
	}
}

export async function applyReadableExportDirs(roots: string[]): Promise<void> {
	for (const root of roots) {
		await ensureDirReadable(root);
		await walkExportTree(root);
	}
}

/** Backup-, Support- und Restore-Inbox-Bäume auf 0755/0644 setzen (bestehende Dateien inkl.). */
export async function applyReadableExportPermissions(input: PathResolverInput): Promise<void> {
	await applyReadableExportDirs([backupDir(input), supportDir(input), restoreInboxDir(input)]);
}

export function adapterFileDownloadPath(namespace: string, kind: "backup" | "support", fileName: string): string {
	return `/files/${namespace}/${kind}/${fileName}`;
}
