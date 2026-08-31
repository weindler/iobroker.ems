"use strict";
/**
 * PHASE 5 — Counterfactual / Shadow Engine.
 *
 * Deterministische Simulation "was wäre ohne diese EMS-Strategie passiert" —
 * getrennte Kategorie von day_telemetry (support_only/rebuildable aus Telemetrie,
 * genau wie learning/daily_evaluator/scores).
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.SHADOW_MAX_MISSING_SLOT_FRACTION = exports.SHADOW_BATTERY_MAX_SOC_FALLBACK_PCT = exports.SHADOW_BATTERY_MIN_SOC_FALLBACK_PCT = exports.SHADOW_ENGINE_MODEL_VERSION = exports.SHADOW_ENGINE_RETENTION_DAYS = exports.SHADOW_ENGINE_STATE_CATEGORY = exports.SHADOW_ENGINE_RESULTS_CATEGORY = exports.SHADOW_ENGINE_SCHEMA_VERSION = exports.SHADOW_ENGINE_MODULE = void 0;
exports.SHADOW_ENGINE_MODULE = "shadow_engine";
exports.SHADOW_ENGINE_SCHEMA_VERSION = 1;
exports.SHADOW_ENGINE_RESULTS_CATEGORY = "learning/shadow_engine/results";
exports.SHADOW_ENGINE_STATE_CATEGORY = "learning/shadow_engine";
/** Gleiche Retention wie day_telemetry — Shadow-Ergebnisse sind aus Telemetrie rebuildbar. */
exports.SHADOW_ENGINE_RETENTION_DAYS = 90;
/** Versionierte Modellkennung für Reproduzierbarkeit (siehe Roadmap: "versioniert, reproduzierbar"). */
exports.SHADOW_ENGINE_MODEL_VERSION = "shadow_v2";
/** Batterie-Hardware-Fallback-Grenzen, falls Admin-Konfiguration unvollständig ist. */
exports.SHADOW_BATTERY_MIN_SOC_FALLBACK_PCT = 5;
exports.SHADOW_BATTERY_MAX_SOC_FALLBACK_PCT = 100;
/** Ein Shadow-Tagesergebnis gilt nur als "evaluable", wenn nicht mehr als dieser Anteil der Slots fehlt. */
exports.SHADOW_MAX_MISSING_SLOT_FRACTION = 0.1;
