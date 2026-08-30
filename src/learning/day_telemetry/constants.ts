/** Tages-Telemetrie Phase 1 — Konstanten. */

export const DAY_TELEMETRY_MODULE = "day_telemetry" as const;
/** Schema 2: Tagesdateien + Coverage-Metadaten; qualityMask null = unobserved. */
export const DAY_TELEMETRY_SCHEMA = 2 as const;
/** Legacy-Monolith (Schema 1) — nur noch für Einmalmigration. */
export const DAY_TELEMETRY_LEGACY_MONOLITH_FILE = "day_telemetry_v1.json";
export const DAY_TELEMETRY_MONOLITH_MIGRATED_MARKER = ".monolith_migrated_v2";
export const DAY_TELEMETRY_CATEGORY = "learning/day_telemetry";
export const DAY_TELEMETRY_RETENTION_DAYS = 90;

/** @deprecated Alias — Monolith-Dateiname für Migration/Inventar. */
export const DAY_TELEMETRY_PERSIST_FILE = DAY_TELEMETRY_LEGACY_MONOLITH_FILE;

/** 15-Minuten-Slotbreite (ms). */
export const DAY_TELEMETRY_SLOT_MS = 15 * 60 * 1000;

/**
 * Max. Integrationsspanne ohne Lücken-Markierung.
 * Längere Gaps → betroffene Domänen missing, keine erfundene Konstantleistung.
 */
export const DAY_TELEMETRY_MAX_GAP_MS = 10 * 60 * 1000;

/** Persistenz-Rundung (Wh-genau → 0.001 kWh), erst nach Akkumulation. */
export const DAY_TELEMETRY_KWH_DECIMALS = 6;

/**
 * Ab diesem Coverage-Anteil (%) gilt der Tag als evaluable für Phase 2.
 * complete (Kalender) bleibt davon unabhängig.
 */
export const DAY_TELEMETRY_EVALUABLE_COVERAGE_PCT = 80;

export const DAY_TELEMETRY_STATES = {
	status: "learning.day_telemetry.status",
	lastSlotWrittenAt: "learning.day_telemetry.last_slot_written_at",
	recoveryPending: "learning.day_telemetry.recovery_pending",
} as const;
