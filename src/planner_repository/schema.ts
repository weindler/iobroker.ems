import { PLANNER_SCHEMA_VERSION } from "../planner_contracts/constants";

export interface CanonicalForecastPlanV1 {
	schema_version: typeof PLANNER_SCHEMA_VERSION;
	revision: number;
	generated_at: string;
	status: string;
	horizon_start: string;
	horizon_end: string;
	slot_minutes: number;
	slots: unknown[];
}

export interface CanonicalDailyPlanV1 {
	schema_version: typeof PLANNER_SCHEMA_VERSION;
	revision: number;
	generated_at: string;
	status: string;
	date: string;
	valid_until: string | null;
	allocations: unknown[];
}

function isObject(v: unknown): v is Record<string, unknown> {
	return typeof v === "object" && v !== null && !Array.isArray(v);
}

function isIso(v: unknown): boolean {
	return typeof v === "string" && !Number.isNaN(Date.parse(v));
}

export function validateCanonicalForecastPlan(raw: unknown): { valid: boolean; errors: string[]; plan?: CanonicalForecastPlanV1 } {
	const errors: string[] = [];
	if (!isObject(raw)) return { valid: false, errors: ["forecast plan must be an object"] };
	if (raw.schema_version !== PLANNER_SCHEMA_VERSION) errors.push("forecast.schema_version invalid");
	if (typeof raw.revision !== "number") errors.push("forecast.revision invalid");
	if (!isIso(raw.generated_at)) errors.push("forecast.generated_at invalid");
	if (typeof raw.status !== "string") errors.push("forecast.status invalid");
	if (!isIso(raw.horizon_start)) errors.push("forecast.horizon_start invalid");
	if (!isIso(raw.horizon_end)) errors.push("forecast.horizon_end invalid");
	if (typeof raw.slot_minutes !== "number") errors.push("forecast.slot_minutes invalid");
	if (!Array.isArray(raw.slots)) errors.push("forecast.slots must be an array");
	if (errors.length) return { valid: false, errors };
	return { valid: true, errors: [], plan: raw as unknown as CanonicalForecastPlanV1 };
}

export function validateCanonicalDailyPlan(raw: unknown): { valid: boolean; errors: string[]; plan?: CanonicalDailyPlanV1 } {
	const errors: string[] = [];
	if (!isObject(raw)) return { valid: false, errors: ["daily plan must be an object"] };
	if (raw.schema_version !== PLANNER_SCHEMA_VERSION) errors.push("daily.schema_version invalid");
	if (typeof raw.revision !== "number") errors.push("daily.revision invalid");
	if (!isIso(raw.generated_at)) errors.push("daily.generated_at invalid");
	if (typeof raw.status !== "string") errors.push("daily.status invalid");
	if (typeof raw.date !== "string" || raw.date.length < 8) errors.push("daily.date invalid");
	if (raw.valid_until !== null && !isIso(raw.valid_until)) errors.push("daily.valid_until invalid");
	if (!Array.isArray(raw.allocations)) errors.push("daily.allocations must be an array");
	if (errors.length) return { valid: false, errors };
	return { valid: true, errors: [], plan: raw as unknown as CanonicalDailyPlanV1 };
}
