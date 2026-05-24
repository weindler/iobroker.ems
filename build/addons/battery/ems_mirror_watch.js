"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.handleEmsMirrorStateChange = exports.setupEmsMirrorWatch = exports.isEmsMirrorStateId = void 0;
const ems_mirror_1 = require("./ems_mirror");
const mode_orchestrator_1 = require("./mode_orchestrator");
const io_1 = require("./io");
function isEmsMirrorStateId(relativeOrFullId, adapterNamespace) {
    const rel = relativeOrFullId.startsWith(adapterNamespace)
        ? relativeOrFullId.slice(adapterNamespace.length + 1)
        : relativeOrFullId;
    return ems_mirror_1.EMS_MIRROR_BATTERY_IDS.includes(rel);
}
exports.isEmsMirrorStateId = isEmsMirrorStateId;
async function setupEmsMirrorWatch(adapter) {
    for (const relId of ems_mirror_1.EMS_MIRROR_BATTERY_IDS) {
        await adapter.subscribeStatesAsync(relId);
    }
}
exports.setupEmsMirrorWatch = setupEmsMirrorWatch;
async function handleEmsMirrorStateChange(adapter) {
    const reqId = await (0, io_1.readNumber)(adapter, ems_mirror_1.EMS_MIRROR_BATTERY.modeRequestId);
    if (reqId != null && reqId > 0) {
        await (0, mode_orchestrator_1.handleEmsModeRequest)(adapter);
        return;
    }
    const intent = await (0, io_1.readBool)(adapter, ems_mirror_1.EMS_MIRROR_BATTERY.batteryIntentActive);
    if (!intent) {
        await (0, mode_orchestrator_1.onEmsIntentReleased)(adapter);
    }
}
exports.handleEmsMirrorStateChange = handleEmsMirrorStateChange;
