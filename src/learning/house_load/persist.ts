import * as fs from "node:fs/promises";
import * as path from "node:path";
import { MODULE_TAG } from "./constants";
import type { HouseLoadComputeResult, HouseLoadPersist } from "./types";

export async function writeHouseLoadPersist(
	baseDir: string,
	result: HouseLoadComputeResult,
	lastRun: string,
): Promise<void> {
	await fs.mkdir(baseDir, { recursive: true });
	const payload: HouseLoadPersist = {
		generated_at: lastRun,
		module: MODULE_TAG,
		sample_count: result.sampleCount,
		sample_days: result.sampleDays,
		confidence: result.confidence,
		profile: result.profileJson,
		forecast_today: result.forecastTodayJson,
		forecast_tomorrow: result.forecastTomorrowJson,
		health: { ...result.healthJson, last_persist_at: lastRun },
	};
	await fs.writeFile(
		path.join(baseDir, "house_load_learning_v1.json"),
		`${JSON.stringify(payload, null, 2)}\n`,
		"utf8",
	);
}

export async function readHouseLoadPersist(baseDir: string): Promise<HouseLoadPersist | null> {
	try {
		const raw = await fs.readFile(path.join(baseDir, "house_load_learning_v1.json"), "utf8");
		return JSON.parse(raw) as HouseLoadPersist;
	} catch {
		return null;
	}
}
