import * as fs from "node:fs/promises";
import * as path from "node:path";
import type { ResolvedWallboxIntent } from "./wallbox/types";
import type { IobrokerIntentSnapshot } from "./wallbox/types";

export interface IntentPersistPayload {
	revision: number;
	resolved: ResolvedWallboxIntent;
	lastRequestId: string | null;
	iobrokerSnapshot: IobrokerIntentSnapshot | null;
}

export async function writeIntentPersist(baseDir: string, payload: IntentPersistPayload): Promise<void> {
	await fs.mkdir(baseDir, { recursive: true });
	const filePath = path.join(baseDir, "wallbox_intent_v1.json");
	await fs.writeFile(
		filePath,
		`${JSON.stringify(
			{
				module: "wallbox_intent_v1",
				revision: payload.revision,
				last_request_id: payload.lastRequestId,
				resolved: payload.resolved,
				iobroker_snapshot: payload.iobrokerSnapshot,
			},
			null,
			2,
		)}\n`,
		"utf8",
	);
}

export async function readIntentPersist(baseDir: string): Promise<IntentPersistPayload | null> {
	try {
		const raw = await fs.readFile(path.join(baseDir, "wallbox_intent_v1.json"), "utf8");
		const parsed = JSON.parse(raw) as {
			revision?: number;
			last_request_id?: string | null;
			resolved?: ResolvedWallboxIntent;
			iobroker_snapshot?: IobrokerIntentSnapshot | null;
		};
		if (!parsed.resolved || typeof parsed.revision !== "number") {
			return null;
		}
		return {
			revision: parsed.revision,
			resolved: parsed.resolved,
			lastRequestId: parsed.last_request_id ?? null,
			iobrokerSnapshot: parsed.iobroker_snapshot ?? null,
		};
	} catch {
		return null;
	}
}
