"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.runEmsLightPhase1Tick = void 0;
const tree_paths_1 = require("../tree_paths");
const live_cache_1 = require("./live_cache");
async function runEmsLightPhase1Tick(host) {
    const ts = new Date().toISOString();
    const hints = [];
    let executionMode = "dryrun";
    try {
        const globalMode = await host.getStateAsync(tree_paths_1.GLOBAL.executionMode);
        if (globalMode?.val != null && String(globalMode.val).trim() !== "") {
            executionMode = String(globalMode.val).trim().toLowerCase();
        }
        else {
            hints.push("global.execution_mode nicht gesetzt");
        }
    }
    catch {
        hints.push("global.execution_mode nicht lesbar");
    }
    try {
        await host.setStateAsync("execution.safety.global_execution_mode", {
            val: executionMode,
            ack: true,
        });
    }
    catch (e) {
        hints.push(`execution.safety.global_execution_mode: ${String(e)}`);
    }
    let liveResult = { updated: [], missing: [], errors: [] };
    try {
        liveResult = await (0, live_cache_1.refreshLiveCache)(host);
    }
    catch (e) {
        hints.push(`live_cache: ${String(e)}`);
        liveResult.errors.push(String(e));
    }
    const health = (0, live_cache_1.deriveHealth)(liveResult, !hints.some((h) => h.includes("global.execution_mode nicht")));
    const summaryParts = [
        `Phase 1 read-only. Modus=${executionMode}.`,
        (0, live_cache_1.formatLiveCacheSummary)(liveResult),
        ...hints,
    ];
    try {
        await host.setStateAsync("system.last_tick_at", { val: ts, ack: true });
        await host.setStateAsync("system.health", { val: health, ack: true });
        await host.setStateAsync("execution.safety.summary_de", {
            val: summaryParts.join(" ").trim().slice(0, 480),
            ack: true,
        });
    }
    catch {
        // kein Throw — Phase 1 soll robust bleiben
    }
}
exports.runEmsLightPhase1Tick = runEmsLightPhase1Tick;
