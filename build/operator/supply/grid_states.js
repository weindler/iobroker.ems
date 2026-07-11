"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ensureGridSupplyStates = exports.GRID_SUPPLY_STATE_IDS = void 0;
const state_util_1 = require("../../ems_light/state_util");
function strState(id, name, def) {
    return {
        id,
        common: { name, type: "string", role: "text", read: true, write: false, def },
        defaultVal: def,
        setDefaultIfEmpty: true,
    };
}
function numState(id, name, def) {
    return {
        id,
        common: { name, type: "number", role: "value", read: true, write: false, def },
        defaultVal: def,
    };
}
function boolState(id, name, def) {
    return {
        id,
        common: { name, type: "boolean", role: "state", read: true, write: false, def },
        defaultVal: def,
    };
}
exports.GRID_SUPPLY_STATE_IDS = {
    status: "planner.intent.supply.grid.status",
    source: "planner.intent.supply.grid.source",
    generatedAt: "planner.intent.supply.grid.generated_at",
    validUntil: "planner.intent.supply.grid.valid_until",
    currentPriceCtPerKwh: "planner.intent.supply.grid.current_price_ct_per_kwh",
    importAllowed: "planner.intent.supply.grid.import_allowed",
    maxImportPowerW: "planner.intent.supply.grid.max_import_power_w",
    slotsJson: "planner.intent.supply.grid.slots_json",
    reasonDe: "planner.intent.supply.grid.reason_de",
    revision: "planner.intent.supply.grid.revision",
};
async function ensureGridSupplyStates(host) {
    await (0, state_util_1.ensureChannel)(host, "planner.intent.supply", "Planner Supply");
    await (0, state_util_1.ensureChannel)(host, "planner.intent.supply.grid", "Planner Grid Supply");
    const defs = [
        strState(exports.GRID_SUPPLY_STATE_IDS.status, "Grid Supply Status", "not_initialized"),
        strState(exports.GRID_SUPPLY_STATE_IDS.source, "Grid Supply Quelle", "none"),
        strState(exports.GRID_SUPPLY_STATE_IDS.generatedAt, "Grid Supply erzeugt (ISO)"),
        strState(exports.GRID_SUPPLY_STATE_IDS.validUntil, "Grid Supply gültig bis (ISO)"),
        numState(exports.GRID_SUPPLY_STATE_IDS.currentPriceCtPerKwh, "Grid Supply aktueller Preis ct/kWh"),
        boolState(exports.GRID_SUPPLY_STATE_IDS.importAllowed, "Grid Supply Import erlaubt", false),
        numState(exports.GRID_SUPPLY_STATE_IDS.maxImportPowerW, "Grid Supply max. Import W"),
        strState(exports.GRID_SUPPLY_STATE_IDS.slotsJson, "Grid Supply Slots (JSON)", "[]"),
        strState(exports.GRID_SUPPLY_STATE_IDS.reasonDe, "Grid Supply Begründung (DE)", ""),
        numState(exports.GRID_SUPPLY_STATE_IDS.revision, "Grid Supply Revision", 0),
    ];
    await (0, state_util_1.ensureStates)(host, defs);
}
exports.ensureGridSupplyStates = ensureGridSupplyStates;
