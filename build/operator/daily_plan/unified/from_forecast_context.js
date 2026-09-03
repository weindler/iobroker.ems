"use strict";
/**
 * Real Data Bridge: ForecastPlan (+ Contribution-Details + Live-Overrides)
 * → UnifiedDayPlannerInput.
 *
 * PV im ForecastPlan ist bereits bias-korrigiert (learning.pv_bias → Contribution).
 * Keine zweite Bias-Korrektur hier. Keine Geräte-Writes.
 *
 * Wallbox/Battery: Planung/Simulation — kein Unified-Live-Takeover.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.summarizeUnifiedDayPlanForReason = exports.buildUnifiedInputFromForecastContext = exports.normalizeFeedInCtPerKwh = exports.findCurrentHouseLoadSlot = exports.findCurrentFifteenMinuteSlot = void 0;
const contribution_ids_1 = require("../../contribution_ids");
const quality_1 = require("../../quality");
const flex_demand_1 = require("../../contributions/flexible/flex_demand");
const hard_off_worth_it_1 = require("../../../addons/air_conditioning/runtime/hard_off_worth_it");
const constants_1 = require("../../../addons/air_conditioning/constants");
const vehicle_availability_1 = require("./vehicle_availability");
const ev_energy_1 = require("./ev_energy");
const live_surplus_1 = require("../live_surplus");
const thermal_cooling_rate_1 = require("../../contributions/flexible/thermal_cooling_rate");
const charge_hold_1 = require("../../../addons/wallbox/charge_hold");
const time_1 = require("../../time");
/**
 * Aktueller 15-Min-Slot für Live-PV: now im Fenster und exakt 900000 ms Dauer.
 * Mehrstunden-Segmente (Hauslast/Wetter) werden bewusst ausgeschlossen.
 */
function findCurrentFifteenMinuteSlot(slots, nowMs) {
    for (const s of slots) {
        const start = Date.parse(s.startIso);
        const end = Date.parse(s.endIso);
        if (!Number.isFinite(start) || !Number.isFinite(end))
            continue;
        if (end - start !== time_1.OPERATOR_MS_PER_15MIN)
            continue;
        if (nowMs >= start && nowMs < end)
            return s;
    }
    return null;
}
exports.findCurrentFifteenMinuteSlot = findCurrentFifteenMinuteSlot;
/**
 * Aktuelles Hauslast-Fenster: now im Slot und Slot trägt Hauslast-Leistung.
 * Segment-Auflösung bleibt unverändert (Mehrstunden ok); kein smearing per startIso.
 */
function findCurrentHouseLoadSlot(slots, nowMs) {
    for (const s of slots) {
        if (s.houseLoadPowerW == null)
            continue;
        const start = Date.parse(s.slot.startIso);
        const end = Date.parse(s.slot.endIso);
        if (!Number.isFinite(start) || !Number.isFinite(end))
            continue;
        if (nowMs >= start && nowMs < end)
            return s.slot;
    }
    return null;
}
exports.findCurrentHouseLoadSlot = findCurrentHouseLoadSlot;
function slotWindowsEqual(a, b) {
    return a.startIso === b.startIso && a.endIso === b.endIso;
}
function num(d, key) {
    if (!d)
        return null;
    const v = d[key];
    return typeof v === "number" && Number.isFinite(v) ? v : null;
}
function str(d, key) {
    if (!d)
        return null;
    const v = d[key];
    return typeof v === "string" && v.trim() ? v : null;
}
function bool(d, key) {
    if (!d)
        return null;
    const v = d[key];
    return typeof v === "boolean" ? v : null;
}
function qualityOf(c, fallbackReason) {
    if (!c)
        return (0, quality_1.operatorQuality)("missing", fallbackReason, null);
    return c.quality;
}
function freshnessFrom(nowMs, observedAtIso, quality) {
    if (!observedAtIso) {
        return { observedAtIso: null, ageSec: null, quality };
    }
    const t = Date.parse(observedAtIso);
    if (!Number.isFinite(t)) {
        return { observedAtIso, ageSec: null, quality };
    }
    return {
        observedAtIso,
        ageSec: Math.max(0, Math.round((nowMs - t) / 1000)),
        quality,
    };
}
function slotEnergyKwh(powerW) {
    if (powerW === null)
        return null;
    return (powerW / 1000) * 0.25;
}
function biasPctFromRawCorrected(raw, corrected) {
    if (raw === null || corrected === null || !(raw > 0))
        return null;
    return Math.round(((corrected - raw) / raw) * 1000) / 10;
}
function sanitizeDisallowedSlotIsos(raw) {
    if (!Array.isArray(raw) || raw.length === 0)
        return undefined;
    const out = [];
    const seen = new Set();
    for (const iso of raw) {
        if (typeof iso !== "string" || !iso)
            continue;
        if (seen.has(iso))
            continue;
        seen.add(iso);
        out.push(iso);
    }
    return out.length > 0 ? out : undefined;
}
/** ct/kWh → Planner; ungültig/negativ → null (kein NaN in Allocation). */
function normalizeFeedInCtPerKwh(raw) {
    if (typeof raw !== "number" || !Number.isFinite(raw) || raw < 0)
        return null;
    return raw;
}
exports.normalizeFeedInCtPerKwh = normalizeFeedInCtPerKwh;
/**
 * Baut UnifiedDayPlannerInput aus dem bestehenden ForecastPlan-Snapshot.
 * Keine parallelen 30-State-Reads — Contributions + optionale Live-Overrides.
 */
