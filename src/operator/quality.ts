import type { OperatorDataQuality, OperatorDataStatus } from "./types";

export function operatorQuality(
	status: OperatorDataStatus,
	reasonDe: string,
	confidencePct: number | null = null,
): OperatorDataQuality {
	return {
		status,
		confidencePct: confidencePct !== null && Number.isFinite(confidencePct) ? confidencePct : null,
		reasonDe,
	};
}

export function mergeOperatorQuality(a: OperatorDataQuality, b: OperatorDataQuality): OperatorDataQuality {
	const rank: Record<OperatorDataStatus, number> = {
		invalid: 5,
		missing: 4,
		disabled: 3,
		degraded: 2,
		valid: 1,
	};
	const pick = rank[a.status] >= rank[b.status] ? a : b;
	return {
		status: pick.status,
		confidencePct: pick.confidencePct ?? a.confidencePct ?? b.confidencePct,
		reasonDe: pick.reasonDe || a.reasonDe || b.reasonDe,
	};
}
