"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.writeForeignIfLive = exports.readMappedRole = exports.mappedTargetId = exports.readForeignNumber = exports.readNumber = exports.readBool = void 0;
const tree_paths_1 = require("../../tree_paths");
const ADDON_ID = "battery";
async function readBool(adapter, relativeId) {
    const st = await adapter.getStateAsync(relativeId);
    return st?.val === true;
}
exports.readBool = readBool;
async function readNumber(adapter, relativeId) {
    const st = await adapter.getStateAsync(relativeId);
    if (st?.val == null)
        return null;
    const n = Number(st.val);
    return Number.isFinite(n) ? n : null;
}
exports.readNumber = readNumber;
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
async function mappedTargetId(adapter, role) {
    const base = (0, tree_paths_1.mappingBase)(ADDON_ID, role);
    const en = await adapter.getStateAsync(`${base}.enabled`);
    if (en?.val === false) {
        return { enabled: false, targetId: "" };
    }
    const ts = await adapter.getStateAsync(`${base}.target_state`);
    const targetId = typeof ts?.val === "string" ? ts.val.trim() : "";
    return { enabled: true, targetId };
}
exports.mappedTargetId = mappedTargetId;
async function readMappedRole(adapter, role) {
    const { enabled, targetId } = await mappedTargetId(adapter, role);
    if (!enabled || !targetId)
        return null;
    return readForeignNumber(adapter, targetId);
}
exports.readMappedRole = readMappedRole;
async function writeForeignIfLive(adapter, stateId, value, liveEnabled) {
    if (!stateId?.trim() || !liveEnabled)
        return false;
    await adapter.setForeignStateAsync(stateId.trim(), { val: value, ack: true });
    return true;
}
exports.writeForeignIfLive = writeForeignIfLive;
