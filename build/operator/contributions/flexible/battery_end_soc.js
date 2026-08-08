"use strict";
/**
 * Dynamisches Batterie-Tagesend-/Ladeziel (Befund 004).
 *
 * Ziel-SOC entsteht aus Energiebedarf bis zur nächsten PV-Recovery + Nachtreserve —
 * nicht aus pauschalen 90/95/100 %-Policy-Werten. 100 % nur bei Top-off / starkem Defizit.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.planDynamicBatteryEndSoc = void 0;
function round1(n) {
    return Math.round(n * 10) / 10;
}
function round3(n) {
    return Math.round(n * 1000) / 1000;
}
function nightFactor(mode) {
    if (mode === "eco")
        return 1.0;
    if (mode === "comfort" || mode === "forced")
        return 1.25;
    return 1.1;
}
function morningCushionFactor(mode) {
    if (mode === "eco")
        return 0.15;
    if (mode === "comfort" || mode === "forced")
        return 0.45;
    return 0.3;
}
/**
 * Dynamisches End-/Ladeziel in kWh/SOC.
 * Keine Gerätewrites — nur Planungszahl für Contribution + Unified.
 */
function planDynamicBatteryEndSoc(input) {
    const cap = input.capacityKwh;
    const minSoc = input.minSocPct;
    const maxSoc = input.maxSocPct;
    const mode = input.modePolicy.mode;
    const minFloorKwh = round3((Math.max(0, minSoc) / 100) * cap);
    const nightRaw = input.avgNightDischargeKwh != null &&
        Number.isFinite(input.avgNightDischargeKwh) &&
        input.avgNightDischargeKwh > 0
        ? input.avgNightDischargeKwh
        : null;
    const logic = input.chargeLogic;
    const hasHorizon = logic?.forecastActive === true;
    const deficit = logic?.energyDeficitKwh != null && logic.energyDeficitKwh > 0 ? logic.energyDeficitKwh : 0;
    /*
     * Dynamik braucht Nachtbedarf und/oder echtes PV-Defizit.
     * Nur „Horizont ok, kein Defizit“ ohne Night-Modell → Policy-Fallback
     * (keine künstliche Absenkung auf minSoc).
     */
    if (nightRaw === null && deficit <= 0) {
        const policyPct = input.modePolicy.chargeTargetSocPct;
        const energyTargetKwh = round3((policyPct / 100) * cap);
        return {
            socTargetPct: policyPct,
            energyTargetKwh,
            usedPolicyFallback: true,
            reasonDe: hasHorizon
                ? `Kein Nachtmodell, kein PV-Defizit — Policy-Ziel ${policyPct} % (${input.modePolicy.labelDe}).`
                : `Kein Nacht-/Horizontbedarf belastbar — Policy-Ziel ${policyPct} % (${input.modePolicy.labelDe}).`,
        };
    }
    let energyTarget = minFloorKwh;
    const parts = [];
    if (nightRaw !== null) {
        const nightNeed = round3(nightRaw * nightFactor(mode));
        const cushion = round3(nightNeed * morningCushionFactor(mode));
        energyTarget = Math.max(energyTarget, nightNeed + cushion);
        parts.push(`Nachtbedarf ~${nightNeed.toFixed(1)} kWh (+Morgen-Puffer ${cushion.toFixed(1)})`);
    }
    if (hasHorizon && deficit > 0 && logic?.energyTargetKwh != null) {
        energyTarget = Math.max(energyTarget, logic.energyTargetKwh);
        parts.push(`PV-Defizit bis Recovery ${logic.pvRecoveryDay ?? "?"} → Ziel ${logic.energyTargetKwh.toFixed(1)} kWh`);
    }
    else if (hasHorizon && deficit <= 0) {
        parts.push(logic?.pvRecoveryDay != null
            ? `PV-Recovery Tag ${logic.pvRecoveryDay} — kein Energiedefizit`
            : "kein PV-Defizit im Horizont");
        // eco: bewusst Headroom für nächsten PV-Tag (nicht Richtung Policy ziehen)
        if (mode === "comfort" || mode === "forced") {
            const soft = round3(cap * (input.modePolicy.chargeTargetSocPct / 100) * 0.35);
            if (logic?.confidenceMinPct != null && logic.confidenceMinPct < 70) {
                energyTarget = Math.max(energyTarget, soft);
                parts.push("niedrige PV-Confidence — Comfort-Puffer");
            }
        }
    }
    if (input.deferForCheapFutureGrid === true && deficit <= 0) {
        const floorOnly = Math.max(minFloorKwh, nightRaw != null ? round3(nightRaw * nightFactor(mode)) : minFloorKwh);
        energyTarget = Math.min(energyTarget, floorOnly);
        parts.push("günstiger zukünftiger Netzstrom — heute weniger speichern");
    }
    energyTarget = round3(Math.min(cap, Math.max(minFloorKwh, energyTarget)));
    let socTarget = round1((energyTarget / cap) * 100);
    socTarget = Math.min(maxSoc, Math.max(minSoc, socTarget));
    parts.push(`${input.modePolicy.labelDe}`);
    parts.push(`dynamisches Ziel ${socTarget.toFixed(0)} % (${energyTarget.toFixed(1)} kWh)`);
    return {
        socTargetPct: socTarget,
        energyTargetKwh: energyTarget,
        usedPolicyFallback: false,
        reasonDe: parts.join("; ") + ".",
    };
}
exports.planDynamicBatteryEndSoc = planDynamicBatteryEndSoc;
