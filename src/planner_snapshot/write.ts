import * as fs from "node:fs/promises";
import * as path from "node:path";
import { createHash } from "node:crypto";
import { assertPathWithinRoot } from "../backup_integration/paths";
import { atomicWriteFile } from "../persistence/atomic_write";
import { assertJobPathNotUnderDurableDataFolder } from "../planner_paths/paths";
import {
	canonicalSnapshotJson,
	computeInputRevision,
	utf8ByteLength,
} from "./canonical";
import { PLANNER_INPUT_SNAPSHOT_BUDGET_BYTES } from "./constants";
import type { PlannerInputSnapshot, PlannerInputWriteResult } from "./types";
import { PlannerInputSnapshotBudgetError } from "./types";
import { assertNoForbiddenSnapshotContent, assertSnapshotSerializable, validatePlannerInputSnapshotV2 } from "./validate";

export const PLANNER_INPUT_SNAPSHOT_FILE = "input.json";

function sha256Hex(text: string): string {
	return createHash("sha256").update(text).digest("hex");
}

function assertSafeJobDir(jobDir: string, runtimeRootDir: string, durableDataDir: string): string {
	const resolvedJobDir = path.resolve(jobDir);
	const resolvedRuntime = path.resolve(runtimeRootDir);
	assertPathWithinRoot(resolvedJobDir, resolvedRuntime);
	assertJobPathNotUnderDurableDataFolder(resolvedJobDir, durableDataDir);
	if (path.basename(resolvedJobDir).includes("..")) {
		throw new Error("invalid job directory");
	}
	return resolvedJobDir;
}

export interface WritePlannerInputSnapshotOptions {
	runtimeRootDir: string;
	durableDataDir: string;
}

export async function writePlannerInputSnapshot(
	jobDir: string,
	snapshot: PlannerInputSnapshot,
	options: WritePlannerInputSnapshotOptions,
): Promise<PlannerInputWriteResult> {
	const safeJobDir = assertSafeJobDir(jobDir, options.runtimeRootDir, options.durableDataDir);
	assertSnapshotSerializable(snapshot);
	assertNoForbiddenSnapshotContent(snapshot);

	const withRevision: PlannerInputSnapshot = {
		...snapshot,
		inputRevision: computeInputRevision({ ...snapshot, inputRevision: "" }),
	};
	const json = `${JSON.stringify(withRevision, null, 2)}\n`;
	const byteSize = utf8ByteLength(json);
	if (byteSize > PLANNER_INPUT_SNAPSHOT_BUDGET_BYTES) {
		throw new PlannerInputSnapshotBudgetError(byteSize, PLANNER_INPUT_SNAPSHOT_BUDGET_BYTES);
	}

	const targetPath = path.join(safeJobDir, PLANNER_INPUT_SNAPSHOT_FILE);
	const sha256 = sha256Hex(json);
	await atomicWriteFile(targetPath, json, {
		validate: () => {
			const reread = JSON.parse(json) as PlannerInputSnapshot;
			if (!validatePlannerInputSnapshotV2(reread)) {
				throw new Error("written snapshot failed validation");
			}
			if (computeInputRevision({ ...reread, inputRevision: "" }) !== withRevision.inputRevision) {
				throw new Error("written snapshot revision mismatch");
			}
			if (canonicalSnapshotJson(reread) !== canonicalSnapshotJson(withRevision)) {
				throw new Error("written snapshot canonical mismatch");
			}
		},
	});

	const disk = await fs.readFile(targetPath, "utf8");
	if (sha256Hex(disk) !== sha256) {
		throw new Error("post-write sha256 mismatch");
	}

	return {
		path: targetPath,
		byteSize,
		sha256,
		inputRevision: withRevision.inputRevision,
	};
}
