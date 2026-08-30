import * as fs from "node:fs/promises";
import * as path from "node:path";
import { randomUUID } from "node:crypto";

export const ATOMIC_TMP_PREFIX = ".tmp-";

/** Diagnose-Dateien: Owner rw, Gruppe/Andere r — kein World-Write. */
export const DIAGNOSTIC_FILE_MODE = 0o644;
export const DIAGNOSTIC_DIR_MODE = 0o755;

export function isAtomicTempFileName(name: string): boolean {
	return name.startsWith(ATOMIC_TMP_PREFIX);
}

export async function cleanupAtomicTempFiles(dir: string): Promise<void> {
	try {
		const names = await fs.readdir(dir);
		for (const name of names) {
			if (!isAtomicTempFileName(name)) continue;
			await fs.unlink(path.join(dir, name)).catch(() => undefined);
		}
	} catch {
		// directory missing
	}
}

export async function atomicWriteFile(
	targetPath: string,
	content: string | Buffer,
	options: { mode?: number; validate?: () => void } = {},
): Promise<void> {
	const dir = path.dirname(targetPath);
	const fileMode = options.mode ?? DIAGNOSTIC_FILE_MODE;
	await fs.mkdir(dir, { recursive: true, mode: DIAGNOSTIC_DIR_MODE });
	const tmp = path.join(
		dir,
		`${ATOMIC_TMP_PREFIX}${path.basename(targetPath)}.${process.pid}.${randomUUID().slice(0, 8)}`,
	);
	try {
		await fs.writeFile(tmp, content, { mode: fileMode });
		if (options.validate) {
			options.validate();
		}
		await fs.rename(tmp, targetPath);
		/* rename behält Mode der Temp-Datei; zusätzlich absichern falls umask/FS abweicht */
		await fs.chmod(targetPath, fileMode).catch(() => undefined);
	} catch (e) {
		await fs.unlink(tmp).catch(() => undefined);
		throw e;
	}
}

export async function atomicWriteJson(
	targetPath: string,
	value: unknown,
	stringify: (value: unknown) => string,
	validate?: (parsed: unknown) => void,
): Promise<void> {
	const content = stringify(value);
	await atomicWriteFile(targetPath, content, {
		validate: validate
			? () => {
					validate(JSON.parse(content));
				}
			: undefined,
	});
}
