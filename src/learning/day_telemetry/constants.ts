/** Tages-Telemetrie Phase 1 — Konstanten. */

export const DAY_TELEMETRY_MODULE = "day_telemetry" as const;
export const DAY_TELEMETRY_SCHEMA = 1 as const;
export const DAY_TELEMETRY_PERSIST_FILE = "day_telemetry_v1.json";
export const DAY_TELEMETRY_CATEGORY = "learning/day_telemetry";
export const DAY_TELEMETRY_RETENTION_DAYS = 90;

/** 15-Minuten-Slotbreite (ms). */
export const DAY_TELEMETRY_SLOT_MS = 15 * 60 * 1000;

/**
 * Max. Integrationsspanne ohne Lücken-Markierung.
 * Längere Gaps → betroffene Domänen missing, keine erfundene Konstantleistung.
 */
export const DAY_TELEMETRY_MAX_GAP_MS = 10 * 60 * 1000;

/** Persistenz-Rundung (Wh-genau → 0.001 kWh), erst nach Akkumulation. */
export const DAY_TELEMETRY_KWH_DECIMALS = 6;

export const DAY_TELEMETRY_STATES = {
	status: "learning.day_telemetry.status",
	lastSlotWrittenAt: "learning.day_telemetry.last_slot_written_at",
	recoveryPending: "learning.day_telemetry.recovery_pending",
} as const;
