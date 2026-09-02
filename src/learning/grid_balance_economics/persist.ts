import * as fs from "node:fs/promises";
import * as path from "node:path";
import { atomicWriteFile } from "../../persistence/atomic_write";
import {
	GRID_BALANCE_ECONOMICS_CATEGORY,
	GRID_BALANCE_ECONOMICS_FILE,
	GRID_BALANCE_ECONOMICS_MODULE,
	GRID_BALANCE_ECONOMICS_SCHEMA,
} from "./constants";
import { emptyEconomicsPersist, type GridBalanceEconomicsPersist } from "./types";

export function gridBalanceEconomicsDirFromHost(
	getAbsolutePath?: (category?: string) => string,
): string | undefined {
	if (!getAbsolutePath) return undefined;
	return getAbsolutePath(GRID_BALANCE_ECONOMICS_CATEGORY);
}

export async function writeGridBalanceEconomicsPersist(
	baseDir: string,
	payload: GridBalanceEconomicsPersist,
): Promise<void> {
	await fs.mkdir(baseDir, { recursive: true });
	await atomicWriteFile(
		path.join(baseDir, GRID_BALANCE_ECONOMICS_FILE),
		`${JSON.stringify(payload, null, 2)}\n`,
	);
}

export async function readGridBalanceEconomicsPersist(
	baseDir: string | undefined,
): Promise<GridBalanceEconomicsPersist | null> {
	if (!baseDir) return null;
	try {
		const raw = await fs.readFile(path.join(baseDir, GRID_BALANCE_ECONOMICS_FILE), "utf8");
		const parsed = JSON.parse(raw) as GridBalanceEconomicsPersist;
		if (!parsed || parsed.module !== GRID_BALANCE_ECONOMICS_MODULE) return null;
		if (parsed.schemaVersion !== GRID_BALANCE_ECONOMICS_SCHEMA) return null;
		return parsed;
	} catch {
		return null;
	}
}

export function coldStartPersist(generatedAt: string): GridBalanceEconomicsPersist {
	return emptyEconomicsPersist(
		generatedAt,
		"Cold Start — noch keine belastbaren Economics-Daten (30-ct-Fallback).",
	);
}
