/**
 * Plan-Vergleich (Plan A = deterministisch, Plan B = KI-gewichtete Simulation).
 *
 * WICHTIG — Sicherheitsrahmen:
 * Plan B ist AUSSCHLIESSLICH eine Beobachtungs-/Statistik-Simulation für den Vergleich.
 * EMS führt zu jedem Zeitpunkt weiterhin Plan A (den deterministischen Tagesplan) aus.
 * "active_plan" ist eine reine Anzeige-Information ("welcher Plan wäre rechnerisch günstiger") —
 * sie schaltet nichts um und schreibt nie auf Geräte. Eine echte Übernahme von Plan B wäre ein
 * separater, zukünftiger Schritt mit eigener Freigabe (siehe Masterplan §13).
 *
 * Plan B verschiebt außerdem nur den ZEITPUNKT der ohnehin von Plan A für Heizstab/Klima
 * vorgesehenen Energiemenge — es wird nie mehr oder weniger Energie eingeplant als Plan A.
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
