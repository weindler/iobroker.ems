import * as fs from "node:fs/promises";
import * as path from "node:path";
import { MODULE_TAG } from "./constants";
import type { PriceLearningPersist, PriceLearningResult } from "./types";

export async function writePriceLearningPersist(
	baseDir: string,
	result: PriceLearningResult,
	lastRun: string,
): Promise<void> {
	await fs.mkdir(baseDir, { recursive: true });
	const payload: PriceLearningPersist = {
		generated_at: lastRun,
		module: MODULE_TAG,
		price_source: result.priceSource,
		sample_days: result.sampleDays,
		coverage_pct: result.coveragePct,
		missing_days: result.missingDays,
		avg_price_7d: result.avgPrice7d,
		avg_price_30d: result.avgPrice30d,
		avg_price_90d: result.avgPrice90d,
		volatility_30d: result.volatility30d,
		cheap_hours: result.cheapHours,
		expensive_hours: result.expensiveHours,
		confidence: result.confidence,
		health: {
			status: result.health,
			sample_days: result.sampleDays,
			coverage_pct: result.coveragePct,
			missing_days: result.missingDays,
			last_run: lastRun,
			confidence: result.confidence,
		},
	};
	const filePath = path.join(baseDir, "price_learning_v1.json");
	await fs.writeFile(filePath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}
