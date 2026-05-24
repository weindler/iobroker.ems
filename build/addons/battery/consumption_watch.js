"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.clearConsumptionWatch = exports.onConsumptionStateChange = exports.isWatchedConsumptionState = exports.setupConsumptionWatch = void 0;
const io_1 = require("./io");
const grid_balance_runner_1 = require("./grid_balance_runner");
const DEBOUNCE_MS = 800;
let debounceTimer = null;
let watchedConsumptionId = null;
async function setupConsumptionWatch(adapter) {
    const { targetId } = await (0, io_1.mappedTargetId)(adapter, "consumption_w");
    watchedConsumptionId = targetId || null;
    if (watchedConsumptionId) {
        try {
            await adapter.subscribeForeignStatesAsync(watchedConsumptionId);
            adapter.log.info(`battery: subscribe consumption_w → ${watchedConsumptionId}`);
        }
        catch (e) {
            adapter.log.warn(`battery: subscribe consumption failed: ${e}`);
        }
    }
}
exports.setupConsumptionWatch = setupConsumptionWatch;
function isWatchedConsumptionState(stateId) {
    return !!watchedConsumptionId && stateId === watchedConsumptionId;
}
exports.isWatchedConsumptionState = isWatchedConsumptionState;
function onConsumptionStateChange(adapter) {
    if (debounceTimer) {
        clearTimeout(debounceTimer);
    }
    debounceTimer = setTimeout(() => {
        debounceTimer = null;
        void (0, grid_balance_runner_1.runGridBalanceOnConsumptionChange)(adapter, "consumption_change").catch((e) => {
            adapter.log.error(`battery grid_balance on consumption: ${e}`);
        });
    }, DEBOUNCE_MS);
}
exports.onConsumptionStateChange = onConsumptionStateChange;
function clearConsumptionWatch() {
    if (debounceTimer) {
        clearTimeout(debounceTimer);
        debounceTimer = null;
    }
    watchedConsumptionId = null;
}
exports.clearConsumptionWatch = clearConsumptionWatch;
