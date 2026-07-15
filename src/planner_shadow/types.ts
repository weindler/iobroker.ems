export type PlannerShadowComparisonStatus =
	| "not_available"
	| "matched"
	| "mismatch"
	| "reference_missing"
	| "reference_time_mismatch"
	| "worker_failed"
	| "comparison_failed";

export interface PlannerShadowGridSlotProjection {
	start: string;
	end: string;
	importAllowed: boolean;
	maxImportW: number | null;
	priceCtPerKwh: number | null;
	priceClass: string | null;
}

export interface PlannerShadowGridProjection {
	capturedAt: string;
	horizonStart: string;
	horizonEnd: string;
	slotCount: number;
	gridImportAllowed: boolean;
	maxGridImportW: number | null;
	houseFuseLimitW: number | null;
	slots: PlannerShadowGridSlotProjection[];
}

export interface PlannerShadowComparisonResult {
	status: PlannerShadowComparisonStatus;
	referenceRevision?: string;
	workerRevision?: string;
	mismatchCount: number;
	firstMismatchPath?: string;
}

export interface PlannerShadowReferenceMeta {
	capturedAt: string;
	horizonStart: string;
	horizonEnd: string;
	slotCount: number;
	referenceRevision: string;
	recordedAt: string;
}
