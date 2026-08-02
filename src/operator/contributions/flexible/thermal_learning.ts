import { dayTypeFromWeekday, weekdayFromDate } from "../../../learning/house_load/time";
import { MIN_CYCLES_OK } from "../../../learning/thermal_runtime/constants";
import { liveRemainingHoursFromEmptyAt } from "../../../learning/thermal_runtime/math";
import { formatLocalDateTimeDe } from "../../time";

/**
 * Gelernter Thermik-Signal-Zustand für den Heizstab (`learning.thermal_runtime.*`).
 * Nie erfundene Werte — ohne belastbares Lernmodell bleibt `status: "missing"`
 * und alle abgeleiteten Felder `null` (Fallback bleibt die bestehende Physik-Schätzung).
 */
export interface ThermalLearningSignal {
	status: "valid" | "degraded" | "missing";
	health: string | null;
	samples: number | null;
	coolingRateCPerHAvg: number | null;
	coolingConstantPerH: number | null;
	coolingAsymptoteC: number | null;
	estimatedRemainingHours: number | null;
	estimatedEmptyAt: string | null;
	currentDayTypeRuntimeHoursMedian: number | null;
	reasonDe: string;
}

interface ThermalRuntimeByDayTypeGroup {
	samples?: number;
	runtime_hours_median?: number | null;
}

function parseByDayTypeJson(raw: string | null): Record<string, ThermalRuntimeByDayTypeGroup> | null {
	if (!raw) return null;
	try {
		const parsed = JSON.parse(raw);
		if (parsed && typeof parsed === "object") return parsed as Record<string, ThermalRuntimeByDayTypeGroup>;
	} catch {
		// ignore
	}
	return null;
}

/**
 * `status`/`health` kommen direkt aus `runThermalRuntimeLearning` (`src/learning/thermal_runtime/run.ts`).
 * `ready`+`ok` → valid nur mit genug Zyklen (`MIN_CYCLES_OK`). Newton-Fit ohne Historie
 * (`samples: 0`) darf keine Deadline treiben. `insufficient_data` / wenige Samples → degraded.
 * Alles andere (kein Source, deaktiviert, ungültige Config, Fehler) → missing.
 */
function deriveStatus(
	rawStatus: string | null,
	rawHealth: string | null,
	samples: number | null,
): ThermalLearningSignal["status"] {
	const n = samples !== null && Number.isFinite(samples) ? samples : 0;
	if (rawStatus === "ready" && rawHealth === "ok") {
		return n >= MIN_CYCLES_OK ? "valid" : "degraded";
	}
	if (rawStatus === "ready" && rawHealth === "degraded") return "degraded";
	if (rawStatus === "insufficient_data") return "degraded";
	return "missing";
}

function reasonDeForStatus(
	status: ThermalLearningSignal["status"],
	samples: number | null,
	estimatedEmptyAt: string | null,
	timezone: string,
): string {
	if (status === "valid") {
		const local =
			estimatedEmptyAt !== null ? formatLocalDateTimeDe(estimatedEmptyAt, timezone) : null;
		return local
			? `Thermal-Runtime-Learning aktiv (${samples ?? 0} Zyklen) — Puffer voraussichtlich leer um ${local}.`
			: `Thermal-Runtime-Learning aktiv (${samples ?? 0} Zyklen).`;
	}
	if (status === "degraded") {
		return `Thermal-Runtime-Learning mit wenigen Zyklen (${samples ?? 0}) — eingeschränkt belastbar.`;
	}
	return "Thermal-Runtime-Learning ohne belastbares Modell — Fallback auf Physik-Schätzung.";
}

export function buildThermalLearningSignal(input: {
	now: Date;
	rawStatus: string | null;
	rawHealth: string | null;
	samples: number | null;
	coolingRateCPerHAvg: number | null;
	coolingConstantPerH: number | null;
	coolingAsymptoteC: number | null;
	estimatedRemainingHours: number | null;
	estimatedEmptyAtRaw: string | null;
	byDayTypeJsonRaw: string | null;
	/** Für Ortszeit in reasonDe — Default Europe/Berlin. */
	timezone?: string;
}): ThermalLearningSignal {
	const status = deriveStatus(input.rawStatus, input.rawHealth, input.samples);
	const timezone = input.timezone?.trim() || "Europe/Berlin";

	let estimatedEmptyAt: string | null = null;
	if (input.estimatedEmptyAtRaw) {
		const ms = Date.parse(input.estimatedEmptyAtRaw);
		if (Number.isFinite(ms) && ms > input.now.getTime()) {
			estimatedEmptyAt = new Date(ms).toISOString();
		}
	}

	// Reststunden immer live aus empty_at — der State-Snapshot altert zwischen Learning-Läufen.
	const liveRemaining = liveRemainingHoursFromEmptyAt(estimatedEmptyAt, input.now);
	const estimatedRemainingHours =
		liveRemaining !== null
			? liveRemaining
			: estimatedEmptyAt === null && input.estimatedEmptyAtRaw
				? 0 // empty_at in der Vergangenheit / verworfen
				: input.estimatedRemainingHours;

	const byDayType = parseByDayTypeJson(input.byDayTypeJsonRaw);
	const currentDayType = dayTypeFromWeekday(weekdayFromDate(input.now));
	const currentGroup = byDayType?.[currentDayType];
	const currentDayTypeRuntimeHoursMedian =
		typeof currentGroup?.runtime_hours_median === "number" && Number.isFinite(currentGroup.runtime_hours_median)
			? currentGroup.runtime_hours_median
			: null;

	if (status === "missing") {
		return {
			status,
			health: input.rawHealth,
			samples: input.samples,
			coolingRateCPerHAvg: null,
			coolingConstantPerH: null,
			coolingAsymptoteC: null,
			estimatedRemainingHours: null,
			estimatedEmptyAt: null,
			currentDayTypeRuntimeHoursMedian: null,
			reasonDe: reasonDeForStatus(status, input.samples, null, timezone),
		};
	}

	return {
		status,
		health: input.rawHealth,
		samples: input.samples,
		coolingRateCPerHAvg: input.coolingRateCPerHAvg,
		coolingConstantPerH: input.coolingConstantPerH,
		coolingAsymptoteC: input.coolingAsymptoteC,
		estimatedRemainingHours,
		estimatedEmptyAt,
		currentDayTypeRuntimeHoursMedian,
		reasonDe: reasonDeForStatus(status, input.samples, estimatedEmptyAt, timezone),
	};
}
