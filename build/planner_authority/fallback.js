"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.performLegacyFallback = void 0;
const pointer_1 = require("./pointer");
/**
 * Deterministic legacy fallback. Never throws (best-effort per step) so a single
 * failing step cannot leave the system in an ambiguous authority state.
 */
async function performLegacyFallback(ctx, reason) {
    // 1. Latch first so nothing re-activates during the transition.
    try {
        ctx.setLatch(reason);
    }
    catch {
        // isolated
    }
    // 2. Invalidate lease + permits.
    try {
        ctx.invalidateLeaseAndPermits();
    }
    catch {
        // isolated
    }
    // 3. Stop the worker publish callback path.
    try {
        ctx.stopWorkerCallback();
    }
    catch {
        // isolated
    }
    // 4. Point authority back to legacy on disk.
    try {
        await (0, pointer_1.writeLegacyPointer)(ctx.layout, {
            generation: ctx.generation,
            sessionId: ctx.sessionId,
            nowMs: ctx.nowMs,
        });
    }
    catch {
        // isolated — pointer read side defaults to legacy on missing/invalid
    }
    // 5. Request a fresh legacy authoritative run.
    try {
        await ctx.requestLegacyRun(reason);
    }
    catch {
        // isolated
    }
    // 6. Publish status last.
    try {
        await ctx.writeStatus();
    }
    catch {
        // isolated
    }
}
exports.performLegacyFallback = performLegacyFallback;
