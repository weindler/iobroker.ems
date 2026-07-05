/** Außenleistung auf parallele Innengeräte verteilen — gleiche Formel wie AC-Runtime. */
export function allocateOutdoorUnitPowerW(
	runningCount: number,
	outdoorMaxPowerW: number,
	unitPowerW: number,
): number {
	if (runningCount <= 0 || unitPowerW <= 0) {
		return 0;
	}
	if (runningCount === 1) {
		return unitPowerW;
	}
	if (outdoorMaxPowerW <= 0) {
		return unitPowerW;
	}
	return Math.min(unitPowerW, Math.round(outdoorMaxPowerW / runningCount));
}

/** Summe geplanter Verbraucherlast (z. B. Klima), begrenzt auf Außengerät-Cap. */
export function sumAllocatedConsumerPeakW(
	unitPowerWs: number[],
	outdoorMaxPowerW: number,
): number {
	const active = unitPowerWs.filter((w) => w > 0);
	if (active.length === 0) {
		return 0;
	}
	if (active.length === 1) {
		return active[0];
	}
	const allocated = active.map((w) => allocateOutdoorUnitPowerW(active.length, outdoorMaxPowerW, w));
	const total = allocated.reduce((a, b) => a + b, 0);
	if (outdoorMaxPowerW > 0) {
		return Math.min(total, outdoorMaxPowerW);
	}
	return total;
}
