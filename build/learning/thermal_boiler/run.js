"use strict";
/**
 * Boiler-Learning A — frischer Start, keine Migration aus Puffer-Zyklen.
 * Ohne genug Samples: kein Fake-emptyAt (Hard nutzt dann nur aktuelle Boiler-Temp vs Min).
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.runThermalBoilerLearning = void 0;
const state_write_1 = require("../../policy/core/state_write");
const state_util_1 = require("../../ems_light/state_util");
const tree_paths_1 = require("../../tree_paths");
const ensure_states_1 = require("./ensure_states");
async function resolveBoilerTempStateId(host) {
    const c = host.config && typeof host.config === "object" ? host.config : {};
    const admin = typeof c.ih_boiler_temp_c_target === "string" ? c.ih_boiler_temp_c_target.trim() : "";
    if (admin)
        return admin;
    const base = (0, tree_paths_1.mappingBase)("immersion_heater", "boiler_temp_c");
    const en = await host.getStateAsync(`${base}.enabled`);
    if (en?.val === false)
        return "";
    const t = await host.getStateAsync(`${base}.target_state`);
    return typeof t?.val === "string" ? t.val.trim() : "";
}
async function runThermalBoilerLearning(host) {
    await (0, ensure_states_1.ensureThermalBoilerLearningStates)(host);
    const nowIso = new Date().toISOString();
    const stateId = await resolveBoilerTempStateId(host);
    let temp = null;
    if (stateId && host.getForeignStateAsync) {
        try {
            temp = (0, state_util_1.asNum)((await host.getForeignStateAsync(stateId))?.val);
        }
        catch {
            temp = null;
        }
    }
    if (temp === null) {
        temp = (0, state_util_1.asNum)((await host.getStateAsync("live.thermal.boiler_temp_c"))?.val);
    }
    const samples = (0, state_util_1.asNum)((await host.getStateAsync("learning.thermal_boiler.samples"))?.val) ?? 0;
    await (0, state_write_1.setStateIfChanged)(host, "learning.thermal_boiler.last_run", nowIso);
    await (0, state_write_1.setStateIfChanged)(host, "learning.thermal_boiler.current_temperature_c", temp);
    await (0, state_write_1.setStateIfChanged)(host, "learning.thermal_boiler.samples", samples);
    if (temp === null) {
        await (0, state_write_1.setStateIfChanged)(host, "learning.thermal_boiler.status", "insufficient_data");
        await (0, state_write_1.setStateIfChanged)(host, "learning.thermal_boiler.health", "degraded");
        await (0, state_write_1.setStateIfChanged)(host, "learning.thermal_boiler.reason_de", "Boiler-Sensor fehlt — kein Fake-emptyAt; Hard nur bei verfügbarer Live-Temperatur.");
        await (0, state_write_1.setStateIfChanged)(host, "learning.thermal_boiler.estimated_empty_at", "");
        return;
    }
    /**
     * Cycle-Fit bewusst noch nicht aus Puffer-Historie übernommen.
     * Bis echte Boiler-Zyklen existieren: degraded, keine emptyAt-Deadline.
     */
    await (0, state_write_1.setStateIfChanged)(host, "learning.thermal_boiler.status", "insufficient_data");
    await (0, state_write_1.setStateIfChanged)(host, "learning.thermal_boiler.health", "degraded");
    await (0, state_write_1.setStateIfChanged)(host, "learning.thermal_boiler.estimated_empty_at", "");
    await (0, state_write_1.setStateIfChanged)(host, "learning.thermal_boiler.estimated_remaining_hours", null);
    await (0, state_write_1.setStateIfChanged)(host, "learning.thermal_boiler.reason_de", `Boiler ${temp.toFixed(1)} °C — Learning sammelt Zyklen; noch keine belastbare Reichweite.`);
}
exports.runThermalBoilerLearning = runThermalBoilerLearning;
