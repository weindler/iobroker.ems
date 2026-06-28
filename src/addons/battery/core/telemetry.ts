import { isValidCapacityKwh } from "./capacity";
import type {
	BatteryOperatingMode,
	BatteryTelemetry,
	BatteryTelemetryQuality,
	PowerSignConvention,
} from "./types";

/** Maximal zulässiges Telemetriealter (ms), bevor Werte als stale gelten. */
export const DEFAULT_TELEMETRY_MAX_AGE_MS = 120_000;

export interface RawBatteryReading {
	socPct: number | null;
	/** Signierte Batterieleistung in Hersteller-Konvention (vor Normalisierung). */
	powerW: number | null;
	/** Optional getrennte (immer positive) Lade-/Entladeleistung. */
	chargingPowerW?: number | null;
	dischargingPowerW?: number | null;
	capacityNetKwh: number | null;
	operatingMode: BatteryOperatingMode;
	online: boolean | null;
	updatedAtMs: number | null;
}

export interface NormalizeTelemetryInput {
	reading: RawBatteryReading;
	signConvention: PowerSignConvention;
	nowMs: number;
	maxAgeMs?: number;
	/** Welche Werte für die aktuelle Aktion zwingend nötig sind. */
	requiredValues?: Array<"soc" | "power" | "capacity" | "mode">;
}

function validNum(v: number | null | undefined): v is number {
	return typeof v === "number" && Number.isFinite(v);
}

/**
 * EMS-Normalisierung: positive Leistung = Laden, negative = Entladen.
 * Getrennte Lade-/Entladeleistung sind normalisiert immer >= 0.
 */
export function normalizeBatteryPower(
	powerW: number | null,
	signConvention: PowerSignConvention,
): { powerW: number | null; chargingPowerW: number | null; dischargingPowerW: number | null } {
	if (!validNum(powerW)) {
		return { powerW: null, chargingPowerW: null, dischargingPowerW: null };
	}
	const normalized = signConvention === "positive_discharge" ? -powerW : powerW;
	const charging = normalized > 0 ? normalized : 0;
	const discharging = normalized < 0 ? -normalized : 0;
	return { powerW: normalized, chargingPowerW: charging, dischargingPowerW: discharging };
}

export function normalizeTelemetry(
	input: NormalizeTelemetryInput,
): { telemetry: BatteryTelemetry; quality: BatteryTelemetryQuality } {
	const { reading, signConvention, nowMs } = input;
	const maxAgeMs = input.maxAgeMs ?? DEFAULT_TELEMETRY_MAX_AGE_MS;
	const required = input.requiredValues ?? [];

	const power = normalizeBatteryPower(reading.powerW, signConvention);

	// Getrennte Hersteller-Lade-/Entladewerte haben Vorrang, falls vorhanden.
	const chargingPowerW = validNum(reading.chargingPowerW)
		? Math.abs(reading.chargingPowerW)
		: power.chargingPowerW;
	const dischargingPowerW = validNum(reading.dischargingPowerW)
		? Math.abs(reading.dischargingPowerW)
		: power.dischargingPowerW;

	const socValid = validNum(reading.socPct) && reading.socPct >= 0 && reading.socPct <= 100;
	const powerValid = power.powerW !== null;
	const capacityValid = isValidCapacityKwh(reading.capacityNetKwh);
	const modeValid = reading.operatingMode !== "unknown";

	const ageMs = reading.updatedAtMs !== null ? nowMs - reading.updatedAtMs : null;
	const stale = ageMs === null ? true : ageMs > maxAgeMs;

	const missingRequiredValues: string[] = [];
	if (required.includes("soc") && !socValid) missingRequiredValues.push("soc");
	if (required.includes("power") && !powerValid) missingRequiredValues.push("power");
	if (required.includes("capacity") && !capacityValid) missingRequiredValues.push("capacity");
	if (required.includes("mode") && !modeValid) missingRequiredValues.push("mode");

	const valid = socValid || powerValid;

	const telemetry: BatteryTelemetry = {
		socPct: socValid ? reading.socPct : null,
		powerW: power.powerW,
		chargingPowerW,
		dischargingPowerW,
		capacityNetKwh: capacityValid ? reading.capacityNetKwh : null,
		operatingMode: reading.operatingMode,
		online: reading.online,
		updatedAt: reading.updatedAtMs !== null ? new Date(reading.updatedAtMs).toISOString() : null,
		valid,
		stale,
	};

	const quality: BatteryTelemetryQuality = {
		socValid,
		powerValid,
		capacityValid,
		modeValid,
		stale,
		lastValidTelemetryAt: valid && !stale ? telemetry.updatedAt : null,
		missingRequiredValues,
	};

	return { telemetry, quality };
}
