/**
 * PHASE 5 — Batch-Orchestrierung der Shadow-/Counterfactual-Engine.
 *
 * Arbeitet wie der Daily Evaluator (siehe learning/daily_evaluator/run.ts) den Backlog
 * abgeschlossener, noch nicht simulierter day_telemetry-Tage chronologisch ab. Schreibt
 * NIE nach day_telemetry und beeinflusst nie reales Planner-/Control-Verhalten — reines
 * Reporting/Nachweis.
 */

import { DAY_TELEMETRY_CATEGORY, DAY_TELEMETRY_RETENTION_DAYS } from "../day_telemetry/constants";
import { readDayTelemetryDay, listDayTelemetryDateKeys } from "../day_telemetry/persist";
import { addDaysToDateKey, localDateKeyInTimezone } from "../../operator/time";
import { hardwareLimitsFromConfig } from "../../addons/battery/core/limits";
import { BAT } from "../../addons/battery/ensure_states";
import { statisticsConfigFromAdapter } from "../../statistics/config";
import { asNum } from "../../ems_light/state_util";
import {
	SHADOW_ENGINE_MODULE,
	SHADOW_ENGINE_RESULTS_CATEGORY,
	SHADOW_ENGINE_SCHEMA_VERSION,
	SHADOW_ENGINE_STATE_CATEGORY,
} from "./constants";
import {
	listShadowEvaluatedDateKeys,
	pruneShadowEngineFiles,
	readShadowDayRecord,
	writeShadowDayRecord,
} from "./persist";
import { computeRealDayResult, simulateEmsWithoutAi, simulateReferenceNoEms } from "./simulate";
import type { ShadowDayRecord } from "./types";
import { wasAiOverrideActiveOnDate } from "../../ai/override_ledger";

export type ShadowEngineHost = {
	getAbsolutePath: (category?: string) => string;
	getStateAsync?: (id: string) => Promise<ioBroker.State | null | undefined>;
	setStateAsync?: (id: string, state: ioBroker.SettableState) => Promise<unknown>;
	config?: unknown;
	log?: { warn?: (m: string) => void; debug?: (m: string) => void; error?: (m: string) => void };
};

export type ShadowEngineBatchResult = {
	processedDateKeys: string[];
	skippedAlreadyProcessed: string[];
	skippedIncomplete: string[];
	errors: Array<{ dateKey: string; error: string }>;
};

async function publish(host: ShadowEngineHost, id: string, val: ioBroker.StateValue): Promise<void> {
	if (!host.setStateAsync) return;
	try {
		await host.setStateAsync(id, { val, ack: true });
	} catch {
		/* best-effort */
	}
}

/** Für einen einzelnen Tag: reale + simulierte Welten berechnen (reine Funktion, kein I/O). */
export function buildShadowDayRecord(
	dateKey: string,
	day: import("../day_telemetry/types").DayTelemetryDayRecord,
	previousDay: import("../day_telemetry/types").DayTelemetryDayRecord | null,
	batteryParams: {
		usableCapacityKwh: number | null;
		minSocPct: number | null;
		maxSocPct: number | null;
		maxChargeW: number | null;
		maxDischargeW: number | null;
	},
	feedInCtPerKwh: number | null,
	aiOverrideActiveForDay: boolean,
	generatedAtIso: string,
): ShadowDayRecord {
	const real = computeRealDayResult(day, feedInCtPerKwh);
	const startSocPct =
		lastNonNull(previousDay?.buckets.batterySocEndPct ?? []) ?? real.socStartPct ?? null;
	const referenceNoEms = simulateReferenceNoEms(
		day,
		{ ...batteryParams, startSocPct },
		feedInCtPerKwh,
	);
	const emsWithoutAi = simulateEmsWithoutAi(real, aiOverrideActiveForDay);
	return {
		module: SHADOW_ENGINE_MODULE,
		schemaVersion: SHADOW_ENGINE_SCHEMA_VERSION,
		dateKey,
		timezone: day.timezone,
		generatedAtIso,
		sourceTelemetryLastSampleIso: day.lastSampleIso,
		dayEvaluable: day.evaluable,
		real,
		strategies: {
			reference_no_ems: referenceNoEms,
			ems_without_ai: emsWithoutAi,
		},
	};
}

function lastNonNull(arr: Array<number | null>): number | null {
	for (let i = arr.length - 1; i >= 0; i--) {
		if (arr[i] !== null) return arr[i]!;
	}
	return null;
}

