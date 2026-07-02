"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.applyBatteryClearFields = exports.resolveBatteryIntent = void 0;
const resolver_1 = require("../core/resolver");
const validation_1 = require("../core/validation");
const validation_2 = require("./validation");
const types_1 = require("./types");
const constants_1 = require("../core/constants");
const PRIORITY_OVERRIDE = 1;
const PRIORITY_EVCC = 2;
const PRIORITY_IOBROKER = 3;
function resolveBatteryIntent(input) {
    const { now, previous, iobroker, evcc, override, active } = input;
    if (!active) {
        const empty = (0, types_1.emptyResolvedBatteryIntent)(now, constants_1.BATTERY_TARGET_ID);
        empty.intent_state = "disabled";
        return { ...empty, revision: previous?.revision ?? 0 };
    }
    const base = previous ?? (0, types_1.emptyResolvedBatteryIntent)(now, constants_1.BATTERY_TARGET_ID);
    const activeOverride = override?.active && (!override.valid_until || !(0, validation_1.isExpiredAt)(override.valid_until, now)) ? override : null;
    const opCands = [];
    const socCands = [];
    const gridCands = [];
    const evDisCands = [];
    const topOffCands = [];
    addFieldCandidate(iobroker?.operating_request, "operating_request", opCands, activeOverride);
    addFieldCandidate(iobroker?.target_soc_pct, "target_soc_pct", socCands, activeOverride);
    addFieldCandidate(iobroker?.grid_charge_request, "grid_charge_request", gridCands, activeOverride);
    addFieldCandidate(iobroker?.ev_discharge_allowed, "ev_discharge_allowed", evDisCands, activeOverride);
    addFieldCandidate(iobroker?.top_off_requested, "top_off_requested", topOffCands, activeOverride);
    addEvccFieldCandidate(evcc?.operating_request, "operating_request", opCands, activeOverride);
    addEvccFieldCandidate(evcc?.grid_charge_request, "grid_charge_request", gridCands, activeOverride);
    addEvccFieldCandidate(evcc?.ev_discharge_allowed, "ev_discharge_allowed", evDisCands, activeOverride);
    const opRes = (0, resolver_1.resolveFieldFromCandidates)(opCands, now);
    const socRes = (0, resolver_1.resolveFieldFromCandidates)(socCands, now);
    const gridRes = (0, resolver_1.resolveFieldFromCandidates)(gridCands, now);
    const evDisRes = (0, resolver_1.resolveFieldFromCandidates)(evDisCands, now);
    const topOffRes = (0, resolver_1.resolveFieldFromCandidates)(topOffCands, now);
    const manualOverride = activeOverride ?? { active: false, scope: [], source: "unknown", owner: "unknown" };
    const draft = {
        ...base,
        operating_request: opRes.field,
        target_soc_pct: socRes.field,
        grid_charge_request: gridRes.field,
        ev_discharge_allowed: evDisRes.field,
        top_off_requested: topOffRes.field,
        manual_override: manualOverride,
        source_summary: buildSummary(opRes.field, socRes.field, gridRes.field, evDisRes.field, topOffRes.field, manualOverride),
        intent_state: "none",
    };
    draft.intent_state = (0, validation_2.deriveBatteryIntentState)(draft);
    const revision = (0, validation_2.nextBatteryRevision)(previous, draft);
    const resolvedAt = previous && (0, validation_2.nextBatteryRevision)(previous, draft) === previous.revision ? previous.resolved_at : now.toISOString();
    return { ...draft, revision, resolved_at: resolvedAt };
}
exports.resolveBatteryIntent = resolveBatteryIntent;
function addFieldCandidate(field, scope, list, activeOverride) {
    if (!field)
        return;
    if (activeOverride && (0, resolver_1.scopeIncludes)(activeOverride.scope, scope)) {
        list.push(fieldToCandidate(field, PRIORITY_OVERRIDE));
    }
    else if (!activeOverride || !(0, resolver_1.scopeIncludes)(activeOverride.scope, scope)) {
        list.push(fieldToCandidate(field, PRIORITY_IOBROKER));
    }
}
function addEvccFieldCandidate(field, scope, list, activeOverride) {
    if (!field || field.status !== "valid")
        return;
    if (activeOverride && (0, resolver_1.scopeIncludes)(activeOverride.scope, scope))
        return;
    list.push(fieldToCandidate(field, PRIORITY_EVCC));
}
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
function buildSummary(op, soc, grid, evDis, topOff, override) {
    const s = new Set();
    if (override.active)
        s.add(`override:${override.source}`);
    for (const f of [op, soc, grid, evDis, topOff]) {
        if (f.status === "valid" && f.origin.source !== "unknown") {
            s.add(`${f.origin.source}:${f.origin.owner}`);
        }
    }
    return [...s].sort();
}
function applyBatteryClearFields(snapshot, clearFields) {
    const out = { ...snapshot };
    for (const key of clearFields) {
        if (key === "operating_request")
            out.operating_request = null;
        if (key === "target_soc_pct")
            out.target_soc_pct = null;
        if (key === "grid_charge_request")
            out.grid_charge_request = null;
        if (key === "ev_discharge_allowed")
            out.ev_discharge_allowed = null;
        if (key === "top_off_requested")
            out.top_off_requested = null;
        if (key === "manual_override")
            out.manual_override = null;
    }
    return out;
}
exports.applyBatteryClearFields = applyBatteryClearFields;
