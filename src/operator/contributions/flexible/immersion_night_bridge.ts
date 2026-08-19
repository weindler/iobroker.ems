import { addDaysToDateKey, isoAtTimezoneLocal, localDateKeyInTimezone } from "../../time";
import { round3 } from "./types";

const MS_PER_HOUR = 3600_000;
/** Morgenstunde Ortszeit, bis zu der die Nacht ohne Nachheizen reichen soll. */
export const IMMERSION_NIGHT_BRIDGE_MORNING_HOUR = 8;
/** Zusätzliche Abkühlungsstunden als Sicherheitspuffer. */
export const IMMERSION_NIGHT_BRIDGE_SAFETY_HOURS = 1;

export interface ImmersionNightBridgeInput {
	now: Date;
	bufferTempC: number;
	planningMinTempC: number;
	planningMaxTempC: number;
	forecastTargetTempC: number;
	coolingRateCPerHAvg: number;
	estimatedEmptyAtIso: string;
	timezone?: string;
	bridgeMorningHour?: number;
	safetyHours?: number;
}

export interface ImmersionNightBridgeResult {
	active: boolean;
	bridgeUntilIso: string | null;
	emptyAtIso: string | null;
	shortfallHours: number | null;
	bridgeTargetTempC: number | null;
	/** max(Forecast-Ziel, Bridge-Ziel) — Effektivziel für Energiebedarf. */
	effectiveTargetTempC: number;
	/** Deadline für Allocation: gelernte Leerzeit (PV-first vor der Nacht). */
	deadlineIso: string | null;
	reasonDe: string;
}

function clampTemp(minC: number, maxC: number, t: number): number {
	return Math.min(maxC, Math.max(minC, t));
}

/**
 * Nächster Ortszeit-Morgen (bridgeMorningHour:00). Liegt die Uhrzeit noch davor, gilt heute, sonst morgen.
 */
export function nextBridgeUntilIso(
	now: Date,
	timezone: string,
	bridgeMorningHour = IMMERSION_NIGHT_BRIDGE_MORNING_HOUR,
): string {
	const tz = timezone.trim() || "Europe/Berlin";
	const hour = Math.max(0, Math.min(23, Math.floor(bridgeMorningHour)));
	const todayKey = localDateKeyInTimezone(now, tz);
	const todayBridge = isoAtTimezoneLocal(todayKey, hour, 0, tz);
	if (Date.parse(todayBridge) > now.getTime()) return todayBridge;
	return isoAtTimezoneLocal(addDaysToDateKey(todayKey, 1), hour, 0, tz);
}

/**
 * Thermal Learning → Nachtbrücke: Wenn `estimated_empty_at` vor dem nächsten Morgen liegt,
 * Zieltemperatur so anheben, dass die Nacht ohne Netz/Batterie-Nachheizen durchsteht, und
 * Deadline = empty_at setzen (Allocation: PV-Surplus vor der Deadline, Soft-Rest danach).
 */
export function resolveImmersionNightBridge(input: ImmersionNightBridgeInput): ImmersionNightBridgeResult {
	const forecast = input.forecastTargetTempC;
	const inactive = (reasonDe: string): ImmersionNightBridgeResult => ({
		active: false,
		bridgeUntilIso: null,
		emptyAtIso: null,
		shortfallHours: null,
		bridgeTargetTempC: null,
		effectiveTargetTempC: forecast,
		deadlineIso: null,
		reasonDe,
	});

	if (!(input.coolingRateCPerHAvg > 0) || !Number.isFinite(input.coolingRateCPerHAvg)) {
		return inactive("Keine belastbare Abkühlrate — keine Nachtbrücke.");
	}
	const emptyMs = Date.parse(input.estimatedEmptyAtIso);
	if (!Number.isFinite(emptyMs)) {
		return inactive("estimated_empty_at ungültig — keine Nachtbrücke.");
	}

	const tz = input.timezone?.trim() || "Europe/Berlin";
	const morningHour = input.bridgeMorningHour ?? IMMERSION_NIGHT_BRIDGE_MORNING_HOUR;
	const safetyHours = input.safetyHours ?? IMMERSION_NIGHT_BRIDGE_SAFETY_HOURS;
	const bridgeUntilIso = nextBridgeUntilIso(input.now, tz, morningHour);
	const bridgeMs = Date.parse(bridgeUntilIso);
	if (!Number.isFinite(bridgeMs) || bridgeMs <= input.now.getTime()) {
		return inactive("Bridge-Morgen ungültig — keine Nachtbrücke.");
	}

	const emptyAtIso = new Date(emptyMs).toISOString();
	if (emptyMs >= bridgeMs) {
		return {
			...inactive(
				`Learning: reicht voraussichtlich bis nach ${bridgeUntilIso} — keine Nachtbrücke nötig.`,
			),
			bridgeUntilIso,
			emptyAtIso,
		};
	}

	const shortfallHours = round3((bridgeMs - emptyMs) / MS_PER_HOUR + Math.max(0, safetyHours));
	const extraTempC = round3(input.coolingRateCPerHAvg * shortfallHours);
	const bridgeTargetTempC = round3(
		clampTemp(
			input.planningMinTempC,
			input.planningMaxTempC,
			input.bufferTempC + extraTempC,
		),
	);
	const effectiveTargetTempC = round3(
		clampTemp(
			input.planningMinTempC,
			input.planningMaxTempC,
			Math.max(forecast, bridgeTargetTempC),
		),
	);

	if (bridgeTargetTempC <= input.bufferTempC + 0.05) {
		return {
			active: false,
			bridgeUntilIso,
			emptyAtIso,
			shortfallHours,
			bridgeTargetTempC,
			effectiveTargetTempC: forecast,
			deadlineIso: null,
			reasonDe: "Nachtbrücke: Boiler reicht rechnerisch — kein Zusatzheizen.",
		};
	}

	return {
		active: true,
		bridgeUntilIso,
		emptyAtIso,
		shortfallHours,
		bridgeTargetTempC,
		effectiveTargetTempC,
		deadlineIso: emptyAtIso,
		reasonDe:
			`Nachtbrücke: Learning leer ca. ${emptyAtIso}, Nacht bis ${bridgeUntilIso} ` +
			`(~${shortfallHours.toFixed(1)} h Defizit) — Ziel ≥ ${bridgeTargetTempC} °C aus PV vor der Deadline.`,
	};
}
