import * as fs from "node:fs/promises";
import * as path from "node:path";
import { sanitizeString, createPseudonymContext } from "../backup/sanitize";

export type LogRotationOptions = {
	maxFiles: number;
	maxFileBytes: number;
	totalMaxBytes: number;
};

const GLOBAL_SUPPORT_LOG_MAX = 3 * 1024 * 1024;

function currentLogFile(dir: string, prefix: string, files: string[]): string {
	const numbered = files
		.filter((f) => f.startsWith(`${prefix}-`) && f.endsWith(".ndjson"))
		.sort();
	if (numbered.length === 0) return path.join(dir, `${prefix}-001.ndjson`);
	return path.join(dir, numbered[numbered.length - 1]);
}

async function listLogFiles(dir: string, prefix: string): Promise<string[]> {
	try {
		return (await fs.readdir(dir))
			.filter((f) => f.startsWith(`${prefix}-`) && f.endsWith(".ndjson"))
			.sort();
	} catch {
		return [];
	}
}

async function totalBytesInDir(dir: string): Promise<number> {
	try {
		const files = await fs.readdir(dir);
		let n = 0;
		for (const f of files) {
			n += (await fs.stat(path.join(dir, f))).size;
		}
		return n;
	} catch {
		return 0;
	}
}

export async function appendNdjsonRotating(
	dir: string,
	prefix: string,
	record: unknown,
	opts: LogRotationOptions,
): Promise<void> {
	await fs.mkdir(dir, { recursive: true });
	const ctx = createPseudonymContext();
	const line =
		sanitizeString(
			typeof record === "string" ? record : JSON.stringify(record),
			ctx,
		) + "\n";
	const lineBuf = Buffer.from(line, "utf8");

	let files = await listLogFiles(dir, prefix);
	let target = currentLogFile(dir, prefix, files);
	let size = 0;
	try {
		size = (await fs.stat(target)).size;
	} catch {
		// neue Datei
	}

	if (size + lineBuf.length > opts.maxFileBytes) {
		const nextNum = files.length + 1;
		const nextName = `${prefix}-${String(nextNum).padStart(3, "0")}.ndjson`;
		target = path.join(dir, nextName);
		files = await listLogFiles(dir, prefix);
		while (files.length >= opts.maxFiles) {
			await fs.unlink(path.join(dir, files[0]));
			files.shift();
		}
	}

	await fs.appendFile(target, lineBuf);

	while ((await totalBytesInDir(dir)) > Math.min(opts.totalMaxBytes, GLOBAL_SUPPORT_LOG_MAX)) {
		files = await listLogFiles(dir, prefix);
		if (files.length === 0) break;
		await fs.unlink(path.join(dir, files[0]));
	}
}

export async function readAllNdjson(dir: string): Promise<string[]> {
	try {
		const files = (await fs.readdir(dir)).filter((f) => f.endsWith(".ndjson")).sort();
		const lines: string[] = [];
		for (const f of files) {
			const raw = await fs.readFile(path.join(dir, f), "utf8");
			for (const line of raw.split("\n")) {
				if (line.trim()) lines.push(line);
			}
		}
		return lines;
	} catch {
		return [];
	}
}
