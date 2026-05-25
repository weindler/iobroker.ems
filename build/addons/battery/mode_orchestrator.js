"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.onEmsIntentReleased = exports.handleEmsModeRequest = exports.isModeSequenceRunning = exports.isGridBalancePaused = void 0;
const execution_mode_1 = require("../../execution_mode");
const status_battery_1 = require("../../status_battery");
const ems_mirror_1 = require("./ems_mirror");
const io_1 = require("./io");
const mode_delays_1 = require("./mode_delays");
const mode_control_1 = require("./mode_control");
const sleep = (ms) => new Promise((resolve) => {
    setTimeout(resolve, ms);
});
let gridBalancePaused = false;
let modeSequenceRunning = false;
let lastHandledRequestId = null;
function isGridBalancePaused() {
    return gridBalancePaused || modeSequenceRunning;
}
exports.isGridBalancePaused = isGridBalancePaused;
function isModeSequenceRunning() {
    return modeSequenceRunning;
}
exports.isModeSequenceRunning = isModeSequenceRunning;
async function setSequenceStatus(adapter, status, detail) {
    await adapter.setStateAsync(status_battery_1.BATTERY_STATUS_STATES.modeSequenceStatus, { val: status, ack: true });
    if (detail !== undefined) {
        await adapter.setStateAsync(status_battery_1.BATTERY_STATUS_STATES.modeSequenceDetail, { val: detail, ack: true });
    }
}
async function handleEmsModeRequest(adapter) {
    const reqId = await (0, io_1.readNumber)(adapter, ems_mirror_1.EMS_MIRROR_BATTERY.modeRequestId);
    const target = await (0, io_1.readNumber)(adapter, ems_mirror_1.EMS_MIRROR_BATTERY.operatingModeTarget);
    const chargeW = await (0, io_1.readNumber)(adapter, ems_mirror_1.EMS_MIRROR_BATTERY.chargePowerWRequest);
    if (reqId == null || reqId <= 0) {
        return;
    }
    if (lastHandledRequestId === reqId) {
        return;
    }
    if (modeSequenceRunning) {
        return;
    }
    const mode = target === 1 ? 1 : target === 2 ? 2 : null;
    if (mode == null) {
        return;
    }
    modeSequenceRunning = true;
    lastHandledRequestId = reqId;
    const cfg = adapter.config && typeof adapter.config === "object"
        ? adapter.config
        : {};
    const delays = (0, mode_delays_1.modeSwitchDelaysFromConfig)(cfg);
    const live = await (0, execution_mode_1.isLiveWriteAllowed)((id) => adapter.getStateAsync(id), "battery");
    try {
        if (mode === 2) {
            await setSequenceStatus(adapter, "running", "mode_2_immediate");
            gridBalancePaused = true;
            await (0, mode_control_1.ensureOperatingMode)(adapter, mode_control_1.SONNEN_OPERATING_MODE_AUTO, live);
            gridBalancePaused = false;
            await setSequenceStatus(adapter, "done", "mode_2");
            adapter.log.info(`battery mode sequence: mode 2 (request ${reqId})`);
            return;
        }
        // Mode 1: Netzausgleich stoppen → warten → Modus → warten → optional charge
        await setSequenceStatus(adapter, "running", "pause_grid_balance");
        gridBalancePaused = true;
        adapter.log.info(`battery mode sequence: pause grid_balance ${delays.pauseGridBalanceSec}s (request ${reqId})`);
        if (delays.pauseGridBalanceSec > 0) {
            await sleep(delays.pauseGridBalanceSec * 1000);
        }
        await setSequenceStatus(adapter, "running", "set_mode_1");
        await (0, mode_control_1.ensureOperatingMode)(adapter, mode_control_1.SONNEN_OPERATING_MODE_MANUAL, live);
        if (delays.waitAfterModeSec > 0) {
            await setSequenceStatus(adapter, "running", `wait_after_mode_${delays.waitAfterModeSec}s`);
            await sleep(delays.waitAfterModeSec * 1000);
        }
        const chargeMap = await (0, io_1.mappedTargetId)(adapter, "battery_charging_w");
        if (chargeW != null && chargeW > 0 && chargeMap.targetId) {
            await setSequenceStatus(adapter, "running", `write_charge_${chargeW}w`);
            const wrote = await (0, io_1.writeForeignIfLive)(adapter, chargeMap.targetId, Math.round(chargeW), live);
            adapter.log.info(`battery mode sequence: charge ${chargeW} W → ${chargeMap.targetId} (${wrote ? "live" : "dryrun"})`);
        }
        // Modus 1 + EMS-Intent: Netzausgleich bleibt pausiert bis EMS Modus 2 anfordert
        const intentActive = await (0, io_1.readBool)(adapter, ems_mirror_1.EMS_MIRROR_BATTERY.batteryIntentActive);
        if (!intentActive) {
            gridBalancePaused = false;
        }
        await setSequenceStatus(adapter, "done", intentActive ? "mode_1_hold_pause" : "mode_1");
    }
    catch (e) {
        gridBalancePaused = false;
        const msg = e instanceof Error ? e.message : String(e);
        await setSequenceStatus(adapter, "error", msg);
        adapter.log.error(`battery mode sequence failed: ${msg}`);
    }
    finally {
        modeSequenceRunning = false;
    }
}
exports.handleEmsModeRequest = handleEmsModeRequest;
/** EMS hat Intent beendet → Pause aufheben, ggf. Netzausgleich wieder erlauben. */
async function onEmsIntentReleased(adapter) {
    if (!modeSequenceRunning) {
        gridBalancePaused = false;
    }
    await setSequenceStatus(adapter, "idle", "");
}
exports.onEmsIntentReleased = onEmsIntentReleased;
