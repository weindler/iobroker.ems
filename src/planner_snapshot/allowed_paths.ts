import * as path from "node:path";
import { assertPathWithinRoot } from "../backup_integration/paths";
import { CONSUMER_STATS_FILENAME } from "../learning/consumer_stats/types";

export const HOUSE_LOAD_LEARNING_FILE = "house_load_learning_v1.json";
export const THERMAL_RUNTIME_LEARNING_FILE = "thermal_runtime_learning_v1.json";

export type PlannerSnapshotAllowedFile =
	| "house_load_learning"
	| "thermal_runtime_learning"
	| "consumer_stats";

const ALLOWED: Record<
	PlannerSnapshotAllowedFile,
	{ category: string; fileName: string }
> = {
	house_load_learning: {
		category: "learning/house_load",
		fileName: HOUSE_LOAD_LEARNING_FILE,
	},
	thermal_runtime_learning: {
		category: "learning/thermal_runtime",
		fileName: THERMAL_RUNTIME_LEARNING_FILE,
	},
	consumer_stats: {
		category: "learning/consumer_stats",
		fileName: CONSUMER_STATS_FILENAME,
	},
};

export function resolveAllowedPlannerJsonPath(
	getAbsolutePath: (category: string) => string,
	kind: PlannerSnapshotAllowedFile,
): string {
	if (typeof getAbsolutePath !== "function") {
		throw new Error("getAbsolutePath unavailable for planner snapshot file path");
	}
	const spec = ALLOWED[kind];
	const rawBase = getAbsolutePath(spec.category);
	if (typeof rawBase !== "string" || !rawBase.trim()) {
		throw new Error("getAbsolutePath returned empty planner snapshot root");
	}
	const baseDir = path.resolve(rawBase);
	if (!path.isAbsolute(baseDir)) {
		throw new Error("getAbsolutePath must resolve to an absolute directory");
	}
	const target = path.resolve(path.join(baseDir, spec.fileName));
	assertPathWithinRoot(target, baseDir);
	if (path.basename(target) !== spec.fileName) {
		throw new Error("invalid planner snapshot file name");
	}
	return target;
}

/** Validates an absolute path is one of the allowed planner learning JSON files. */
export function assertAllowedPlannerJsonPath(
	absolutePath: string,
	getAbsolutePath: (category: string) => string,
): void {
	const resolved = path.resolve(absolutePath);
	for (const kind of Object.keys(ALLOWED) as PlannerSnapshotAllowedFile[]) {
		const allowed = resolveAllowedPlannerJsonPath(getAbsolutePath, kind);
		if (resolved === allowed) {
			return;
		}
	}
	throw new Error("planner snapshot file path not allowed");
}
