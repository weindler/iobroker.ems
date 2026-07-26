/**
 * Plan-Vergleich (Plan A = deterministisch, Plan B = KI-gewichtete Simulation).
 *
 * Roadmap Block 6: Wenn Plan B messbar gewinnt (Kosten/PV/Netz), schreibt `src/ai/writeback/`
 * die umverteilte Allocation in den Daily Plan (nie direkt auf Geräte). Sonst bleibt Plan A
 * und Auto-KI wird gesperrt. Plan B verschiebt nur den Zeitpunkt der von Plan A vorgesehenen
 * flexiblen Energiemenge für Heizstab/Klima — nie mehr Gesamtenergie.
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
	priceCt: number | null;
}

export interface ComparePlanTotals {
	costCt: number;
	pvKwh: number;
	gridKwh: number;
	unallocatedKwh: number | null;
	ihKwh: number;
	acKwh: number;
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
