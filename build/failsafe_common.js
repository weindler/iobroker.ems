"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.readForeignBool = exports.readForeignNumber = exports.setEdgeBool = exports.isEmsUnreachable = exports.failsafeTimeoutsFromConfig = void 0;
const ems_activity_1 = require("./ems_activity");
function failsafeTimeoutsFromConfig(config, prefix) {
    const globalEms = Number(config.global_ems_unreachable_timeout_sec);
    const globalVer = Number(config.global_verification_timeout_sec);
    const globalCheck = Number(config.global_failsafe_check_interval_sec);
    const ems = Number(config[`${prefix}_ems_unreachable_timeout_sec`]);
    const ver = Number(config[`${prefix}_verification_timeout_sec`]);
    const check = Number(config[`${prefix}_failsafe_check_interval_sec`]);
    const pick = (specific, global, def, min, max) => {
        const v = Number.isFinite(specific) && specific > 0 ? specific : Number.isFinite(global) && global > 0 ? global : def;
        return Math.min(max, Math.max(min, v));
    };
    return {
        emsUnreachableTimeoutSec: pick(ems, globalEms, 300, 60, 900),
        verificationTimeoutSec: pick(ver, globalVer, 300, 60, 900),
        failsafeCheckIntervalSec: pick(check, globalCheck, 30, 10, 120),
    };
}
exports.failsafeTimeoutsFromConfig = failsafeTimeoutsFromConfig;
function isEmsUnreachable(config, prefix) {
    const { emsUnreachableTimeoutSec } = failsafeTimeoutsFromConfig(config, prefix);
    return (0, ems_activity_1.msSinceEmsActivity)() >= emsUnreachableTimeoutSec * 1000;
}
exports.isEmsUnreachable = isEmsUnreachable;
async function setEdgeBool(adapter, stateId, value) {
    const cur = await adapter.getStateAsync(stateId);
    if (cur?.val === value) {
        return;
    }
    await adapter.setStateAsync(stateId, { val: value, ack: true });
}
exports.setEdgeBool = setEdgeBool;
async function readForeignNumber(adapter, stateId) {
    const id = stateId?.trim();
    if (!id)
        return null;
    try {
        const st = await adapter.getForeignStateAsync(id);
        if (st?.val == null)
            return null;
        const n = Number(st.val);
        return Number.isFinite(n) ? n : null;
    }
    catch {
        return null;
    }
}
exports.readForeignNumber = readForeignNumber;
async function readForeignBool(adapter, stateId) {
    const id = stateId?.trim();
    if (!id)
        return null;
    try {
        const st = await adapter.getForeignStateAsync(id);
        if (st?.val === true || st?.val === 1 || st?.val === "1" || st?.val === "true")
            return true;
        if (st?.val === false || st?.val === 0 || st?.val === "0" || st?.val === "false")
            return false;
        return null;
    }
    catch {
        return null;
    }
}
exports.readForeignBool = readForeignBool;
