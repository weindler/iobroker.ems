import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { explainDailyPlanDegradedDe } from "./degraded_reason";
import { CONTRIBUTION_IDS } from "../contribution_ids";
import { operatorQuality } from "../quality";
import { baseContribution } from "../contributions/types";
import { addonContributorRef } from "../contributor";
import type { PlanContribution } from "../types";

function ihFlex(details: Record<string, unknown>, status: "valid" | "degraded" = "degraded"): PlanContribution {
	return baseContribution(
		CONTRIBUTION_IDS.IMMERSION_FLEXIBLE,
		addonContributorRef("immersion_heater"),
		"consume",
		["supply"],
		{
			generatedAt: "2026-08-09T10:00:00.000Z",
			validUntil: null,
			revision: 1,
			enabled: true,
			flexible: true,
			gridEligible: false,
			quality: operatorQuality(status, "t", 60),
			reasonDe: "t",
			details,
			slots: [],
		},
	);
}

describe("D1 daily plan degraded reason", () => {
	it("names Newton-only thermal learning cause exactly", () => {
		const cause = explainDailyPlanDegradedDe(
			[
				ihFlex({
					thermalLearningStatus: "degraded",
					thermalLearningModel: "newton",
					thermalLearningSamples: 0,
					thermalLearningDegradedCauseDe:
						"thermal learning usable only via Newton estimate, 0 completed cooling cycles",
				}),
			],
			{ hasDegradedContributions: true },
		);
		assert.equal(
			cause,
			"thermal learning usable only via Newton estimate, 0 completed cooling cycles",
		);
	});

	it("falls back from thermalLearningModel when cause string missing", () => {
		const cause = explainDailyPlanDegradedDe(
			[
				ihFlex({
					thermalLearningStatus: "degraded",
					thermalLearningModel: "newton",
					thermalLearningSamples: 0,
				}),
			],
			{},
		);
		assert.match(cause, /Newton estimate.*0 completed cooling cycles/);
	});
});
