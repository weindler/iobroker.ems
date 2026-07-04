"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.planThermal = void 0;
const inputs_1 = require("../inputs");
function planThermal(input) {
    const none = (reason) => ({
        commanded_stage: 0,
        commanded_power_w: 0,
        reason_de: reason,
    });
    if (!input.governanceEnabled) {
        return none("Heizstab-Governance deaktiviert.");
    }
    if (input.thermalMode !== "auto") {
        return none(`Heizstab-Modus „${input.thermalMode}“ — Planner greift nur bei auto.`);
    }
    if (input.surplusW === null) {
        return none("PV-Überschuss unbekannt (PV oder Hauslast fehlt).");
    }
    if (input.bufferTempC !== null && input.bufferTempC >= input.config.planningMaxTempC) {
        return none(`Puffer ${input.bufferTempC.toFixed(1)} °C ≥ Obergrenze ${input.config.planningMaxTempC} °C — kein Heizen.`);
    }
    if (input.surplusW < inputs_1.PLANNER_SURPLUS_MIN_W) {
        return none(`PV-Überschuss ${input.surplusW} W unter Minimum ${inputs_1.PLANNER_SURPLUS_MIN_W} W.`);
    }
    const enabledStages = input.config.stages
        .filter((s) => s.enabled && s.nominalPowerW > 0 && s.setStateId)
        .sort((a, b) => b.nominalPowerW - a.nominalPowerW);
    for (const stage of enabledStages) {
        if (input.surplusW >= stage.nominalPowerW) {
            return {
                commanded_stage: stage.index,
                commanded_power_w: stage.nominalPowerW,
                reason_de: `PV-Überschuss ${input.surplusW} W → Heizstab Stufe ${stage.index} (${stage.nominalPowerW} W).`,
            };
        }
    }
    return none(`PV-Überschuss ${input.surplusW} W reicht für keine Heizstab-Stufe.`);
}
exports.planThermal = planThermal;
