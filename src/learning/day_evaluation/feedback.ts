/**
 * Learning-Feedback aus Day Evaluation — speist bestehende Module, keine zweite Engine.
 */

import {
	readDailyPersist,
	upsertDailyRecord,
	writeDailyPersist,
} from "../pv_bias/daily_persist";
import { atomicWriteFile } from "../../persistence/atomic_write";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import type { DayEvaluationRecord } from "./types";

/** Bounds für geglättete IH kWh/°C (um Default 0.38). */
export const THERMAL_KWH_PER_C_MIN = 0.2;
export const THERMAL_KWH_PER_C_MAX = 0.6;
export const THERMAL_KWH_PER_C_DEFAULT = 0.38;
export const THERMAL_KWH_EMA_ALPHA = 0.15;
/** Unter dieser Sample-Zahl darf der Faktor Flex-Demand nicht beeinflussen. */
export const THERMAL_KWH_MIN_SAMPLES_FOR_USE = 5;
export const THERMAL_HEAT_FACTOR_FILE = "immersion_heat_factor_v1.json";

export type ImmersionHeatFactorStore = {
	module: "immersion_heat_factor";
	schemaVersion: 1;
	updatedAtIso: string;
	kwhPerDegreeC: number;
	samples: number;
	lastObservedKwhPerDegreeC: number | null;
};

export function emptyHeatFactorStore(): ImmersionHeatFactorStore {
	return {
		module: "immersion_heat_factor",
		schemaVersion: 1,
		updatedAtIso: new Date(0).toISOString(),
		kwhPerDegreeC: THERMAL_KWH_PER_C_DEFAULT,
		samples: 0,
		lastObservedKwhPerDegreeC: null,
	};
}

export function clampKwhPerDegree(v: number): number {
	return Math.min(THERMAL_KWH_PER_C_MAX, Math.max(THERMAL_KWH_PER_C_MIN, v));
}

export function applyThermalHeatFactorSample(
	store: ImmersionHeatFactorStore,
	observedKwhPerDegreeC: number,
	atIso: string,
): ImmersionHeatFactorStore {
	if (!Number.isFinite(observedKwhPerDegreeC) || observedKwhPerDegreeC <= 0) return store;
	const obs = clampKwhPerDegree(observedKwhPerDegreeC);
	const prev = store.samples <= 0 ? THERMAL_KWH_PER_C_DEFAULT : store.kwhPerDegreeC;
	const next = clampKwhPerDegree(
		prev * (1 - THERMAL_KWH_EMA_ALPHA) + obs * THERMAL_KWH_EMA_ALPHA,
	);
	return {
		...store,
		updatedAtIso: atIso,
		kwhPerDegreeC: next,
		samples: store.samples + 1,
		lastObservedKwhPerDegreeC: obs,
	};
}

export async function loadHeatFactorStore(baseDir: string): Promise<ImmersionHeatFactorStore> {
	try {
		const raw = await fs.readFile(path.join(baseDir, THERMAL_HEAT_FACTOR_FILE), "utf8");
		const parsed = JSON.parse(raw) as ImmersionHeatFactorStore;
		if (parsed?.module === "immersion_heat_factor" && parsed.schemaVersion === 1) return parsed;
	} catch {
		/* empty */
	}
	return emptyHeatFactorStore();
}

export async function writeHeatFactorStore(
	baseDir: string,
	store: ImmersionHeatFactorStore,
): Promise<void> {
	await fs.mkdir(baseDir, { recursive: true });
	await atomicWriteFile(
		path.join(baseDir, THERMAL_HEAT_FACTOR_FILE),
		`${JSON.stringify(store, null, 2)}\n`,
	);
}

/** Nutzbarer Faktor nur bei genug Samples — sonst null (Default behalten). */
export function usableHeatFactorKwhPerDegree(store: ImmersionHeatFactorStore): number | null {
	if (store.samples < THERMAL_KWH_MIN_SAMPLES_FOR_USE) return null;
	return store.kwhPerDegreeC;
}

export type LearningFeedbackResult = {
	pvBiasUpserted: boolean;
	thermalUpdated: boolean;
	houseLoadNoted: boolean;
	skippedReason: string | null;
};

