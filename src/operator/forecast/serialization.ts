import type { ForecastPlan } from "./types";
import { utf8Bytes } from "../../diagnostics/forecast_plan_write_probe";

export interface ForecastPlanSerializedField {
	stateId: string;
	value: string;
	bytes: number;
	slotCount?: number;
	contributionCount?: number;
}

export interface ForecastPlanSerializationReport {
	fields: ForecastPlanSerializedField[];
	totalSerializedBytes: number;
	uniqueSlotBytes: number;
	uniqueContributionBytes: number;
	duplicateSlotBytesVsPlanJson: number;
	duplicateContributionBytesVsPlanJson: number;
}

export interface ForecastPlanSerializedWrites {
	activeContributorsJson: string;
	excludedContributorsJson: string;
	daysJson: string;
	slotsJson: string;
	contributionsJson: string;
	planJson: string;
	report: ForecastPlanSerializationReport;
}

/** Serialize each forecast mirror once; caller writes sequentially and drops references. */
export function serializeForecastPlanForWrites(plan: ForecastPlan): ForecastPlanSerializedWrites {
	const activeContributorsJson = JSON.stringify(plan.activeContributors);
	const excludedContributorsJson = JSON.stringify(plan.excludedContributors);
	const daysJson = JSON.stringify(plan.days);
	const slotsJson = JSON.stringify(plan.slots);
	const contributionsJson = JSON.stringify(plan.contributions);
	const planJson = JSON.stringify(plan);

	const fields: ForecastPlanSerializedField[] = [
		{ stateId: "active_contributors_json", value: activeContributorsJson, bytes: utf8Bytes(activeContributorsJson) },
		{ stateId: "excluded_contributors_json", value: excludedContributorsJson, bytes: utf8Bytes(excludedContributorsJson) },
		{ stateId: "days_json", value: daysJson, bytes: utf8Bytes(daysJson) },
		{
			stateId: "slots_json",
			value: slotsJson,
			bytes: utf8Bytes(slotsJson),
			slotCount: plan.slots.length,
		},
		{
			stateId: "contributions_json",
			value: contributionsJson,
			bytes: utf8Bytes(contributionsJson),
			contributionCount: plan.contributions.length,
		},
		{
			stateId: "plan_json",
			value: planJson,
			bytes: utf8Bytes(planJson),
			slotCount: plan.slots.length,
			contributionCount: plan.contributions.length,
		},
	];

	const uniqueSlotBytes = utf8Bytes(slotsJson);
	const uniqueContributionBytes = utf8Bytes(contributionsJson);

	return {
		activeContributorsJson,
		excludedContributorsJson,
		daysJson,
		slotsJson,
		contributionsJson,
		planJson,
		report: {
			fields,
			totalSerializedBytes: fields.reduce((sum, f) => sum + f.bytes, 0),
			uniqueSlotBytes,
			uniqueContributionBytes,
			duplicateSlotBytesVsPlanJson: utf8Bytes(slotsJson),
			duplicateContributionBytesVsPlanJson: utf8Bytes(contributionsJson),
		},
	};
}
