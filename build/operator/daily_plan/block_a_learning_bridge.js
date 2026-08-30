"use strict";
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.loadBlockALearningSnapshot = void 0;
const constants_1 = require("../../learning/daily_evaluator/constants");
const persist_1 = require("../../learning/daily_evaluator/persist");
function emptySnapshot() {
    return { value: null, sampleCount: null, confidencePct: null };
}
function toSnapshot(metric) {
    if (!metric)
        return emptySnapshot();
    return { value: metric.value, sampleCount: metric.sampleCount, confidencePct: metric.confidence };
}
function emptyBlockALearningSnapshot() {
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
async function loadBlockALearningSnapshot(host) {
    try {
        if (typeof host.getAbsolutePath !== "function") {
            return emptyBlockALearningSnapshot();
        }
        const stateDir = host.getAbsolutePath(constants_1.DAILY_EVALUATOR_STATE_CATEGORY);
        const state = await (0, persist_1.loadDailyEvaluatorLearningState)(stateDir);
        return {
            thermalPriceTimingScore: toSnapshot(state.thermalPriceTimingScore),
            batteryReserveAccuracyPct: toSnapshot(state.batteryReserveAccuracyPct),
            updatedAtIso: state.updatedAtIso ?? null,
        };
    }
    catch {
        return emptyBlockALearningSnapshot();
    }
}
exports.loadBlockALearningSnapshot = loadBlockALearningSnapshot;
