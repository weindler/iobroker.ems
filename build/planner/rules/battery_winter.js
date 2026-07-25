"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.planBatteryWinter = exports.dailyKwhFromHouseLoadForecast = void 0;
const constants_1 = require("../../learning/house_load/constants");
const battery_winter_windows_1 = require("./battery_winter_windows");
function round3(n) {
    return Math.round(n * 1000) / 1000;
}
function round1(n) {
    return Math.round(n * 10) / 10;
}
function dailyKwhFromHouseLoadForecast(json) {
    if (!json)
        return null;
    let sumWh = 0;
    let hasAny = false;
    for (const segment of constants_1.SEGMENTS) {
        const entry = json.segments[segment];
        if (entry?.avg_w == null || !Number.isFinite(entry.avg_w))
            continue;
        const bounds = constants_1.SEGMENT_HOURS[segment];
        const hours = bounds.end - bounds.start;
        sumWh += entry.avg_w * hours;
        hasAny = true;
    }
    return hasAny ? round3(sumWh / 1000) : null;
}
exports.dailyKwhFromHouseLoadForecast = dailyKwhFromHouseLoadForecast;
function comfortReserveFactor(modePolicy) {
    if (modePolicy.mode === "comfort" || modePolicy.mode === "forced")
        return 1.35;
    if (modePolicy.mode === "eco")
        return 0.85;
    return 1;
}
function findRecoveryDay(days, pvRecoveryRatio) {
    for (let i = 0; i < days.length; i++) {
        const d = days[i];
        if (d.pvKwh === null || d.loadKwh === null || d.loadKwh <= 0)
            continue;
        if (d.pvKwh >= d.loadKwh * pvRecoveryRatio) {
            return { recoveryIndex: i, scanDays: i + 1 };
        }
    }
    return { recoveryIndex: null, scanDays: days.length };
}
function reserveFromConfidence(days, scanDays, baseReserveKwh, factor, modeFactor) {
    let reserve = baseReserveKwh * modeFactor;
    let minConf = null;
    for (let i = 0; i < scanDays; i++) {
        const d = days[i];
        if (d.loadKwh === null || d.pvConfidencePct === null)
            continue;
        if (minConf === null || d.pvConfidencePct < minConf)
            minConf = d.pvConfidencePct;
        if (d.pvConfidencePct < 70 && d.loadKwh > 0) {
            const uncertainty = (70 - d.pvConfidencePct) / 100;
            reserve += d.loadKwh * uncertainty * factor;
        }
    }
    if (days.some((d) => d.pvKwh === null || d.loadKwh === null)) {
        reserve += baseReserveKwh * 0.5 * modeFactor;
    }
    return { reserveKwh: round3(reserve), minConfidence: minConf };
}
/**
 * Read-only 7-Tage-Bilanz für Winter-Netzladung (keine Gerätewrites).
 * Läuft unabhängig von der KI-Governance-Freigabe (`batteryAiAllowed`) — siehe Feld-Doku.
 */
