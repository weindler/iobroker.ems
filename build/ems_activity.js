"use strict";
/** Interner EMS-Lebenszeichen-Zähler (Hybrid C — ohne Dauer-Writes). */
Object.defineProperty(exports, "__esModule", { value: true });
exports.touchEmsActivity = touchEmsActivity;
exports.msSinceEmsActivity = msSinceEmsActivity;
exports.isEmsActivityStateId = isEmsActivityStateId;
let lastActivityMs = Date.now();
function touchEmsActivity() {
    lastActivityMs = Date.now();
}
function msSinceEmsActivity() {
    return Date.now() - lastActivityMs;
}
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
