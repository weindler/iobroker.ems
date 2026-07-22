/**
 * Wallbox Fault/Lockout — analog Heizstab relay_chatter/Batterie FinalWriteGate.
 * Ein aktiver Fault sperrt weitere Live-Writes bis zum expliziten Reset, damit ein
 * defekter Feedback-Pfad (z. B. Readback antwortet nie) nicht endlos wiederholt wird.
 */
export type WallboxFaultCode = "write_failed" | "feedback_mismatch" | "feedback_timeout" | "feedback_invalid" | null;

export interface WallboxFaultState {
	active: boolean;
	code: WallboxFaultCode;
	since: string | null;
	message: string | null;
}

export function emptyWallboxFault(): WallboxFaultState {
	return { active: false, code: null, since: null, message: null };
}

export function raiseWallboxFault(code: NonNullable<WallboxFaultCode>, message: string, nowIso: string): WallboxFaultState {
	return { active: true, code, since: nowIso, message };
}

export function clearWallboxFault(): WallboxFaultState {
	return emptyWallboxFault();
}

/** Feedback-Aggregatstatus → Fault-Code, sofern es sich um ein echtes Problem handelt (nicht "pending"). */
export function faultCodeForFeedbackStatus(status: string): NonNullable<WallboxFaultCode> | null {
	if (status === "mismatch") return "feedback_mismatch";
	if (status === "timeout") return "feedback_timeout";
	if (status === "invalid") return "feedback_invalid";
	return null;
}
