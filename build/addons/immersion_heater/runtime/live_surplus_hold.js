"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.computeImmersionLiveSurplusHold = exports.minEnabledImmersionStage = exports.computeEffectivePvSurplusW = void 0;
function computeEffectivePvSurplusW(pvPowerW, houseLoadW, immersionOnPowerW) {
    if (pvPowerW === null || houseLoadW === null)
        return null;
    if (!Number.isFinite(pvPowerW) || !Number.isFinite(houseLoadW))
        return null;
    const ih = Math.max(0, immersionOnPowerW ?? 0);
    return Math.round(pvPowerW - houseLoadW + ih);
}
exports.computeEffectivePvSurplusW = computeEffectivePvSurplusW;
function minEnabledImmersionStage(config) {
    const enabled = config.stages.filter((s) => s.enabled && s.nominalPowerW > 0 && s.setStateId);
    if (enabled.length === 0)
        return null;
    const min = [...enabled].sort((a, b) => a.nominalPowerW - b.nominalPowerW)[0];
    return { stageIndex: min.index, nominalPowerW: min.nominalPowerW };
}
exports.minEnabledImmersionStage = minEnabledImmersionStage;
function computeImmersionLiveSurplusHold(input) {
    const surplus = computeEffectivePvSurplusW(input.pvPowerW, input.houseLoadW, input.immersionOnPowerW);
    const minStage = minEnabledImmersionStage(input.config);
    const inactive = (reasonDe) => ({
        active: false,
        effectiveSurplusW: surplus,
        reasonDe,
        stageIndex: null,
        stagePowerW: null,
    });
    if (!input.continueHeating) {
        return inactive("Live-Surplus-Hold: Heizstab nicht aktiv (kein Durchlauf).");
    }
    if (!minStage) {
        return inactive("Live-Surplus-Hold: keine konfigurierte Stufe.");
    }
    if (input.bufferTempC === null || !Number.isFinite(input.bufferTempC)) {
        return inactive("Live-Surplus-Hold: Puffertemperatur fehlt.");
    }
    const targetC = input.targetTempC !== null && Number.isFinite(input.targetTempC)
        ? Math.min(input.planningMaxTempC, input.targetTempC)
        : input.planningMaxTempC;
    if (input.bufferTempC >= input.planningMaxTempC - 0.05) {
        return inactive("Live-Surplus-Hold: Planungs-Maxtemperatur erreicht.");
    }
    if (input.bufferTempC >= targetC - 0.05) {
        return inactive("Live-Surplus-Hold: Tagesziel erreicht.");
    }
    if (surplus === null) {
        return inactive("Live-Surplus-Hold: Live-PV/Hauslast fehlt.");
    }
    if (surplus + 1 < minStage.nominalPowerW * 0.95) {
        return inactive(`Live-Surplus-Hold: Überschuss ${surplus} W unter Stufe ${minStage.nominalPowerW} W.`);
    }
    return {
        active: true,
        effectiveSurplusW: surplus,
        reasonDe: `Live-PV-Überschuss ${surplus} W — Durchlauf bei anhaltendem Überschuss (Stufe ${minStage.stageIndex}, ${minStage.nominalPowerW} W).`,
        stageIndex: minStage.stageIndex,
        stagePowerW: minStage.nominalPowerW,
    };
}
exports.computeImmersionLiveSurplusHold = computeImmersionLiveSurplusHold;
