"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.emptyVehiclePresenceStore = void 0;
const constants_1 = require("./constants");
function emptyVehiclePresenceStore(nowIso = new Date().toISOString()) {
    return {
        module: constants_1.MODULE_TAG,
        schemaVersion: 2,
        updatedAtIso: nowIso,
        profiles: {},
    };
}
exports.emptyVehiclePresenceStore = emptyVehiclePresenceStore;
