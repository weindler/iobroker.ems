import { ensureChannel, ensureStates, type StateDef, type StateHost } from "../../ems_light/state_util";

function numState(id: string, name: string): StateDef {
	return { id, common: { name, type: "number", role: "value", read: true, write: false } };
}
function strState(id: string, name: string, def?: string): StateDef {
	return {
		id,
		common: { name, type: "string", role: "text", read: true, write: false, def },
		defaultVal: def,
		setDefaultIfEmpty: true,
	};
}

export const AI_VALIDATOR_BASE = "ai.validator";

export const AI_VALIDATOR_STATES = {
	activeOverridesCount: `${AI_VALIDATOR_BASE}.active_overrides_count`,
	lastValidatedAtIso: `${AI_VALIDATOR_BASE}.last_validated_at`,
	lastRejectReasonDe: `${AI_VALIDATOR_BASE}.last_reject_reason_de`,
	lastAcceptedParameter: `${AI_VALIDATOR_BASE}.last_accepted_parameter`,
} as const;

/**
 * PHASE 6 — Diagnose-/Transparenz-States des KI-Validators. Kein Steuer-State — der Validator
 * wird ausschließlich intern (deterministisch) aufgerufen, nie per State getriggert.
 */
export async function ensureAiValidatorStates(host: StateHost): Promise<void> {
	await ensureChannel(host, "ai.validator", "EMS-Light KI-Validator (Phase 6 — Overrides)");
	const defs: StateDef[] = [
		numState(AI_VALIDATOR_STATES.activeOverridesCount, "KI-Validator aktive Overrides"),
		strState(AI_VALIDATOR_STATES.lastValidatedAtIso, "KI-Validator letzte Prüfung (ISO)"),
		strState(AI_VALIDATOR_STATES.lastRejectReasonDe, "KI-Validator letzte Ablehnung (Grund)", ""),
		strState(AI_VALIDATOR_STATES.lastAcceptedParameter, "KI-Validator zuletzt akzeptierter Parameter", ""),
	];
	await ensureStates(host, defs);
}
