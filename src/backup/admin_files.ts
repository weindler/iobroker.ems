import * as fs from "node:fs/promises";
import * as path from "node:path";
import { EXPORT_LIMITS } from "./limits";
import { assertSafeFileName, backupDir, supportDir, OWN_EXPORT_FILE_RE } from "./retention";
import { restoreInboxDir } from "../restore/source";
import type { PathResolverInput } from "../backup_integration/paths";
import { EXPORT_FILE_MODE, adapterFileDownloadPath, ensureDirReadable, chmodExportPath } from "./export_permissions";

export type AdapterFilesHost = PathResolverInput & {
	namespace: string;
	writeFileAsync?: (adapterName: string, fileName: string, data: Buffer | string) => Promise<void>;
	readFileAsync?: (adapterName: string, fileName: string) => Promise<{ file: string | Buffer; mimeType?: string }>;
	readDirAsync?: (
		adapterName: string,
		dirName: string,
	) => Promise<Array<{ file: string; isDir: boolean; stats?: { size?: number } }>>;
	delFileAsync?: (adapterName: string, fileName: string) => Promise<void>;
	setObjectNotExistsAsync?: (id: string, obj: ioBroker.Object) => Promise<unknown>;
	log?: { info?: (m: string) => void; warn?: (m: string) => void; debug?: (m: string) => void };
};

const ADAPTER_RESTORE_INBOX = "restore-inbox";

/** Meta-Objekt für Admin fileSelector / Download. */
export async function ensureAdapterFilesMeta(host: AdapterFilesHost): Promise<void> {
	if (typeof host.setObjectNotExistsAsync !== "function") return;
	await host.setObjectNotExistsAsync(host.namespace, {
		type: "meta",
		common: {
			name: host.namespace,
			type: "meta.user",
		},
		native: {},
	} as ioBroker.Object);
}

/** Datei zusätzlich in die Adapter-File-DB legen (Admin-Download). */
export async function mirrorExportIntoAdapterFiles(
	host: AdapterFilesHost,
	kind: "backup" | "support",
	fileName: string,
	data: Buffer,
): Promise<void> {
	if (typeof host.writeFileAsync !== "function") {
		host.log?.warn?.("backup: writeFileAsync missing — Admin-Download-Spiegel übersprungen");
		return;
	}
	await ensureAdapterFilesMeta(host);
	const rel = `${kind}/${fileName}`;
	await host.writeFileAsync(host.namespace, rel, data);
	host.log?.info?.(`backup: mirrored ${rel} into adapter files for Admin download`);
}

export async function mirrorHostExportFile(
	host: AdapterFilesHost,
	kind: "backup" | "support",
	fileName: string,
): Promise<void> {
	const dir = kind === "backup" ? backupDir(host) : supportDir(host);
	const full = path.join(dir, fileName);
	const data = await fs.readFile(full);
	await mirrorExportIntoAdapterFiles(host, kind, fileName, data);
}

export type SelectOption = { label: string; value: string; description?: string };

/** Zeitstempel aus ems-light-…-backup-2026-07-19T095123951Z.emsbackup lesen. */
export function parseBackupFileStamp(fileName: string): { sortKey: string; labelWhen: string } | null {
	const m = fileName.match(/(\d{4}-\d{2}-\d{2})T(\d{2})(\d{2})(\d{2})(\d{3})?Z/);
	if (!m) return null;
	const [, day, hh, mm, ss] = m;
	return {
		sortKey: `${day}T${hh}${mm}${ss}`,
		labelWhen: `${day} ${hh}:${mm}:${ss} UTC`,
	};
}

function formatRestoreOptionLabel(fileName: string, tag: string, newest: boolean): SelectOption {
	const stamp = parseBackupFileStamp(fileName);
	const when = stamp?.labelWhen ?? fileName;
	const newestMark = newest ? " ★ NEUESTE" : "";
	return {
		value: fileName,
		label: `${when}${newestMark}`,
		description: `${tag} · ${fileName}`,
	};
}

/**
 * Admin-Uploads unter restore-inbox/ in die Host-Inbox spiegeln
 * (Restore liest nur Host-Pfade).
 */
