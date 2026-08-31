"use strict";
/**
 * PHASE 6 — periodischer Sweep: TTL-Ablauf anwenden und Diagnose-States aktualisieren.
 * Reine Transparenz — ändert nie reales Planner-/Control-Verhalten.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.syncAiValidatorStates = void 0;
const persist_1 = require("./persist");
const validate_1 = require("./validate");
const ensure_states_1 = require("./ensure_states");
async function syncAiValidatorStates(host, now = new Date()) {
    const baseDir = host.getAbsolutePath(persist_1.AI_OVERRIDE_LEDGER_CATEGORY);
    const store = await (0, persist_1.readOverrideLedgerStore)(baseDir);
    const swept = (0, validate_1.sweepExpiredOverrides)(store.overrides, now);
    const changed = swept.some((o, i) => o.status !== store.overrides[i]?.status);
    if (changed) {
        await (0, persist_1.writeOverrideLedgerStore)(baseDir, { ...store, updatedAtIso: now.toISOString(), overrides: swept });
    }
    const active = swept.filter((o) => o.status === "active");
    if (!host.setStateAsync)
        return;
    await host.setStateAsync(ensure_states_1.AI_VALIDATOR_STATES.activeOverridesCount, { val: active.length, ack: true });
    await host.setStateAsync(ensure_states_1.AI_VALIDATOR_STATES.lastValidatedAtIso, { val: now.toISOString(), ack: true });
}
exports.syncAiValidatorStates = syncAiValidatorStates;
