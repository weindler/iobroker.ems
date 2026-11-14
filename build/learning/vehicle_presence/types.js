"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.emptyVehiclePresenceStore = emptyVehiclePresenceStore;
const constants_1 = require("./constants");
function emptyVehiclePresenceStore(nowIso = new Date().toISOString()) {
    return {
        module: constants_1.MODULE_TAG,
        schemaVersion: 2,
        updatedAtIso: nowIso,
        profiles: {},
    };
}
