import * as fs from "node:fs/promises";
import * as path from "node:path";
import { resolveEmsPaths, type PathResolverInput } from "../backup_integration/paths";
import { atomicWriteFile } from "../persistence/atomic_write";

export type PlanPathHost = {
	namespace?: string;
	getAbsoluteInstanceDataDir?: () => string;
};

function plannerDir(host: PlanPathHost): string {
	return path.join(resolveEmsPaths(host as PathResolverInput).durableDataDir, "planner");
}

export function forecastPlanFilePath(host: PlanPathHost): string {
	return path.join(plannerDir(host), "forecast_plan.json");
}

export function dailyPlanFilePath(host: PlanPathHost): string {
	return path.join(plannerDir(host), "daily_plan.json");
}

export async function readForecastPlanFile(host: PlanPathHost): Promise<string | null> {
	try {
		const raw = await fs.readFile(forecastPlanFilePath(host), "utf8");
		return raw.trim() ? raw : null;
	} catch {
		return null;
	}
}

export async function writeForecastPlanFile(host: PlanPathHost, planJson: string): Promise<void> {
	await atomicWriteFile(forecastPlanFilePath(host), planJson);
}

export async function readDailyPlanFile(host: PlanPathHost): Promise<string | null> {
	try {
		const raw = await fs.readFile(dailyPlanFilePath(host), "utf8");
		return raw.trim() ? raw : null;
	} catch {
		return null;
	}
}

export async function writeDailyPlanFile(host: PlanPathHost, planJson: string): Promise<void> {
	await atomicWriteFile(dailyPlanFilePath(host), planJson);
}
