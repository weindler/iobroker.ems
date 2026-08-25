import { touchEmsActivity } from "../ems_activity";
import { GLOBAL } from "../tree_paths";
import { deriveHealth, formatLiveCacheSummary, refreshLiveCache, type LiveCacheHost } from "./live_cache";
/** Type-only — must not pull `planner/run` onto the production tick path (Block 4). */
import type { PlannerHost } from "../planner/inputs";

/**
 * Operator Forecast → Daily Plan → Allocation.
 * Always on for production control (addons consume these plans).
 * Roadmap Block 4: single planner path — no `runPlannerTick` / `src/planner/run.ts` on the tick.
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

	try {
		const cfg = (host.config ?? {}) as Record<string, unknown>;
		const showDiag = cfg.vis_show_diagnostics === true || cfg.vis_show_diagnostics === 1 || cfg.vis_show_diagnostics === "true";
		await host.setStateAsync("operator.vis.show_diagnostics", { val: showDiag, ack: true });
	} catch (e) {
		hints.push(`operator.vis.show_diagnostics: ${String(e)}`);
	}

	try {
		const { syncEconomicsFeedInFromConfig } = await import("./economics_feed_in.js");
		const { syncEconomicsTariffFeesFromConfig } = await import("./economics_tariff_fees.js");
		const feedHost = host as typeof host & {
			config?: unknown;
			updateConfig?: (c: Record<string, unknown>) => Promise<unknown>;
			log?: { info?: (m: string) => void; warn?: (m: string) => void };
			setObjectNotExistsAsync?: (
				id: string,
				obj: ioBroker.Object,
			) => Promise<unknown>;
			extendObjectAsync?: (id: string, obj: Partial<ioBroker.Object>) => Promise<unknown>;
		};
		if (typeof feedHost.setObjectNotExistsAsync === "function") {
			const econHost = {
				setObjectNotExistsAsync: feedHost.setObjectNotExistsAsync.bind(feedHost),
				getStateAsync: host.getStateAsync.bind(host),
				setStateAsync: host.setStateAsync.bind(host),
				extendObjectAsync: feedHost.extendObjectAsync?.bind(feedHost),
				config: feedHost.config ?? {},
				updateConfig:
					typeof feedHost.updateConfig === "function"
						? feedHost.updateConfig.bind(feedHost)
						: undefined,
				log: feedHost.log,
			};
			await syncEconomicsFeedInFromConfig(econHost);
			await syncEconomicsTariffFeesFromConfig(econHost);
		}
	} catch (e) {
		hints.push(`economics.tariff: ${String(e)}`);
	}

	let liveResult = { updated: [] as string[], missing: [] as string[], errors: [] as string[] };
	try {
		liveResult = await refreshLiveCache(host);
	} catch (e) {
		hints.push(`live_cache: ${String(e)}`);
		liveResult.errors.push(String(e));
	}

	try {
		const { refreshThermalRemainingCountdown } = await import("../learning/thermal_runtime/run.js");
		await refreshThermalRemainingCountdown(host);
		const { refreshThermalBoilerRemainingCountdown } = await import("../learning/thermal_boiler/run.js");
		await refreshThermalBoilerRemainingCountdown(host);
	} catch (e) {
		hints.push(`thermal_remaining_countdown: ${String(e)}`);
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
				try {
					const { maybeUpdatePlanCompareOnDailyPlanChange } = await import("../ai/compare/index.js");
					await maybeUpdatePlanCompareOnDailyPlanChange(
						host as Parameters<typeof maybeUpdatePlanCompareOnDailyPlanChange>[0],
						plan,
					);
				} catch (e) {
					hints.push(`plan_compare: ${String(e)}`);
				}
			}
		}
	}

	try {
		const { publishVisPriceTimeline } = await import("../operator/vis/publish.js");
		await publishVisPriceTimeline(host);
	} catch (e) {
		hints.push(`vis_price_timeline: ${String(e)}`);
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
