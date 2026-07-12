import { touchEmsActivity } from "../ems_activity";
import { GLOBAL } from "../tree_paths";
import { deriveHealth, formatLiveCacheSummary, refreshLiveCache, type LiveCacheHost } from "./live_cache";
import { runPlannerTick, type PlannerHost } from "../planner";
import { runGridSupplyTick } from "../operator/supply/grid_tick";
import { runFlexibleContributionsTick } from "../operator/contributions/flexible/tick";
import { runForecastPlanTick } from "../operator/forecast/tick";
import { runDailyPlanTick } from "../operator/daily_plan/tick";

export type EmsLightPhase1TickOptions = {
	/** When false, skip grid/forecast/daily operator ticks (planner runtime already ran them). */
	operatorTicks?: boolean;
	/** When false, skip forecast + daily plan ticks (grid/flex/planner still run). */
	planTicks?: boolean;
	/** When false, forecast/daily plans are computed in memory only (no file/scalar persistence). Default true. */
	persistPlans?: boolean;
};

export async function runEmsLightPhase1Tick(
	host: LiveCacheHost & PlannerHost,
	options: EmsLightPhase1TickOptions = {},
): Promise<void> {
	const runOperatorTicks = options.operatorTicks !== false;
	const runPlanTicks = options.planTicks !== false;
	const persistPlans = options.persistPlans !== false;
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

	if (runOperatorTicks) {
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
		if (runPlanTicks) {
			try {
				forecastPlan = await runForecastPlanTick(host, gridForecast, flexibleContributions, {
					persistToDb: persistPlans,
				});
			} catch (e) {
				hints.push(`forecast_plan: ${String(e)}`);
			}

			if (forecastPlan) {
				try {
					await runDailyPlanTick(host, forecastPlan, { persistToDb: persistPlans });
				} catch (e) {
					hints.push(`daily_plan: ${String(e)}`);
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
