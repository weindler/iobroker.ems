/**
 * Kompaktes Transition-Logging für Climate ON→OFF-Realfälle.
 * Nur an START / feedback-ON / STOP / switch_off — kein Dauer-Spam.
 */

export type AcCoolingDiagTag = "start" | "feedback_on" | "stop" | "switch_off";

export interface AcCoolingDiagSnapshot {
	tag: AcCoolingDiagTag;
	unitIndex: number;
	nowMs: number;
	slotStartIso: string | null;
	slotEndIso: string | null;
	allocatedPowerW: number | null;
	dailyPlanRevision: number | null;
	dailyPlanStatus: string;
	desired: string;
	lastDesired: string | null;
	commandGeneration: number;
	stopArmedGeneration: number | null;
	feedback: "on" | "off" | "unknown";
	decisionSource: string;
	allowStart: boolean;
	allowStop: boolean;
	demandStop: boolean;
	plannerOff: boolean;
	reasonDe: string;
}

function shortReason(reasonDe: string): string {
	const t = reasonDe.trim().replace(/\s+/g, " ");
	return t.length <= 140 ? t : `${t.slice(0, 137)}...`;
}

/** Eine Zeile — Realfall ON→OFF anhand einer Logsequenz nachvollziehbar. */
export function formatAcCoolingDiagLine(s: AcCoolingDiagSnapshot): string {
	const slot =
		s.slotStartIso || s.slotEndIso ? `${s.slotStartIso ?? "?"}->${s.slotEndIso ?? "?"}` : "none";
	const alloc = s.allocatedPowerW == null ? "null" : String(s.allocatedPowerW);
	const rev = s.dailyPlanRevision == null ? "null" : String(s.dailyPlanRevision);
	return (
		`ac unit ${s.unitIndex}: diag ${s.tag}` +
		` | t=${new Date(s.nowMs).toISOString()}` +
		` slot=${slot}` +
		` allocW=${alloc}` +
		` rev=${rev}` +
		` status=${s.dailyPlanStatus}` +
		` desired=${s.desired}` +
		` lastDesired=${s.lastDesired ?? "null"}` +
		` cmdGen=${s.commandGeneration}` +
		` stopGen=${s.stopArmedGeneration ?? "null"}` +
		` fb=${s.feedback}` +
		` src=${s.decisionSource}` +
		` allowStart=${s.allowStart}` +
		` allowStop=${s.allowStop}` +
		` demandStop=${s.demandStop}` +
		` plannerOff=${s.plannerOff}` +
		` | ${shortReason(s.reasonDe)}`
	);
}

export function logAcCoolingDiag(
	log: { info: (m: string) => void },
	snapshot: AcCoolingDiagSnapshot,
): void {
	log.info(formatAcCoolingDiagLine(snapshot));
}
