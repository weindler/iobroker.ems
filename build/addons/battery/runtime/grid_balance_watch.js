"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.clearGridBalanceWatch = exports.scheduleGridBalanceTick = exports.isGridBalanceWatchState = exports.setupGridBalanceWatch = void 0;
const DEBOUNCE_MS = 500;
let debounceTimer = null;
const watchedStateIds = new Set();
async function setupGridBalanceWatch(adapter, table) {
    watchedStateIds.clear();
    for (const role of ["consumption_w", "pv_ac_power_w"]) {
        const slot = table[role];
        if (!slot.enabled || !slot.targetState.trim())
            continue;
        watchedStateIds.add(slot.targetState.trim());
        try {
            await adapter.subscribeForeignStatesAsync(slot.targetState.trim());
            adapter.log.info(`battery: Netzausgleich watch → ${role} (${slot.targetState})`);
        }
        catch (e) {
            adapter.log.warn(`battery: subscribe ${role} failed: ${e}`);
        }
    }
}
exports.setupGridBalanceWatch = setupGridBalanceWatch;
function isGridBalanceWatchState(stateId) {
    return watchedStateIds.has(stateId);
}
exports.isGridBalanceWatchState = isGridBalanceWatchState;
/** Debounced tick — wie früher runGridBalanceOnConsumptionChange (on change). */
function scheduleGridBalanceTick(host, runTick) {
    if (debounceTimer) {
        clearTimeout(debounceTimer);
    }
    debounceTimer = setTimeout(() => {
        debounceTimer = null;
        void runTick(host).catch((e) => host.log.error(`battery grid_balance tick: ${e}`));
    }, DEBOUNCE_MS);
}
exports.scheduleGridBalanceTick = scheduleGridBalanceTick;
function clearGridBalanceWatch() {
    if (debounceTimer) {
        clearTimeout(debounceTimer);
        debounceTimer = null;
    }
    watchedStateIds.clear();
}
exports.clearGridBalanceWatch = clearGridBalanceWatch;
