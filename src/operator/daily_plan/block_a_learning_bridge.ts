/**
 * BLOCK B — Block-A-Learning-Loader (Read-Only Bridge).
 *
 * Liest ausschließlich den bestehenden, bereits produktiven diagnostischen Block-A-State
 * (`learning/daily_evaluator/learning_state_v1.json`, geschrieben von `daily_evaluator/
 * persist.ts` + `run.ts`). Block B schreibt diesen State NIEMALS, erzeugt keine zweite
 * Learning-Datei und verändert keine aktiven Learning-Module (pv_bias, battery_runtime,
 * thermal_runtime, house_load, ...) — der Daily Evaluator bleibt alleiniger Eigentümer
 * seiner Daten.
 *
 * Wiederverwendet die bestehende Persistenz-Infrastruktur 1:1 (`loadDailyEvaluatorLearningState`,
 * bereits crash-sicher: fehlende/leere/kaputte Datei → `emptyDailyEvaluatorLearningState()`).
 * Diese Bridge ergänzt nur die Übersetzung der beiden für Block B fachlich passenden
 * Metriken (`thermalPriceTimingScore`, `batteryReserveAccuracyPct`) in ein primitives,
 * von Block-A-Typen entkoppeltes Format für die Planner-Domains.
 */

import { DAILY_EVALUATOR_STATE_CATEGORY } from "../../learning/daily_evaluator/constants";
import { loadDailyEvaluatorLearningState } from "../../learning/daily_evaluator/persist";
import type { LearningMetric } from "../../learning/daily_evaluator/types";

export type BlockALearningMetricSnapshot = {
	value: number | null;
	sampleCount: number | null;
	confidencePct: number | null;
};

export type BlockALearningSnapshot = {
	/** Rückblick-Score früherer preis-/PV-getimter Heizstab-Entscheidungen (0..100). */
	thermalPriceTimingScore: BlockALearningMetricSnapshot;
	/** Anteil (%) bisheriger Reserve-Checks, bei denen die Reserve tatsächlich gehalten wurde. */
	batteryReserveAccuracyPct: BlockALearningMetricSnapshot;
	/** null = kein Block-A-Learning-State lesbar (fehlt/Host ohne Pfad-Unterstützung/kaputt). */
	updatedAtIso: string | null;
};

export type BlockALearningHost = {
	getAbsolutePath?: (category?: string) => string;
};

function emptySnapshot(): BlockALearningMetricSnapshot {
	return { value: null, sampleCount: null, confidencePct: null };
}

function toSnapshot(metric: LearningMetric | null | undefined): BlockALearningMetricSnapshot {
	if (!metric) return emptySnapshot();
	return { value: metric.value, sampleCount: metric.sampleCount, confidencePct: metric.confidence };
}

function emptyBlockALearningSnapshot(): BlockALearningSnapshot {
	return {
		thermalPriceTimingScore: emptySnapshot(),
		batteryReserveAccuracyPct: emptySnapshot(),
		updatedAtIso: null,
	};
}

/**
 * Lädt den Block-A-Learning-State read-only. Sicherer Fallback (leere Snapshot-Struktur,
 * kein Crash) bei fehlendem Host-Support, fehlender/leerer/beschädigter Datei — entspricht
 * exakt "Learning-State fehlt/beschädigt → Baseline" für alle Aufrufer dieser Bridge.
 */
export async function loadBlockALearningSnapshot(
	host: BlockALearningHost,
): Promise<BlockALearningSnapshot> {
	try {
		if (typeof host.getAbsolutePath !== "function") {
			return emptyBlockALearningSnapshot();
		}
		const stateDir = host.getAbsolutePath(DAILY_EVALUATOR_STATE_CATEGORY);
		const state = await loadDailyEvaluatorLearningState(stateDir);
		return {
			thermalPriceTimingScore: toSnapshot(state.thermalPriceTimingScore),
			batteryReserveAccuracyPct: toSnapshot(state.batteryReserveAccuracyPct),
			updatedAtIso: state.updatedAtIso ?? null,
		};
	} catch {
		return emptyBlockALearningSnapshot();
	}
}
