"use strict";
/** Interner EMS-Lebenszeichen-Zähler (Hybrid C — ohne Dauer-Writes). */
Object.defineProperty(exports, "__esModule", { value: true });
exports.isEmsActivityStateId = exports.msSinceEmsActivity = exports.touchEmsActivity = void 0;
let lastActivityMs = Date.now();
function touchEmsActivity() {
    lastActivityMs = Date.now();
}
exports.touchEmsActivity = touchEmsActivity;
function msSinceEmsActivity() {
    return Date.now() - lastActivityMs;
}
exports.msSinceEmsActivity = msSinceEmsActivity;
/** stateChange-ID relativ zur Adapter-Instanz. */
function isEmsActivityStateId(stateId, namespacePrefix) {
    if (!stateId.startsWith(namespacePrefix)) {
        return false;
    }
    const rel = stateId.slice(namespacePrefix.length);
    return (rel.startsWith("ems_mirror.") ||
        rel === "command.inbox" ||
        rel === "command.last_result");
}
exports.isEmsActivityStateId = isEmsActivityStateId;
