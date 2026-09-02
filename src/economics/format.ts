/**
 * Nur Darstellung: Vorzeichen der Shadow-Netto-Kosten nicht umdrehen.
 * emsVorteilEur = reference_no_ems.netCost − real.netCost (positiv = EMS günstiger).
 */

function absEur(n: number): string {
	return `${Math.abs(n).toFixed(2).replace(".", ",")} €`;
}

export function formatEmsAdvantagePhraseDe(emsVorteilEur: number | null): string {
	if (emsVorteilEur == null || !Number.isFinite(emsVorteilEur)) {
		return "EMS-Effekt nicht bewertbar";
	}
	if (emsVorteilEur > 0.005) {
		return `EMS hat ${absEur(emsVorteilEur)} gespart`;
	}
	if (emsVorteilEur < -0.005) {
		return `EMS verursachte ${absEur(emsVorteilEur)} Mehrkosten`;
	}
	return "EMS hat weder gespart noch Mehrkosten verursacht";
}

/** Netto-Kosten: negativ = Ertrag (Exportgutschrift > Bezug). */
export function formatNetCostPhraseDe(netCostEur: number | null, roleDe: string): string {
	if (netCostEur == null || !Number.isFinite(netCostEur)) {
		return `${roleDe}: —`;
	}
	if (netCostEur < -0.005) {
		return `${roleDe}: ${absEur(netCostEur)} Ertrag`;
	}
	if (netCostEur > 0.005) {
		return `${roleDe}: ${absEur(netCostEur)} Kosten`;
	}
	return `${roleDe}: 0,00 €`;
}
