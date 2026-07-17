"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.writePlannerAuthorizationStates = exports.isPlannerAuthorizationState = exports.ensurePlannerAuthorizationStates = exports.PLANNER_AUTHORIZATION_STATE_PREFIX = exports.PLANNER_AUTHORIZATION_STATE_IDS = void 0;
const state_util_1 = require("../ems_light/state_util");
const state_write_1 = require("../policy/core/state_write");
exports.PLANNER_AUTHORIZATION_STATE_IDS = {
    configuredMode: "planner.takeover.authorization.configured_mode",
    effectiveMode: "planner.takeover.authorization.effective_mode",
    state: "planner.takeover.authorization.state",
    eligible: "planner.takeover.authorization.eligible",
    primaryBlockReason: "planner.takeover.authorization.primary_block_reason",
    blockReasonCount: "planner.takeover.authorization.block_reason_count",
    prepare: "planner.takeover.authorization.prepare",
    confirmChallengeId: "planner.takeover.authorization.confirm_challenge_id",
    confirm: "planner.takeover.authorization.confirm",
    cancel: "planner.takeover.authorization.cancel",
    challengeId: "planner.takeover.authorization.challenge_id",
    challengeCreatedAt: "planner.takeover.authorization.challenge_created_at",
    challengeExpiresAt: "planner.takeover.authorization.challenge_expires_at",
    confirmFailures: "planner.takeover.authorization.confirm_failures",
    grantActive: "planner.takeover.authorization.grant_active",
    grantCreatedAt: "planner.takeover.authorization.grant_created_at",
    grantExpiresAt: "planner.takeover.authorization.grant_expires_at",
    revisionMatch: "planner.takeover.authorization.revision_match",
    activationCapabilityPresent: "planner.takeover.authorization.activation_capability_present",
    permitMinted: "planner.takeover.authorization.permit_minted",
    canonicalAllowed: "planner.takeover.authorization.canonical_allowed",
    lastEventCode: "planner.takeover.authorization.last_event_code",
    lastErrorCode: "planner.takeover.authorization.last_error_code",
};
exports.PLANNER_AUTHORIZATION_STATE_PREFIX = "planner.takeover.authorization.";
function strState(id, name, def = "", write = false) {
    return {
        id,
        common: { name, type: "string", role: write ? "state" : "text", read: true, write, def },
        defaultVal: def,
        setDefaultIfEmpty: !write,
    };
}
function numState(id, name, def = 0) {
    return {
        id,
        common: { name, type: "number", role: "value", read: true, write: false, def },
        defaultVal: def,
        setDefaultIfEmpty: true,
    };
}
function boolState(id, name, def = false, write = false, role = "state") {
    return {
        id,
        common: { name, type: "boolean", role, read: true, write, def },
        defaultVal: def,
        setDefaultIfEmpty: !write,
    };
}
async function ensurePlannerAuthorizationStates(host) {
    await (0, state_util_1.ensureChannel)(host, "planner.takeover.authorization", "Planner Takeover Authorization");
    const defs = [
        strState(exports.PLANNER_AUTHORIZATION_STATE_IDS.configuredMode, "Authorization Mode (Konfiguration)", "disabled"),
        strState(exports.PLANNER_AUTHORIZATION_STATE_IDS.effectiveMode, "Authorization Mode (effektiv)", "disabled"),
        strState(exports.PLANNER_AUTHORIZATION_STATE_IDS.state, "Authorization Zustand", "disabled"),
        boolState(exports.PLANNER_AUTHORIZATION_STATE_IDS.eligible, "Authorization eligible", false),
        strState(exports.PLANNER_AUTHORIZATION_STATE_IDS.primaryBlockReason, "Authorization Blockgrund"),
        numState(exports.PLANNER_AUTHORIZATION_STATE_IDS.blockReasonCount, "Authorization Blockgründe"),
        boolState(exports.PLANNER_AUTHORIZATION_STATE_IDS.prepare, "Authorization Prepare", false, true, "button"),
        strState(exports.PLANNER_AUTHORIZATION_STATE_IDS.confirmChallengeId, "Authorization Confirm Challenge-ID", "", true),
        boolState(exports.PLANNER_AUTHORIZATION_STATE_IDS.confirm, "Authorization Confirm", false, true, "button"),
        boolState(exports.PLANNER_AUTHORIZATION_STATE_IDS.cancel, "Authorization Cancel", false, true, "button"),
        strState(exports.PLANNER_AUTHORIZATION_STATE_IDS.challengeId, "Authorization Challenge-ID"),
        strState(exports.PLANNER_AUTHORIZATION_STATE_IDS.challengeCreatedAt, "Challenge erstellt"),
        strState(exports.PLANNER_AUTHORIZATION_STATE_IDS.challengeExpiresAt, "Challenge läuft ab"),
        numState(exports.PLANNER_AUTHORIZATION_STATE_IDS.confirmFailures, "Confirm Fehlversuche"),
        boolState(exports.PLANNER_AUTHORIZATION_STATE_IDS.grantActive, "Grant aktiv", false),
        strState(exports.PLANNER_AUTHORIZATION_STATE_IDS.grantCreatedAt, "Grant erstellt"),
        strState(exports.PLANNER_AUTHORIZATION_STATE_IDS.grantExpiresAt, "Grant läuft ab"),
        boolState(exports.PLANNER_AUTHORIZATION_STATE_IDS.revisionMatch, "Revision Match", false),
        boolState(exports.PLANNER_AUTHORIZATION_STATE_IDS.activationCapabilityPresent, "Activation Capability", false),
        boolState(exports.PLANNER_AUTHORIZATION_STATE_IDS.permitMinted, "Permit minted", false),
        boolState(exports.PLANNER_AUTHORIZATION_STATE_IDS.canonicalAllowed, "Canonical allowed", false),
        strState(exports.PLANNER_AUTHORIZATION_STATE_IDS.lastEventCode, "Letztes Authorization Event"),
        strState(exports.PLANNER_AUTHORIZATION_STATE_IDS.lastErrorCode, "Letzter Authorization Fehler"),
    ];
    await (0, state_util_1.ensureStates)(host, defs);
}
exports.ensurePlannerAuthorizationStates = ensurePlannerAuthorizationStates;
function isPlannerAuthorizationState(relativeId) {
    return relativeId.startsWith(exports.PLANNER_AUTHORIZATION_STATE_PREFIX);
}
exports.isPlannerAuthorizationState = isPlannerAuthorizationState;
async function writePlannerAuthorizationStates(host, status) {
    await (0, state_write_1.setStateIfChanged)(host, exports.PLANNER_AUTHORIZATION_STATE_IDS.configuredMode, status.configuredMode);
    await (0, state_write_1.setStateIfChanged)(host, exports.PLANNER_AUTHORIZATION_STATE_IDS.effectiveMode, status.effectiveMode);
    await (0, state_write_1.setStateIfChanged)(host, exports.PLANNER_AUTHORIZATION_STATE_IDS.state, status.state);
    await (0, state_write_1.setStateIfChanged)(host, exports.PLANNER_AUTHORIZATION_STATE_IDS.eligible, status.eligible);
    await (0, state_write_1.setStateIfChanged)(host, exports.PLANNER_AUTHORIZATION_STATE_IDS.primaryBlockReason, status.primaryBlockReason ?? "");
    await (0, state_write_1.setOptionalNumberIfChanged)(host, exports.PLANNER_AUTHORIZATION_STATE_IDS.blockReasonCount, status.blockReasonCount);
    await (0, state_write_1.setStateIfChanged)(host, exports.PLANNER_AUTHORIZATION_STATE_IDS.challengeId, status.challengeId ?? "");
    await (0, state_write_1.setStateIfChanged)(host, exports.PLANNER_AUTHORIZATION_STATE_IDS.challengeCreatedAt, status.challengeCreatedAt ?? "");
    await (0, state_write_1.setStateIfChanged)(host, exports.PLANNER_AUTHORIZATION_STATE_IDS.challengeExpiresAt, status.challengeExpiresAt ?? "");
    await (0, state_write_1.setOptionalNumberIfChanged)(host, exports.PLANNER_AUTHORIZATION_STATE_IDS.confirmFailures, status.confirmFailures);
    await (0, state_write_1.setStateIfChanged)(host, exports.PLANNER_AUTHORIZATION_STATE_IDS.grantActive, status.grantActive);
    await (0, state_write_1.setStateIfChanged)(host, exports.PLANNER_AUTHORIZATION_STATE_IDS.grantCreatedAt, status.grantCreatedAt ?? "");
    await (0, state_write_1.setStateIfChanged)(host, exports.PLANNER_AUTHORIZATION_STATE_IDS.grantExpiresAt, status.grantExpiresAt ?? "");
    await (0, state_write_1.setStateIfChanged)(host, exports.PLANNER_AUTHORIZATION_STATE_IDS.revisionMatch, status.revisionMatch);
    await (0, state_write_1.setStateIfChanged)(host, exports.PLANNER_AUTHORIZATION_STATE_IDS.activationCapabilityPresent, false);
    await (0, state_write_1.setStateIfChanged)(host, exports.PLANNER_AUTHORIZATION_STATE_IDS.permitMinted, false);
    await (0, state_write_1.setStateIfChanged)(host, exports.PLANNER_AUTHORIZATION_STATE_IDS.canonicalAllowed, false);
    await (0, state_write_1.setStateIfChanged)(host, exports.PLANNER_AUTHORIZATION_STATE_IDS.lastEventCode, status.lastEventCode ?? "");
    await (0, state_write_1.setStateIfChanged)(host, exports.PLANNER_AUTHORIZATION_STATE_IDS.lastErrorCode, status.lastErrorCode ?? "");
}
exports.writePlannerAuthorizationStates = writePlannerAuthorizationStates;