function buildUnifiedInputFromForecastContext(ctx) {
    const nowMs = ctx.now.getTime();
    const nowIso = ctx.now.toISOString();
    const slots = ctx.forecastPlan.slots.map((s) => s.slot);
    const contribById = new Map(ctx.forecastPlan.contributions.map((c) => [c.contributionId, c]));
    const pvC = contribById.get(contribution_ids_1.CONTRIBUTION_IDS.PV_SUPPLY);
    const loadC = contribById.get(contribution_ids_1.CONTRIBUTION_IDS.HOUSE_LOAD_FIXED);
    const gridC = contribById.get(contribution_ids_1.CONTRIBUTION_IDS.GRID_SUPPLY);
    const batCharge = contribById.get(contribution_ids_1.CONTRIBUTION_IDS.BATTERY_CHARGE);
    const batReserve = contribById.get(contribution_ids_1.CONTRIBUTION_IDS.BATTERY_RESERVE);
    const batDischarge = contribById.get(contribution_ids_1.CONTRIBUTION_IDS.BATTERY_DISCHARGE);
    const wbC = contribById.get(contribution_ids_1.CONTRIBUTION_IDS.WALLBOX_EV_SESSION);
    const ih = contribById.get(contribution_ids_1.CONTRIBUTION_IDS.IMMERSION_FLEXIBLE) ??
        contribById.get(contribution_ids_1.CONTRIBUTION_IDS.IMMERSION_MANDATORY);
    const ihD = (ih?.details ?? null);
    const pvD = (pvC?.details ?? null);
    const loadD = (loadC?.details ?? null);
    const batD = (batCharge?.details ?? null);
    const resD = (batReserve?.details ?? null);
    const wbD = (wbC?.details ?? null);
    const day0 = ctx.forecastPlan.days[0];
    const liveNowUsable = (0, live_surplus_1.isLiveNowTelemetryUsable)({
        pvPowerW: ctx.observedPvPowerW ?? null,
        houseLoadW: ctx.observedHouseLoadPowerW ?? null,
        pvAgeSec: ctx.observedPvAgeSec,
        houseAgeSec: ctx.observedHouseAgeSec,
    });
    const currentPvSlot = liveNowUsable ? findCurrentFifteenMinuteSlot(slots, nowMs) : null;
    const currentHouseLoadSlot = liveNowUsable
        ? findCurrentHouseLoadSlot(ctx.forecastPlan.slots, nowMs)
        : null;
    const pvSlots = ctx.forecastPlan.slots.map((s) => {
        const power = s.pvPowerW;
        const observed = liveNowUsable && currentPvSlot && slotWindowsEqual(s.slot, currentPvSlot)
            ? (ctx.observedPvPowerW ?? null)
            : null;
        const effective = observed ?? power;
        return {
            slot: s.slot,
            forecastPowerW: power,
            observedPowerW: observed,
            energyKwh: slotEnergyKwh(effective),
        };
    });
    const loadSlots = ctx.forecastPlan.slots.map((s) => {
        const power = s.houseLoadPowerW;
        const observed = liveNowUsable &&
            currentHouseLoadSlot &&
            slotWindowsEqual(s.slot, currentHouseLoadSlot)
            ? (ctx.observedHouseLoadPowerW ?? null)
            : null;
        const effective = observed ?? power;
        return {
            slot: s.slot,
            forecastPowerW: power,
            observedPowerW: observed,
            energyKwh: slotEnergyKwh(effective),
        };
    });
    const exportCtPerKwh = normalizeFeedInCtPerKwh(ctx.feedInCtPerKwh ?? null);
    const priceSlots = ctx.forecastPlan.slots.map((s) => ({
        slot: s.slot,
        importCtPerKwh: s.gridPriceCtPerKwh,
        /** ct/kWh — gleiche Einheit wie importCt; Scorer: exportCt * 0.01 → €/kWh. */
        exportCtPerKwh,
        gridImportAllowed: s.gridImportAllowed,
    }));
    const rawToday = num(pvD, "rawTodayKwh");
    const correctedToday = num(pvD, "correctedTodayKwh") ?? day0?.pvEnergyKwh ?? null;
    const biasPct = biasPctFromRawCorrected(rawToday, correctedToday);
    const pvLastUpdate = str(pvD, "lastUpdateTs");
    const pvQuality = qualityOf(pvC, "PV-Prognose fehlt.");
    const pvFresh = freshnessFrom(nowMs, pvLastUpdate ?? pvC?.generatedAt ?? null, pvQuality);
    const loadLastUpdate = str(loadD, "lastUpdate") ?? loadC?.generatedAt ?? null;
    const loadQuality = qualityOf(loadC, "Hauslast-Prognose fehlt.");
    const loadFresh = freshnessFrom(nowMs, loadLastUpdate, loadQuality);
    const priceQuality = qualityOf(gridC, "Netzpreis-Prognose fehlt.");
    const priceFresh = freshnessFrom(nowMs, gridC?.generatedAt ?? null, priceQuality);
    const timeQuality = mergeWorstQuality([pvQuality, loadQuality, priceQuality]);
    const timeFresh = freshnessFrom(nowMs, nowIso, timeQuality);
    // --- Battery (Unified Live via bestehende Runtime; Discharge Live unsupported) ---
    const socPct = ctx.batterySocPct !== undefined && ctx.batterySocPct !== null
        ? ctx.batterySocPct
        : num(batD, "socPct");
    const usableCapacityKwh = ctx.batteryCapacityKwh !== undefined && ctx.batteryCapacityKwh !== null
        ? ctx.batteryCapacityKwh
        : num(batD, "capacityEffectiveKwh") ?? num(batD, "usableCapacityKwh");
    const maxChargePowerW = ctx.batteryMaxChargePowerW ?? num(batD, "maxChargePowerW");
    const maxDischargePowerW = ctx.batteryMaxDischargePowerW ??
        (batDischarge?.enabled ? num(batDischarge.details, "maxDischargePowerW") : null);
    const minSocPct = ctx.batteryMinSocPct ?? num(resD, "minSocPct");
    const maxSocPct = ctx.batteryMaxSocPct ?? num(resD, "maxSocPct");
    const batFault = bool(resD, "fault") === true || bool(batD, "fault") === true;
    const batLockout = bool(resD, "lockout") === true || bool(batD, "lockout") === true;
    let batQuality = qualityOf(batCharge ?? batReserve, "Batterie-Telemetrie fehlt.");
    if (socPct === null || usableCapacityKwh === null) {
        batQuality = (0, quality_1.operatorQuality)("missing", "Batterie SOC oder Kapazität unbekannt.", batQuality.confidencePct);
    }
    else if (batFault || batLockout) {
        batQuality = (0, quality_1.operatorQuality)("blocked", "Batterie Fault/Lockout — keine Flex-Annahme.", batQuality.confidencePct);
    }
    else if (batCharge && batCharge.quality.status !== "valid") {
        batQuality = batCharge.quality;
    }
    const batFresh = freshnessFrom(nowMs, ctx.batterySocObservedAtIso ?? batCharge?.generatedAt ?? null, batQuality);
    const allowedModes = ["idle"];
    if (!batFault && !batLockout && (batCharge?.enabled !== false)) {
        allowedModes.unshift("charge");
    }
    // discharge: nur wenn Contribution nicht unsupported
    if (batDischarge && batDischarge.quality.status !== "unsupported" && batDischarge.enabled) {
        allowedModes.push("discharge");
    }
    // --- Wallbox (Unified Live via EVCC-Runtime; Presence: live > explicit > predicted > unknown) ---
    const wallbox = mapWallbox(wbC, wbD, nowIso, slots, ctx);
    // --- Thermal ---
    const bufferTempC = ctx.bufferTempC !== undefined ? ctx.bufferTempC : num(ihD, "bufferTempC");
    const targetTempC = num(ihD, "targetTempC");
    const maxPowerW = num(ihD, "maxPowerW");
    const minPowerW = num(ihD, "minPowerW");
    const ihEnabled = ih?.enabled === true;
    const ihBlocked = ih?.quality.status === "blocked" ||
        ih?.quality.status === "unsupported" ||
        ih?.quality.status === "disabled";
    // Headroom: bevorzugt Contribution (`requiredEnergyKwh` aus flex_demand/Learning).
    // Keine eigene 0.38-Formel in der Bridge — bei fehlendem Beitrag fallback auf
    // dieselbe Schätzfunktion wie die Contribution, sonst null (unknown).
    let headroom = null;
    if (!ih || !ihEnabled || ihBlocked) {
        headroom = ih ? 0 : null;
    }
    else {
        const fromContrib = num(ihD, "requiredEnergyKwh");
        if (fromContrib !== null) {
            headroom = fromContrib;
        }
        else if (bufferTempC !== null && targetTempC !== null) {
            const learningStatus = str(ihD, "thermalLearningStatus");
            headroom = (0, flex_demand_1.estimateImmersionRequiredEnergyKwh)(bufferTempC, targetTempC, maxPowerW, {
                status: learningStatus === "valid" || learningStatus === "degraded" || learningStatus === "missing"
                    ? learningStatus
                    : "missing",
                coolingRateCPerHAvg: num(ihD, "coolingRateCPerHAvg"),
            });
        }
        else {
            headroom = null;
        }
    }
    const thermalQuality = ih
        ? ihBlocked
            ? (0, quality_1.operatorQuality)("blocked", "Heizstab Safety/Fault — kein Flex-Headroom.", ih.quality.confidencePct)
            : ih.quality
        : (0, quality_1.operatorQuality)("missing", "Heizstab-Contribution fehlt.", null);
    const thermalFresh = freshnessFrom(nowMs, ctx.bufferTempObservedAtIso ?? ih?.generatedAt ?? null, thermalQuality);
    // --- Climate ---
    const acRtByUnit = new Map((ctx.acRuntime ?? []).map((r) => [r.unitIndex, r]));
    const climateUnits = [];
    for (let u = 1; u <= constants_1.AC_UNIT_COUNT; u++) {
        const c = contribById.get(contribution_ids_1.CONTRIBUTION_IDS.AC_UNIT(u));
        if (!c || !c.enabled)
            continue;
        const d = c.details;
        const room = ctx.roomTemps?.[u] ?? num(d, "roomTempC");
        const comfortMax = num(d, "offTempC") ?? num(d, "comfortMaxC") ?? num(d, "onTempC");
        const onTemp = num(d, "onTempC") ?? comfortMax;
        const typical = num(d, "estimatedPowerW") ?? num(d, "typicalPowerW") ?? num(d, "expectedPeakW");
        const expected = num(d, "expectedKwhToday") ?? num(d, "expectedEnergyKwh");
        const overComfort = room !== null && onTemp !== null && room >= onTemp;
        const rt = acRtByUnit.get(u);
        const hardwareRunning = rt?.running === true;
        /*
         * Runtime-Hold: Gerät läuft, kein neuer Startbedarf.
         * Wichtig: allocW<50 darf Hold NICHT triggern — sonst erzeugt ein kurzzeitig
         * fehlender NOW-Eintrag Hold→leerer NOW→Runtime-Planner-OFF-Schleife.
         * Hold reduziert nur Flex-Mehr-Allocation im NOW-Slot (score_allocate);
         * Runtime behandelt fehlenden NOW-Eintrag als HOLD, nicht als Planner-OFF.
         */
        const noNewDemand = rt?.decisionSource === "temperature_no_demand";
        const runtimeHold = hardwareRunning && noNewDemand;
        const allocW = rt?.allocatedPowerW;
        const holdPowerW = rt?.estimatedPowerW ?? typical ?? (allocW != null && allocW > 0 ? allocW : null);
        /*
         * Klima-/Ownership-Block: nächstes Hard-Off ab jetzt (über Mitternacht gewickelt) —
         * harte Planner-Deadline, kein künstliches Zeitfenster (siehe score_allocate.ts).
         */
        const hardOffAtRaw = str(d, "hardOffAt");
        const nowDate = new Date(nowMs);
        const nowMinLocal = nowDate.getHours() * 60 + nowDate.getMinutes();
        const minsToHardOff = hardOffAtRaw ? (0, hard_off_worth_it_1.minutesUntilHardOff)(nowMinLocal, hardOffAtRaw) : null;
        const hardStopMs = minsToHardOff !== null ? nowMs + minsToHardOff * 60_000 : null;
        const sharedRaw = str(d, "sharedPowerGroupId");
        const sharedPowerGroupId = sharedRaw && sharedRaw.trim() ? sharedRaw.trim() : null;
        /**
         * Additiv (Block A, Abnahme-Korrektur #2b): Feuchte-Seite derselben Urgency-Formel
         * (hard_off_worth_it.ts) — rein deskriptiv, keine Auswirkung auf Scoring/Allocation.
         */
        const roomHumidityPct = num(d, "roomHumidityPct");
        const maxHumidityPct = num(d, "maxHumidityPct");
        climateUnits.push({
            unitId: contribution_ids_1.CONTRIBUTION_IDS.AC_UNIT(u),
            label: str(d, "name") ?? `unit_${u}`,
            roomTempC: room,
            comfortMinC: null,
            comfortMaxC: comfortMax,
            targetTempC: onTemp,
            mandatoryComfort: overComfort,
            expectedEnergyKwh: expected,
            typicalPowerW: typical,
            maxShiftHours: overComfort ? 0 : 3,
            uncertainty: c.quality,
            hardwareRunning,
            runtimeHold,
            holdPowerW,
            hardStopMs,
            sharedPowerGroupId,
            roomHumidityPct,
            maxHumidityPct,
        });
    }
    /*
     * Shared Outdoor Unit: typische elektrische Leistung je Gruppe = max(Unit-Schätzungen),
     * damit score_allocate / Hard-PV-Bound dieselbe Obergrenze sieht (nie Summe).
     */
    const groupMaxW = new Map();
    for (const u of climateUnits) {
        const g = u.sharedPowerGroupId;
        if (!g || u.typicalPowerW == null || !(u.typicalPowerW > 0))
            continue;
        groupMaxW.set(g, Math.max(groupMaxW.get(g) ?? 0, u.typicalPowerW));
    }
    for (const u of climateUnits) {
        const g = u.sharedPowerGroupId;
        if (!g)
            continue;
        const maxW = groupMaxW.get(g);
        if (maxW != null && maxW > 0)
            u.typicalPowerW = maxW;
    }
    const climateFresh = freshnessFrom(nowMs, nowIso, climateUnits[0]?.uncertainty ?? (0, quality_1.operatorQuality)("missing", "Keine Klima-Units.", null));
    const horizonStart = slots[0]?.startIso ?? nowIso;
    const horizonEnd = slots[slots.length - 1]?.endIso ?? nowIso;
    return {
        schemaVersion: 1,
        planIntent: "unified_day",
        time: {
            nowIso,
            timezone: ctx.timezone,
            horizonStartIso: horizonStart,
            horizonEndIso: horizonEnd,
            slotMinutes: 15,
            slots,
            freshness: timeFresh,
        },
        pv: {
            slots: pvSlots,
            expectedDayEnergyKwh: correctedToday,
            previousExpectedDayEnergyKwh: ctx.previousExpectedDayEnergyKwh ?? null,
            // ForecastPlan-Slots / Day-Energy stammen aus korrigierten Tages-kWh (pv_bias).
            biasCorrected: true,
            biasPct,
            uncertainty: pvQuality,
            freshness: pvFresh,
        },
        prices: {
            slots: priceSlots,
            uncertainty: priceQuality,
            freshness: priceFresh,
        },
        houseLoad: {
            slots: loadSlots,
            expectedDayEnergyKwh: day0?.houseLoadEnergyKwh ?? null,
            uncertainty: loadQuality,
            freshness: loadFresh,
        },
        battery: {
            socPct,
            usableCapacityKwh,
            minSocPct,
            maxSocPct,
            maxChargePowerW,
            maxDischargePowerW,
            chargeEfficiency: null, // nicht produktiv modelliert → unknown
            dischargeEfficiency: null,
            allowedModes,
            reserveSocPct: minSocPct,
            nightReserveKwh: num(batD, "avgNightDischargeKwh"),
            profileId: str(batD, "profileId") ?? str(resD, "profileId"),
            // Produktiv: Discharge Live unsupported (Sonnen EM discharge_unverified) — nie erfinden
            dischargeLiveSupported: false,
            passiveBatteryEnergyAvailable: ctx.passiveBatteryEnergyAvailable === true,
            requiredChargeEnergyKwh: num(batD, "requiredEnergyKwh") ?? num(batD, "socGapEnergyKwh"),
            endSocTargetPct: num(batD, "targetSocPct"),
            chargeDeadlineIso: batCharge?.deadlineIso ?? str(batD, "chargeLogicBridgeUntilIso"),
            gridChargeAllowed: bool(batD, "gridImportAllowed") !== false &&
                (batCharge?.gridEligible !== false),
            uncertainty: batQuality,
            freshness: batFresh,
        },
        wallbox,
        thermal: ih
            ? (() => {
                const boilerMinTempC = num(ihD, "boilerMinTempC") ?? num(ihD, "mandatoryMinTempC");
                const boilerTempC = num(ihD, "boilerTempC");
                const fromOverride = typeof ctx.boilerEstimatedEmptyAtOverride === "string" &&
                    ctx.boilerEstimatedEmptyAtOverride.trim()
                    ? ctx.boilerEstimatedEmptyAtOverride.trim()
                    : null;
                const estimatedEmptyAtIso = fromOverride ??
                    str(ihD, "boilerEstimatedEmptyAt") ??
                    str(ihD, "estimatedEmptyAt");
                /*
                 * Hard-Bridge: nur mit Contribution-Flag (belastbares Learning).
                 * Soft-Deadline: Boiler-emptyAt-Zeitpunkt trotzdem durchreichen, wenn gesetzt —
                 * sonst wandert Soft auf Wochenend-PV obwohl VIS emptyAt heute Abend zeigt
                 * (Export 2026-08-20: usable=true im Contribution-State, Plan trotzdem Sa/So).
                 */
                const emptyUsable = bool(ihD, "emptyAtPlanningUsable") === true;
                const emptyAtIsoForSoft = estimatedEmptyAtIso;
                const emptyMsForRate = estimatedEmptyAtIso != null ? Date.parse(estimatedEmptyAtIso) : Number.NaN;
                const coolingRateCPerH = (0, thermal_cooling_rate_1.effectiveCoolingRateCPerH)({
                    coolingRateCPerHAvg: num(ihD, "boilerCoolingRateCPerHAvg"),
                    coolingConstantPerH: num(ihD, "boilerCoolingConstantPerH"),
                    coolingAsymptoteC: num(ihD, "boilerCoolingAsymptoteC"),
                    currentTempC: boilerTempC,
                    bufferTempC: boilerTempC,
                    minTempC: boilerMinTempC,
                    estimatedEmptyAtMs: emptyUsable && Number.isFinite(emptyMsForRate) ? emptyMsForRate : null,
                    nowMs,
                });
                const forecastTargetTempC = num(ihD, "forecastTargetTempC");
                const emptyAtSource = (() => {
                    const s = str(ihD, "emptyAtSource");
                    if (!estimatedEmptyAtIso)
                        return null;
                    if (s === "learned" || s === "estimated")
                        return s;
                    return emptyUsable ? null : "estimated";
                })();
                return {
                    bufferTempC,
                    boilerTempC,
                    minTempC: boilerMinTempC,
                    boilerMinTempC,
                    maxTempC: num(ihD, "planningMaxTempC"),
                    dayTargetTempC: targetTempC,
                    forecastTargetTempC,
                    pvPrechargeActive: bool(ihD, "pvPrechargeActive") === true,
                    availablePowerW: maxPowerW,
                    minPowerW: minPowerW,
                    headroomEnergyKwh: headroom,
                    estimatedEmptyAtIso: emptyAtIsoForSoft,
                    deadlineIso: emptyUsable ? estimatedEmptyAtIso : emptyAtIsoForSoft,
                    emptyAtSource,
                    boilerEmptyAtUsable: emptyUsable,
                    boilerSensorDegraded: bool(ihD, "boilerSensorDegraded") === true || boilerTempC === null,
                    hygieneMandatoryKwh: num(ihD, "hygieneMandatoryKwh"),
                    hygieneDue: bool(ihD, "hygieneDue") === true,
                    nightBridgeActive: bool(ihD, "nightBridgeActive") === true,
                    coolingRateCPerH: emptyUsable ? coolingRateCPerH : null,
                    minimumRuntimeSec: num(ihD, "minimumRuntimeSec"),
                    hysteresisK: num(ihD, "reheatHysteresisK") ?? num(ihD, "temperatureHysteresisK"),
                    reheatHysteresisActive: bool(ihD, "reheatHysteresisActive") === true,
                    uncertainty: thermalQuality,
                    freshness: thermalFresh,
                    learnedPriceTimingScore: ctx.thermalLearnedPriceTimingScore ?? null,
                };
            })()
            : null,
        climate: climateUnits.length ? { units: climateUnits, freshness: climateFresh } : null,
        otherFlex: [],
        contributionRevision: ctx.contributionRevision ?? 1,
        globalMode: ctx.globalMode,
        preferImmersionLiveSurplusNow: ctx.preferImmersionLiveSurplusNow === true,
        continueImmersionSoftCurrentSlot: ctx.continueImmersionSoftCurrentSlot === true,
        immersionSoftDisallowedSlotIsos: sanitizeDisallowedSlotIsos(ctx.immersionSoftDisallowedSlotIsos),
    };
}
exports.buildUnifiedInputFromForecastContext = buildUnifiedInputFromForecastContext;
function mergeWorstQuality(list) {
    const rank = {
        invalid: 7,
        unsupported: 6,
        blocked: 5,
        missing: 4,
        disabled: 3,
        degraded: 2,
        valid: 1,
    };
    let best = list[0] ?? (0, quality_1.operatorQuality)("missing", "keine Daten", null);
    for (const q of list.slice(1)) {
        if ((rank[q.status] ?? 0) > (rank[best.status] ?? 0))
            best = q;
    }
    return best;
}
/**
 * Fahrzeug-Presence: live (aktueller Slot) > explicit > predicted Learning > unknown.
 * Keine erfundenen Anwesenheitszeiten.
 */
