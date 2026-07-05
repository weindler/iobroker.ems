import {
	AC_CLEANING_ACTIVE_CONFIRM_SEC,
	AC_CLEANING_FEEDBACK_MIN_RUNTIME_SEC,
} from "../constants";

/** SmartThings custom.autoCleaningMode — operatingState während Reinigung. */
export const CLEANING_RUNNING_OPERATING = ["autoclean", "speedclean", "quietclean", "timedclean"] as const;

export function normalizeCleaningToken(raw: unknown): string {
	return String(raw ?? "").trim().toLowerCase();
}

export function isCleaningOperatingActive(raw: unknown): boolean {
	const token = normalizeCleaningToken(raw);
	return (CLEANING_RUNNING_OPERATING as readonly string[]).includes(token);
}

export function shouldMarkCleaningOperatingActive(raw: unknown, elapsedSec: number): boolean {
	return elapsedSec >= AC_CLEANING_ACTIVE_CONFIRM_SEC && isCleaningOperatingActive(raw);
}

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
	if (mode === "off" && input.elapsedSec >= AC_CLEANING_ACTIVE_CONFIRM_SEC) {
		return true;
	}
	if (op === "ready" && input.elapsedSec >= AC_CLEANING_FEEDBACK_MIN_RUNTIME_SEC) {
		return true;
	}
	return false;
}
