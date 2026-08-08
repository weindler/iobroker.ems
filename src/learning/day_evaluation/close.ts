/**
 * Tagesabschluss — genau einmal pro lokalem Tag (idempotent, restart-sicher).
 */

import { learningDataPathFromRoot } from "../data_dir";
import {
	buildDayEvaluationRecord,
	type DayEvalActuals,
	type DayEvalSessionSnapshot,
} from "./build";
import { applyLearningFeedbackFromEvaluation } from "./feedback";
import {
	dayEvaluationExists,
	loadOrEmptyDayEvaluationStore,
	upsertDayEvaluationOnce,
	writeDayEvaluationPersist,
} from "./persist";
import type { DayEvaluationRecord, DayEvaluationStore } from "./types";

export type CloseDayResult = {
	closed: boolean;
	alreadyClosed: boolean;
	record: DayEvaluationRecord | null;
	store: DayEvaluationStore;
	error: string | null;
};

export async function closeDayEvaluationOnce(input: {
	/** Absolute Kategorie `learning/day_evaluation`. */
	dayEvalDir: string;
	pvBiasDir: string;
	thermalDir: string;
	session: DayEvalSessionSnapshot;
	actuals: DayEvalActuals;
	now: Date;
}): Promise<CloseDayResult> {
	try {
		let store = await loadOrEmptyDayEvaluationStore(input.dayEvalDir);
		if (dayEvaluationExists(store, input.session.date)) {
			return {
				closed: false,
				alreadyClosed: true,
				record: store.days[input.session.date] ?? null,
				store,
				error: null,
			};
		}
		const record = buildDayEvaluationRecord(input.session, input.actuals, input.now);
		const upsert = upsertDayEvaluationOnce(store, record);
		if (!upsert.inserted) {
			return {
				closed: false,
				alreadyClosed: true,
				record: upsert.store.days[input.session.date] ?? null,
				store: upsert.store,
				error: null,
			};
		}
		store = upsert.store;
		const feedback = await applyLearningFeedbackFromEvaluation({
			pvBiasDir: input.pvBiasDir,
			thermalDir: input.thermalDir,
			evaluation: record,
		});
		const withLearning: DayEvaluationRecord = {
			...record,
			learningApplied: feedback.skippedReason !== "already_applied",
		};
		store = {
			...store,
			days: { ...store.days, [record.plan.date]: withLearning },
			updatedAtIso: input.now.toISOString(),
		};
		await writeDayEvaluationPersist(input.dayEvalDir, store);
		return {
			closed: true,
			alreadyClosed: false,
			record: withLearning,
			store,
			error: null,
		};
	} catch (e) {
		return {
			closed: false,
			alreadyClosed: false,
			record: null,
			store: await loadOrEmptyDayEvaluationStore(input.dayEvalDir),
			error: String(e),
		};
	}
}

/** Pfade aus durable root ableiten. */
export function dayEvaluationDirsFromRoot(durableRoot: string): {
	dayEvalDir: string;
	pvBiasDir: string;
	thermalDir: string;
} {
	return {
		dayEvalDir: learningDataPathFromRoot(durableRoot, "learning/day_evaluation"),
		pvBiasDir: learningDataPathFromRoot(durableRoot, "learning/pv_bias"),
		thermalDir: learningDataPathFromRoot(durableRoot, "learning/thermal_runtime"),
	};
}
