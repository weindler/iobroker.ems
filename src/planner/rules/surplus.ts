/** PV-Überschuss-Schätzung für Planner MVP. */

export function computePvSurplusW(pvPowerW: number | null, houseLoadW: number | null): number | null {
	if (pvPowerW === null || houseLoadW === null) return null;
	if (!Number.isFinite(pvPowerW) || !Number.isFinite(houseLoadW)) return null;
	return Math.max(0, Math.round(pvPowerW - houseLoadW));
}

export function surplusAfterLoadW(surplusW: number, allocatedW: number): number {
	return Math.max(0, Math.round(surplusW - allocatedW));
}
