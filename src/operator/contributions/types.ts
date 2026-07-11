import type { EmsAddonId } from "../../addons/registry";
import type {
	OperatorContributorRef,
	PlanContribution,
	PlanContributionFlow,
	PlanRole,
} from "../types";
import { operatorQuality } from "../quality";
import { addonContributorRef } from "../contributor";

export function clampConfidencePct(value: number | null | undefined): number | null {
	if (value === null || value === undefined || !Number.isFinite(value)) return null;
	return Math.max(0, Math.min(100, Math.round(value * 10) / 10));
}

export function baseContribution(
	contributionId: string,
	contributor: OperatorContributorRef,
	flow: PlanContributionFlow,
	roles: PlanRole[],
	params: {
		generatedAt: string;
		validUntil: string | null;
		revision: number;
		enabled: boolean;
		flexible: boolean;
		gridEligible: boolean;
		quality: ReturnType<typeof operatorQuality>;
		reasonDe: string;
		details: Record<string, unknown>;
		slots?: PlanContribution["slots"];
		priorityBand?: number | null;
		deadlineIso?: string | null;
	},
): PlanContribution {
	return {
		contributionId,
		contributor,
		flow,
		roles,
		generatedAt: params.generatedAt,
		validUntil: params.validUntil,
		revision: params.revision,
		enabled: params.enabled,
		flexible: params.flexible,
		gridEligible: params.gridEligible,
		priorityBand: params.priorityBand ?? null,
		deadlineIso: params.deadlineIso ?? null,
		slots: params.slots ?? [],
		quality: params.quality,
		reasonDe: params.reasonDe,
		details: params.details,
	};
}

export function isPvForecastPresent(
	correctedTodayKwh: number | null,
	correctedTomorrowKwh: number | null,
	status: string | null,
): boolean {
	if (status === "ready" || status === "insufficient_data") {
		return correctedTodayKwh !== null || correctedTomorrowKwh !== null;
	}
	return correctedTodayKwh !== null || correctedTomorrowKwh !== null;
}

export function pvAddonId(): EmsAddonId {
	return "pv_forecast";
}

export function weatherForecastAddonId(): EmsAddonId {
	return "weather_forecast";
}

export function houseMainFuseAddonId(): EmsAddonId {
	return "house_main_fuse";
}

export function pvContributorRef(): OperatorContributorRef {
	return addonContributorRef("pv_forecast");
}
