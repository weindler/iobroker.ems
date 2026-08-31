"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ensureAiValidatorStates = exports.AI_VALIDATOR_STATES = exports.AI_VALIDATOR_BASE = void 0;
const state_util_1 = require("../../ems_light/state_util");
function numState(id, name) {
    return { id, common: { name, type: "number", role: "value", read: true, write: false } };
}
function strState(id, name, def) {
    return {
        id,
        common: { name, type: "string", role: "text", read: true, write: false, def },
        defaultVal: def,
        setDefaultIfEmpty: true,
    };
}
exports.AI_VALIDATOR_BASE = "ai.validator";
exports.AI_VALIDATOR_STATES = {
    activeOverridesCount: `${exports.AI_VALIDATOR_BASE}.active_overrides_count`,
    lastValidatedAtIso: `${exports.AI_VALIDATOR_BASE}.last_validated_at`,
    lastRejectReasonDe: `${exports.AI_VALIDATOR_BASE}.last_reject_reason_de`,
    lastAcceptedParameter: `${exports.AI_VALIDATOR_BASE}.last_accepted_parameter`,
};
/**
 * PHASE 6 — Diagnose-/Transparenz-States des KI-Validators. Kein Steuer-State — der Validator
 * wird ausschließlich intern (deterministisch) aufgerufen, nie per State getriggert.
 */
async function ensureAiValidatorStates(host) {
    await (0, state_util_1.ensureChannel)(host, "ai.validator", "EMS-Light KI-Validator (Phase 6 — Overrides)");
    const defs = [
        numState(exports.AI_VALIDATOR_STATES.activeOverridesCount, "KI-Validator aktive Overrides"),
        strState(exports.AI_VALIDATOR_STATES.lastValidatedAtIso, "KI-Validator letzte Prüfung (ISO)"),
        strState(exports.AI_VALIDATOR_STATES.lastRejectReasonDe, "KI-Validator letzte Ablehnung (Grund)", ""),
        strState(exports.AI_VALIDATOR_STATES.lastAcceptedParameter, "KI-Validator zuletzt akzeptierter Parameter", ""),
    ];
    await (0, state_util_1.ensureStates)(host, defs);
}
exports.ensureAiValidatorStates = ensureAiValidatorStates;
