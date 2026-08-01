import { randomUUID } from "node:crypto";
import type { RestoreArchiveIdentity, RestorePlan, RestorePlanSummary, RestoreProjection } from "./types";
import type { ExportManifest } from "../backup/types";
import { RESTORE_PLAN_TTL_MS } from "./types";
import { RESTORE_LEARNING_KEYS } from "./learning_map";

const RESTORE_LEARNING_KEY_COUNT = RESTORE_LEARNING_KEYS.length;

let activePlan: RestorePlan | null = null;

export function clearRestorePlanForTest(): void {
	activePlan = null;
}

export function getActiveRestorePlan(): RestorePlan | null {
	if (!activePlan) return null;
	if (activePlan.used || Date.now() > Date.parse(activePlan.expiresAt)) {
		activePlan = null;
		return null;
	}
	return activePlan;
}

export function invalidateRestorePlan(): void {
	activePlan = null;
}

export function createRestorePlan(input: {
	identity: RestoreArchiveIdentity;
	manifest: ExportManifest;
	projection: RestoreProjection;
	changedConfigFields: number;
}): RestorePlan {
	const now = Date.now();
	const planId = randomUUID();
	const vehicleProfileCount = Array.isArray(input.projection.native.wb_vehicle_map)
		? input.projection.native.wb_vehicle_map.length
		: 0;
	const learningFileCount = Object.keys(input.projection.learning).length;
	const learningFilesToRemove = RESTORE_LEARNING_KEY_COUNT - learningFileCount;

	const summary: RestorePlanSummary = {
		fileName: input.identity.fileName,
		backupVersion: input.manifest.adapter.version,
		schemaVersion: input.manifest.schema_version,
		exportAt: input.manifest.created_at,
		changedConfigFields: input.changedConfigFields,
		vehicleProfileCount,
		learningFileCount,
		learningFilesToRemove,
		skippedClasses: input.projection.skippedClasses,
		warnings: input.projection.warnings,
		configuredModesAtExport: { ...input.projection.configuredModesAtExport },
		applyModes: {
			global: "dryrun",
			wallbox: "dryrun",
			battery: "dryrun",
			immersion_heater: "dryrun",
			air_conditioning: "dryrun",
		},
	};

	const plan: RestorePlan = {
		planId,
		createdAt: new Date(now).toISOString(),
		expiresAt: new Date(now + RESTORE_PLAN_TTL_MS).toISOString(),
		used: false,
		identity: input.identity,
		manifest: input.manifest,
		projection: input.projection,
		summary,
	};
	activePlan = plan;
	return plan;
}

export function markPlanUsed(): void {
	if (activePlan) activePlan.used = true;
}

export function assertPlanMatchesIdentity(identity: RestoreArchiveIdentity, confirmPlanId: string): RestorePlan {
	const plan = getActiveRestorePlan();
	if (!plan) {
		throw new Error("no valid restore plan");
	}
	if (plan.planId !== confirmPlanId) {
		throw new Error("invalid plan id");
	}
	if (plan.identity.fileName !== identity.fileName) {
		throw new Error("archive file name changed");
	}
	if (plan.identity.archiveSha256 !== identity.archiveSha256) {
		throw new Error("archive content changed");
	}
	if (plan.identity.sizeBytes !== identity.sizeBytes) {
		throw new Error("archive size changed");
	}
	if (plan.identity.mtimeMs !== identity.mtimeMs) {
		throw new Error("archive mtime changed");
	}
	return plan;
}

export function planSummaryJson(plan: RestorePlan): string {
	return JSON.stringify(plan.summary);
}
