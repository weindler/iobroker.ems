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

export function gridSupplySlotsFilePath(host: PlanPathHost): string {
	return path.join(plannerDir(host), "grid_supply_slots.json");
}

export function flexibleContributionsFilePath(host: PlanPathHost): string {
	return path.join(plannerDir(host), "flexible_contributions.json");
}

export function plannerIntentFilePath(host: PlanPathHost): string {
	return path.join(plannerDir(host), "planner_intent_last.json");
}

async function readPlannerFile(host: PlanPathHost, filePath: string): Promise<string | null> {
	try {
		const raw = await fs.readFile(filePath, "utf8");
		return raw.trim() ? raw : null;
	} catch {
		return null;
	}
}

async function writePlannerFile(host: PlanPathHost, filePath: string, content: string): Promise<void> {
	try {
		await atomicWriteFile(filePath, content);
	} catch (e) {
		throw e;
	}
}

function safePlannerPath(host: PlanPathHost, build: (host: PlanPathHost) => string): string | null {
	try {
		return build(host);
	} catch {
		return null;
	}
}

export async function readForecastPlanFile(host: PlanPathHost): Promise<string | null> {
	const filePath = safePlannerPath(host, forecastPlanFilePath);
	if (!filePath) return null;
	return readPlannerFile(host, filePath);
}

export async function writeForecastPlanFile(host: PlanPathHost, planJson: string): Promise<void> {
	const filePath = safePlannerPath(host, forecastPlanFilePath);
	if (!filePath) throw new Error("forecast plan file path unavailable");
	await writePlannerFile(host, filePath, planJson);
}

export async function readDailyPlanFile(host: PlanPathHost): Promise<string | null> {
	const filePath = safePlannerPath(host, dailyPlanFilePath);
	if (!filePath) return null;
	return readPlannerFile(host, filePath);
}

export async function writeDailyPlanFile(host: PlanPathHost, planJson: string): Promise<void> {
	const filePath = safePlannerPath(host, dailyPlanFilePath);
	if (!filePath) throw new Error("daily plan file path unavailable");
	await writePlannerFile(host, filePath, planJson);
}

export async function readGridSupplySlotsFile(host: PlanPathHost): Promise<string | null> {
	const filePath = safePlannerPath(host, gridSupplySlotsFilePath);
	if (!filePath) return null;
	return readPlannerFile(host, filePath);
}

export async function writeGridSupplySlotsFile(host: PlanPathHost, slotsJson: string): Promise<void> {
	const filePath = safePlannerPath(host, gridSupplySlotsFilePath);
	if (!filePath) throw new Error("grid supply slots file path unavailable");
	await writePlannerFile(host, filePath, slotsJson);
}

export async function readFlexibleContributionsFile(host: PlanPathHost): Promise<string | null> {
	const filePath = safePlannerPath(host, flexibleContributionsFilePath);
	if (!filePath) return null;
	return readPlannerFile(host, filePath);
}

export async function writeFlexibleContributionsFile(host: PlanPathHost, payloadJson: string): Promise<void> {
	const filePath = safePlannerPath(host, flexibleContributionsFilePath);
	if (!filePath) throw new Error("flexible contributions file path unavailable");
	await writePlannerFile(host, filePath, payloadJson);
}

export async function readPlannerIntentFile(host: PlanPathHost): Promise<string | null> {
	const filePath = safePlannerPath(host, plannerIntentFilePath);
	if (!filePath) return null;
	return readPlannerFile(host, filePath);
}

export async function writePlannerIntentFile(host: PlanPathHost, intentJson: string): Promise<void> {
	const filePath = safePlannerPath(host, plannerIntentFilePath);
	if (!filePath) throw new Error("planner intent file path unavailable");
	await writePlannerFile(host, filePath, intentJson);
}
