/**
 * Wenn der Daily Plan den aktuellen Slot absichtlich auf 0 W setzt, der Puffer aber unter
 * Ziel liegt und Live-PV-Überschuss eine Stufe trägt → Stufe nachziehen (Pull-forward).
 * Fault/Pause bleiben in der FSM; hier nur die Planner-Sollstufe.
 */

export interface ImmersionStagePick {
	index: number;
	enabled: boolean;
	nominalPowerW: number;
	setStateId: string;
}

export function resolveImmersionSurplusPullForward(input: {
	useDailyPlan: boolean;
	commandedStage: number;
	bufferTempC: number | null;
	targetTempC: number | null;
	hysteresisK: number;
	liveSurplusW: number | null;
	stages: ImmersionStagePick[];
	preferredStage: number;
}): { active: boolean; stage: number; reasonDe: string } {
	if (!input.useDailyPlan) {
		return { active: false, stage: input.commandedStage, reasonDe: "" };
	}
	if (input.commandedStage > 0) {
		return { active: false, stage: input.commandedStage, reasonDe: "" };
	}
	if (input.bufferTempC === null || input.targetTempC === null) {
		return { active: false, stage: 0, reasonDe: "" };
	}
	const reheatThreshold = input.targetTempC - Math.max(0, input.hysteresisK);
	if (input.bufferTempC >= reheatThreshold) {
		return { active: false, stage: 0, reasonDe: "" };
	}
	const surplus = input.liveSurplusW;
	if (surplus === null || !Number.isFinite(surplus) || surplus <= 0) {
		return { active: false, stage: 0, reasonDe: "" };
	}

	const runnable = input.stages.filter(
		(s) => s.enabled && s.setStateId.trim() !== "" && s.nominalPowerW > 0 && s.nominalPowerW <= surplus,
	);
	if (runnable.length === 0) {
		return { active: false, stage: 0, reasonDe: "" };
	}

	const preferred = runnable.find((s) => s.index === input.preferredStage);
	const pick =
		preferred ??
		runnable.reduce((best, s) => (s.nominalPowerW > best.nominalPowerW ? s : best), runnable[0]);

	return {
		active: true,
		stage: pick.index,
		reasonDe: `Live-Überschuss ${Math.round(surplus)} W ≥ Stufe ${pick.index} (${pick.nominalPowerW} W) — nachziehen trotz Plan-Slot 0 W.`,
	};
}
