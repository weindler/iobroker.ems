import {
	AC_PROFILE_IDS,
	AC_UNIT_COUNT,
	AC_HUMIDITY_OFF_HYSTERESIS_PCT_DEFAULT,
	type AcProfileId,
} from "./constants";
import type { AcGlobalConfig, AcUnitConfig, AcUnitModePurpose } from "./types";

function configRecord(config: unknown): Record<string, unknown> {
	return config && typeof config === "object" ? (config as Record<string, unknown>) : {};
}

function boolField(c: Record<string, unknown>, key: string, def: boolean): boolean {
	const v = c[key];
	if (typeof v === "boolean") return v;
	if (typeof v === "number") return v !== 0;
	const s = String(v ?? "").trim().toLowerCase();
	if (["1", "true", "on", "yes", "ja"].includes(s)) return true;
	if (["0", "false", "off", "no", "nein"].includes(s)) return false;
	return def;
}

function numField(c: Record<string, unknown>, key: string, def: number): number {
	const v = c[key];
	if (v === null || v === undefined || v === "") return def;
	const n = typeof v === "number" ? v : parseFloat(String(v).replace(",", "."));
	return Number.isFinite(n) ? n : def;
}

function strField(c: Record<string, unknown>, key: string, def = ""): string {
	const v = c[key];
	return typeof v === "string" ? v.trim() : v != null ? String(v).trim() : def;
}

function parseProfile(raw: unknown, fallback: AcProfileId): AcProfileId {
	const s = String(raw ?? "").trim().toLowerCase();
	return (AC_PROFILE_IDS as readonly string[]).includes(s) ? (s as AcProfileId) : fallback;
}

function parseOptionalHumidity(c: Record<string, unknown>, key: string): number | null {
	const v = numField(c, key, 0);
	return v > 0 ? v : null;
}

/** Leer = Modus absichtlich aus (cool/dry/heat/fan). */
export function acModeCommandEnabled(mode: string): boolean {
	return mode.trim().length > 0;
}

export function acCleaningAfterPurpose(
	unit: AcUnitConfig,
	purpose: AcUnitModePurpose | null,
): boolean {
	switch (purpose) {
		case "dehumidify":
			return unit.cleaningAfterDehumidify;
		case "heating":
			return unit.cleaningAfterHeating;
		case "cooling":
			return unit.cleaningAfterCooling;
		case "fan_only":
			return false;
		default:
			// Unbekannter Modus (z. B. nach Restart/Abort): keine Auto-Reinigung raten.
			return false;
	}
}

/** Geschätzte elektrische Leistung: Dry ~ Hälfte von Cool (kein separates Admin-Feld). */
export function acEstimatedPowerForPurpose(
	unit: AcUnitConfig,
	purpose: AcUnitModePurpose | null | undefined,
): number {
	const base = unit.estimatedPowerW;
	if (purpose === "dehumidify") {
		return Math.max(0, Math.round(base / 2));
	}
	return base;
}

function effectiveEstimatedPowerW(c: Record<string, unknown>, key: string, def: number): number {
	const n = numField(c, key, def);
	return n > 0 ? n : def;
}

export function acUnitConfigFromAdapter(config: unknown, index: number): AcUnitConfig {
	const c = configRecord(config);
	const p = `ac_u${index}_`;
	const defaultProfile = parseProfile(c.ac_default_profile, "generic");
	const legacyCleaning = boolField(c, `${p}cleaning_after_run`, true);
	const humidityHyst = Math.max(
		0,
		Math.min(30, numField(c, `${p}humidity_off_hysteresis_pct`, AC_HUMIDITY_OFF_HYSTERESIS_PCT_DEFAULT)),
	);
	return {
		index,
		enabled: boolField(c, `${p}enabled`, false),
		name: strField(c, `${p}name`, `Innengerät ${index}`),
		profileId: parseProfile(c[`${p}profile`], defaultProfile),
		onTempC: numField(c, `${p}on_temp_c`, 26),
		offTempC: numField(c, `${p}off_temp_c`, 24),
		maxHumidityPct: parseOptionalHumidity(c, `${p}max_humidity_pct`),
		humidityOffHysteresisPct: humidityHyst,
		coolingSetpointC: numField(c, `${p}cooling_setpoint_c`, 17),
		modeWhenCooling: strField(c, `${p}mode_when_cooling`, "cool"),
		fanModeWhenCooling: strField(c, `${p}fan_mode_when_cooling`, "auto"),
		fanSpeedWhenCooling: strField(c, `${p}fan_speed_when_cooling`, ""),
		modeWhenDehumidify: strField(c, `${p}mode_when_dehumidify`, "dry"),
		fanModeWhenDehumidify: strField(c, `${p}fan_mode_when_dehumidify`, "auto"),
		modeWhenFanOnly: strField(c, `${p}mode_when_fan_only`, "fan"),
		fanModeWhenFanOnly: strField(c, `${p}fan_mode_when_fan_only`, "auto"),
		modeWhenHeating: strField(c, `${p}mode_when_heating`, ""),
		fanModeWhenHeating: strField(c, `${p}fan_mode_when_heating`, "auto"),
		heatSetpointC: null,
		activeFrom: strField(c, `${p}active_from`, "08:00"),
		activeUntil: strField(c, `${p}active_until`, "20:00"),
		hardOffAt: strField(c, `${p}hard_off_at`, "20:00"),
		estimatedPowerW: effectiveEstimatedPowerW(c, `${p}estimated_power_w`, 700),
		cleaningAfterRun: legacyCleaning,
		cleaningAfterCooling: boolField(c, `${p}cleaning_after_cooling`, legacyCleaning),
		cleaningAfterDehumidify: boolField(c, `${p}cleaning_after_dehumidify`, legacyCleaning),
		cleaningAfterHeating: boolField(c, `${p}cleaning_after_heating`, false),
		cleaningDelayMin: Math.max(0, numField(c, `${p}cleaning_delay_min`, 1)),
		cleaningDurationMin: Math.max(0, numField(c, `${p}cleaning_duration_min`, 30)),
		statsEnabled: boolField(c, `${p}stats_enabled`, true),
		statsTrackRuntime: boolField(c, `${p}stats_track_runtime`, true),
		statsTrackEnergy: boolField(c, `${p}stats_track_energy`, true),
		statsRuntimeOffsetSec: Math.max(0, numField(c, `${p}stats_runtime_offset_h`, 0) * 3600),
		statsEnergyOffsetKwh: Math.max(0, numField(c, `${p}stats_energy_offset_kwh`, 0)),
	};
}

export function acGlobalConfigFromAdapter(config: unknown): AcGlobalConfig {
	const c = configRecord(config);
	const units: AcUnitConfig[] = [];
	for (let i = 1; i <= AC_UNIT_COUNT; i++) {
		units.push(acUnitConfigFromAdapter(config, i));
	}
	return {
		outdoorMaxPowerW: Math.max(0, numField(c, "ac_outdoor_max_power_w", 1300)),
		plannerOutdoorLikelyTempC: numField(c, "ac_planner_outdoor_likely_temp_c", 28),
		defaultProfileId: parseProfile(c.ac_default_profile, "generic"),
		units,
	};
}

export function acEnabledUnits(config: AcGlobalConfig): AcUnitConfig[] {
	return config.units.filter((u) => u.enabled);
}
