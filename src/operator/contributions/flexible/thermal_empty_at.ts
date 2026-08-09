/**
 * A1: Wann estimated_empty_at planungswirksam ist.
 * Cycle-Learning (Abkühlzyklen) und Newton-Schätzung bleiben semantisch getrennt:
 * - status "valid" nur bei genug Zyklen
 * - Newton darf trotzdem Deadline/empty_at treiben, ohne "cycle-valid" zu behaupten
 */

import type { ThermalLearningSignal } from "./thermal_learning";

/** Abgeschlossene Peak→Floor-Zyklen mit positiver linearer Rate. */
export function hasCycleCoolingModel(learning: ThermalLearningSignal | null | undefined): boolean {
	return (
		!!learning &&
		learning.coolingRateCPerHAvg !== null &&
		learning.coolingRateCPerHAvg > 0 &&
		(learning.samples ?? 0) > 0
	);
}

/** Newton-k + zukünftige empty_at (auch bei samples=0). */
export function hasNewtonEmptyAtModel(learning: ThermalLearningSignal | null | undefined): boolean {
	return (
		!!learning &&
		!!learning.estimatedEmptyAt &&
		learning.coolingConstantPerH !== null &&
		learning.coolingConstantPerH > 0
	);
}

/**
 * Planning darf empty_at nutzen bei valid|degraded wenn Cycle-Rate oder Newton-Modell trägt.
 * status bleibt degraded bei samples&lt;3 — kein falsches „valid cycles“.
 */
export function thermalEmptyAtUsableForPlanning(
	learning: ThermalLearningSignal | null | undefined,
): boolean {
	if (!learning?.estimatedEmptyAt) return false;
	if (learning.status !== "valid" && learning.status !== "degraded") return false;
	if (learning.coolingRateCPerHAvg !== null && learning.coolingRateCPerHAvg > 0) return true;
	return hasNewtonEmptyAtModel(learning);
}

/** Kurzer Diagnose-Code für Briefing/Details. */
export function thermalLearningDegradedCauseDe(
	learning: ThermalLearningSignal | null | undefined,
): string | null {
	if (!learning || learning.status !== "degraded") return null;
	const samples = learning.samples ?? 0;
	if (hasNewtonEmptyAtModel(learning) && !hasCycleCoolingModel(learning)) {
		return `thermal learning usable only via Newton estimate, ${samples} completed cooling cycles`;
	}
	if (samples > 0 && samples < 3) {
		return `thermal learning few cooling cycles (${samples}), limited confidence`;
	}
	return `thermal learning degraded (${samples} cycles)`;
}
