"use strict";
/**
 * Leitet Slot-Präferenzen aus strategischen KI-Entscheidungen ab.
 * Reine Funktion — keine I/O, keine Geräte-Writes.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.wallboxPvOnlyFromDecisions = exports.decisionsToSlotPreferences = void 0;
const time_1 = require("../operator/time");
const HIGH_W = 2.8;
const LOW_W = 0.2;
const HOLD_W = 0.1;
const MS_12H = 12 * 3_600_000;
function wallboxDeadlineMs(plan) {
    let best = null;
    for (const slot of plan.slots) {
        for (const a of slot.allocations) {
            if (a.mandatory || !a.contributionId.startsWith("wallbox.ev_session") || !a.deadlineIso)
                continue;
            const t = Date.parse(a.deadlineIso);
            if (!Number.isFinite(t))
                continue;
            best = best === null ? t : Math.min(best, t);
        }
    }
    return best;
}
function localTomorrowStartMs(plan, refMs) {
    const todayKey = (0, time_1.localDateKeyInTimezone)(new Date(refMs), plan.timezone);
    const tomorrowKey = (0, time_1.addDaysToDateKey)(todayKey, 1);
    return Date.parse((0, time_1.isoAtTimezoneLocal)(tomorrowKey, 0, 0, plan.timezone));
}
function avgSurplus(slots) {
    const vals = slots
        .map((s) => s.availablePvSurplusPowerW)
        .filter((v) => v !== null && Number.isFinite(v));
    if (vals.length === 0)
        return 0;
    return vals.reduce((a, b) => a + b, 0) / vals.length;
}
function priceQuartileWeights(slots) {
    const priced = slots
        .filter((s) => s.price !== null && Number.isFinite(s.price))
        .map((s) => ({ startIso: s.startIso, price: s.price }))
        .sort((a, b) => a.price - b.price || a.startIso.localeCompare(b.startIso));
    const out = new Map();
    if (priced.length === 0)
        return out;
    const cheapCount = Math.max(1, Math.ceil(priced.length * 0.25));
    const expensiveStart = Math.max(cheapCount, priced.length - cheapCount);
    for (let i = 0; i < priced.length; i++) {
        const iso = priced[i].startIso;
        if (i < cheapCount)
            out.set(iso, HIGH_W);
        else if (i >= expensiveStart)
            out.set(iso, LOW_W);
        else
            out.set(iso, 1);
    }
    return out;
}
function surplusWeights(slots, highW, lowW) {
    const avg = (() => {
        const vals = slots
            .map((s) => s.surplus)
            .filter((v) => v !== null && Number.isFinite(v));
        if (vals.length === 0)
            return 0;
        return vals.reduce((a, b) => a + b, 0) / vals.length;
    })();
    const out = new Map();
    for (const s of slots) {
        const surplus = s.surplus;
        if (surplus === null || !Number.isFinite(surplus)) {
            out.set(s.startIso, 1);
            continue;
        }
        out.set(s.startIso, surplus >= avg && surplus > 0 ? highW : lowW);
    }
    return out;
}
function prefsFromMap(addonId, weights) {
    return [...weights.entries()].map(([slotStartIso, weight]) => ({
        addonId,
        slotStartIso,
        weight,
    }));
}
function deriveForDecision(plan, decision, nowMs) {
    const { addonId, action } = decision;
    if (action === "keep_plan_a")
        return [];
    const tomorrowMs = localTomorrowStartMs(plan, nowMs);
    const deadlineMs = wallboxDeadlineMs(plan);
    const horizonEnd12 = nowMs + MS_12H;
    const allSlots = plan.slots.map((s) => ({
        startIso: s.slot.startIso,
        startMs: Date.parse(s.slot.startIso),
        price: s.gridPriceCtPerKwh,
        surplus: s.availablePvSurplusPowerW,
    }));
    if (addonId === "wallbox") {
        if (action === "charge_cheap_grid_now") {
            const window = allSlots.filter((s) => {
                if (!Number.isFinite(s.startMs) || s.startMs < nowMs || s.startMs >= horizonEnd12)
                    return false;
                if (deadlineMs !== null && s.startMs >= deadlineMs)
                    return false;
                return true;
            });
            return prefsFromMap(addonId, priceQuartileWeights(window));
        }
        if (action === "prefer_pv_tomorrow") {
            const out = new Map();
            const tomorrowSlots = allSlots.filter((s) => Number.isFinite(s.startMs) && s.startMs >= tomorrowMs);
            const todaySlots = allSlots.filter((s) => Number.isFinite(s.startMs) && s.startMs < tomorrowMs);
            for (const [iso, w] of surplusWeights(tomorrowSlots, HIGH_W, 1.2))
                out.set(iso, w);
            for (const s of todaySlots)
                out.set(s.startIso, LOW_W);
            return prefsFromMap(addonId, out);
        }
        if (action === "prefer_pv_today") {
            const todaySlots = allSlots.filter((s) => Number.isFinite(s.startMs) && s.startMs < tomorrowMs);
            return prefsFromMap(addonId, surplusWeights(todaySlots, HIGH_W, 0.5));
        }
    }
    if (addonId === "immersion_heater") {
        if (action === "heat_today") {
            const todaySlots = allSlots.filter((s) => Number.isFinite(s.startMs) && s.startMs < tomorrowMs);
            return prefsFromMap(addonId, surplusWeights(todaySlots, HIGH_W, 0.5));
        }
        if (action === "defer_tomorrow") {
            const out = new Map();
            const tomorrowSlots = allSlots.filter((s) => Number.isFinite(s.startMs) && s.startMs >= tomorrowMs);
            const todaySlots = allSlots.filter((s) => Number.isFinite(s.startMs) && s.startMs < tomorrowMs);
            for (const [iso, w] of surplusWeights(tomorrowSlots, HIGH_W, 1.2))
                out.set(iso, w);
            for (const s of todaySlots)
                out.set(s.startIso, LOW_W);
            return prefsFromMap(addonId, out);
        }
    }
    if (addonId === "battery") {
        if (action === "hold") {
            return allSlots.map((s) => ({ addonId, slotStartIso: s.startIso, weight: HOLD_W }));
        }
        if (action === "charge_now") {
            const window = allSlots.filter((s) => Number.isFinite(s.startMs) && s.startMs >= nowMs && s.startMs < horizonEnd12);
            const priceMap = priceQuartileWeights(window);
            const surplusMap = surplusWeights(window, HIGH_W, 0.8);
            const out = new Map();
            for (const s of window) {
                const pw = priceMap.get(s.startIso) ?? 1;
                const sw = surplusMap.get(s.startIso) ?? 1;
                out.set(s.startIso, Math.min(3, Math.max(pw, sw)));
            }
            return prefsFromMap(addonId, out);
        }
        if (action === "wait_pv") {
            const mean = avgSurplus(plan.slots);
            const out = new Map();
            for (const s of allSlots) {
                const surplus = s.surplus;
                if (surplus !== null && Number.isFinite(surplus) && surplus > mean && surplus > 0) {
                    out.set(s.startIso, HIGH_W);
                }
                else {
                    out.set(s.startIso, LOW_W);
                }
            }
            return prefsFromMap(addonId, out);
        }
    }
    // climate advisory / unknown → no derived prefs
    return [];
}
function mergePrefs(derived, aiProvided) {
    const map = new Map();
    for (const p of derived) {
        map.set(`${p.addonId}|${p.slotStartIso}`, p);
    }
    // AI-provided prefs win on same slot+addon
    for (const p of aiProvided) {
        map.set(`${p.addonId}|${p.slotStartIso}`, p);
    }
    return [...map.values()];
}
/**
 * Wandelt strategische Decisions in Slot-Gewichte um und merged mit KI-slot_preferences.
 * Nur Add-ons mit Decision ≠ keep_plan_a erzeugen abgeleitete Prefs.
 */
function decisionsToSlotPreferences(plan, decisions, existingPrefs, nowMs = Date.now()) {
    const derived = [];
    for (const d of decisions) {
        if (!d || d.action === "keep_plan_a")
            continue;
        derived.push(...deriveForDecision(plan, d, nowMs));
    }
    return mergePrefs(derived, existingPrefs);
}
exports.decisionsToSlotPreferences = decisionsToSlotPreferences;
/** Wallbox soll nur PV-Kapazität nutzen (kein zusätzlicher Netz-Peak in Plan B). */
function wallboxPvOnlyFromDecisions(decisions) {
    return decisions.some((d) => d.addonId === "wallbox" &&
        (d.action === "prefer_pv_today" || d.action === "prefer_pv_tomorrow"));
}
exports.wallboxPvOnlyFromDecisions = wallboxPvOnlyFromDecisions;
