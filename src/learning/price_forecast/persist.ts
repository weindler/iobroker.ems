import * as fs from "node:fs/promises";
import * as path from "node:path";
import { MODULE_TAG } from "./constants";
import type { PriceForecastFreezeFile, PriceForecastPersist, PriceForecastResult } from "./types";

export function freezeDir(baseDir: string): string {
	return path.join(baseDir, "freeze");
}

export function freezeFilePath(baseDir: string, targetDate: string): string {
	return path.join(freezeDir(baseDir), `${targetDate}.json`);
}

export async function writeForecastFreezeFile(
	baseDir: string,
	payload: PriceForecastFreezeFile,
): Promise<void> {
	const dir = freezeDir(baseDir);
	await fs.mkdir(dir, { recursive: true });
	const filePath = freezeFilePath(baseDir, payload.target_date);
	await fs.writeFile(filePath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}

export async function readForecastFreezeFiles(
	baseDir: string,
	lookbackDays: number,
): Promise<PriceForecastFreezeFile[]> {
	const dir = freezeDir(baseDir);
	let names: string[] = [];
	try {
		names = await fs.readdir(dir);
	} catch {
		return [];
	}

	const cutoff = new Date();
	cutoff.setHours(0, 0, 0, 0);
	cutoff.setDate(cutoff.getDate() - lookbackDays);
	const cutoffKey = cutoff.toISOString().slice(0, 10);

	const files: PriceForecastFreezeFile[] = [];
	for (const name of names) {
		if (!name.endsWith(".json")) continue;
		const targetDate = name.replace(/\.json$/, "");
		if (targetDate < cutoffKey) continue;
		try {
			const raw = await fs.readFile(path.join(dir, name), "utf8");
			const parsed = JSON.parse(raw) as PriceForecastFreezeFile;
			if (parsed?.target_date && Array.isArray(parsed.slots)) {
				files.push(parsed);
			}
		} catch {
			// skip corrupt file
		}
	}
	return files;
}

export async function writePriceForecastPersist(
	baseDir: string,
	result: PriceForecastResult,
	lastRun: string,
): Promise<void> {
	await fs.mkdir(baseDir, { recursive: true });
	const payload: PriceForecastPersist = {
		generated_at: lastRun,
		module: MODULE_TAG,
		sample_days: result.sampleDays,
		coverage_pct: result.coveragePct,
		missing_days: result.missingDays,
		forecast_accuracy_7d: result.forecastAccuracy7d,
		forecast_accuracy_30d: result.forecastAccuracy30d,
		forecast_accuracy_90d: result.forecastAccuracy90d,
		avg_error_ct_7d: result.avgErrorCt7d,
		avg_error_ct_30d: result.avgErrorCt30d,
		avg_error_ct_90d: result.avgErrorCt90d,
		forecast_confidence: result.forecastConfidence,
		stability: result.stability,
		health: {
			status: result.health,
			sample_days: result.sampleDays,
			coverage_pct: result.coveragePct,
			missing_days: result.missingDays,
			last_run: lastRun,
			forecast_confidence: result.forecastConfidence,
		},
	};
	await fs.writeFile(
		path.join(baseDir, "price_forecast_learning_v1.json"),
		`${JSON.stringify(payload, null, 2)}\n`,
		"utf8",
	);
}
