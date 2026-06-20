"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ensurePvHorizonStates = void 0;
const state_util_1 = require("../../ems_light/state_util");
const constants_1 = require("./constants");
function numState(id, name, unit) {
    return {
        id,
        common: {
            name,
            type: "number",
            role: "value",
            read: true,
            write: false,
            unit,
        },
    };
}
function strState(id, name, def) {
    return {
        id,
        common: { name, type: "string", role: "text", read: true, write: false, def },
        defaultVal: def,
        setDefaultIfEmpty: true,
    };
}
async function ensurePvHorizonStates(host) {
    await (0, state_util_1.ensureChannel)(host, "learning.pv_horizon", "EMS-Light Learning PV-Horizon");
    const defs = [
        numState("learning.pv_horizon.total_7d_raw_kwh", "PV-Horizon 7d Roh gesamt", "kWh"),
        numState("learning.pv_horizon.total_7d_corrected_kwh", "PV-Horizon 7d korrigiert gesamt", "kWh"),
        numState("learning.pv_horizon.days_available", "PV-Horizon verfügbare Tage"),
        strState("learning.pv_horizon.status", "PV-Horizon Status", "no_data"),
        strState("learning.pv_horizon.last_update", "PV-Horizon letztes Update (ISO)"),
    ];
    for (let d = 1; d <= constants_1.PV_HORIZON_DAY_COUNT; d++) {
        const prefix = `learning.pv_horizon.day${d}`;
        defs.push(numState(`${prefix}.raw_kwh`, `PV-Horizon Tag ${d} Roh`, "kWh"), numState(`${prefix}.corrected_kwh`, `PV-Horizon Tag ${d} korrigiert`, "kWh"), numState(`${prefix}.confidence_pct`, `PV-Horizon Tag ${d} Confidence`, "%"));
    }
    await (0, state_util_1.ensureStates)(host, defs);
}
exports.ensurePvHorizonStates = ensurePvHorizonStates;
