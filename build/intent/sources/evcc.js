"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.readEvccIntentSnapshot = void 0;
const normalize_1 = require("../wallbox/normalize");
const config_1 = require("../config");
async function readForeign(host, objectId) {
    if (!objectId || !(0, config_1.isValidExternalStateId)(objectId)) {
        return null;
    }
    if (host.getForeignStateAsync) {
        const st = await host.getForeignStateAsync(objectId);
        if (!st)
            return null;
        return { val: st.val, ts: st.ts };
    }
    // Fallback: only works if id is relative to adapter namespace (should not happen for EVCC)
    const st = await host.getStateAsync(objectId);
    if (!st)
        return null;
    return { val: st.val, ts: st.ts };
}
function makeField(value, status, observedAt, raw, changedAt) {
    return {
        value,
        status,
        origin: {
            source: "evcc",
            owner: "evcc",
            change_kind: "unknown",
        },
        observed_at: observedAt,
        changed_at: changedAt,
        raw_value: raw,
    };
}
async function readEvccIntentSnapshot(host, cfg, timezone, now) {
    const observedAt = now.toISOString();
    const ids = (0, config_1.configuredEvccStateIds)(cfg);
    if (ids.length === 0) {
        return {
            observed_at: observedAt,
            charge_strategy: makeField(null, "missing", observedAt, null),
            target_soc_pct: makeField(null, "missing", observedAt, null),
            deadline: makeField(null, "missing", observedAt, null),
            status: "unconfigured",
        };
    }
    let lastError;
    let sourceTs;
    try {
        if (cfg.sourceTimestampStateId) {
            const tsSt = await readForeign(host, cfg.sourceTimestampStateId);
            if (tsSt?.val != null) {
                const n = typeof tsSt.val === "number" ? tsSt.val : Date.parse(String(tsSt.val));
                if (Number.isFinite(n)) {
                    sourceTs = new Date(n > 1e12 ? n : n * 1000).toISOString();
                }
            }
        }
        let modeRaw = null;
        let socRaw = null;
        let deadlineRaw = null;
        let immediateRaw = null;
        if (cfg.modeStateId) {
            const st = await readForeign(host, cfg.modeStateId);
            modeRaw = st?.val ?? null;
        }
        if (cfg.targetSocStateId) {
            const st = await readForeign(host, cfg.targetSocStateId);
            socRaw = st?.val ?? null;
        }
        if (cfg.deadlineStateId) {
            const st = await readForeign(host, cfg.deadlineStateId);
            deadlineRaw = st?.val ?? null;
        }
        if (cfg.immediateStateId) {
            const st = await readForeign(host, cfg.immediateStateId);
            immediateRaw = st?.val ?? null;
        }
        const modeNorm = (0, normalize_1.normalizeEvccMode)(modeRaw);
        let strategy = modeNorm.strategy;
        let strategyStatus = modeNorm.status;
        let strategyRaw = modeNorm.raw;
        const imm = (0, normalize_1.immediateFromBool)(immediateRaw);
        if (imm === "immediate" && strategy !== "immediate") {
            strategy = "immediate";
            strategyStatus = "valid";
            strategyRaw = immediateRaw ?? modeRaw;
        }
        const socNorm = (0, normalize_1.normalizeTargetSoc)(socRaw);
        const deadlineNorm = (0, normalize_1.normalizeDeadline)(deadlineRaw, timezone, now);
        const changedAt = sourceTs;
        const charge_strategy = makeField(strategy, strategyStatus, observedAt, strategyRaw, changedAt);
        const target_soc_pct = makeField(socNorm.value, socNorm.status, observedAt, socNorm.raw, changedAt);
        const deadline = makeField(deadlineNorm.value, deadlineNorm.status, observedAt, deadlineNorm.raw, changedAt);
        const hasAny = charge_strategy.status !== "missing" ||
            target_soc_pct.status !== "missing" ||
            deadline.status !== "missing";
        return {
            observed_at: observedAt,
            charge_strategy,
            target_soc_pct,
            deadline,
            status: hasAny ? "ok" : "partial",
            last_error: lastError,
        };
    }
    catch (e) {
        lastError = String(e);
        return {
            observed_at: observedAt,
            charge_strategy: makeField(null, "missing", observedAt, null),
            target_soc_pct: makeField(null, "missing", observedAt, null),
            deadline: makeField(null, "missing", observedAt, null),
            status: "error",
            last_error: lastError,
        };
    }
}
exports.readEvccIntentSnapshot = readEvccIntentSnapshot;
