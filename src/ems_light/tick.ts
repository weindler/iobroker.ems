import { touchEmsActivity } from "../ems_activity";
import { GLOBAL } from "../tree_paths";
import { deriveHealth, formatLiveCacheSummary, refreshLiveCache, type LiveCacheHost } from "./live_cache";
import { runPlannerTick } from "../planner/run";
import type { PlannerHost } from "../planner/inputs";

/**
 * Operator Forecast → Daily Plan → Allocation.
 * Always on for production control (addons consume these plans).
 * Shadow/Takeover/Authority stay disabled separately.
 */
function operatorForecastPathEnabled(_config: unknown): boolean {
	return true;
}

export async function runEmsLightPhase1Tick(host: LiveCacheHost & PlannerHost): Promise<void> {
	touchEmsActivity();
	const ts = new Date().toISOString();
	const hints: string[] = [];

	let executionMode = "dryrun";
	try {
		const globalMode = await host.getStateAsync(GLOBAL.executionMode);
		if (globalMode?.val != null && String(globalMode.val).trim() !== "") {
			executionMode = String(globalMode.val).trim().toLowerCase();
		} else {
			hints.push("global.execution_mode nicht gesetzt");
		}
	} catch {
		hints.push("global.execution_mode nicht lesbar");
	}

	try {
		await host.setStateAsync("execution.safety.global_execution_mode", {
			val: executionMode,
			ack: true,
		});
	} catch (e) {
		hints.push(`execution.safety.global_execution_mode: ${String(e)}`);
	}

	let liveResult = { updated: [] as string[], missing: [] as string[], errors: [] as string[] };
	try {
		liveResult = await refreshLiveCache(host);
	} catch (e) {
		hints.push(`live_cache: ${String(e)}`);
		liveResult.errors.push(String(e));
	}

	try {
		await runPlannerTick(host);
	} catch (e) {
		hints.push(`planner: ${String(e)}`);
	}

	if (operatorForecastPathEnabled(host.config)) {
		const { runGridSupplyTick } = await import("../operator/supply/grid_tick.js");
		const { runFlexibleContributionsTick } = await import("../operator/contributions/flexible/tick.js");
		const { runForecastPlanTick } = await import("../operator/forecast/tick.js");
		const { runDailyPlanTick } = await import("../operator/daily_plan/tick.js");

		let gridForecast;
		try {
			gridForecast = await runGridSupplyTick(host);
		} catch (e) {
			hints.push(`grid_supply: ${String(e)}`);
		}

		let flexibleContributions: Awaited<ReturnType<typeof runFlexibleContributionsTick>> = [];
		try {
			flexibleContributions = await runFlexibleContributionsTick(host, gridForecast);
		} catch (e) {
			hints.push(`flexible_contributions: ${String(e)}`);
		}

		let forecastPlan;
		try {
			forecastPlan = await runForecastPlanTick(host, gridForecast, flexibleContributions);
		} catch (e) {
			hints.push(`forecast_plan: ${String(e)}`);
		}

		if (forecastPlan) {
			let plan: Awaited<ReturnType<typeof runDailyPlanTick>> | null = null;
			try {
				plan = await runDailyPlanTick(host, forecastPlan);
			} catch (e) {
				hints.push(`daily_plan: ${String(e)}`);
			}
			if (plan) {
				try {
					const { maybeTriggerAiOptimizationOnDailyPlanChange } = await import("../ai/index.js");
					await maybeTriggerAiOptimizationOnDailyPlanChange(
						host as Parameters<typeof maybeTriggerAiOptimizationOnDailyPlanChange>[0],
						plan,
					);
				} catch (e) {
					hints.push(`ai_optimization: ${String(e)}`);
				}
			}
		}
	}

	const health = deriveHealth(liveResult, !hints.some((h) => h.includes("global.execution_mode nicht")));
	const summaryParts = [
		`Phase 1 read-only. Modus=${executionMode}.`,
		formatLiveCacheSummary(liveResult),
		...hints,
	];

	try {
		await host.setStateAsync("system.last_tick_at", { val: ts, ack: true });
		await host.setStateAsync("system.health", { val: health, ack: true });
		await host.setStateAsync("execution.safety.summary_de", {
			val: summaryParts.join(" ").trim().slice(0, 480),
			ack: true,
		});
	} catch {
		// kein Throw — Phase 1 soll robust bleiben
	}
}
