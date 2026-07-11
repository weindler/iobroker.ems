import { setStateIfChanged } from "../../policy/core/state_write";
import { collectContributions, type ContributionsReadHost } from "../contributions/read";
import type { GridSupplyForecast } from "../types";
import { buildForecastPlan, forecastPlanRevisionPayload } from "./build";
import { FORECAST_PLAN_STATE_IDS } from "./states";
import type { ForecastPlan } from "./types";

let lastRevisionPayload = "";
let revision = 0;

export function resetForecastPlanRevisionForTest(): void {
	lastRevisionPayload = "";
	revision = 0;
}

export function forecastPlanRevisionForTest(): number {
	return revision;
}

export async function runForecastPlanTick(
	host: ContributionsReadHost,
	gridForecast?: GridSupplyForecast,
): Promise<ForecastPlan> {
	const now = new Date();
	const collected = await collectContributions(host, now, gridForecast);
	const plan = buildForecastPlan({
		now,
		timezone: collected.timezone,
		contributions: collected.contributions,
	});

	const payload = forecastPlanRevisionPayload(plan);
	if (payload !== lastRevisionPayload) {
		revision += 1;
		lastRevisionPayload = payload;
	}
	plan.revision = revision;

	try {
		await setStateIfChanged(host, FORECAST_PLAN_STATE_IDS.status, plan.status);
		await setStateIfChanged(host, FORECAST_PLAN_STATE_IDS.generatedAt, plan.generatedAt);
		await setStateIfChanged(host, FORECAST_PLAN_STATE_IDS.validUntil, plan.validUntil ?? "");
		await setStateIfChanged(host, FORECAST_PLAN_STATE_IDS.horizonStart, plan.horizonStart);
		await setStateIfChanged(host, FORECAST_PLAN_STATE_IDS.horizonEnd, plan.horizonEnd);
		await setStateIfChanged(host, FORECAST_PLAN_STATE_IDS.slotMinutes, plan.slotMinutes);
		await setStateIfChanged(
			host,
			FORECAST_PLAN_STATE_IDS.activeContributorsJson,
			JSON.stringify(plan.activeContributors),
		);
		await setStateIfChanged(
			host,
			FORECAST_PLAN_STATE_IDS.excludedContributorsJson,
			JSON.stringify(plan.excludedContributors),
		);
		await setStateIfChanged(host, FORECAST_PLAN_STATE_IDS.daysJson, JSON.stringify(plan.days));
		await setStateIfChanged(host, FORECAST_PLAN_STATE_IDS.slotsJson, JSON.stringify(plan.slots));
		await setStateIfChanged(
			host,
			FORECAST_PLAN_STATE_IDS.contributionsJson,
			JSON.stringify(plan.contributions),
		);
		await setStateIfChanged(host, FORECAST_PLAN_STATE_IDS.planJson, JSON.stringify(plan));
		await setStateIfChanged(host, FORECAST_PLAN_STATE_IDS.reasonDe, plan.reasonDe);
		await setStateIfChanged(host, FORECAST_PLAN_STATE_IDS.revision, revision);
	} catch (e) {
		host.log?.warn?.(`forecast plan state write: ${String(e)}`);
		try {
			await setStateIfChanged(host, FORECAST_PLAN_STATE_IDS.status, "error");
			await setStateIfChanged(
				host,
				FORECAST_PLAN_STATE_IDS.reasonDe,
				`Forecast Plan Fehler: ${String(e)}`.slice(0, 480),
			);
		} catch {
			// ignore secondary failure
		}
	}

	return plan;
}