export async function syncAdapterRestoreInboxToHost(host: AdapterFilesHost): Promise<string[]> {
	const synced: string[] = [];
	if (typeof host.readDirAsync !== "function" || typeof host.readFileAsync !== "function") {
		return synced;
	}
	let entries: Array<{ file: string; isDir: boolean }> = [];
	try {
		entries = await host.readDirAsync(host.namespace, ADAPTER_RESTORE_INBOX);
	} catch {
		return synced;
	}
	const inbox = restoreInboxDir(host);
	await ensureDirReadable(inbox);
	for (const ent of entries) {
		if (ent.isDir) continue;
		const rawName = path.basename(ent.file);
		if (!rawName.endsWith(".emsbackup")) continue;
		let name = rawName;
		if (!OWN_EXPORT_FILE_RE.test(name)) {
			const ts = new Date().toISOString().replace(/[:.]/g, "-");
			name = `ems-light-upload-${ts}.emsbackup`;
		}
		try {
			const { file } = await host.readFileAsync(host.namespace, `${ADAPTER_RESTORE_INBOX}/${rawName}`);
			const buf = Buffer.isBuffer(file) ? file : Buffer.from(String(file), "binary");
			if (buf.length < 32) continue;
			await fs.writeFile(path.join(inbox, name), buf, { mode: EXPORT_FILE_MODE });
			await chmodExportPath(path.join(inbox, name), false);
			synced.push(name);
		} catch (e) {
			host.log?.warn?.(
				`restore sync ${rawName}: ${e instanceof Error ? e.message : String(e)}`,
			);
		}
	}
	return synced;
}

export async function listRestoreFileOptions(host: AdapterFilesHost): Promise<SelectOption[]> {
	await syncAdapterRestoreInboxToHost(host);
	const dirs: Array<{ dir: string; tag: string }> = [
		{ dir: backupDir(host), tag: "backup" },
		{ dir: restoreInboxDir(host), tag: "inbox" },
	];
	const collected: Array<{ name: string; tag: string; sortKey: string }> = [];
	const seen = new Set<string>();
	for (const { dir, tag } of dirs) {
		let names: string[] = [];
		try {
			names = await fs.readdir(dir);
		} catch {
			continue;
		}
		for (const name of names) {
			if (!name.endsWith(".emsbackup")) continue;
			if (!OWN_EXPORT_FILE_RE.test(name)) continue;
			if (seen.has(name)) continue;
			seen.add(name);
			const stamp = parseBackupFileStamp(name);
			collected.push({ name, tag, sortKey: stamp?.sortKey ?? name });
		}
	}
	collected.sort((a, b) => (a.sortKey < b.sortKey ? 1 : a.sortKey > b.sortKey ? -1 : 0));
	if (collected.length === 0) {
		return [
			{
				value: "",
				label: "(keine .emsbackup — zuerst „Backup jetzt erstellen“)",
			},
		];
	}
	return collected.map((c, i) => formatRestoreOptionLabel(c.name, c.tag, i === 0));
}

export async function writeRestoreUploadToInbox(
	host: PathResolverInput,
	_fileName: string,
	base64OrDataUrl: string,
): Promise<{ ok: true; fileName: string } | { ok: false; error: string }> {
	try {
		const raw = String(base64OrDataUrl || "");
		if (!raw || raw.length < 16) {
			return { ok: false, error: "keine Upload-Daten — Datei wählen und speichern/nochmal versuchen" };
		}
		/* Größenbegrenzung vor dem Dekodieren: base64 ist ca. 4/3 so lang wie die Daten. */
		if (raw.length > Math.ceil((EXPORT_LIMITS.MAX_BACKUP_ARCHIVE_BYTES * 4) / 3) + 1024) {
			return { ok: false, error: "Datei zu groß (maximal 32 MB)" };
		}
		const b64 = raw.includes("base64,") ? raw.split("base64,", 2)[1] : raw;
		const buf = Buffer.from(b64, "base64");
		if (buf.length > EXPORT_LIMITS.MAX_BACKUP_ARCHIVE_BYTES) {
			return { ok: false, error: "Datei zu groß (maximal 32 MB)" };
		}
		if (buf.length < 32) {
			return { ok: false, error: "upload empty or invalid" };
		}
		const ts = new Date().toISOString().replace(/[:.]/g, "-");
		const name = `ems-light-upload-${ts}.emsbackup`;
		const inbox = restoreInboxDir(host);
		await ensureDirReadable(inbox);
		await fs.writeFile(path.join(inbox, name), buf, { mode: EXPORT_FILE_MODE });
		await chmodExportPath(path.join(inbox, name), false);
		return { ok: true, fileName: name };
	} catch (e) {
		return { ok: false, error: e instanceof Error ? e.message : String(e) };
	}
}

export async function readSupportFileBase64(
	host: AdapterFilesHost,
	fileName?: string,
): Promise<
	| { ok: true; fileName: string; mimeType: string; downloadPath: string; base64: string; sizeBytes: number }
	| { ok: false; error: string }
