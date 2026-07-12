import * as fs from "node:fs/promises";
import * as path from "node:path";
import { realpath } from "node:fs/promises";
import { learningDataPath } from "../learning/data_dir";
import { sha256Buffer } from "../backup/checksum";
import { EXPORT_LIMITS, assertWithinLimit } from "../backup/limits";
import { stableJsonStringify } from "../backup/schema";
import { RESTORE_LEARNING_TARGETS, RESTORE_LEARNING_KEYS } from "./learning_map";
import { writeJsonFileAtomic } from "./journal";
import { maybeInjectRestoreApplyFailure } from "./apply_hooks";
import type { RestoreHost } from "./types";

export interface LearningSnapshotEntry {
	key: string;
	category: string;
	fileName: string;
	exists: boolean;
	sha256: string | null;
	sizeBytes: number;
	content?: unknown;
}

export async function snapshotLearningFiles(host: RestoreHost): Promise<LearningSnapshotEntry[]> {
	const adapter = host as ioBroker.Adapter;
	const out: LearningSnapshotEntry[] = [];
	for (const key of RESTORE_LEARNING_KEYS) {
		const target = RESTORE_LEARNING_TARGETS[key];
		const base = learningDataPath(adapter, target.category);
		const filePath = path.join(base, target.fileName);
		let exists = false;
		let sha256: string | null = null;
		let sizeBytes = 0;
		let content: unknown | undefined;
		try {
			const st = await fs.lstat(filePath);
			if (st.isSymbolicLink()) {
				throw new Error(`learning symlink not allowed: ${key}`);
			}
			const buf = await fs.readFile(filePath);
			exists = true;
			sizeBytes = buf.length;
			sha256 = sha256Buffer(buf);
			content = JSON.parse(buf.toString("utf8")) as unknown;
		} catch (e) {
			if (e instanceof Error && e.message.includes("symlink")) throw e;
		}
		out.push({ key, category: target.category, fileName: target.fileName, exists, sha256, sizeBytes, content });
	}
	return out;
}

export async function writeLearningSnapshot(dir: string, sub: "before" | "staged", entries: LearningSnapshotEntry[]): Promise<void> {
	for (const e of entries) {
		if (!e.exists || e.content === undefined) continue;
		const rel = path.join(sub, "learning", e.fileName);
		await writeJsonFileAtomic(path.join(dir, rel), e.content);
	}
}

export async function applyLearningFromStaged(
	host: RestoreHost,
	txDir: string,
	learning: Record<string, unknown>,
): Promise<void> {
	const adapter = host as ioBroker.Adapter;
	const middleIdx = Math.floor(RESTORE_LEARNING_KEYS.length / 2);
	for (let i = 0; i < RESTORE_LEARNING_KEYS.length; i++) {
		const key = RESTORE_LEARNING_KEYS[i]!;
		const target = RESTORE_LEARNING_TARGETS[key];
		const base = learningDataPath(adapter, target.category);
		await fs.mkdir(base, { recursive: true, mode: 0o700 });
		const dest = path.join(base, target.fileName);
		const resolved = path.resolve(dest);
		const realBase = await realpath(base).catch(() => path.resolve(base));
		if (!resolved.startsWith(realBase + path.sep) && resolved !== realBase) {
			throw new Error("learning target outside base");
		}
		const st = await fs.lstat(dest).catch(() => null);
		if (st?.isSymbolicLink()) {
			throw new Error("learning target is symlink");
		}

		if (learning[key] === undefined) {
			await fs.unlink(dest).catch(() => undefined);
		} else {
			const text = stableJsonStringify(learning[key]);
			assertWithinLimit(text.length, EXPORT_LIMITS.MAX_SINGLE_FILE_BYTES, key);
			JSON.parse(text);
			const stagedPath = path.join(txDir, "staged", "learning", target.fileName);
			let payload = learning[key];
			try {
				const stagedRaw = await fs.readFile(stagedPath, "utf8");
				payload = JSON.parse(stagedRaw) as unknown;
			} catch {
				// staged fehlt — direkt aus Projektion
			}
			const tmp = path.join(base, `.tmp-${target.fileName}.${process.pid}`);
			await fs.writeFile(tmp, stableJsonStringify(payload), { mode: 0o600 });
			await fs.rename(tmp, dest);
			const verify = sha256Buffer(await fs.readFile(dest));
			const expected = sha256Buffer(Buffer.from(stableJsonStringify(payload), "utf8"));
			if (verify !== expected) {
				throw new Error(`learning verify failed: ${key}`);
			}
		}

		if (i === 0) await maybeInjectRestoreApplyFailure("after_learning_first");
		if (i === middleIdx) await maybeInjectRestoreApplyFailure("after_learning_middle");
		if (i === RESTORE_LEARNING_KEYS.length - 1) await maybeInjectRestoreApplyFailure("after_learning_last");
	}
}

export async function restoreLearningFromSnapshot(host: RestoreHost, txDir: string, sub: "before"): Promise<void> {
	const adapter = host as ioBroker.Adapter;
	for (const key of RESTORE_LEARNING_KEYS) {
		const target = RESTORE_LEARNING_TARGETS[key];
		const base = learningDataPath(adapter, target.category);
		const dest = path.join(base, target.fileName);
		const snapPath = path.join(txDir, sub, "learning", target.fileName);
		try {
			const raw = await fs.readFile(snapPath, "utf8");
			const tmp = path.join(base, `.tmp-${target.fileName}.${process.pid}`);
			await fs.writeFile(tmp, raw, { mode: 0o600 });
			await fs.rename(tmp, dest);
		} catch {
			await fs.unlink(dest).catch(() => undefined);
		}
	}
}
