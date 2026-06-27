"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.applyClearFields = exports.resolveWallboxIntent = void 0;
const resolver_1 = require("../core/resolver");
const revision_1 = require("../core/revision");
const validation_1 = require("../core/validation");
const validation_2 = require("./validation");
const types_1 = require("./types");
const PRIORITY_OVERRIDE = 1;
const PRIORITY_IOBROKER = 2;
const PRIORITY_EVCC = 3;
const PRIORITY_ADMIN = 4;
function resolveWallboxIntent(input) {
    const { now, previous, evcc, iobroker, admin, override } = input;
    const base = previous ?? (0, types_1.emptyResolvedWallboxIntent)(now);
    const activeOverride = override?.active && (!override.valid_until || !(0, validation_1.isExpiredAt)(override.valid_until, now)) ? override : null;
    const chargeCandidates = [];
    const socCandidates = [];
    const deadlineCandidates = [];
    if (activeOverride && (0, resolver_1.scopeIncludes)(activeOverride.scope, "charge_strategy") && iobroker?.charge_strategy) {
        chargeCandidates.push(fieldToCandidate(iobroker.charge_strategy, PRIORITY_OVERRIDE));
    }
    if (activeOverride && (0, resolver_1.scopeIncludes)(activeOverride.scope, "target_soc_pct") && iobroker?.target_soc_pct) {
        socCandidates.push(fieldToCandidate(iobroker.target_soc_pct, PRIORITY_OVERRIDE));
    }
    if (activeOverride && (0, resolver_1.scopeIncludes)(activeOverride.scope, "deadline") && iobroker?.deadline) {
        deadlineCandidates.push(fieldToCandidate(iobroker.deadline, PRIORITY_OVERRIDE));
    }
    if (iobroker?.charge_strategy && (!activeOverride || !(0, resolver_1.scopeIncludes)(activeOverride.scope, "charge_strategy"))) {
        chargeCandidates.push(fieldToCandidate(iobroker.charge_strategy, PRIORITY_IOBROKER));
    }
    if (iobroker?.target_soc_pct && (!activeOverride || !(0, resolver_1.scopeIncludes)(activeOverride.scope, "target_soc_pct"))) {
        socCandidates.push(fieldToCandidate(iobroker.target_soc_pct, PRIORITY_IOBROKER));
    }
    if (iobroker?.deadline && (!activeOverride || !(0, resolver_1.scopeIncludes)(activeOverride.scope, "deadline"))) {
        deadlineCandidates.push(fieldToCandidate(iobroker.deadline, PRIORITY_IOBROKER));
    }
    if (evcc) {
        if (!activeOverride || !(0, resolver_1.scopeIncludes)(activeOverride.scope, "charge_strategy")) {
            chargeCandidates.push(fieldToCandidate(evcc.charge_strategy, PRIORITY_EVCC));
        }
        if (!activeOverride || !(0, resolver_1.scopeIncludes)(activeOverride.scope, "target_soc_pct")) {
            socCandidates.push(fieldToCandidate(evcc.target_soc_pct, PRIORITY_EVCC));
        }
        if (!activeOverride || !(0, resolver_1.scopeIncludes)(activeOverride.scope, "deadline")) {
            deadlineCandidates.push(fieldToCandidate(evcc.deadline, PRIORITY_EVCC));
        }
    }
    if (admin?.charge_strategy) {
        chargeCandidates.push(fieldToCandidate(admin.charge_strategy, PRIORITY_ADMIN));
    }
    if (admin?.target_soc_pct) {
        socCandidates.push(fieldToCandidate(admin.target_soc_pct, PRIORITY_ADMIN));
    }
    const chargeRes = (0, resolver_1.resolveFieldFromCandidates)(chargeCandidates, now);
    const socRes = (0, resolver_1.resolveFieldFromCandidates)(socCandidates, now);
    const deadlineRes = (0, resolver_1.resolveFieldFromCandidates)(deadlineCandidates, now);
    const hasConflict = chargeRes.conflict || socRes.conflict || deadlineRes.conflict;
    const manualOverride = activeOverride ?? {
        active: false,
        scope: [],
        source: "unknown",
        owner: "unknown",
    };
    const sourceSummary = buildSourceSummary(chargeRes.field, socRes.field, deadlineRes.field, manualOverride);
    const draft = {
        schema_version: base.schema_version,
        domain: "wallbox",
        target: base.target,
        revision: 0,
        intent_state: "none",
        resolved_at: base.resolved_at,
        charge_strategy: chargeRes.field,
        target_soc_pct: socRes.field,
        deadline: deadlineRes.field,
        manual_override: manualOverride,
        source_summary: sourceSummary,
    };
    if (hasConflict) {
        draft.intent_state = "conflict";
    }
    else {
        draft.intent_state = (0, validation_2.deriveIntentState)(draft);
    }
    const revision = (0, revision_1.nextRevision)(previous, draft);
    const resolvedAt = previous && !(0, revision_1.semanticIntentChanged)(previous, draft)
        ? previous.resolved_at
        : now.toISOString();
    return {
        ...draft,
        revision,
        resolved_at: resolvedAt,
    };
}
exports.resolveWallboxIntent = resolveWallboxIntent;
function fieldToCandidate(field, priority) {
    return {
        value: field.value,
        status: field.status,
        origin: field.origin,
        observed_at: field.observed_at,
        changed_at: field.changed_at,
        valid_until: field.valid_until,
        raw_value: field.raw_value,
        priority,
    };
}
function buildSourceSummary(charge, soc, deadline, override) {
    const sources = new Set();
    if (override.active) {
        sources.add(`override:${override.source}`);
    }
    for (const f of [charge, soc, deadline]) {
        if (f.status === "valid" && f.origin.source !== "unknown") {
            sources.add(`${f.origin.source}:${f.origin.owner}`);
        }
    }
    return [...sources].sort();
}
function applyClearFields(snapshot, clearFields) {
    const out = { ...snapshot };
    for (const key of clearFields) {
        if (key === "charge_strategy")
            out.charge_strategy = null;
        if (key === "target_soc_pct")
            out.target_soc_pct = null;
        if (key === "deadline")
            out.deadline = null;
        if (key === "manual_override")
            out.manual_override = null;
    }
    return out;
}
exports.applyClearFields = applyClearFields;
