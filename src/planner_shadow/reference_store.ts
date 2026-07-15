import { computeShadowProjectionRevision } from "./canonical";
import { projectionFromGridSupplyForecast } from "./projection";
import type { GridSupplyForecast } from "../grid_supply/types";
import type { PlannerShadowReferenceMeta } from "./types";

let latestReference: PlannerShadowReferenceMeta | null = null;

export function recordGridSupplyShadowReference(forecast: GridSupplyForecast, capturedAt: string): void {
	const projection = projectionFromGridSupplyForecast(forecast, capturedAt);
	latestReference = {
		capturedAt: projection.capturedAt,
		horizonStart: projection.horizonStart,
		horizonEnd: projection.horizonEnd,
		slotCount: projection.slotCount,
		referenceRevision: computeShadowProjectionRevision(projection),
		recordedAt: new Date().toISOString(),
	};
}

export function getGridSupplyShadowReference(): PlannerShadowReferenceMeta | null {
	return latestReference ? { ...latestReference } : null;
}

export function clearGridSupplyShadowReferenceForTest(): void {
	latestReference = null;
}
