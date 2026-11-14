"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.resetGridSupplyRevisionForTest = resetGridSupplyRevisionForTest;
exports.runGridSupplyTick = runGridSupplyTick;
exports.gridSupplyRevisionForTest = gridSupplyRevisionForTest;
const state_write_1 = require("../../policy/core/state_write");
const grid_1 = require("./grid");
const grid_read_1 = require("./grid_read");
const grid_states_1 = require("./grid_states");
let lastRevisionPayload = "";
let revision = 0;
function resetGridSupplyRevisionForTest() {
    lastRevisionPayload = "";
    revision = 0;
}
async function runGridSupplyTick(host) {
    const input = await (0, grid_read_1.collectGridSupplyBuildInput)(host, new Date());
    const forecast = (0, grid_1.buildGridSupplyForecast)(input);
    const payload = (0, grid_1.gridSupplyRevisionPayload)(forecast);
    if (payload !== lastRevisionPayload) {
        revision += 1;
        lastRevisionPayload = payload;
    }
    try {
        await (0, state_write_1.setStateIfChanged)(host, grid_states_1.GRID_SUPPLY_STATE_IDS.status, forecast.quality.status);
        await (0, state_write_1.setStateIfChanged)(host, grid_states_1.GRID_SUPPLY_STATE_IDS.source, forecast.source);
        await (0, state_write_1.setStateIfChanged)(host, grid_states_1.GRID_SUPPLY_STATE_IDS.generatedAt, forecast.generatedAt);
        await (0, state_write_1.setStateIfChanged)(host, grid_states_1.GRID_SUPPLY_STATE_IDS.validUntil, forecast.validUntil ?? "");
        await (0, state_write_1.setOptionalNumberIfChanged)(host, grid_states_1.GRID_SUPPLY_STATE_IDS.currentPriceCtPerKwh, forecast.currentPriceCtPerKwh);
        await (0, state_write_1.setStateIfChanged)(host, grid_states_1.GRID_SUPPLY_STATE_IDS.importAllowed, forecast.gridImportAllowed);
        await (0, state_write_1.setOptionalNumberIfChanged)(host, grid_states_1.GRID_SUPPLY_STATE_IDS.maxImportPowerW, forecast.effectiveMaxGridImportW);
        await (0, state_write_1.setStateIfChanged)(host, grid_states_1.GRID_SUPPLY_STATE_IDS.slotsJson, JSON.stringify(forecast.slots));
        await (0, state_write_1.setStateIfChanged)(host, grid_states_1.GRID_SUPPLY_STATE_IDS.reasonDe, forecast.reasonDe);
        await (0, state_write_1.setStateIfChanged)(host, grid_states_1.GRID_SUPPLY_STATE_IDS.revision, revision);
    }
    catch (e) {
        host.log?.warn?.(`grid supply state write: ${String(e)}`);
    }
    return forecast;
}
function gridSupplyRevisionForTest() {
    return revision;
}
