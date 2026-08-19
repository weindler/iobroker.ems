"use strict";
/**
 * B1: Realer PV-Überschuss als Material-Replan-Signal für Heizstab-NOW.
 * Kein simples „Batterie voll ⇒ sofort heizen“ — alle Gates müssen greifen.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.evaluateLiveThermalSurplusReplan = exports.LIVE_THERMAL_BATTERY_NEAR_FULL_SOC_PCT = exports.LIVE_THERMAL_SURPLUS_REPLAN_COOLDOWN_MS = exports.LIVE_THERMAL_SURPLUS_STABLE_MS = void 0;
/** Überschuss muss so lange über der IH-Min-Stufe bleiben (Entprellung). */
exports.LIVE_THERMAL_SURPLUS_STABLE_MS = 90_000;
/** Mindestabstand zwischen Surplus-Replans (zusätzlich zur Stabilitätsdauer). */
exports.LIVE_THERMAL_SURPLUS_REPLAN_COOLDOWN_MS = 180_000;
/** SOC ab dem Batterie als „nahe voll / keine sinnvolle Aufnahme“ gilt. */
exports.LIVE_THERMAL_BATTERY_NEAR_FULL_SOC_PCT = 95;
function batteryNearFullOrNoUptake(input) {
    const soc = input.batterySocPct;
    if (soc === null || !Number.isFinite(soc))
        return false;
    const maxSoc = input.batteryMaxSocPct;
    if (maxSoc !== null && Number.isFinite(maxSoc) && soc + 0.5 >= maxSoc)
        return true;
    if (soc >= exports.LIVE_THERMAL_BATTERY_NEAR_FULL_SOC_PCT)
        return true;
    const need = input.batteryRequiredChargeKwh;
    if ((need === null || !(need > 0.15)) && soc >= 90)
        return true;
    return false;
}
/**
 * Rein: bewertet einen Tick. Debounce-State wird als nextSurplusQualifySinceMs zurückgegeben.
 */
function evaluateLiveThermalSurplusReplan(input) {
    const ihMin = input.ihMinPowerW;
    const surplus = input.liveSurplusW;
    const headroom = input.thermalHeadroomKwh;
    const currentIh = input.currentIhAllocatedW ?? 0;
    const fail = (blockReasonDe, nextSurplusQualifySinceMs) => ({
        shouldReplan: false,
        preferImmersionNow: false,
        nextSurplusQualifySinceMs,
        reasonDe: "",
        blockReasonDe,
        startupStabilityBypassApplied: false,
    });
    if (!input.ihGovernanceEnabled || !input.ihLiveWriteAllowed) {
        return fail("IH nicht LIVE/Governance", null);
    }
    if (input.ihRuntimeWriteBlocked) {
        return fail("IH Runtime Hysterese/Safety sperrt Writes", null);
    }
    if (ihMin === null || !(ihMin > 0)) {
        return fail("IH Min-Stufe unbekannt", null);
    }
    if (headroom === null || !(headroom > 0.05)) {
        return fail("kein thermischer Headroom", null);
    }
    if (currentIh + 1 >= ihMin) {
        return fail("IH-Slot bereits allokiert", input.surplusQualifySinceMs);
    }
    if (!batteryNearFullOrNoUptake(input)) {
        return fail("Batterie kann noch sinnvoll laden", null);
    }
    if (surplus === null || !Number.isFinite(surplus)) {
        return fail("Live-Überschuss fehlt", null);
    }
    const reserved = Math.max(0, input.higherPriorityLiveDemandW);
    const available = surplus - reserved;
    /*
     * B1-Erweiterung: Wenn die Batterie voll ist, darf sie den Heizstab-Start unterstützen.
     * Wir erlauben bis zu 800 W Entnahme aus der vollen Batterie, um den Heizstab-Start
     * (z. B. 1700 W) auch bei Wolken/Klima-Last (z. B. 1000 W PV-Rest) zu ermöglichen,
     * statt den Überschuss ins Netz einzuspeisen.
     */
    const isBatFull = batteryNearFullOrNoUptake(input);
    const batSupportW = isBatFull ? 800 : 0;
    if (available + batSupportW + 1 < ihMin) {
        const msg = reserved > 0
            ? `Überschuss nach LIVE-Vorrang (${Math.round(reserved)} W) reicht nicht für IH`
            : `Überschuss (${Math.round(available)} W) unter IH-Min-Stufe`;
        return fail(isBatFull ? `${msg} (trotz 800 W Batterie-Support bei SOC 100 %)` : msg, null);
    }
    const qualifySince = input.surplusQualifySinceMs !== null && Number.isFinite(input.surplusQualifySinceMs)
        ? input.surplusQualifySinceMs
        : input.nowMs;
    const stableMs = input.nowMs - qualifySince;
    const bypassStability = input.bypassStabilityMs === true;
    if (stableMs < exports.LIVE_THERMAL_SURPLUS_STABLE_MS && !bypassStability) {
        return {
            shouldReplan: false,
            preferImmersionNow: false,
            nextSurplusQualifySinceMs: qualifySince,
            reasonDe: "",
            blockReasonDe: `Überschuss noch nicht stabil (${Math.round(stableMs / 1000)}s/${exports.LIVE_THERMAL_SURPLUS_STABLE_MS / 1000}s)`,
            startupStabilityBypassApplied: false,
        };
    }
    const last = input.lastThermalSurplusReplanAtMs;
    if (last !== null && input.nowMs - last < exports.LIVE_THERMAL_SURPLUS_REPLAN_COOLDOWN_MS) {
        return {
            shouldReplan: false,
            preferImmersionNow: true, // Score darf NOW trotzdem bevorzugen, falls Replan kürzlich lief
            nextSurplusQualifySinceMs: qualifySince,
            reasonDe: "",
            blockReasonDe: "Surplus-Replan Cooldown aktiv",
            startupStabilityBypassApplied: false,
        };
    }
    const startupBypass = bypassStability && stableMs < exports.LIVE_THERMAL_SURPLUS_STABLE_MS;
    return {
        shouldReplan: true,
        preferImmersionNow: true,
        nextSurplusQualifySinceMs: qualifySince,
        reasonDe: startupBypass
            ? `Startup-Hard-Replan: Live-Überschuss ${Math.round(available)} W ≥ IH ${Math.round(ihMin)} W — NOW bevorzugen (90s-Entprellung nur diesmal übersprungen)`
            : `Live-Überschuss ${Math.round(available)} W ≥ IH ${Math.round(ihMin)} W, Batterie nahe voll, Headroom ${headroom.toFixed(2)} kWh — NOW bevorzugen`,
        blockReasonDe: null,
        startupStabilityBypassApplied: startupBypass,
    };
}
exports.evaluateLiveThermalSurplusReplan = evaluateLiveThermalSurplusReplan;
