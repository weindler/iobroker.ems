import { setOptionalNumberIfChanged, setStateIfChanged } from "../../policy/core/state_write";
import { collectContributions, type ContributionsReadHost } from "../contributions/read";
import type { PlanContribution } from "../types";
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
	flexibleContributions: PlanContribution[] = [],
): Promise<ForecastPlan> {
	const now = new Date();
	const collected = await collectContributions(host, now, gridForecast);
	const contributions = [...collected.contributions, ...flexibleContributions];
	try {
		const pvDetails = collected.contributions.find((c) => c.contributionId === "pv_forecast.supply")?.details;
		if (pvDetails && typeof pvDetails.pvProfileNoteDe === "string") {
			await setStateIfChanged(host, "learning.pv_bias.profile_status_de", pvDetails.pvProfileNoteDe);
		}
		if (pvDetails && typeof pvDetails.intradayFactor === "number") {
			await setStateIfChanged(host, "learning.pv_bias.intraday_factor", pvDetails.intradayFactor);
			if (typeof pvDetails.expectedTodayKwh === "number") {
				await setStateIfChanged(host, "learning.pv_bias.expected_today_kwh", pvDetails.expectedTodayKwh);
			}
			await setStateIfChanged(host, "learning.pv_bias.intraday_status_de", String(pvDetails.intradayReasonDe ?? ""));
		}
	} catch {
		/* Anzeige-States — nie den Plan blockieren */
	}
	const plan = buildForecastPlan({
		now,
		timezone: collected.timezone,
		contributions,
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
		await setStateIfChanged(host, FORECAST_PLAN_STATE_IDS.reasonDe, plan.reasonDe);
		await setOptionalNumberIfChanged(host, FORECAST_PLAN_STATE_IDS.revision, revision);
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
