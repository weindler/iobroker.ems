/**
 * Gelernter Batterie-Runtime-Zustand (`learning.battery_runtime.*`) für die Batterie-Contribution.
 * Nie erfundene Werte — ohne belastbares Lernmodell bleibt `status: "missing"` und alle
 * abgeleiteten Felder `null` (Fallback: bestehende Policy-/Intent-Logik, unverändert).
 */
export interface BatteryLearningSignal {
	status: "valid" | "degraded" | "missing";
	sampleDays: number | null;
	avgNightDischargeKwh: number | null;
	avgChargePowerW: number | null;
	maxChargePowerW: number | null;
	topoffDue: boolean | null;
	topoffDaysRemaining: number | null;
	estimatedRuntimeDays: number | null;
	reasonDe: string;
}

/**
 * `status` kommt direkt aus `runBatteryRuntimeLearning` (`src/learning/battery_runtime/run.ts`).
 * `ready` → valid. `insufficient_data`/`partial` → degraded (nutzbar, aber wenig Historie).
 * `no_source`/`disabled`/`error`/unbekannt → missing.
 */
function deriveStatus(rawStatus: string | null): BatteryLearningSignal["status"] {
	if (rawStatus === "ready") return "valid";
	if (rawStatus === "insufficient_data" || rawStatus === "partial") return "degraded";
	return "missing";
}

function reasonDeForStatus(status: BatteryLearningSignal["status"], sampleDays: number | null): string {
	if (status === "valid") return `Battery-Runtime-Learning aktiv (${sampleDays ?? 0} Tage Historie).`;
	if (status === "degraded") return `Battery-Runtime-Learning mit wenig Historie (${sampleDays ?? 0} Tage).`;
	return "Battery-Runtime-Learning ohne belastbares Modell — Fallback auf bestehende Policy/Intent.";
}

export function buildBatteryLearningSignal(input: {
	rawStatus: string | null;
	sampleDays: number | null;
	avgNightDischargeKwh: number | null;
	avgChargePowerW: number | null;
	maxChargePowerW: number | null;
	topoffDueRaw: number | null;
	topoffDaysRemaining: number | null;
	estimatedRuntimeDays: number | null;
}): BatteryLearningSignal {
	const status = deriveStatus(input.rawStatus);

	if (status === "missing") {
		return {
			status,
			sampleDays: input.sampleDays,
			avgNightDischargeKwh: null,
			avgChargePowerW: null,
			maxChargePowerW: null,
			topoffDue: null,
			topoffDaysRemaining: null,
			estimatedRuntimeDays: null,
			reasonDe: reasonDeForStatus(status, input.sampleDays),
		};
	}

	const topoffDue =
		input.topoffDueRaw === null || input.topoffDueRaw === undefined ? null : input.topoffDueRaw === 1;

	return {
		status,
		sampleDays: input.sampleDays,
		avgNightDischargeKwh: input.avgNightDischargeKwh,
		avgChargePowerW: input.avgChargePowerW,
		maxChargePowerW: input.maxChargePowerW,
		topoffDue,
		topoffDaysRemaining: input.topoffDaysRemaining,
		estimatedRuntimeDays: input.estimatedRuntimeDays,
		reasonDe: reasonDeForStatus(status, input.sampleDays),
	};
}
