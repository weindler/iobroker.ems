import type { AcUnitPersist } from "./persist";

/** Statistik: zählen ab Start-Sequenz bis Stopp bestätigt (auch wenn feedback_switch nachzieht). */
export function acStatsDeviceActive(up: AcUnitPersist, fbOn: boolean, upRunning: boolean): boolean {
	if (fbOn) return true;
	if (upRunning) return true;
	if (!up.lastStartAtMs) return false;
	const stoppedAfterStart = up.lastStopAtMs != null && up.lastStopAtMs >= up.lastStartAtMs;
	return !stoppedAfterStart;
}
