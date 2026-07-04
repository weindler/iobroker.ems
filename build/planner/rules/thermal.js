"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.planThermal = void 0;
const inputs_1 = require("../inputs");
const thermal_forecast_1 = require("./thermal_forecast");
function enabledStages(config) {
    return config.stages
        .filter((s) => s.enabled && s.nominalPowerW > 0 && s.setStateId)
        .sort((a, b) => b.nominalPowerW - a.nominalPowerW);
}
function withTarget(base, target) {
    return {
        ...base,
        target_temp_c: target.targetTempC,
        target_reason_de: target.targetReasonDe,
        forecast_active: target.forecastActive,
    };
}
/** Ein/Aus: voller Überschuss muss Nennleistung tragen (kein Netzbezug). Mehrstufen: höchste passende Stufe. */
function planThermal(input) {
    const target = (0, thermal_forecast_1.resolveThermalForecastTarget)({
        config: input.config,
        bufferTempC: input.bufferTempC,
        pvTodayKwh: input.pvTodayKwh,
        pvTomorrowKwh: input.pvTomorrowKwh,
        pvBiasStatus: input.pvBiasStatus,
        forecastModeEnabled: input.forecastModeEnabled,
        aiOptimizationAllowed: input.aiOptimizationAllowed,
    });
    const none = (reason) => withTarget({
        commanded_stage: 0,
        commanded_power_w: 0,
        reason_de: reason,
    }, target);
    if (!input.governanceEnabled) {
        return none("Heizstab-Governance deaktiviert.");
    }
    if (!input.modePolicy.allowOptimization || !input.modePolicy.allowThermalAuto) {
        return none(`${input.modePolicy.labelDe} — kein Heizstab-Auftrag.`);
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
    if (input.bufferTempC !== null && input.bufferTempC >= target.targetTempC) {
        return none(`Puffer ${input.bufferTempC.toFixed(1)} °C ≥ Tagesziel ${target.targetTempC} °C — kein Heizen. ${target.targetReasonDe}`);
    }
    if (input.surplusW < inputs_1.PLANNER_SURPLUS_MIN_W) {
        return none(`PV-Überschuss ${input.surplusW} W unter Minimum ${inputs_1.PLANNER_SURPLUS_MIN_W} W.`);
    }
    const stages = enabledStages(input.config);
    if (stages.length === 0) {
        return none("Keine Heizstab-Stufe mit Schaltausgang und Nennleistung konfiguriert.");
    }
    // Ein/Aus (1 Stufe): binär — Überschuss muss die (konfigurierte) Nennleistung decken.
    if (input.config.stageCount === 1) {
        const stage = stages[0];
        if (input.surplusW >= stage.nominalPowerW) {
            return withTarget({
                commanded_stage: stage.index,
                commanded_power_w: stage.nominalPowerW,
                reason_de: `PV-Überschuss ${input.surplusW} W → Heizstab Ein (${stage.nominalPowerW} W). Ziel ${target.targetTempC} °C.`,
            }, target);
        }
        return none(`PV-Überschuss ${input.surplusW} W unter ${stage.nominalPowerW} W für Ein/Aus — kein Einschalten (nur PV).`);
    }
    // Mehrstufen: höchste Stufe wählen, die der Überschuss trägt.
    for (const stage of stages) {
        if (input.surplusW >= stage.nominalPowerW) {
            return withTarget({
                commanded_stage: stage.index,
                commanded_power_w: stage.nominalPowerW,
                reason_de: `PV-Überschuss ${input.surplusW} W → Heizstab Stufe ${stage.index} (${stage.nominalPowerW} W). Ziel ${target.targetTempC} °C.`,
            }, target);
        }
    }
    const minRequired = stages[stages.length - 1]?.nominalPowerW ?? 0;
    return none(`PV-Überschuss ${input.surplusW} W reicht nicht für eine Stufe (kleinste Stufe ${minRequired} W).`);
}
exports.planThermal = planThermal;
