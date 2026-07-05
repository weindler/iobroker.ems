/** SmartThings custom.autoCleaningMode — operatingState während Reinigung. */
export const CLEANING_RUNNING_OPERATING = ["autoclean", "speedclean", "quietclean", "timedclean"] as const;

export function normalizeCleaningToken(raw: unknown): string {
	return String(raw ?? "").trim().toLowerCase();
}

export function isCleaningOperatingActive(raw: unknown): boolean {
	const token = normalizeCleaningToken(raw);
	return (CLEANING_RUNNING_OPERATING as readonly string[]).includes(token);
}

export function isCleaningFinishedByFeedback(input: {
	operatingStateRaw: unknown;
	modeRaw: unknown;
	sawOperatingActive: boolean;
}): boolean {
	if (!input.sawOperatingActive) {
		return false;
	}
	const op = normalizeCleaningToken(input.operatingStateRaw);
	const mode = normalizeCleaningToken(input.modeRaw);
	if (op === "ready") {
		return true;
	}
	return mode === "off";
}