export async function runShadowEngineBatch(
	host: ShadowEngineHost,
	opts: { now?: Date; timezone?: string } = {},
): Promise<ShadowEngineBatchResult> {
	const now = opts.now ?? new Date();
	const timezone = opts.timezone ?? "Europe/Berlin";
	const todayKey = localDateKeyInTimezone(now, timezone);

	const result: ShadowEngineBatchResult = {
		processedDateKeys: [],
		skippedAlreadyProcessed: [],
		skippedIncomplete: [],
		errors: [],
	};

	try {
		const telemetryDir = host.getAbsolutePath(DAY_TELEMETRY_CATEGORY);
		const resultsDir = host.getAbsolutePath(SHADOW_ENGINE_RESULTS_CATEGORY);

		const cutoffKey = addDaysToDateKey(todayKey, -(DAY_TELEMETRY_RETENTION_DAYS - 1));
		const allKeys = (await listDayTelemetryDateKeys(telemetryDir)).filter((k) => k >= cutoffKey);
		const processedKeys = await listShadowEvaluatedDateKeys(resultsDir);

		const limits = hardwareLimitsFromConfig(host.config);
		const usableCapacityKwh = host.getStateAsync
			? asNum((await host.getStateAsync(BAT.telemetry.capacityEffectiveKwh))?.val)
			: null;
		const feedInCtPerKwh = statisticsConfigFromAdapter(host.config).feedInCtPerKwh;
		const batteryParams = {
			usableCapacityKwh,
			minSocPct: limits.minSocPct,
			maxSocPct: limits.maxSocPct,
			maxChargeW: limits.maxChargeW,
			maxDischargeW: limits.maxDischargeW,
		};

		let lastEvaluated: string | null = null;
		for (const dateKey of allKeys.sort()) {
			if (dateKey >= todayKey) continue;
			if (processedKeys.has(dateKey)) {
				result.skippedAlreadyProcessed.push(dateKey);
				continue;
			}
			try {
				const day = await readDayTelemetryDay(telemetryDir, dateKey);
				if (!day) {
					result.errors.push({ dateKey, error: "telemetry_day_not_readable" });
					continue;
				}
				if (!day.complete) {
					result.skippedIncomplete.push(dateKey);
					continue;
				}
				const prevKey = addDaysToDateKey(dateKey, -1);
				const previousDay = await readDayTelemetryDay(telemetryDir, prevKey);
				const aiOverrideActive = await wasAiOverrideActiveOnDate(host, dateKey);

				const record = buildShadowDayRecord(
					dateKey,
					day,
					previousDay,
					batteryParams,
					feedInCtPerKwh,
					aiOverrideActive,
					now.toISOString(),
				);
				await writeShadowDayRecord(resultsDir, record);
				result.processedDateKeys.push(dateKey);
				lastEvaluated = dateKey;
			} catch (e) {
				result.errors.push({ dateKey, error: e instanceof Error ? e.message : String(e) });
			}
		}

		await pruneShadowEngineFiles(resultsDir, todayKey);

		if (lastEvaluated) {
			await publish(host, "learning.shadow_engine.last_evaluated_date_key", lastEvaluated);
			const rec = await readShadowDayRecord(resultsDir, lastEvaluated);
			if (rec) {
				await publish(
					host,
					"learning.shadow_engine.yesterday_real_net_cost_eur",
					rec.real.netCostEur,
				);
				await publish(
					host,
					"learning.shadow_engine.yesterday_reference_no_ems_net_cost_eur",
					rec.strategies.reference_no_ems?.netCostEur ?? null,
				);
				await publish(
					host,
					"learning.shadow_engine.yesterday_ems_without_ai_net_cost_eur",
					rec.strategies.ems_without_ai?.netCostEur ?? null,
				);
			}
		}
		const evaluatedCount = (await listShadowEvaluatedDateKeys(resultsDir)).size;
		await publish(host, "learning.shadow_engine.evaluated_days_count", evaluatedCount);
		await publish(
			host,
			"learning.shadow_engine.pending_backlog_count",
			Math.max(0, allKeys.length - evaluatedCount),
		);
		await publish(host, "learning.shadow_engine.status", result.errors.length > 0 ? "error" : "ok");
		await publish(host, "learning.shadow_engine.last_run_at", now.toISOString());
		await publish(host, "learning.shadow_engine.last_error", result.errors[0]?.error ?? "");
	} catch (e) {
		result.errors.push({ dateKey: "batch", error: e instanceof Error ? e.message : String(e) });
		host.log?.warn?.(`shadow_engine batch: ${e instanceof Error ? e.message : String(e)}`);
		await publish(host, "learning.shadow_engine.status", "error");
		await publish(
			host,
			"learning.shadow_engine.last_error",
			e instanceof Error ? e.message : String(e),
		);
	}

	return result;
}

export async function readShadowDayResult(
	host: ShadowEngineHost,
	dateKey: string,
): Promise<ShadowDayRecord | null> {
	const resultsDir = host.getAbsolutePath(SHADOW_ENGINE_RESULTS_CATEGORY);
	return readShadowDayRecord(resultsDir, dateKey);
}

export { SHADOW_ENGINE_STATE_CATEGORY };
