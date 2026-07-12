import { setStateIfChanged, type StateWriteOptions } from "../../policy/core/state_write";
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
	const plan = buildForecastPlan({
		now,
		timezone: collected.timezone,
		contributions,
	});

	const payload = forecastPlanRevisionPayload(plan);
	const revisionChanged = payload !== lastRevisionPayload;
	const nextRevision = revisionChanged ? revision + 1 : revision;
	plan.revision = nextRevision;
	const writeOpts: StateWriteOptions | undefined = revisionChanged ? { skipRead: true } : undefined;

	try {
		await setStateIfChanged(host, FORECAST_PLAN_STATE_IDS.status, plan.status, writeOpts);
		await setStateIfChanged(host, FORECAST_PLAN_STATE_IDS.generatedAt, plan.generatedAt, writeOpts);
		await setStateIfChanged(host, FORECAST_PLAN_STATE_IDS.validUntil, plan.validUntil ?? "", writeOpts);
		await setStateIfChanged(host, FORECAST_PLAN_STATE_IDS.horizonStart, plan.horizonStart, writeOpts);
		await setStateIfChanged(host, FORECAST_PLAN_STATE_IDS.horizonEnd, plan.horizonEnd, writeOpts);
		await setStateIfChanged(host, FORECAST_PLAN_STATE_IDS.slotMinutes, plan.slotMinutes, writeOpts);
		await setStateIfChanged(
			host,
			FORECAST_PLAN_STATE_IDS.activeContributorsJson,
			JSON.stringify(plan.activeContributors),
			writeOpts,
		);
		await setStateIfChanged(
			host,
			FORECAST_PLAN_STATE_IDS.excludedContributorsJson,
			JSON.stringify(plan.excludedContributors),
			writeOpts,
		);
		await setStateIfChanged(host, FORECAST_PLAN_STATE_IDS.daysJson, JSON.stringify(plan.days), writeOpts);
		await setStateIfChanged(host, FORECAST_PLAN_STATE_IDS.slotsJson, JSON.stringify(plan.slots), writeOpts);
		await setStateIfChanged(
			host,
			FORECAST_PLAN_STATE_IDS.contributionsJson,
			JSON.stringify(plan.contributions),
			writeOpts,
		);
		await setStateIfChanged(host, FORECAST_PLAN_STATE_IDS.planJson, JSON.stringify(plan), writeOpts);
		await setStateIfChanged(host, FORECAST_PLAN_STATE_IDS.reasonDe, plan.reasonDe, writeOpts);
		await setStateIfChanged(host, FORECAST_PLAN_STATE_IDS.revision, nextRevision, writeOpts);
		if (revisionChanged) {
			revision = nextRevision;
			lastRevisionPayload = payload;
		}
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
