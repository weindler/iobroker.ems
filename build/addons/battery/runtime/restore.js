"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.planSafeRestore = void 0;
const ownership_1 = require("./ownership");
/**
 * Safe Restore: charge stoppen → Self Consumption / Modus 2 → Netzausgleich
 * kontrolliert wiederherstellen. Nur sinnvoll bei nachgewiesener EMS-Ownership.
 */
function planSafeRestore(input) {
    if (!(0, ownership_1.canSafeRestore)(input.ownership)) {
        return {
            required: false,
            stopCharge: false,
            setSelfConsumption: false,
            restoreGridBalance: false,
            reason: "no_ownership",
        };
    }
    return {
        required: true,
        stopCharge: true,
        setSelfConsumption: true,
        restoreGridBalance: input.gridBalanceWasActive,
        reason: "ems_ownership",
    };
}
exports.planSafeRestore = planSafeRestore;
