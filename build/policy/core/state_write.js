"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.setStatesIfRevisionChanged = exports.setStateIfChanged = void 0;
async function setStateIfChanged(host, id, val) {
    const cur = await host.getStateAsync(id);
    const curVal = cur?.val;
    if (curVal === val) {
        return false;
    }
    if (typeof val === "string" && typeof curVal === "string" && val === curVal) {
        return false;
    }
    await host.setStateAsync(id, { val, ack: true });
    return true;
}
exports.setStateIfChanged = setStateIfChanged;
async function setStatesIfRevisionChanged(host, revisionStateId, newRevision, writes, updatedAtId, updatedAt) {
    const curRev = await host.getStateAsync(revisionStateId);
    const prevRevision = curRev?.val != null ? String(curRev.val) : "";
    const revisionChanged = prevRevision !== newRevision;
    if (!revisionChanged) {
        return { changed: false, writes: 0 };
    }
    let writeCount = 0;
    for (const w of writes) {
        if (await setStateIfChanged(host, w.id, w.val)) {
            writeCount++;
        }
    }
    await setStateIfChanged(host, revisionStateId, newRevision);
    await setStateIfChanged(host, updatedAtId, updatedAt);
    return { changed: true, writes: writeCount };
}
exports.setStatesIfRevisionChanged = setStatesIfRevisionChanged;
