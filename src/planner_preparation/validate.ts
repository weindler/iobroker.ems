import * as fs from "node:fs/promises";
import * as path from "node:path";
import { assertPathWithinRoot } from "../backup_integration/paths";
import { atomicWriteFile } from "../persistence/atomic_write";
import { computeInputRevision, utf8ByteLength } from "../planner_snapshot/canonical";
import { PLANNER_INPUT_SNAPSHOT_BUDGET_BYTES, PLANNER_INPUT_SCHEMA_VERSION } from "../planner_snapshot/constants";
import {
	assertNoForbiddenSnapshotContent,
	assertSnapshotSerializable,
	validatePlannerInputSnapshotV2,
} from "../planner_snapshot/validate";
import type { PlannerInputSnapshot } from "../planner_snapshot/types";
import { computePreparationRevision } from "./canonical";
import {
	PLANNER_PREPARED_INPUT_BUDGET_BYTES,
	PLANNER_PREPARED_INPUT_FILE,
	PLANNER_PREPARED_INPUT_SCHEMA_VERSION,
} from "./constants";
import type { PlannerPreparedInput } from "./types";
import { PlannerInputValidationError, PlannerPreparedInputBudgetError } from "./types";

export function parsePlannerInputSnapshotV2(raw: unknown): PlannerInputSnapshot {
	if (!validatePlannerInputSnapshotV2(raw)) {
		throw new PlannerInputValidationError("invalid_schema", "input snapshot schema v2 validation failed");
	}
	const snapshot = raw as PlannerInputSnapshot;
	assertSnapshotSerializable(snapshot);
	assertNoForbiddenSnapshotContent(snapshot);
	return snapshot;
}

export function validatePlannerInputRevision(snapshot: PlannerInputSnapshot): void {
	const expected = computeInputRevision({ ...snapshot, inputRevision: "" });
	if (snapshot.inputRevision !== expected) {
		throw new PlannerInputValidationError(
			"input_revision_mismatch",
			`inputRevision mismatch: expected ${expected.slice(0, 12)}…`,
		);
	}
}

export function validatePlannerInputBudget(json: string): void {
	const bytes = utf8ByteLength(json);
	if (bytes > PLANNER_INPUT_SNAPSHOT_BUDGET_BYTES) {
		throw new PlannerInputValidationError(
			"input_budget_exceeded",
			`input snapshot exceeds budget: ${bytes} > ${PLANNER_INPUT_SNAPSHOT_BUDGET_BYTES}`,
		);
	}
}

export async function readAndValidatePlannerInputFile(inputPath: string): Promise<PlannerInputSnapshot> {
	let raw: string;
	try {
		raw = await fs.readFile(inputPath, "utf8");
	} catch (e) {
		throw new PlannerInputValidationError("input_missing", `input.json missing: ${String(e)}`);
	}

	validatePlannerInputBudget(raw);

	let parsed: unknown;
	try {
		parsed = JSON.parse(raw);
	} catch {
		throw new PlannerInputValidationError("input_invalid_json", "input.json is not valid JSON");
	}

	if (!parsed || typeof parsed !== "object") {
		throw new PlannerInputValidationError("invalid_schema", "input must be an object");
	}
	const obj = parsed as Record<string, unknown>;
	if (obj.schemaVersion !== PLANNER_INPUT_SCHEMA_VERSION) {
		throw new PlannerInputValidationError(
			"invalid_schema_version",
			`unsupported input schemaVersion: ${String(obj.schemaVersion)}`,
		);
	}

	const snapshot = parsePlannerInputSnapshotV2(parsed);
	validatePlannerInputRevision(snapshot);
	return snapshot;
}

export interface WritePreparedInputOptions {
	runtimeRootDir: string;
}