> {
	try {
		let name = String(fileName || "").trim();
		if (!name) {
			const dir = supportDir(host);
			const names = (await fs.readdir(dir).catch(() => [] as string[]))
				.filter((n) => n.endsWith(".emssupport") && OWN_EXPORT_FILE_RE.test(n))
				.sort()
				.reverse();
			name = names[0] ?? "";
		}
		if (!name || !name.endsWith(".emssupport") || !OWN_EXPORT_FILE_RE.test(name)) {
			return { ok: false, error: "no support file" };
		}
		const full = path.join(supportDir(host), name);
		const buf = await fs.readFile(full);
		return {
			ok: true,
			fileName: name,
			mimeType: "application/zip",
			downloadPath: adapterFileDownloadPath(host.namespace, "support", name),
			base64: buf.toString("base64"),
			sizeBytes: buf.length,
		};
	} catch (e) {
		return { ok: false, error: e instanceof Error ? e.message : String(e) };
	}
}

/** Alle vorhandenen .emsbackup (Host-Backup-Ordner und Inbox), neueste zuerst. */
export async function listBackupFileNames(host: PathResolverInput): Promise<string[]> {
	const seen = new Set<string>();
	for (const dir of [backupDir(host), restoreInboxDir(host)]) {
		const names = await fs.readdir(dir).catch(() => [] as string[]);
		for (const n of names) if (n.endsWith(".emsbackup") && OWN_EXPORT_FILE_RE.test(n)) seen.add(n);
	}
	return [...seen].sort((a, b) => {
		const ka = parseBackupFileStamp(a)?.sortKey ?? a;
		const kb = parseBackupFileStamp(b)?.sortKey ?? b;
		return ka < kb ? 1 : ka > kb ? -1 : 0;
	});
}

/** Backup für den Browser-Download bereitstellen (Adapter-Dateien + base64 bis 6 MB). */
export async function readBackupFileBase64(
	host: AdapterFilesHost,
	fileName: string,
): Promise<
	| { ok: true; fileName: string; mimeType: string; downloadPath: string; base64: string; sizeBytes: number }
	| { ok: false; error: string }
> {
	try {
		const name = String(fileName || "").trim();
		assertSafeFileName(name);
		if (!name.endsWith(".emsbackup")) return { ok: false, error: "keine Backup-Datei" };
		let buf: Buffer | null = null;
		for (const dir of [backupDir(host), restoreInboxDir(host)]) {
			buf = await fs.readFile(path.join(dir, name)).catch(() => null);
			if (buf) break;
		}
		if (!buf) return { ok: false, error: "Datei nicht gefunden" };
		/* Spiegel in den Adapter-Dateien sicherstellen, damit der Download-Link funktioniert. */
		await mirrorExportIntoAdapterFiles(host, "backup", name, buf).catch(() => undefined);
		return {
			ok: true,
			fileName: name,
			mimeType: "application/zip",
			downloadPath: adapterFileDownloadPath(host.namespace, "backup", name),
			base64: buf.toString("base64"),
			sizeBytes: buf.length,
		};
	} catch (e) {
		return { ok: false, error: e instanceof Error ? e.message : String(e) };
	}
}

/** Ein Backup löschen: Host-Ordner, Inbox und die Spiegelkopie in den Adapter-Dateien. */
export async function deleteBackupFile(
	host: AdapterFilesHost,
	fileName: string,
): Promise<{ ok: true; fileName: string } | { ok: false; error: string }> {
	try {
		const name = String(fileName || "").trim();
		assertSafeFileName(name);
		if (!name.endsWith(".emsbackup")) return { ok: false, error: "keine Backup-Datei" };
		let found = false;
		for (const dir of [backupDir(host), restoreInboxDir(host)]) {
			const full = path.join(dir, name);
			const had = await fs.stat(full).then(() => true).catch(() => false);
			if (had) {
				await fs.unlink(full);
				found = true;
			}
		}
		if (typeof host.delFileAsync === "function") {
			for (const rel of [`backup/${name}`, `${ADAPTER_RESTORE_INBOX}/${name}`]) {
				if (await host.delFileAsync(host.namespace, rel).then(() => true).catch(() => false)) found = true;
			}
		}
		return found ? { ok: true, fileName: name } : { ok: false, error: "Datei nicht gefunden" };
	} catch (e) {
		return { ok: false, error: e instanceof Error ? e.message : String(e) };
	}
}

/** Alle Backups löschen außer den neuesten `keep`. */
export async function deleteOldBackups(
	host: AdapterFilesHost,
	keep: number,
): Promise<{ deleted: string[]; kept: string[] }> {
	const names = await listBackupFileNames(host);
	const keepN = Math.max(1, Math.floor(keep));
	const deleted: string[] = [];
	for (const n of names.slice(keepN)) {
		const r = await deleteBackupFile(host, n);
		if (r.ok) deleted.push(n);
	}
	return { deleted, kept: names.slice(0, keepN) };
}
