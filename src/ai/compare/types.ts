/**
 * Plan-Vergleich (Plan A = deterministisch, Plan B = KI-gewichtete Simulation).
 *
 * Beta (Schritt 7 Final Gate): Plan B ist advisory/comparison. Live-Authority ist ausschließlich
 * der Unified Planner. `src/ai/writeback/` schreibt Compare-States, mutiert aber keine
 * Allocations/Slices. Simulation darf weiterhin zeigen, wie flexible Energiemengen zeitlich
 * verschoben würden — nie Batterie-Entladen, nie Geräte-Writes. `defer_tomorrow` darf
 * flexible Heizstabenergie unverteilt lassen (nicht als erfüllt verbuchen).
 */

export interface ComparePlanPoint {
	/** ISO-Start des 15-Minuten-Slots. */
	t: string;
	/** Gesamter PV-Anteil aller Allokationen in diesem Slot (W). */
	pvW: number;
	/** Gesamter Netzbezugs-Anteil aller Allokationen in diesem Slot (W). */
	gridW: number;
	/** Flexible Heizstab-Leistung in diesem Slot (W). */
	ihW: number;
	/** Klimaanlagen-Leistung in diesem Slot (W). */
	acW: number;
	/** Batterie-Ladeleistung (nur charge) in diesem Slot (W). */
	batW: number;
	/** Wallbox-Ladeleistung in diesem Slot (W). */
	wbW: number;
	priceCt: number | null;
}

export interface ComparePlanTotals {
	costCt: number;
	pvKwh: number;
	gridKwh: number;
	unallocatedKwh: number | null;
	ihKwh: number;
	acKwh: number;
	batKwh: number;
	wbKwh: number;
}

export interface CompareDeltaSummary {
	planA: ComparePlanTotals;
	planB: ComparePlanTotals;
	/** planB.costCt - planA.costCt — negativ bedeutet Plan B rechnerisch günstiger. */
	deltaCostCt: number;
	activePlan: "a" | "b";
	decisionReasonDe: string;
	/** Governance-IDs, die für den Vergleich tatsächlich KI-gewichtet wurden (leer = kein Add-on freigegeben). */
	aiInvolvedAddonIds: string[];
}

export interface CompareResult {
	generatedAt: string;
	planRevision: number;
	chartA: ComparePlanPoint[];
	chartB: ComparePlanPoint[];
	delta: CompareDeltaSummary;
}