export async function writePreparedInput(
	jobDir: string,
	prepared: PlannerPreparedInput,
	options: WritePreparedInputOptions,
): Promise<{ path: string; byteSize: number; sha256: string; preparationRevision: string }> {
	const resolvedJob = path.resolve(jobDir);
	const resolvedRuntime = path.resolve(options.runtimeRootDir);
	assertPathWithinRoot(resolvedJob, resolvedRuntime);

	const withRevision: PlannerPreparedInput = {
		...prepared,
		preparationRevision: computePreparationRevision({ ...prepared, preparationRevision: "" }),
	};
	const json = `${JSON.stringify(withRevision, null, 2)}\n`;
	const byteSize = utf8ByteLength(json);
	if (byteSize > PLANNER_PREPARED_INPUT_BUDGET_BYTES) {
		throw new PlannerPreparedInputBudgetError(byteSize, PLANNER_PREPARED_INPUT_BUDGET_BYTES);
	}

	if (withRevision.schemaVersion !== PLANNER_PREPARED_INPUT_SCHEMA_VERSION) {
		throw new PlannerInputValidationError("invalid_prepared_schema", "prepared input schema invalid");
	}

	const target = path.join(resolvedJob, PLANNER_PREPARED_INPUT_FILE);
	await atomicWriteFile(target, json, {
		validate: () => {
			const reread = JSON.parse(json) as PlannerPreparedInput;
			if (reread.inputRevision !== withRevision.inputRevision) {
				throw new Error("prepared inputRevision mismatch after write");
			}
		},
	});

	const { createHash } = await import("node:crypto");
	const sha256 = createHash("sha256").update(json).digest("hex");
	return {
		path: target,
		byteSize,
		sha256,
		preparationRevision: withRevision.preparationRevision,
	};
}

export async function readAndValidatePreparedInputFile(
	jobDir: string,
	options: {
		expectedInputRevision: string;
		runtimeRootDir: string;
	},
): Promise<PlannerPreparedInput> {
	const resolvedJob = path.resolve(jobDir);
	const resolvedRuntime = path.resolve(options.runtimeRootDir);
	assertPathWithinRoot(resolvedJob, resolvedRuntime);

	const target = path.join(resolvedJob, PLANNER_PREPARED_INPUT_FILE);
	let raw: string;
	try {
		raw = await fs.readFile(target, "utf8");
	} catch (e) {
		throw new PlannerInputValidationError("prepared_output_missing", `prepared input missing: ${String(e)}`);
	}

	const byteSize = utf8ByteLength(raw);
	if (byteSize > PLANNER_PREPARED_INPUT_BUDGET_BYTES) {
		throw new PlannerInputValidationError(
			"prepared_output_budget_exceeded",
			`prepared input exceeds budget: ${byteSize} > ${PLANNER_PREPARED_INPUT_BUDGET_BYTES}`,
		);
	}

	let parsed: unknown;
	try {
		parsed = JSON.parse(raw);
	} catch {
		throw new PlannerInputValidationError("prepared_output_invalid", "prepared input is not valid JSON");
	}

	if (!parsed || typeof parsed !== "object") {
		throw new PlannerInputValidationError("prepared_output_invalid", "prepared input must be an object");
	}

	const prepared = parsed as PlannerPreparedInput;
	if (prepared.schemaVersion !== PLANNER_PREPARED_INPUT_SCHEMA_VERSION) {
		throw new PlannerInputValidationError("prepared_output_invalid", "prepared input schema invalid");
	}
	if (prepared.inputRevision !== options.expectedInputRevision) {
		throw new PlannerInputValidationError(
			"result_input_revision_mismatch",
			"prepared inputRevision mismatch",
		);
	}

	const expectedPrepRevision = computePreparationRevision({ ...prepared, preparationRevision: "" });
	if (prepared.preparationRevision !== expectedPrepRevision) {
		throw new PlannerInputValidationError(
			"prepared_output_invalid",
			"prepared preparationRevision mismatch",
		);
	}

	return prepared;
}
