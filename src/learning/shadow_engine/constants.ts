/**
 * PHASE 5 — Counterfactual / Shadow Engine.
 *
 * Deterministische Simulation "was wäre ohne diese EMS-Strategie passiert" —
 * getrennte Kategorie von day_telemetry (support_only/rebuildable aus Telemetrie,
 * genau wie learning/daily_evaluator/scores).
 */

export const SHADOW_ENGINE_MODULE = "shadow_engine" as const;
export const SHADOW_ENGINE_SCHEMA_VERSION = 1 as const;

export const SHADOW_ENGINE_RESULTS_CATEGORY = "learning/shadow_engine/results";
export const SHADOW_ENGINE_STATE_CATEGORY = "learning/shadow_engine";

/** Gleiche Retention wie day_telemetry — Shadow-Ergebnisse sind aus Telemetrie rebuildbar. */
export const SHADOW_ENGINE_RETENTION_DAYS = 90;

/** Versionierte Modellkennung für Reproduzierbarkeit (siehe Roadmap: "versioniert, reproduzierbar"). */
export const SHADOW_ENGINE_MODEL_VERSION = "shadow_v3";

/** Batterie-Hardware-Fallback-Grenzen, falls Admin-Konfiguration unvollständig ist. */
export const SHADOW_BATTERY_MIN_SOC_FALLBACK_PCT = 5;
export const SHADOW_BATTERY_MAX_SOC_FALLBACK_PCT = 100;

/** Ein Shadow-Tagesergebnis gilt nur als "evaluable", wenn nicht mehr als dieser Anteil der Slots fehlt. */
export const SHADOW_MAX_MISSING_SLOT_FRACTION = 0.1;
