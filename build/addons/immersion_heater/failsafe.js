"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.runImmersionFailsafeCheck = exports.forceImmersionHeaterOff = void 0;
const execution_mode_1 = require("../../execution_mode");
const failsafe_common_1 = require("../../failsafe_common");
const tree_paths_1 = require("../../tree_paths");
const status_1 = require("./status");
const ADDON_ID = "immersion_heater";
let lastEmsReachable = null;
async function mappedEnableTarget(adapter) {
    const base = (0, tree_paths_1.mappingBase)(ADDON_ID, "set_enabled");
    const en = await adapter.getStateAsync(`${base}.enabled`);
    if (en?.val === false) {
        return "";
    }
    const ts = await adapter.getStateAsync(`${base}.target_state`);
    return typeof ts?.val === "string" ? ts.val.trim() : "";
}
async function forceImmersionHeaterOff(adapter, reason) {
    const targetId = await mappedEnableTarget(adapter);
    if (!targetId) {
        adapter.log.warn(`immersion failsafe (${reason}): no set_enabled mapping`);
        return false;
    }
    const live = await (0, execution_mode_1.isLiveWriteAllowed)((id) => adapter.getStateAsync(id), ADDON_ID);
    if (!live) {
        return false;
    }
    try {
        await adapter.setForeignStateAsync(targetId, { val: false, ack: true });
        adapter.log.warn(`immersion failsafe (${reason}): OFF → ${targetId}`);
        return true;
    }
    catch (e) {
        adapter.log.error(`immersion failsafe write failed: ${e}`);
        return false;
    }
}
exports.forceImmersionHeaterOff = forceImmersionHeaterOff;
async function runImmersionFailsafeCheck(adapter) {
    const cfg = adapter.config && typeof adapter.config === "object"
        ? adapter.config
        : {};
    const liveAllowed = await (0, execution_mode_1.isLiveWriteAllowed)((id) => adapter.getStateAsync(id), ADDON_ID);
    const emsReachable = !(0, failsafe_common_1.isEmsUnreachable)(cfg, "ih");
    const wouldTrip = !emsReachable;
    await (0, failsafe_common_1.setEdgeBool)(adapter, status_1.IMMERSION_STATUS_STATES.emsReachable, emsReachable);
    await (0, failsafe_common_1.setEdgeBool)(adapter, status_1.IMMERSION_STATUS_STATES.failsafeWouldTrip, wouldTrip && !liveAllowed);
    if (lastEmsReachable !== emsReachable) {
        lastEmsReachable = emsReachable;
        adapter.log.info(`immersion_heater: ems_reachable=${emsReachable}`);
    }
    const ts = new Date().toISOString();
    await adapter.setStateAsync(status_1.IMMERSION_STATUS_STATES.updatedAt, { val: ts, ack: true });
    if (!wouldTrip) {
        if (!liveAllowed) {
            return;
        }
        const active = await adapter.getStateAsync(status_1.IMMERSION_STATUS_STATES.failsafeActive);
        if (active?.val === true) {
            await adapter.setStateAsync(status_1.IMMERSION_STATUS_STATES.failsafeActive, { val: false, ack: true });
        }
        return;
    }
    if (!liveAllowed) {
        return;
    }
    const wrote = await forceImmersionHeaterOff(adapter, "ems_unreachable");
    if (wrote) {
        await adapter.setStateAsync(status_1.IMMERSION_STATUS_STATES.failsafeActive, { val: true, ack: true });
        await adapter.setStateAsync(status_1.IMMERSION_STATUS_STATES.lastFailsafeAt, { val: ts, ack: true });
    }
}
exports.runImmersionFailsafeCheck = runImmersionFailsafeCheck;
