"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.applyThermalClearFields = exports.resolveThermalIntent = void 0;
const resolver_1 = require("../core/resolver");
const validation_1 = require("../core/validation");
const validation_2 = require("./validation");
const types_1 = require("./types");
const constants_1 = require("../core/constants");
const PRIORITY_OVERRIDE = 1;
const PRIORITY_IOBROKER = 2;
function resolveThermalIntent(input) {
    const { now, previous, iobroker, override, active } = input;
    if (!active) {
        const empty = (0, types_1.emptyResolvedThermalIntent)(now, constants_1.THERMAL_TARGET_ID);
        empty.intent_state = "disabled";
        return { ...empty, revision: previous?.revision ?? 0 };
    }
    const base = previous ?? (0, types_1.emptyResolvedThermalIntent)(now, constants_1.THERMAL_TARGET_ID);
    const activeOverride = override?.active && (!override.valid_until || !(0, validation_1.isExpiredAt)(override.valid_until, now)) ? override : null;
    const opCands = [];
    const tempCands = [];
    const readyCands = [];
    const prioCands = [];
    const addIob = (field, scope, list) => {
        if (!field)
            return;
        if (activeOverride && (0, resolver_1.scopeIncludes)(activeOverride.scope, scope)) {
            list.push({ ...fieldToCandidate(field, PRIORITY_OVERRIDE) });
        }
        else {
            list.push({ ...fieldToCandidate(field, PRIORITY_IOBROKER) });
        }
    };
    if (iobroker) {
        if (!activeOverride || !(0, resolver_1.scopeIncludes)(activeOverride.scope, "operating_request")) {
            addIob(iobroker.operating_request, "operating_request", opCands);
        }
        else if (iobroker.operating_request) {
            opCands.push(fieldToCandidate(iobroker.operating_request, PRIORITY_OVERRIDE));
        }
        if (!activeOverride || !(0, resolver_1.scopeIncludes)(activeOverride.scope, "target_temperature_c")) {
            addIob(iobroker.target_temperature_c, "target_temperature_c", tempCands);
        }
        else if (iobroker.target_temperature_c) {
            tempCands.push(fieldToCandidate(iobroker.target_temperature_c, PRIORITY_OVERRIDE));
        }
        if (!activeOverride || !(0, resolver_1.scopeIncludes)(activeOverride.scope, "ready_at")) {
            addIob(iobroker.ready_at, "ready_at", readyCands);
        }
        else if (iobroker.ready_at) {
            readyCands.push(fieldToCandidate(iobroker.ready_at, PRIORITY_OVERRIDE));
        }
        if (!activeOverride || !(0, resolver_1.scopeIncludes)(activeOverride.scope, "priority")) {
            addIob(iobroker.priority, "priority", prioCands);
        }
        else if (iobroker.priority) {
            prioCands.push(fieldToCandidate(iobroker.priority, PRIORITY_OVERRIDE));
        }
    }
    const opRes = (0, resolver_1.resolveFieldFromCandidates)(opCands, now);
    const tempRes = (0, resolver_1.resolveFieldFromCandidates)(tempCands, now);
    const readyRes = (0, resolver_1.resolveFieldFromCandidates)(readyCands, now);
    const prioRes = (0, resolver_1.resolveFieldFromCandidates)(prioCands, now);
    const manualOverride = activeOverride ?? { active: false, scope: [], source: "unknown", owner: "unknown" };
    const draft = {
        ...base,
        operating_request: opRes.field,
        target_temperature_c: tempRes.field,
        ready_at: readyRes.field,
        priority: prioRes.field,
        manual_override: manualOverride,
        source_summary: buildSummary(opRes.field, tempRes.field, readyRes.field, prioRes.field, manualOverride),
        intent_state: "none",
    };
    draft.intent_state = (0, validation_2.deriveThermalIntentState)(draft);
    const revision = (0, validation_2.nextThermalRevision)(previous, draft);
    const resolvedAt = previous && (0, validation_2.nextThermalRevision)(previous, draft) === previous.revision ? previous.resolved_at : now.toISOString();
    return { ...draft, revision, resolved_at: resolvedAt };
}
exports.resolveThermalIntent = resolveThermalIntent;
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
function buildSummary(op, temp, ready, prio, override) {
    const s = new Set();
    if (override.active)
        s.add(`override:${override.source}`);
    for (const f of [op, temp, ready, prio]) {
        if (f.status === "valid" && f.origin.source !== "unknown") {
            s.add(`${f.origin.source}:${f.origin.owner}`);
        }
    }
    return [...s].sort();
}
function applyThermalClearFields(snapshot, clearFields) {
    const out = { ...snapshot };
    for (const key of clearFields) {
        if (key === "operating_request")
            out.operating_request = null;
        if (key === "target_temperature_c")
            out.target_temperature_c = null;
        if (key === "ready_at")
            out.ready_at = null;
        if (key === "priority")
            out.priority = null;
        if (key === "manual_override")
            out.manual_override = null;
    }
    return out;
}
exports.applyThermalClearFields = applyThermalClearFields;
