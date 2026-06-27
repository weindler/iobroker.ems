import * as fs from "node:fs/promises";
import * as path from "node:path";
import type { GlobalModeResolution } from "./types";

export async function writeGlobalModesPersist(baseDir: string, payload: GlobalModeResolution): Promise<void> {
	await fs.mkdir(baseDir, { recursive: true });
	const filePath = path.join(baseDir, "global_modes_v1.json");
	await fs.writeFile(
		filePath,
		`${JSON.stringify(
			{
				module: "global_modes_v1",
				requested: payload.requested,
				active: payload.active,
				valid: payload.valid,
				status: payload.status,
				revision: payload.revision,
				issues: payload.issues,
			},
			null,
			2,
		)}\n`,
		"utf8",
	);
}

export async function readGlobalModesPersistRevision(baseDir: string): Promise<string | null> {
	try {
		const raw = await fs.readFile(path.join(baseDir, "global_modes_v1.json"), "utf8");
		const parsed = JSON.parse(raw) as { revision?: string };
		return typeof parsed.revision === "string" ? parsed.revision : null;
	} catch {
		return null;
	}
}
