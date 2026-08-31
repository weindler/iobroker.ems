import { mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { atomicWriteFile, DIAGNOSTIC_FILE_MODE } from "../persistence/atomic_write";
import { ECONOMICS_MODULE, ECONOMICS_SCHEMA_VERSION, emptyEconomicsPersist, type EconomicsPersist } from "./types";

export const ECONOMICS_PERSIST_FILE = "economics_v1.json";
export const ECONOMICS_PERSIST_CATEGORY = "economics";

export async function readEconomicsPersist(dir: string | null | undefined): Promise<EconomicsPersist> {
	if (!dir) return emptyEconomicsPersist();
	try {
		const raw = await readFile(join(dir, ECONOMICS_PERSIST_FILE), "utf8");
		const parsed = JSON.parse(raw) as Partial<EconomicsPersist>;
		if (!parsed || parsed.module !== ECONOMICS_MODULE || !parsed.days || typeof parsed.days !== "object") {
			return emptyEconomicsPersist();
		}
		return {
			module: ECONOMICS_MODULE,
			schemaVersion: ECONOMICS_SCHEMA_VERSION,
			updatedAtIso: typeof parsed.updatedAtIso === "string" ? parsed.updatedAtIso : new Date(0).toISOString(),
			days: parsed.days,
		};
	} catch {
		return emptyEconomicsPersist();
	}
}

export async function writeEconomicsPersist(dir: string, data: EconomicsPersist): Promise<void> {
	await mkdir(dir, { recursive: true });
	const next: EconomicsPersist = { ...data, updatedAtIso: new Date().toISOString() };
	await atomicWriteFile(join(dir, ECONOMICS_PERSIST_FILE), `${JSON.stringify(next)}\n`, {
		mode: DIAGNOSTIC_FILE_MODE,
	});
}
