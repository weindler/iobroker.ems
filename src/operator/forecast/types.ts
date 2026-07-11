import type {
	ForecastPlanDay,
	ForecastPlanSlot,
	ForecastPlanStatus,
	OperatorContributorRef,
	OperatorDataQuality,
	PlanContribution,
} from "../types";

export type { ForecastPlanDay, ForecastPlanSlot, ForecastPlanStatus } from "../types";

export interface ForecastPlanExcludedContributor {
	contributor: OperatorContributorRef;
	contributionId: string;
	reasonDe: string;
}

export interface ForecastPlan {
	generatedAt: string;
	validUntil: string | null;
	revision: number;

	timezone: string;
	horizonStart: string;
	horizonEnd: string;
	slotMinutes: number;

	status: ForecastPlanStatus;

	activeContributors: OperatorContributorRef[];
	excludedContributors: ForecastPlanExcludedContributor[];

	days: ForecastPlanDay[];
	slots: ForecastPlanSlot[];

	contributions: PlanContribution[];

	quality: OperatorDataQuality;
	reasonDe: string;
}
