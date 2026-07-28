/**
 * Wenn der erwartete Tages-PV-Überschuss (PV − Hauslast) den Batterie-Ladebedarf deckt,
 * braucht das EMS keine aktiven Lade-Slots — die Batterie füllt sich über Eigenverbrauch/PV.
 * Top-Off (Nutzer oder gelernt) und fehlende Surplus-Daten bleiben ausgenommen.
 */
export function pvSurplusCoversChargeNeed(input: {
	requiredChargeEnergyKwh: number | null;
	todayPvSurplusKwh: number | null;
	topOffRequested: boolean;
	learnedTopoffDue: boolean;
}): boolean {
	if (input.topOffRequested || input.learnedTopoffDue) return false;
	const need = input.requiredChargeEnergyKwh;
	const surplus = input.todayPvSurplusKwh;
	if (need === null || need <= 0) return false;
	if (surplus === null || !Number.isFinite(surplus)) return false;
	return surplus >= need;
}

export function todayPvSurplusKwh(pvTodayKwh: number | null, houseLoadTodayKwh: number | null): number | null {
	if (pvTodayKwh === null || houseLoadTodayKwh === null) return null;
	if (!Number.isFinite(pvTodayKwh) || !Number.isFinite(houseLoadTodayKwh)) return null;
	return Math.max(0, Math.round((pvTodayKwh - houseLoadTodayKwh) * 1000) / 1000);
}
