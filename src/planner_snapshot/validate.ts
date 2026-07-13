import { PLANNER_INPUT_SCHEMA_VERSION } from "./constants";
import type { PlannerInputSnapshot } from "./types";

const FORBIDDEN_SNAPSHOT_KEY_PATTERNS = [
	/plan_json$/i,
	/effective_json$/i,
	/last_json$/i,
	/setStateId/i,
	/password/i,
	/token/i,
	/credential/i,
	/snapshot_json$/i,
	/history_json$/i,
	/by_season_json$/i,
	/by_day_type_json$/i,
] as const;

const FORBIDDEN_SNAPSHOT_VALUE_PATTERNS = [
	/setState\./i,
	/password=/i,
	/token=/i,
	/:.*@.*\//, // URL with credentials
] as const;

function walk(value: unknown, keyPath: string, issues: string[]): void {
	if (value === null || value === undefined) return;
	if (typeof value === "function") {
		issues.push(`function at ${keyPath}`);
		return;
	}
	if (typeof value !== "object") {
		if (typeof value === "string") {
			for (const pattern of FORBIDDEN_SNAPSHOT_VALUE_PATTERNS) {
				if (pattern.test(value)) {
					issues.push(`forbidden value at ${keyPath}`);
				}
			}
		}
		return;
	}
	if (Array.isArray(value)) {
		value.forEach((item, i) => walk(item, `${keyPath}[${i}]`, issues));
		return;
	}
	for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
		const childPath = keyPath ? `${keyPath}.${key}` : key;
		for (const pattern of FORBIDDEN_SNAPSHOT_KEY_PATTERNS) {
			if (pattern.test(key)) {
				issues.push(`forbidden key ${childPath}`);
			}
		}
		walk(child, childPath, issues);
	}
}

export function assertSnapshotSerializable(snapshot: PlannerInputSnapshot): void {
	JSON.parse(JSON.stringify(snapshot));
}

export function assertNoForbiddenSnapshotContent(snapshot: PlannerInputSnapshot): void {
	const issues: string[] = [];
	walk(snapshot, "", issues);
	if (issues.length > 0) {
		throw new Error(`forbidden snapshot content: ${issues.join("; ")}`);
	}
}

export function validatePlannerInputSnapshotV2(snapshot: unknown): snapshot is PlannerInputSnapshot {
	if (!snapshot || typeof snapshot !== "object") return false;
	const s = snapshot as PlannerInputSnapshot;
	if (s.schemaVersion !== PLANNER_INPUT_SCHEMA_VERSION) return false;
	if (typeof s.capturedAt !== "string" || typeof s.timezone !== "string") return false;
	if (typeof s.inputRevision !== "string" || s.inputRevision.length !== 64) return false;
	if (!s.general || !s.policy || !s.live || !s.learning || !s.prices || !s.intents) return false;
	return true;
}