function mapWallbox(wbC, wbD, nowIso, slots, ctx) {
    if (!wbC && !wbD) {
        return null;
    }
    const connectedNow = ctx.connectedNowOverride !== undefined && ctx.connectedNowOverride !== null
        ? ctx.connectedNowOverride === true
        : bool(wbD, "connected") === true;
    const explicitFromDetails = parseExplicitWindows(wbD);
    const explicit = ctx.explicitVehiclePresenceWindows ??
        explicitFromDetails;
    const presenceWindows = (0, vehicle_availability_1.buildVehicleAvailabilityWindows)({
        nowIso,
        timezone: ctx.timezone,
        slots,
        connectedNow,
        explicitWindows: explicit,
        learningStore: ctx.vehiclePresenceLearning ?? null,
        learningVehicleKey: ctx.vehiclePresenceVehicleKey ?? null,
        observedAtIso: wbC?.generatedAt ?? nowIso,
    });
    const hasHardFuture = presenceWindows.some((w) => (w.source === "explicit" || w.hard === true) &&
        (w.status ?? (w.available ? "available" : "unavailable")) === "available" &&
        Date.parse(w.endIso) > Date.parse(nowIso));
    const hasPredictedFuture = presenceWindows.some((w) => w.source === "predicted" &&
        (w.status ?? (w.available ? "available" : "unavailable")) === "available");
    const socSourceRaw = str(wbD, "socSource") ?? str(wbD, "vehicleSocSource");
    const socSource = socSourceRaw === "direct" ||
        socSourceRaw === "energy_rollforward" ||
        socSourceRaw === "range_estimate" ||
        socSourceRaw === "last_trusted"
        ? socSourceRaw
        : num(wbD, "vehicleSocPct") !== null
            ? "direct"
            : "unknown";
    const vehicleSocPct = num(wbD, "vehicleSocPct");
    const requiredFromSoc = vehicleSocPct !== null &&
        num(wbD, "vehicleCapacityKwh") !== null &&
        (num(wbD, "planSocPct") ?? num(wbD, "effectiveLimitSocPct")) !== null
        ? (Math.max(0, (num(wbD, "planSocPct") ?? num(wbD, "effectiveLimitSocPct")) - vehicleSocPct) /
            100) *
            num(wbD, "vehicleCapacityKwh")
        : null;
    const requiredEnergyKwh = num(wbD, "requiredEnergyKwh") ??
        num(wbD, "remainingEnergyKwh") ??
        (socSource === "unknown" ? null : requiredFromSoc);
    const chargingEfficiency = num(wbD, "chargingEfficiency");
    const minimumDepartureSocPct = num(wbD, "minimumDepartureSocPct");
    const externalSmartChargingMinSocPct = num(wbD, "externalSmartChargingMinSocPct");
    const departureAt = str(wbD, "departureAt");
    const deadlineIso = departureAt ??
        (minimumDepartureSocPct != null
            ? (wbC?.deadlineIso ?? str(wbD, "deadlineIso"))
            : null);
    let uncertainty = wbC
        ? connectedNow || hasHardFuture || hasPredictedFuture
            ? wbC.quality
            : (0, quality_1.operatorQuality)("degraded", "Fahrzeug-Presence teilweise unknown — keine Phantom-Ladung.", wbC.quality.confidencePct)
        : (0, quality_1.operatorQuality)("missing", "Wallbox-Contribution fehlt.", null);
    if (socSource === "unknown" && requiredEnergyKwh === null && num(wbD, "energyToTargetKwh") === null) {
        uncertainty = (0, quality_1.operatorQuality)("degraded", "Fahrzeug-SOC unknown und kein belastbarer Energiebedarf.", uncertainty.confidencePct);
    }
    const reservations = (0, ev_energy_1.parseExternalReservations)(wbD?.externalReservations ?? wbD?.externalSmartPlanJson ?? wbD?.externalSmartPlanSlots);
    const planQualityRaw = str(wbD, "externalPlanQuality") ?? str(wbD, "externalSourceQuality");
    const externalPlanQuality = planQualityRaw === "ok" || planQualityRaw === "degraded" || planQualityRaw === "unknown"
        ? planQualityRaw
        : reservations.some((r) => r.quality === "degraded")
            ? "degraded"
            : reservations.length
                ? "ok"
                : null;
    const draft = {
        connectedNow,
        presenceWindows,
        presenceHardConstraint: true,
        vehicleProfileId: ctx.vehiclePresenceVehicleKey ?? str(wbD, "vehicleProfileId") ?? str(wbD, "evccVehicleId"),
        vehicleSocPct,
        socSource,
        fallbackEnergyNeedKwh: null,
        vehicleCapacityKwh: num(wbD, "vehicleCapacityKwh"),
        targetSocPct: num(wbD, "planSocPct") ?? num(wbD, "effectiveLimitSocPct"),
        requiredEnergyKwh,
        deadlineIso,
        energyGoalHard: false,
        minChargePowerW: num(wbD, "minChargePowerW"),
        maxChargePowerW: num(wbD, "maxChargePowerW") ?? num(wbD, "vehicleMaxAcChargePowerW"),
        chargeLossFactor: chargingEfficiency != null ? 1 : num(wbD, "chargeLossFactor"),
        evccExecutionMaster: true,
        minimumDepartureSocPct,
        externalSmartChargingMinSocPct,
        chargingEfficiency,
        hardRequiredEnergyKwh: num(wbD, "energyToDepartureMinimumKwh") ?? num(wbD, "hardRequiredEnergyKwh"),
        targetEnergyKwh: num(wbD, "energyToTargetKwh") ?? num(wbD, "targetEnergyKwh"),
        externalAuthorityState: str(wbD, "externalAuthorityState"),
        takeoverSeverity: str(wbD, "takeoverSeverity"),
        externalReservations: reservations.length ? reservations : undefined,
        externalPlanQuality,
        uncertainty,
        freshness: freshnessFrom(Date.parse(nowIso), wbC?.generatedAt ?? nowIso, wbC?.quality ?? (0, quality_1.operatorQuality)("missing", "wb", null)),
    };
    draft.managementMode = (0, ev_energy_1.evManagementFromWallbox)(draft);
    const classes = (0, ev_energy_1.resolveEvEnergyClasses)(draft);
    draft.energyGoalHard = classes.energyGoalHard;
    const observedHold = (0, charge_hold_1.resolveWallboxBatteryHold)({
        vehicleConnected: connectedNow,
        charging: bool(wbD, "charging"),
        chargePowerW: num(wbD, "chargePowerW"),
        batteryBoost: bool(wbD, "batteryBoost"),
        loadpointMode: str(wbD, "loadpointMode"),
        externalVehicleChargeRaw: null,
        tibberGridRewardsActive: bool(wbD, "tibberGridRewardsActive"),
    });
    draft.batteryHoldRequested = observedHold.hold;
    return draft;
}
function parseExplicitWindows(wbD) {
    if (!wbD)
        return null;
    const raw = wbD.explicitPresenceWindows ?? wbD.presenceWindowsExplicit;
    if (!Array.isArray(raw))
        return null;
    const out = [];
    for (const item of raw) {
        if (!item || typeof item !== "object")
            continue;
        const o = item;
        const startIso = typeof o.startIso === "string" ? o.startIso : null;
        const endIso = typeof o.endIso === "string" ? o.endIso : null;
        const available = typeof o.available === "boolean" ? o.available : null;
        if (!startIso || !endIso || available === null)
            continue;
        out.push({ available, startIso, endIso });
    }
    return out.length ? out : null;
}
/** Kurzsummary für Daily-Plan reason_de (keine neuen States). */
function summarizeUnifiedDayPlanForReason(plan) {
    const vehicle = plan.goalStatuses.find((g) => g.consumerId === "wallbox");
    const vehicleTxt = vehicle
        ? vehicle.met === true
            ? "EV-Ziel ok"
            : "EV-Ziel offen/unknown"
        : "EV n/a";
    const horizonPv = plan.expectedPvEnergyHorizonKwh !== undefined && plan.expectedPvEnergyHorizonKwh !== null
        ? ` PV_H=${plan.expectedPvEnergyHorizonKwh}kWh`
        : "";
    return (`Unified ${plan.planId} rev=${plan.inputRevision}: ` +
        `PV_today=${plan.expectedPvEnergyTodayKwh ?? "?"}kWh Load_today=${plan.expectedHouseLoadEnergyTodayKwh ?? "?"}kWh` +
        `${horizonPv} ` +
        `Imp=${plan.expectedGridImportEnergyKwh ?? "?"} Exp=${plan.expectedGridExportEnergyKwh ?? "?"} ` +
        `Cost=${plan.expectedCostCt ?? "?"}ct ${vehicleTxt}`).slice(0, 320);
}
exports.summarizeUnifiedDayPlanForReason = summarizeUnifiedDayPlanForReason;