/**
 * PV: speist bestehende pv_bias_daily Persistenz (eine Zeile pro Tag — keine Replan-Doppelzählung).
 * Forecast = initial expected (vor Replans), Actual = Evaluation.
 */
export async function applyPvBiasFeedbackFromEvaluation(
	pvBiasDir: string,
	ev: DayEvaluationRecord,
): Promise<boolean> {
	const forecast = ev.pv.initialExpectedKwh;
	const actual = ev.pv.actualKwh;
	if (forecast === null && actual === null) return false;
	const persist = await readDailyPersist(pvBiasDir);
	const existing = persist.days[ev.plan.date];
	if (existing?.actualKwh != null && existing?.forecastKwh != null) {
		// Bereits vollständiger Tag — kein Überschreiben durch Re-Close
		return false;
	}
	const next = upsertDailyRecord(persist, {
		date: ev.plan.date,
		actualKwh: actual,
		actualCapturedAt: actual !== null ? ev.evaluatedAtIso : existing?.actualCapturedAt ?? null,
		forecastKwh: forecast,
		forecastCapturedAt:
			forecast !== null ? ev.evaluatedAtIso : existing?.forecastCapturedAt ?? null,
		actualSource: "day_evaluation",
		forecastSource: "day_evaluation_initial_plan",
	});
	await writeDailyPersist(pvBiasDir, next);
	return true;
}

/**
 * Thermal: nur wenn geplante ΔT und Ist-Energie belastbar — EMA innerhalb Bounds.
 */
export async function applyThermalHeatFactorFeedback(
	thermalDir: string,
	ev: DayEvaluationRecord,
): Promise<boolean> {
	const plannedKwh = ev.immersion.plannedKwh;
	const actualKwh = ev.immersion.actualKwh;
	const target = ev.immersion.plannedTargetTempC;
	if (
		plannedKwh === null ||
		actualKwh === null ||
		target === null ||
		actualKwh < 0.2 ||
		!ev.immersion.targetReached
	) {
		return false;
	}
	// Ohne Start-Temp schätzen wir ΔT aus Energie/Default — zu schwach → skip
	// Nutze Ist-Energie / geplante Energie * Default als Observation nur wenn Ziel erreicht
	const observed = (actualKwh / Math.max(plannedKwh, 0.2)) * THERMAL_KWH_PER_C_DEFAULT;
	if (!Number.isFinite(observed) || observed < THERMAL_KWH_PER_C_MIN * 0.5) return false;
	const store = await loadHeatFactorStore(thermalDir);
	const next = applyThermalHeatFactorSample(store, observed, ev.evaluatedAtIso);
	await writeHeatFactorStore(thermalDir, next);
	return true;
}

/**
 * House Load: Evaluation speichert Abweichung; keine Tick-Samples.
 * Hier nur Qualitäts-Flag — bestehendes house_load-Modul bleibt History-Authority.
 */
export function noteHouseLoadFeedback(ev: DayEvaluationRecord): boolean {
	return ev.houseLoad.expectedKwh !== null || ev.houseLoad.actualKwh !== null;
}

export async function applyLearningFeedbackFromEvaluation(dirs: {
	pvBiasDir: string;
	thermalDir: string;
	evaluation: DayEvaluationRecord;
}): Promise<LearningFeedbackResult> {
	const ev = dirs.evaluation;
	if (ev.learningApplied) {
		return {
			pvBiasUpserted: false,
			thermalUpdated: false,
			houseLoadNoted: false,
			skippedReason: "already_applied",
		};
	}
	const pvBiasUpserted = await applyPvBiasFeedbackFromEvaluation(dirs.pvBiasDir, ev);
	const thermalUpdated = await applyThermalHeatFactorFeedback(dirs.thermalDir, ev);
	const houseLoadNoted = noteHouseLoadFeedback(ev);
	return {
		pvBiasUpserted,
		thermalUpdated,
		houseLoadNoted,
		skippedReason: null,
	};
}

/** Confidence-Hinweis: ein Tag allein → few_data. */
export function learningConfidenceTier(sampleDays: number): "none" | "few" | "usable" | "stale" {
	if (sampleDays <= 0) return "none";
	if (sampleDays < 3) return "few";
	if (sampleDays < 7) return "usable";
	return "usable";
}
