/** Rein messender Verbraucherblock — EMS schaltet diese Geräte niemals (nur Anzeige/Statistik/Learning-Vorbereitung). */
export const MEASURED_CONSUMERS_ADDON_ID = "measured_consumers";

/** Feste Admin-Kapazität; intern generisch als Liste verarbeitet. */
export const MEASURED_CONSUMERS_SLOT_COUNT = 20;

/** Admin-Config-Key der Tabelle (Präfix `ems_` ist in der Backup-Allowlist enthalten). */
export const MEASURED_CONSUMERS_CONFIG_KEY = "ems_measured_consumers_map";

export const MEASURED_CONSUMERS_TICK_MS = 20_000;

/**
 * Maximale Zeitdifferenz (Sekunden) für die Leistungs→Energie-Integration (Fall B).
 * Größere Lücken (z. B. Adapter-Neustart, State länger offline) werden NICHT
 * nachintegriert, um Phantomverbräuche zu vermeiden — die Lücke zählt als 0 kWh.
 */
export const MEASURED_CONSUMERS_MAX_POWER_INTEGRATION_DT_SEC = 300;

/** Retention der Tages-Map je Verbraucher (Tage) — deckt aktuelles + letztes Jahr sicher ab. */
export const MEASURED_CONSUMERS_DAY_RETENTION_DAYS = 400;

/** Bereits gemessener Gesamt-Hausverbrauch (W) — nur lesend, niemals erhöht. */
export const MEASURED_CONSUMERS_HOUSE_LOAD_STATE_ID = "live.battery.house_load_w";
