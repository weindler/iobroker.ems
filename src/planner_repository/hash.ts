import { createHash } from "node:crypto";
import * as fs from "node:fs/promises";

export function sha256Hex(content: string | Buffer): string {
	return createHash("sha256").update(content).digest("hex");
}

export async function sha256File(filePath: string): Promise<string> {
	const buf = await fs.readFile(filePath);
	return sha256Hex(buf);
}

export function stableSemanticStringify(value: unknown): string {
	return JSON.stringify(value, (_key, v) => (v === undefined ? null : v));
}