function planBatteryWinter(input) {
    const inactive = (reason, forecastActive = false) => ({
        active: false,
        forecast_active: forecastActive,
        horizon_days: input.config.horizonDays,
        bridge_until_iso: null,
        pv_recovery_day: null,
        energy_stored_kwh: null,
        energy_deficit_kwh: null,
        energy_reserve_kwh: null,
        energy_target_kwh: null,
        soc_target_pct: null,
        charge_energy_kwh: null,
        charge_duration_h: null,
        charge_slots_15m: null,
        confidence_min_pct: null,
        windows: [],
        reason_de: reason,
    });
    if (!input.config.enabled) {
        return inactive("Winter-Netzplanung deaktiviert (bat_winter_plan_enabled).");
    }
    if (!input.batteryGovernanceEnabled) {
        return inactive("Batterie-Governance aus — keine Winter-Netzplanung.");
    }
    if (input.modePolicy.mode === "off") {
        return inactive(`${input.modePolicy.labelDe} — keine Winter-Netzplanung.`);
    }
    const cap = input.config.capacityKwh;
    if (cap === null || !(cap > 0)) {
        return inactive("Keine gültige Batteriekapazität in Config — Winter-Netzplanung pausiert.");
    }
    if (input.socPct === null || !Number.isFinite(input.socPct)) {
        return inactive("SOC unbekannt — Winter-Netzplanung pausiert.");
    }
    const days = input.days.slice(0, input.config.horizonDays);
    if (days.length === 0) {
        return inactive("Keine Horizont-Tagesdaten — Winter-Netzplanung pausiert.");
    }
    const energyStored = round3((input.socPct / 100) * cap);
    const { recoveryIndex, scanDays } = findRecoveryDay(days, input.config.pvRecoveryRatio);
    const bridgeOffset = recoveryIndex ?? scanDays - 1;
    const bridgeEnd = new Date(input.now);
    bridgeEnd.setHours(23, 59, 59, 999);
    bridgeEnd.setDate(bridgeEnd.getDate() + bridgeOffset);
    const bridgeUntil = bridgeEnd.toISOString();
    let cumPv = 0;
    let cumLoad = 0;
    for (let i = 0; i < scanDays; i++) {
        cumPv += days[i].pvKwh ?? 0;
        cumLoad += days[i].loadKwh ?? 0;
    }
    let energySim = energyStored;
    for (let i = 0; i < scanDays; i++) {
        const pv = days[i].pvKwh ?? 0;
        const load = days[i].loadKwh ?? 0;
        energySim += pv - load;
        if (energySim < 0)
            energySim = 0;
        if (energySim > cap)
            energySim = cap;
    }
    const netWithoutGrid = energyStored + cumPv - cumLoad;
    const energyDeficitRaw = netWithoutGrid < 0 ? round3(-netWithoutGrid) : 0;
    let energyDeficit = energyDeficitRaw;
    if (input.snowCoverSuspected && energyDeficitRaw > 0) {
        energyDeficit = round3(energyDeficit + input.config.marginKwh);
    }
    const modeFactor = comfortReserveFactor(input.modePolicy);
    const { reserveKwh, minConfidence } = reserveFromConfidence(days, scanDays, input.config.marginKwh, input.config.reserveLowConfidenceFactor, modeFactor);
    const reserveApplied = energyDeficitRaw > 0 ? reserveKwh : 0;
    const energyTarget = round3(Math.min(cap, energyStored + energyDeficit + reserveApplied));
    const chargeEnergy = round3(Math.max(0, energyTarget - energyStored));
    const maxSoc = input.config.maxSocPct;
    const minSoc = input.config.minSocPct;
    let socTarget = round1((energyTarget / cap) * 100);
    socTarget = Math.min(maxSoc, Math.max(minSoc, socTarget));
    const maxChargeW = input.config.maxChargeW;
    const eff = input.config.chargeEfficiencyPct / 100;
    let chargeDurationH = null;
    let chargeSlots = null;
    if (chargeEnergy > 0 && maxChargeW > 0 && eff > 0) {
        const pKw = (maxChargeW * eff) / 1000;
        chargeDurationH = round3(chargeEnergy / pKw);
        chargeSlots = Math.max(1, Math.ceil(chargeDurationH * 4));
    }
    const recoveryDayHuman = recoveryIndex !== null ? recoveryIndex + 1 : null;
    let windows = [];
    if (chargeEnergy > 0 && chargeSlots !== null && chargeSlots > 0) {
        const deadlineMs = bridgeEnd.getTime();
        windows = (0, battery_winter_windows_1.planBatteryWinterPriceWindows)({
            nowMs: input.now.getTime(),
            slots: input.priceSlots,
            slotsNeeded: chargeSlots,
            deadlineMs,
            globalMode: input.modePolicy.mode,
        });
    }
    const parts = [
        `Horizont ${scanDays} Tag(e)`,
        recoveryDayHuman
            ? `PV-Recovery Tag ${recoveryDayHuman}`
            : `kein Recovery in ${scanDays} Tagen`,
        `SOC ${input.socPct.toFixed(0)} %`,
    ];
    if (chargeEnergy > 0) {
        parts.push(`Netz-Ziel +${chargeEnergy.toFixed(1)} kWh → ${socTarget.toFixed(0)} %`);
        if (chargeDurationH !== null && chargeSlots !== null) {
            parts.push(`~${chargeDurationH.toFixed(1)} h (${chargeSlots}×15 min @ ${maxChargeW} W)`);
        }
        if (windows.length > 0) {
            const strategy = windows[0]?.strategy ?? "none";
            parts.push(`${windows.length} Preisfenster (${strategy})`);
        }
        else if (chargeSlots !== null && chargeSlots > 0 && input.priceSlots.length === 0) {
            parts.push("keine Tibber-15-min-Preise konfiguriert");
        }
        else if (chargeSlots !== null && chargeSlots > 0) {
            parts.push("kein passendes Preisfenster im Horizont");
        }
    }
    else {
        parts.push("kein Netzladen nötig");
    }
    if (input.snowCoverSuspected)
        parts.push("Schnee/Vollabdichtung — konservativ");
    if (minConfidence !== null && minConfidence < 70) {
        parts.push(`niedrige PV-Confidence min ${minConfidence.toFixed(0)} %`);
    }
    parts.push(input.modePolicy.labelDe);
    return {
        active: chargeEnergy > 0,
        forecast_active: true,
        horizon_days: scanDays,
        bridge_until_iso: bridgeUntil,
        pv_recovery_day: recoveryDayHuman,
        energy_stored_kwh: energyStored,
        energy_deficit_kwh: energyDeficit,
        energy_reserve_kwh: reserveKwh,
        energy_target_kwh: energyTarget,
        soc_target_pct: socTarget,
        charge_energy_kwh: chargeEnergy > 0 ? chargeEnergy : null,
        charge_duration_h: chargeDurationH,
        charge_slots_15m: chargeSlots,
        confidence_min_pct: minConfidence,
        windows,
        reason_de: parts.join("; ") + ".",
    };
}
exports.planBatteryWinter = planBatteryWinter;
