import {
	AC_FEEDBACK_POLL_ATTEMPTS,
	AC_FEEDBACK_POLL_MS,
} from "../constants";
import type { AcUnitPersist } from "./persist";

/** Grace after start while feedback_switch may still be off. */
export const AC_STATS_START_FEEDBACK_GRACE_MS =
	AC_FEEDBACK_POLL_MS * AC_FEEDBACK_POLL_ATTEMPTS + 5_000;

/**
 * Statistik: zählen ab Start-Sequenz bis Stopp bestätigt (auch wenn feedback_switch kurz nachzieht).
 * Ohne bestätigtes Feedback und ohne Dryrun-Session endet das Sticky nach der Start-Grace —
 * sonst läuft die Statistik weiter, obwohl das Gerät längst aus ist (z. B. nach Deaktivieren/Reaktivieren).
 */
export function acStatsDeviceActive(
	up: AcUnitPersist,
	fbOn: boolean,
	upRunning: boolean,
	nowMs: number = Date.now(),
	startGraceMs: number = AC_STATS_START_FEEDBACK_GRACE_MS,
): boolean {
	if (fbOn) return true;
	if (upRunning) return true;
	if (!up.lastStartAtMs) return false;
	const stoppedAfterStart = up.lastStopAtMs != null && up.lastStopAtMs >= up.lastStartAtMs;
	if (stoppedAfterStart) return false;
	// Sticky only during short feedback lag after EMS start — not forever.
	return nowMs - up.lastStartAtMs <= startGraceMs;
}

/** Close an open stats/runtime session (e.g. unit disabled in Admin). */
export function closeAcUnitStatsSession(up: AcUnitPersist, nowMs: number): boolean {
	const open =
		up.running ||
		(up.lastStartAtMs != null &&
			(up.lastStopAtMs == null || up.lastStopAtMs < up.lastStartAtMs));
	if (!open) return false;
	up.running = false;
	if (up.lastStartAtMs == null) {
		up.lastStartAtMs = nowMs;
	}
	up.lastStopAtMs = nowMs;
	return true;
}
