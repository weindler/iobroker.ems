"use strict";
/** Tages-Telemetrie Phase 1 — Konstanten. */
Object.defineProperty(exports, "__esModule", { value: true });
exports.DAY_TELEMETRY_STATES = exports.DAY_TELEMETRY_EVALUABLE_COVERAGE_PCT = exports.DAY_TELEMETRY_KWH_DECIMALS = exports.DAY_TELEMETRY_MAX_GAP_MS = exports.DAY_TELEMETRY_SLOT_MS = exports.DAY_TELEMETRY_PERSIST_FILE = exports.DAY_TELEMETRY_RETENTION_DAYS = exports.DAY_TELEMETRY_CATEGORY = exports.DAY_TELEMETRY_MONOLITH_MIGRATED_MARKER = exports.DAY_TELEMETRY_LEGACY_MONOLITH_FILE = exports.DAY_TELEMETRY_SCHEMA = exports.DAY_TELEMETRY_MODULE = void 0;
exports.DAY_TELEMETRY_MODULE = "day_telemetry";
/** Schema 2: Tagesdateien + Coverage-Metadaten; qualityMask null = unobserved. */
exports.DAY_TELEMETRY_SCHEMA = 2;
/** Legacy-Monolith (Schema 1) — nur noch für Einmalmigration. */
exports.DAY_TELEMETRY_LEGACY_MONOLITH_FILE = "day_telemetry_v1.json";
exports.DAY_TELEMETRY_MONOLITH_MIGRATED_MARKER = ".monolith_migrated_v2";
exports.DAY_TELEMETRY_CATEGORY = "learning/day_telemetry";
exports.DAY_TELEMETRY_RETENTION_DAYS = 90;
/** @deprecated Alias — Monolith-Dateiname für Migration/Inventar. */
exports.DAY_TELEMETRY_PERSIST_FILE = exports.DAY_TELEMETRY_LEGACY_MONOLITH_FILE;
/** 15-Minuten-Slotbreite (ms). */
exports.DAY_TELEMETRY_SLOT_MS = 15 * 60 * 1000;
/**
 * Max. Integrationsspanne ohne Lücken-Markierung.
 * Längere Gaps → betroffene Domänen missing, keine erfundene Konstantleistung.
 */
exports.DAY_TELEMETRY_MAX_GAP_MS = 10 * 60 * 1000;
/** Persistenz-Rundung (Wh-genau → 0.001 kWh), erst nach Akkumulation. */
exports.DAY_TELEMETRY_KWH_DECIMALS = 6;
/**
 * Ab diesem Coverage-Anteil (%) gilt der Tag als evaluable für Phase 2.
 * complete (Kalender) bleibt davon unabhängig.
 */
exports.DAY_TELEMETRY_EVALUABLE_COVERAGE_PCT = 80;
exports.DAY_TELEMETRY_STATES = {
    status: "learning.day_telemetry.status",
    lastSlotWrittenAt: "learning.day_telemetry.last_slot_written_at",
    recoveryPending: "learning.day_telemetry.recovery_pending",
};
