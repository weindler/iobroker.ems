import {
	AC_CLEANING_ACTIVE_CONFIRM_SEC,
	AC_CLEANING_FEEDBACK_MIN_RUNTIME_SEC,
	AC_CLEANING_STUCK_ABORT_SEC,
} from "../constants";

/** SmartThings custom.autoCleaningMode — operatingState während Reinigung. */
export const CLEANING_RUNNING_OPERATING = ["autoclean", "speedclean", "quietclean", "timedclean"] as const;

export function normalizeCleaningToken(raw: unknown): string {
	return String(raw ?? "").trim().toLowerCase();
}

export function normalizeCleaningProgressPct(raw: unknown): number | null {
	if (raw == null || raw === "") {
		return null;
	}
	const token = String(raw).trim().replace(/%$/, "");
	const n = Number(token);
	return Number.isFinite(n) ? n : null;
}

export function isCleaningOperatingActive(raw: unknown): boolean {
	if (typeof raw === "boolean") return raw;
	if (typeof raw === "number") return raw !== 0;
	const token = normalizeCleaningToken(raw);
	if (token === "true" || token === "1" || token === "on") return true;
	return (CLEANING_RUNNING_OPERATING as readonly string[]).includes(token);
}

export function shouldMarkCleaningOperatingActive(raw: unknown, elapsedSec: number): boolean {
	return elapsedSec >= AC_CLEANING_ACTIVE_CONFIRM_SEC && isCleaningOperatingActive(raw);
}

export function shouldMarkCleaningProgressActive(progressPct: number | null): boolean {
	return progressPct != null && progressPct > 0 && progressPct < 100;
}

/** Primäres Ende-Signal: SmartThings progress = 100 %. */
export function isCleaningFinishedByProgress(input: {
	progressPct: number | null;
	sawProgressActive: boolean;
	sawOperatingActive: boolean;
	startProgressPct: number | null;
	elapsedSec: number;
}): boolean {
	const progress = input.progressPct;
	if (progress == null || progress < 100 || input.elapsedSec < AC_CLEANING_ACTIVE_CONFIRM_SEC) {
		return false;
	}
	if (input.sawProgressActive || input.sawOperatingActive) {
		return true;
	}
	const start = input.startProgressPct;
	return start != null && progress > start;
}

/** Fallback wenn kein Fortschritt gemappt oder progress hängt. */
export function isCleaningFinishedByFeedback(input: {
	operatingStateRaw: unknown;
	modeRaw: unknown;
	sawOperatingActive: boolean;
	elapsedSec: number;
}): boolean {
	if (!input.sawOperatingActive || input.elapsedSec < AC_CLEANING_ACTIVE_CONFIRM_SEC) {
		return false;
	}
	const op = normalizeCleaningToken(input.operatingStateRaw);
	const mode = normalizeCleaningToken(input.modeRaw);
	if (mode === "off" || mode === "false" || mode === "0" || mode === "") {
		return true;
	}
	if (op === "false" || op === "0" || op === "off") {
		return true;
	}
	if (op === "ready" && input.elapsedSec >= AC_CLEANING_FEEDBACK_MIN_RUNTIME_SEC) {
		return true;
	}
	return false;
}

/** Reinigung nie wirklich gestartet (ready + kein autoclean/progress) → Flag freigeben. */
export function isCleaningStuckNeverEngaged(input: {
	operatingStateRaw: unknown;
	sawOperatingActive: boolean;
	sawProgressActive: boolean;
	elapsedSec: number;
}): boolean {
	if (input.sawOperatingActive || input.sawProgressActive) {
		return false;
	}
	if (input.elapsedSec < AC_CLEANING_STUCK_ABORT_SEC) {
		return false;
	}
	const op = normalizeCleaningToken(input.operatingStateRaw);
	return op === "ready" || op === "" || op === "idle";
}
