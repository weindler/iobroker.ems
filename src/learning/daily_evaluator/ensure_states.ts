/**
 * BLOCK A — Admin-/Visibility-States. Rein additiv, keine Steuer-States (read-only).
 */
import { ensureChannel, ensureStates, type StateDef, type StateHost } from "../../ems_light/state_util";
import { DAILY_EVALUATOR_STATES } from "./constants";

function strState(id: string, name: string, def?: string): StateDef {
	return {
		id,
		common: { name, type: "string", role: "text", read: true, write: false, def },
		defaultVal: def,
		setDefaultIfEmpty: true,
	};
}

function numState(id: string, name: string, unit?: string): StateDef {
	return {
		id,
		common: { name, type: "number", role: "value", unit, read: true, write: false, def: null },
		defaultVal: null,
		setDefaultIfEmpty: true,
	};
}

function boolState(id: string, name: string, def = false): StateDef {
	return {
		id,
		common: { name, type: "boolean", role: "indicator", read: true, write: false, def },
		defaultVal: def,
		setDefaultIfEmpty: true,
	};
}

export async function ensureDailyEvaluatorStates(host: StateHost): Promise<void> {
	await ensureChannel(host, "learning.daily_evaluator", "EMS-Light Daily Evaluator");
	const defs: StateDef[] = [
		strState(DAILY_EVALUATOR_STATES.status, "Daily Evaluator Status", "idle"),
		strState(DAILY_EVALUATOR_STATES.lastEvaluatedDateKey, "Letzter evaluierter Tag (YYYY-MM-DD)"),
		strState(DAILY_EVALUATOR_STATES.lastRunAtIso, "Letzter Lauf (ISO)"),
		strState(DAILY_EVALUATOR_STATES.lastError, "Letzter Fehler"),
		numState(DAILY_EVALUATOR_STATES.pendingBacklogCount, "Noch nicht evaluierte Tage im Backlog"),
		boolState(DAILY_EVALUATOR_STATES.lastDayEvaluable, "Letzter Tag global evaluable"),
		numState(DAILY_EVALUATOR_STATES.lastDayGlobalScore, "Letzter Tag GlobalScore", "%"),
		numState(DAILY_EVALUATOR_STATES.lastDayFindingsCount, "Letzter Tag Findings-Anzahl"),
		strState(DAILY_EVALUATOR_STATES.lastDayTopFindingDe, "Letzter Tag wichtigstes Finding", ""),
		strState(DAILY_EVALUATOR_STATES.learningSampleCountJson, "Diagnostisches Learning Sample-Counts (JSON)"),
	];
	await ensureStates(host, defs);
}

export const DAILY_EVALUATOR_STATE_IDS = Object.values(DAILY_EVALUATOR_STATES);
