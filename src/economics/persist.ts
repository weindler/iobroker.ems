import { mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { atomicWriteFile, DIAGNOSTIC_FILE_MODE } from "../persistence/atomic_write";
import { ECONOMICS_MODULE, ECONOMICS_SCHEMA_VERSION, emptyEconomicsPersist, type EconomicsPersist } from "./types";

export const ECONOMICS_PERSIST_FILE = "economics_v1.json";
export const ECONOMICS_PERSIST_CATEGORY = "economics";
/** Kompakter Accounting-Ledger; Detailtelemetrie hat wesentlich kürzere Retention. */
export const ECONOMICS_DAILY_RETENTION_DAYS = 3_660;

export function pruneEconomicsPersist(
	data: EconomicsPersist,
	anchorDateKey: string,
	retainDays: number = ECONOMICS_DAILY_RETENTION_DAYS,
): EconomicsPersist {
	if (!/^\d{4}-\d{2}-\d{2}$/.test(anchorDateKey) || !(retainDays > 0)) return data;
	const anchor = new Date(`${anchorDateKey}T12:00:00.000Z`);
	anchor.setUTCDate(anchor.getUTCDate() - (Math.floor(retainDays) - 1));
	const cutoff = anchor.toISOString().slice(0, 10);
	const days: EconomicsPersist["days"] = {};
	for (const [dateKey, day] of Object.entries(data.days)) {
		if (!/^\d{4}-\d{2}-\d{2}$/.test(dateKey) || dateKey >= cutoff) days[dateKey] = day;
	}
	return { ...data, days };
}

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

export async function writeEconomicsPersist(
	dir: string,
	data: EconomicsPersist,
	anchorDateKey?: string,
): Promise<void> {
	await mkdir(dir, { recursive: true });
	const latestKey = Object.keys(data.days).filter((key) => /^\d{4}-\d{2}-\d{2}$/.test(key)).sort().at(-1);
	const anchor = anchorDateKey ?? latestKey;
	const compacted = anchor ? pruneEconomicsPersist(data, anchor) : data;
	data.days = compacted.days;
	const next: EconomicsPersist = { ...data, updatedAtIso: new Date().toISOString() };
	await atomicWriteFile(join(dir, ECONOMICS_PERSIST_FILE), `${JSON.stringify(next)}\n`, {
		mode: DIAGNOSTIC_FILE_MODE,
	});
}
