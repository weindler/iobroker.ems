"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.instanceState = exports.STATE = void 0;
const tree_paths_1 = require("./tree_paths");
/** State IDs under this adapter instance (ems.0 = default instance id 0). */
exports.STATE = {
    global: tree_paths_1.GLOBAL,
    command: tree_paths_1.COMMAND,
    audit: tree_paths_1.AUDIT,
};
function instanceState(instanceId, relativeId) {
    return `ems.${instanceId}.${relativeId}`;
}
exports.instanceState = instanceState;
