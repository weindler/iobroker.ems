import * as fs from "node:fs/promises";
import * as path from "node:path";
import { backupDir, supportDir, OWN_EXPORT_FILE_RE } from "./retention";
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
		const b64 = raw.includes("base64,") ? raw.split("base64,", 2)[1] : raw;
		const buf = Buffer.from(b64, "base64");
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
