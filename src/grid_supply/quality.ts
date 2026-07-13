import type { GridDataQuality, GridDataStatus } from "./types";

export function gridDataQuality(
	status: GridDataStatus,
	reasonDe: string,
	confidencePct: number | null = null,
): GridDataQuality {
	return {
		status,
		confidencePct: confidencePct !== null && Number.isFinite(confidencePct) ? confidencePct : null,
		reasonDe,
	};
}
