"use strict";
/**
 * PHASE 6 — Daily-Analyst-Findings in Validator-Vorschläge überführen.
 *
 * Nur wenn Admin `ai_override_enabled` gesetzt ist. Ohne numerischen Vorschlag,
 * ohne Allowlist-Treffer oder bei bereits aktivem Override für denselben Parameter:
 * kein Raten, kein Stacking.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.ingestAnalystFindingsAsOverrides = void 0;
const persist_1 = require("./persist");
const allowlist_1 = require("./allowlist");
const validate_1 = require("./validate");
const ensure_states_1 = require("./ensure_states");
async function publish(host, id, val) {
    if (!host.setStateAsync)
        return;
    try {
        await host.setStateAsync(id, { val, ack: true });
    }
    catch {
        /* Transparenz-States sind best-effort */
    }
}
async function ingestAnalystFindingsAsOverrides(host, findings, dateKey, now = new Date()) {
    const result = {
        considered: 0,
        accepted: 0,
        rejected: 0,
        skipped: 0,
        overrides: [],
    };
    const baseDir = host.getAbsolutePath(persist_1.AI_OVERRIDE_LEDGER_CATEGORY);
    const store = await (0, persist_1.readOverrideLedgerStore)(baseDir);
    const active = (0, validate_1.sweepExpiredOverrides)(store.overrides, now).filter((o) => o.status === "active");
    for (const f of findings) {
        if (!f.affectedParameter || f.proposedNumericValue === null || !Number.isFinite(f.proposedNumericValue)) {
            result.skipped += 1;
            continue;
        }
        const bounds = (0, allowlist_1.boundsForOverrideParameter)(f.affectedParameter);
        if (!bounds) {
            result.skipped += 1;
            continue;
        }
        if (active.some((o) => o.parameter === f.affectedParameter)) {
            result.skipped += 1;
            continue;
        }
        const originalValue = (0, allowlist_1.defaultOriginalValueForParameter)(f.affectedParameter);
        if (originalValue === null) {
            result.skipped += 1;
            continue;
        }
        result.considered += 1;
        const proposal = {
            parameter: f.affectedParameter,
            originalValue,
            proposedValue: f.proposedNumericValue,
            reasoningDe: f.suggestedImprovementDe,
            evidence: f.evidence,
            confidencePct: f.confidencePct,
            sampleCount: Math.max(1, f.evidence.length),
            dataAgeDays: 1,
            source: "daily_analyst",
            createdAtIso: now.toISOString(),
        };
        const validated = (0, validate_1.validateOverrideProposal)(proposal, bounds, dateKey, now);
        await (0, persist_1.appendOverrideToLedger)(baseDir, validated, now);
        result.overrides.push(validated);
        if (validated.status === "active") {
            result.accepted += 1;
            active.push(validated);
            await publish(host, ensure_states_1.AI_VALIDATOR_STATES.lastAcceptedParameter, validated.parameter);
        }
        else {
            result.rejected += 1;
            await publish(host, ensure_states_1.AI_VALIDATOR_STATES.lastRejectReasonDe, validated.rejectReasonDe ?? "");
        }
    }
    return result;
}
exports.ingestAnalystFindingsAsOverrides = ingestAnalystFindingsAsOverrides;
