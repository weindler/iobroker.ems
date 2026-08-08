/**
 * Wiedereinschalt-Hysterese nach erreichtem Auto-Tagesziel — lokaler Taktschutz.
 * Greift in der FSM nur, wenn kein explizites Planner-Soll (Stufe > 0) vorliegt.
 * Unified-/Daily-Plan-Allocationen dürfen dadurch nicht pauschal auf 0 gesetzt werden;
 * harte Deckel (Tagesziel / planningMax) bleiben separat in der FSM.
 */
export function isImmersionReheatHysteresisActive(input: {
	bufferTempC: number | null;
	targetTempC: number;
	hysteresisK: number;
	autoTargetReached: boolean;
}): boolean {
	if (input.bufferTempC === null || !Number.isFinite(input.bufferTempC)) return false;
	if (!Number.isFinite(input.targetTempC)) return false;
	const hyst = Math.max(0, input.hysteresisK);
	const reheatThresholdC = input.targetTempC - hyst;
	if (input.bufferTempC < reheatThresholdC) return false;
	return input.autoTargetReached === true || input.bufferTempC >= input.targetTempC;
}
