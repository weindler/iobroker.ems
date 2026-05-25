"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.runBatteryFailsafeCheck = exports.noteBatteryModeDesired = exports.isBatteryAddonDead = void 0;
const execution_mode_1 = require("../../execution_mode");
const failsafe_common_1 = require("../../failsafe_common");
const status_battery_1 = require("../../status_battery");
const ems_mirror_1 = require("./ems_mirror");
const io_1 = require("./io");
const mode_control_1 = require("./mode_control");
const mode_orchestrator_1 = require("./mode_orchestrator");
let pendingDesiredMode = null;
let pendingSinceMs = 0;
let pendingRequestId = null;
let lastEmsReachable = null;
function isBatteryAddonDead(adapter) {
    return adapter.getStateAsync(status_battery_1.BATTERY_STATUS_STATES.addonDead).then((st) => st?.val === true);
}
exports.isBatteryAddonDead = isBatteryAddonDead;
async function readActualOperatingMode(adapter) {
    const { enabled, targetId } = await (0, io_1.mappedTargetId)(adapter, "operating_mode");
    if (!enabled || !targetId) {
        return null;
    }
    const n = await (0, failsafe_common_1.readForeignNumber)(adapter, targetId);
    if (n == null)
        return null;
    const m = Math.round(n);
    return m === 1 || m === 2 ? m : null;
}
async function noteBatteryModeDesired(adapter) {
    const target = await (0, io_1.readNumber)(adapter, ems_mirror_1.EMS_MIRROR_BATTERY.operatingModeTarget);
    const reqId = await (0, io_1.readNumber)(adapter, ems_mirror_1.EMS_MIRROR_BATTERY.modeRequestId);
    if (target !== 1 && target !== 2) {
        return;
    }
    if (reqId == null || reqId <= 0) {
        return;
    }
    if (reqId === pendingRequestId && target === pendingDesiredMode) {
        return;
    }
    pendingRequestId = reqId;
    pendingDesiredMode = target;
    pendingSinceMs = Date.now();
}
exports.noteBatteryModeDesired = noteBatteryModeDesired;
async function forceBatterySafeMode2(adapter, reason) {
    const live = await (0, execution_mode_1.isLiveWriteAllowed)((id) => adapter.getStateAsync(id), "battery");
    if (!live) {
        return false;
    }
    const err = await (0, mode_control_1.ensureOperatingMode)(adapter, mode_control_1.SONNEN_OPERATING_MODE_AUTO, true);
    if (err) {
        adapter.log.warn(`battery failsafe (${reason}): mode 2 not written (${err})`);
        return false;
    }
    adapter.log.warn(`battery failsafe (${reason}): forced operating mode 2 (Eigenverbrauch)`);
    return true;
}
async function runBatteryFailsafeCheck(adapter) {
    const cfg = adapter.config && typeof adapter.config === "object"
        ? adapter.config
        : {};
    const { verificationTimeoutSec } = (0, failsafe_common_1.failsafeTimeoutsFromConfig)(cfg, "bat");
    const liveAllowed = await (0, execution_mode_1.isLiveWriteAllowed)((id) => adapter.getStateAsync(id), "battery");
    const emsReachable = !(0, failsafe_common_1.isEmsUnreachable)(cfg, "bat");
    await (0, failsafe_common_1.setEdgeBool)(adapter, status_battery_1.BATTERY_STATUS_STATES.emsReachable, emsReachable);
    if (lastEmsReachable !== emsReachable) {
        lastEmsReachable = emsReachable;
        adapter.log.info(`battery: ems_reachable=${emsReachable}`);
    }
    const ts = new Date().toISOString();
    await adapter.setStateAsync(status_battery_1.BATTERY_STATUS_STATES.updatedAt, { val: ts, ack: true });
    await noteBatteryModeDesired(adapter);
    const actual = await readActualOperatingMode(adapter);
    const desired = pendingDesiredMode;
    const verificationDue = desired != null &&
        actual != null &&
        actual !== desired &&
        Date.now() - pendingSinceMs >= verificationTimeoutSec * 1000;
    const seqStuck = (0, mode_orchestrator_1.isModeSequenceRunning)() && Date.now() - pendingSinceMs >= verificationTimeoutSec * 1000;
    const shouldTrip = !emsReachable || verificationDue || seqStuck;
    await (0, failsafe_common_1.setEdgeBool)(adapter, status_battery_1.BATTERY_STATUS_STATES.failsafeWouldTrip, shouldTrip && !liveAllowed);
    const dead = await adapter.getStateAsync(status_battery_1.BATTERY_STATUS_STATES.addonDead);
    if (dead?.val === true && emsReachable && actual === mode_control_1.SONNEN_OPERATING_MODE_AUTO) {
        await (0, failsafe_common_1.setEdgeBool)(adapter, status_battery_1.BATTERY_STATUS_STATES.addonDead, false);
        await (0, failsafe_common_1.setEdgeBool)(adapter, status_battery_1.BATTERY_STATUS_STATES.actuatorReachable, true);
        pendingDesiredMode = 2;
    }
    if (!shouldTrip) {
        if (actual != null && desired != null && actual === desired) {
            await (0, failsafe_common_1.setEdgeBool)(adapter, status_battery_1.BATTERY_STATUS_STATES.actuatorReachable, true);
            await (0, failsafe_common_1.setEdgeBool)(adapter, status_battery_1.BATTERY_STATUS_STATES.addonDead, false);
        }
        const active = await adapter.getStateAsync(status_battery_1.BATTERY_STATUS_STATES.failsafeActive);
        if (active?.val === true && liveAllowed) {
            await adapter.setStateAsync(status_battery_1.BATTERY_STATUS_STATES.failsafeActive, { val: false, ack: true });
        }
        return;
    }
    if (!liveAllowed) {
        return;
    }
    const reason = !emsReachable ? "ems_unreachable" : seqStuck ? "mode_sequence_stuck" : "mode_verify_timeout";
    const wrote = await forceBatterySafeMode2(adapter, reason);
    if (wrote) {
        await (0, failsafe_common_1.setEdgeBool)(adapter, status_battery_1.BATTERY_STATUS_STATES.actuatorReachable, false);
        await (0, failsafe_common_1.setEdgeBool)(adapter, status_battery_1.BATTERY_STATUS_STATES.addonDead, true);
        await adapter.setStateAsync(status_battery_1.BATTERY_STATUS_STATES.failsafeActive, { val: true, ack: true });
        await adapter.setStateAsync(status_battery_1.BATTERY_STATUS_STATES.lastFailsafeAt, { val: ts, ack: true });
        pendingDesiredMode = 2;
        pendingSinceMs = Date.now();
    }
}
exports.runBatteryFailsafeCheck = runBatteryFailsafeCheck;
