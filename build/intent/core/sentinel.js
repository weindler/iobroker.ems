"use strict";
/** Leere/null-artige Werte (z. B. EVCC effectivePlanTime = "null"). */
Object.defineProperty(exports, "__esModule", { value: true });
exports.isEmptySentinel = void 0;
const NULLISH_STRINGS = new Set(["null", "undefined", "none", "nil"]);
function isEmptySentinel(raw) {
    if (raw === null || raw === undefined) {
        return true;
    }
    if (typeof raw === "string") {
        const s = raw.trim().toLowerCase();
        return s === "" || NULLISH_STRINGS.has(s);
    }
    return false;
}
exports.isEmptySentinel = isEmptySentinel;
