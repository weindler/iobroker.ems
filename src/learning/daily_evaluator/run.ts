/**
 * BLOCK A — Batch-Trigger + Top-Level-Orchestrierung.
 *
 * Arbeitet beim Lauf ALLE vollständigen, noch nicht evaluierten Day-Telemetry-Tage
 * innerhalb der Retention chronologisch ab (Korrektur #11) — nicht nur „gestern“. Ein
 * Adapter-Ausfall über Mitternacht/mehrere Tage wird so sauber aufgeholt.
 *
 * Schreibt NIE nach day_telemetry oder in aktive Learning-Module. Kein Ergebnis ändert
 * reales Planner-/Control-Verhalten.
 */

import { DAY_TELEMETRY_CATEGORY, DAY_TELEMETRY_RETENTION_DAYS } from "../day_telemetry/constants";
import { readDayTelemetryDay, listDayTelemetryDateKeys } from "../day_telemetry/persist";
import { addDaysToDateKey, localDateKeyInTimezone } from "../../operator/time";
import {
	DAILY_EVALUATOR_FINDINGS_CATEGORY,
	DAILY_EVALUATOR_SCORES_CATEGORY,
	DAILY_EVALUATOR_STATE_CATEGORY,
	DAILY_EVALUATOR_STATES,
} from "./constants";
import { evaluateDay } from "./evaluate";
import { applyDayToLearningState } from "./learning";
import {
	listEvaluatedDateKeys,
	loadDailyEvaluatorLearningState,
	pruneDailyEvaluatorFiles,
	readScoresDay,
	writeDailyEvaluatorLearningState,
	writeFindingsDay,
	writeScoresDay,
} from "./persist";

export type DailyEvaluatorHost = {
	getAbsolutePath: (category?: string) => string;
	getStateAsync?: (id: string) => Promise<ioBroker.State | null | undefined>;
	setStateAsync?: (id: string, state: ioBroker.SettableState) => Promise<unknown>;
	config?: unknown;
	log?: { warn?: (m: string) => void; debug?: (m: string) => void; error?: (m: string) => void };
};

export type DailyEvaluatorBatchResult = {
	processedDateKeys: string[];
	skippedAlreadyEvaluated: string[];
	skippedIncomplete: string[];
	errors: Array<{ dateKey: string; error: string }>;
};

async function publishStatus(host: DailyEvaluatorHost, id: string, val: ioBroker.StateValue): Promise<void> {
	if (!host.setStateAsync) return;
	try {
		await host.setStateAsync(id, { val, ack: true });
	} catch {
		/* Status-States sind best-effort */
	}
}

/**
 * Arbeitet den Backlog chronologisch ab. `force`: erlaubt Re-Evaluation bereits
 * evaluierter Tage (z. B. nach Evaluator-Logik-Update) — überschreibt findings/scores,
 * lässt den Learning-State aber idempotent (lastProcessedDateKey-Gate) unverändert für
 * bereits verarbeitete Tage, außer explizit angefordert.
 */
export async function runDailyEvaluatorBatch(
	host: DailyEvaluatorHost,
	opts: { now?: Date; timezone?: string; force?: boolean; reapplyLearningOnForce?: boolean } = {},
): Promise<DailyEvaluatorBatchResult> {
	const now = opts.now ?? new Date();
	const timezone = opts.timezone ?? "Europe/Berlin";
	const todayKey = localDateKeyInTimezone(now, timezone);

	const result: DailyEvaluatorBatchResult = {
		processedDateKeys: [],
		skippedAlreadyEvaluated: [],
		skippedIncomplete: [],
		errors: [],
	};

	try {
		const telemetryDir = host.getAbsolutePath(DAY_TELEMETRY_CATEGORY);
		const findingsDir = host.getAbsolutePath(DAILY_EVALUATOR_FINDINGS_CATEGORY);
		const scoresDir = host.getAbsolutePath(DAILY_EVALUATOR_SCORES_CATEGORY);
		const stateDir = host.getAbsolutePath(DAILY_EVALUATOR_STATE_CATEGORY);

		const cutoffKey = addDaysToDateKey(todayKey, -(DAY_TELEMETRY_RETENTION_DAYS - 1));
		const allKeys = (await listDayTelemetryDateKeys(telemetryDir)).filter((k) => k >= cutoffKey);
		const evaluatedKeys = await listEvaluatedDateKeys(scoresDir);

		let learningState = await loadDailyEvaluatorLearningState(stateDir);

		for (const dateKey of allKeys.sort()) {
			if (dateKey >= todayKey) continue; /* heutiger/zukünftiger Tag ist per Definition nicht complete */
			if (!opts.force && evaluatedKeys.has(dateKey)) {
				result.skippedAlreadyEvaluated.push(dateKey);
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
				const nextKey = addDaysToDateKey(dateKey, 1);
				const nextDay = await readDayTelemetryDay(telemetryDir, nextKey);

				const { record, findings } = evaluateDay({
					day,
					nextDay,
					sourceUpdatedAtIso: day.lastSampleIso ?? now.toISOString(),
					sourceTelemetrySchemaVersion: 2,
					evaluatedAtIso: now.toISOString(),
				});

				await writeFindingsDay(findingsDir, dateKey, findings);
				await writeScoresDay(scoresDir, record);

				if (!opts.force || opts.reapplyLearningOnForce) {
					learningState = applyDayToLearningState(learningState, record, findings, now.toISOString());
					await writeDailyEvaluatorLearningState(stateDir, learningState);
				}

				result.processedDateKeys.push(dateKey);
				await publishStatus(host, DAILY_EVALUATOR_STATES.lastEvaluatedDateKey, dateKey);
				await publishStatus(host, DAILY_EVALUATOR_STATES.lastDayEvaluable, day.evaluable);
				await publishStatus(host, DAILY_EVALUATOR_STATES.lastDayGlobalScore, record.globalScore);
				await publishStatus(host, DAILY_EVALUATOR_STATES.lastDayFindingsCount, record.findingsCount);
				const topFinding = findings.find((f) => !f.insufficientData && !f.notApplicable && f.explanationDe);
				await publishStatus(
					host,
					DAILY_EVALUATOR_STATES.lastDayTopFindingDe,
					topFinding?.explanationDe.slice(0, 240) ?? "",
				);
			} catch (e) {
				result.errors.push({ dateKey, error: e instanceof Error ? e.message : String(e) });
			}
		}

		await pruneDailyEvaluatorFiles(findingsDir, scoresDir, todayKey);

		await publishStatus(host, DAILY_EVALUATOR_STATES.status, result.errors.length > 0 ? "error" : "ok");
		await publishStatus(host, DAILY_EVALUATOR_STATES.lastRunAtIso, now.toISOString());
		await publishStatus(
			host,
			DAILY_EVALUATOR_STATES.pendingBacklogCount,
			Math.max(0, allKeys.length - evaluatedKeys.size - result.processedDateKeys.length),
		);
	} catch (e) {
		result.errors.push({ dateKey: "batch", error: e instanceof Error ? e.message : String(e) });
		host.log?.warn?.(`daily_evaluator batch: ${e instanceof Error ? e.message : String(e)}`);
		await publishStatus(host, DAILY_EVALUATOR_STATES.status, "error");
		await publishStatus(host, DAILY_EVALUATOR_STATES.lastError, e instanceof Error ? e.message : String(e));
	}

	return result;
}

export async function readDailyEvaluatorScores(host: DailyEvaluatorHost, dateKey: string) {
	const scoresDir = host.getAbsolutePath(DAILY_EVALUATOR_SCORES_CATEGORY);
	return readScoresDay(scoresDir, dateKey);
}
