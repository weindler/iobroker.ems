"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.forecastPlanRevisionPayload = exports.buildForecastPlan = void 0;
const contribution_ids_1 = require("../contribution_ids");
const contributor_1 = require("../contributor");
const quality_1 = require("../quality");
const time_1 = require("../time");
function findContribution(contributions, key) {
    return contributions.find((c) => (0, contributor_1.contributorRefKey)(c.contributor) === key);
}
function findContributionById(contributions, contributionId) {
    return contributions.find((c) => c.contributionId === contributionId);
}
function isOptionalFlexibleExclusion(c) {
    if (c.contributionId === contribution_ids_1.CONTRIBUTION_IDS.BATTERY_DISCHARGE)
        return true;
    if (c.contributionId === contribution_ids_1.CONTRIBUTION_IDS.WALLBOX_EV_SESSION && !c.enabled)
        return true;
    if (c.quality.status === "unsupported")
        return true;
    if (c.quality.status === "disabled" && c.flexible)
        return true;
    return false;
}
function pvDayEnergy(contribution, dateKey) {
    if (!contribution?.enabled)
        return null;
    const details = contribution.details;
    const todayKey = details.todayDateKey;
    const tomorrowKey = details.tomorrowDateKey;
    if (dateKey === todayKey && details.correctedTodayKwh !== undefined) {
        const v = details.correctedTodayKwh;
        return typeof v === "number" && Number.isFinite(v) ? v : null;
    }
    if (dateKey === tomorrowKey && details.correctedTomorrowKwh !== undefined) {
        const v = details.correctedTomorrowKwh;
        return typeof v === "number" && Number.isFinite(v) ? v : null;
    }
    const horizonDays = details.horizonDays;
    const match = horizonDays?.find((d) => d.dateKey === dateKey);
    if (match && match.correctedKwh !== null && Number.isFinite(match.correctedKwh)) {
        return match.correctedKwh;
    }
    return null;
}
function houseLoadDayEnergy(contribution, dateKey) {
    if (!contribution?.enabled)
        return null;
    const details = contribution.details;
    if (dateKey === details.todayDateKey) {
        const v = details.expectedFixedTodayKwh;
        return typeof v === "number" && Number.isFinite(v) ? v : null;
    }
    if (dateKey === details.tomorrowDateKey) {
        const v = details.expectedFixedTomorrowKwh;
        return typeof v === "number" && Number.isFinite(v) ? v : null;
    }
    return null;
}
function weatherDayMinMax(contribution, dateKey, todayKey, tomorrowKey) {
    if (!contribution?.enabled)
        return { min: null, max: null };
    const d = contribution.details;
    if (dateKey === todayKey) {
        return {
            min: typeof d.todayMinTempC === "number" ? d.todayMinTempC : null,
            max: typeof d.todayMaxTempC === "number" ? d.todayMaxTempC : null,
        };
    }
    if (dateKey === tomorrowKey) {
        return {
            min: typeof d.tomorrowMinTempC === "number" ? d.tomorrowMinTempC : null,
            max: typeof d.tomorrowMaxTempC === "number" ? d.tomorrowMaxTempC : null,
        };
    }
    return { min: null, max: null };
}
function buildDays(input, pv, house, weather) {
    const todayKey = (0, time_1.localDateKeyInTimezone)(input.now, input.timezone);
    const dayKeys = [todayKey, (0, time_1.addDaysToDateKey)(todayKey, 1)];
    const horizonDays = pv?.details.horizonDays;
    if (horizonDays) {
        for (const d of horizonDays) {
            if (!dayKeys.includes(d.dateKey))
                dayKeys.push(d.dateKey);
        }
    }
    const tomorrowKey = (0, time_1.addDaysToDateKey)(todayKey, 1);
    const days = [];
    for (const dateKey of dayKeys.sort()) {
        const pvKwh = pvDayEnergy(pv, dateKey);
        const loadKwh = houseLoadDayEnergy(house, dateKey);
        const weatherTemps = weatherDayMinMax(weather, dateKey, todayKey, tomorrowKey);
        let renewableBalance = null;
        if (pvKwh !== null && loadKwh !== null) {
            renewableBalance = Math.round((pvKwh - loadKwh) * 1000) / 1000;
        }
        let dayQuality = (0, quality_1.operatorQuality)("missing", "Keine Tagesdaten.");
        if (pvKwh !== null || loadKwh !== null) {
            dayQuality = (0, quality_1.mergeOperatorQuality)(pvKwh !== null ? (pv?.quality ?? dayQuality) : (0, quality_1.operatorQuality)("missing", "PV fehlt."), loadKwh !== null ? (house?.quality ?? dayQuality) : (0, quality_1.operatorQuality)("missing", "Hauslast fehlt."));
        }
        const parts = [];
        if (pvKwh !== null)
            parts.push(`PV ${pvKwh} kWh`);
        if (loadKwh !== null)
            parts.push(`Hauslast ${loadKwh} kWh`);
        if (renewableBalance !== null)
            parts.push(`Bilanz ${renewableBalance} kWh`);
        days.push({
            date: dateKey,
            pvEnergyKwh: pvKwh,
            houseLoadEnergyKwh: loadKwh,
            renewableBalanceKwh: renewableBalance,
            weatherMinTempC: weatherTemps.min,
            weatherMaxTempC: weatherTemps.max,
            quality: dayQuality,
            reasonDe: parts.length > 0 ? parts.join(", ") + "." : "Keine gültigen Tageswerte.",
        });
    }
    return days;
}
function slotKey(startIso, endIso) {
    return `${startIso}|${endIso}`;
}
function buildSlots(input, pv, house, weather, grid, globalConstraints) {
    const byKey = new Map();
    const upsert = (startIso, endIso, patch) => {
        if (!(0, time_1.isValidIsoTimestamp)(startIso) || !(0, time_1.isValidIsoTimestamp)(endIso))
            return;
        const key = slotKey(startIso, endIso);
        const existing = byKey.get(key) ?? {
            slot: { startIso, endIso },
            pvPowerW: null,
            houseLoadPowerW: null,
            fixedBalancePowerW: null,
            gridPriceCtPerKwh: null,
            gridImportAllowed: true,
            gridMaxImportPowerW: null,
            outdoorTempC: null,
            quality: (0, quality_1.operatorQuality)("missing", "Keine Slotdaten."),
            reasonDe: "",
        };
        byKey.set(key, { ...existing, ...patch, slot: { startIso, endIso } });
    };
    for (const s of grid?.slots ?? []) {
        upsert(s.slot.startIso, s.slot.endIso, {
            gridPriceCtPerKwh: s.priceCtPerKwh ?? null,
            gridImportAllowed: s.available,
            gridMaxImportPowerW: s.maxPowerW,
            quality: s.quality,
            reasonDe: "Grid-Supply-Preisslot.",
        });
    }
    for (const s of house?.slots ?? []) {
        const power = s.preferredPowerW;
        upsert(s.slot.startIso, s.slot.endIso, {
            houseLoadPowerW: power,
            quality: (0, quality_1.mergeOperatorQuality)(byKey.get(slotKey(s.slot.startIso, s.slot.endIso))?.quality ??
                (0, quality_1.operatorQuality)("missing", ""), s.quality),
            reasonDe: "Hauslast-Segment-Baseline.",
        });
    }
    for (const s of weather?.slots ?? []) {
        if (!s.available)
            continue;
        const details = weather?.details.hourlyPoints;
        const point = details?.find((p) => p.startIso === s.slot.startIso && p.endIso === s.slot.endIso);
        const temp = point?.outdoorTempC ??
            (s.slot.startIso === weather?.generatedAt ? weather.details.outdoorTempC : null);
        if (temp !== null) {
            upsert(s.slot.startIso, s.slot.endIso, {
                outdoorTempC: temp,
                reasonDe: "Wetter-Kontext.",
            });
        }
    }
    const importAllowedDefault = globalConstraints?.details.gridImportAllowed ?? true;
    const maxImportDefault = globalConstraints?.details.effectiveMaxGridImportW ?? null;
    for (const [key, slot] of byKey) {
        if (slot.houseLoadPowerW !== null && slot.pvPowerW !== null) {
            slot.fixedBalancePowerW = slot.pvPowerW - slot.houseLoadPowerW;
        }
        if (slot.gridImportAllowed === true && importAllowedDefault === false) {
            slot.gridImportAllowed = false;
        }
        if (slot.gridMaxImportPowerW === null && maxImportDefault !== null) {
            slot.gridMaxImportPowerW = maxImportDefault;
        }
        const reasons = [];
        if (slot.gridPriceCtPerKwh !== null)
            reasons.push("Preis");
        if (slot.houseLoadPowerW !== null)
            reasons.push("Hauslast");
        if (slot.outdoorTempC !== null)
            reasons.push("Temperatur");
        slot.reasonDe = reasons.length > 0 ? reasons.join(", ") + "." : "Keine zeitlich aufgelösten Werte.";
        byKey.set(key, slot);
    }
    return [...byKey.values()].sort((a, b) => {
        const cmp = a.slot.startIso.localeCompare(b.slot.startIso);
        return cmp !== 0 ? cmp : a.slot.endIso.localeCompare(b.slot.endIso);
    });
}
function resolveStatus(pv, house, weather, grid, timezone) {
    if (!timezone.trim())
        return "error";
    const pvOk = pv?.enabled && pv.quality.status !== "missing" && pv.quality.status !== "invalid";
    const houseOk = house?.enabled && house.quality.status !== "missing" && house.quality.status !== "invalid";
    if (!pvOk || !houseOk)
        return "missing_inputs";
    const weatherMissing = !weather?.enabled || weather.quality.status === "missing";
    const gridMissing = !grid?.enabled || grid.quality.status === "missing";
    const anyDegraded = [pv, house, weather, grid].some((c) => c?.enabled && c.quality.status === "degraded");
    if (weatherMissing || gridMissing || anyDegraded)
        return "degraded";
    return "ready";
}
function partitionContributors(contributions) {
    const active = [];
    const excluded = [];
    for (const c of contributions) {
        if (c.enabled && c.quality.status !== "missing" && c.quality.status !== "invalid") {
            if (!active.some((a) => (0, contributor_1.contributorRefKey)(a) === (0, contributor_1.contributorRefKey)(c.contributor))) {
                active.push(c.contributor);
            }
        }
        else if (!isOptionalFlexibleExclusion(c)) {
            excluded.push({
                contributor: c.contributor,
                contributionId: c.contributionId,
                reasonDe: c.reasonDe || c.quality.reasonDe,
            });
        }
        else {
            excluded.push({
                contributor: c.contributor,
                contributionId: c.contributionId,
                reasonDe: c.reasonDe || c.quality.reasonDe,
            });
        }
    }
    return { active, excluded };
}
function overallQuality(status, contributions) {
    if (status === "error")
        return (0, quality_1.operatorQuality)("invalid", "Forecast Plan Fehler.");
    if (status === "missing_inputs")
        return (0, quality_1.operatorQuality)("missing", "Pflichtquellen PV oder Hauslast fehlen.");
    if (status === "disabled")
        return (0, quality_1.operatorQuality)("disabled", "Forecast Plan deaktiviert.");
    if (status === "degraded") {
        return (0, quality_1.operatorQuality)("degraded", "Forecast Plan nutzbar, aber mit Lücken.");
    }
    let q = (0, quality_1.operatorQuality)("valid", "Forecast Plan bereit.");
    for (const c of contributions) {
        if (c.enabled)
            q = (0, quality_1.mergeOperatorQuality)(q, c.quality);
    }
    return q;
}
function planReasonDe(status, excluded) {
    if (status === "ready")
        return "Deterministischer Forecast Plan mit PV und Hauslast bereit.";
    if (status === "degraded") {
        const names = excluded.map((e) => e.contributor.id).join(", ");
        return names
            ? `Forecast Plan nutzbar; ausgeschlossen: ${names}.`
            : "Forecast Plan nutzbar mit eingeschränkten Nebenquellen.";
    }
    if (status === "missing_inputs")
        return "PV- oder Hauslast-Prognose fehlt — keine Energiebilanz erfunden.";
    return "Forecast Plan nicht vollständig.";
}
function buildForecastPlan(input) {
    const slotMinutes = input.slotMinutes ?? time_1.OPERATOR_MS_PER_15MIN / 60_000;
    const pv = findContribution(input.contributions, "addon:pv_forecast");
    const house = findContribution(input.contributions, "system:house_load");
    const weather = findContribution(input.contributions, "addon:weather_forecast");
    const grid = findContribution(input.contributions, "system:grid_supply");
    const globalConstraints = findContribution(input.contributions, "system:global_constraints");
    const days = buildDays(input, pv, house, weather);
    const slots = buildSlots(input, pv, house, weather, grid, globalConstraints);
    const { active, excluded } = partitionContributors(input.contributions);
    const status = resolveStatus(pv, house, weather, grid, input.timezone);
    const todayKey = (0, time_1.localDateKeyInTimezone)(input.now, input.timezone);
    const horizonStart = input.now.toISOString();
    const horizonEnd = isoEndOfDay((0, time_1.addDaysToDateKey)(todayKey, 1), input.timezone);
    return {
        generatedAt: input.now.toISOString(),
        validUntil: grid?.validUntil ?? null,
        revision: 0,
        timezone: input.timezone,
        horizonStart,
        horizonEnd,
        slotMinutes,
        status,
        activeContributors: active,
        excludedContributors: excluded,
        days,
        slots,
        contributions: input.contributions,
        quality: overallQuality(status, input.contributions),
        reasonDe: planReasonDe(status, excluded),
    };
}
exports.buildForecastPlan = buildForecastPlan;
function isoEndOfDay(dateKey, timezone) {
    const next = (0, time_1.addDaysToDateKey)(dateKey, 1);
    return (0, time_1.isoAtTimezoneLocal)(next, 0, 0, timezone);
}
function forecastPlanRevisionPayload(plan) {
    const payload = {
        status: plan.status,
        timezone: plan.timezone,
        horizonEnd: plan.horizonEnd,
        slotMinutes: plan.slotMinutes,
        activeContributors: plan.activeContributors,
        excludedContributors: plan.excludedContributors,
        days: plan.days,
        slots: plan.slots,
        contributions: plan.contributions.map((c) => ({
            contributionId: c.contributionId,
            flow: c.flow,
            contributor: c.contributor,
            roles: c.roles,
            enabled: c.enabled,
            quality: c.quality,
            details: c.details,
            slots: c.slots,
        })),
        quality: plan.quality,
        reasonDe: plan.reasonDe,
    };
    return JSON.stringify(payload);
}
exports.forecastPlanRevisionPayload = forecastPlanRevisionPayload;
