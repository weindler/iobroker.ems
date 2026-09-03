"use strict";
/**
 * Leitet Slot-Präferenzen aus strategischen KI-Entscheidungen ab.
 * Reine Funktion — keine I/O, keine Geräte-Writes.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.parseAiSlotPreferencesJson = exports.acceptedImmersionSoftDisallowedSlotIsos = exports.immersionSoftDisallowedSlotIsosFromRetainedPrefs = exports.immersionDeferTomorrowFromDecisions = exports.wallboxPvOnlyFromDecisions = exports.decisionsToSlotPreferences = exports.normalizeAddonDecisions = void 0;
const time_1 = require("../operator/time");
/** Extremere Gewichte → Plan B weicht klar von Plan A ab (sonst oft Identitäts-Compare). */
const HIGH_W = 3;
const LOW_W = 0.05;
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
/** Kombiniert Gewichtskarten (Summe der Anteile = 1 empfohlen Slot → clamp 0.05..3). */
function blendWeightMaps(slots, parts) {
    const out = new Map();
    for (const s of slots) {
        let sum = 0;
        for (const p of parts) {
            sum += (p.map.get(s.startIso) ?? 1) * p.share;
        }
        out.set(s.startIso, Math.min(HIGH_W, Math.max(LOW_W, sum)));
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
/**
 * Korrigiert Action/Note-Widersprüche (z. B. charge_cheap_grid_now bei „PV-Überschuss hoch“)
 * anhand Situation + Note — bevor Gewichte abgeleitet werden.
 */
function normalizeAddonDecisions(decisions, situation) {
    const surplus = situation?.nextHours?.avgAvailablePvSurplusPowerW ?? null;
    const surplusHigh = surplus !== null && Number.isFinite(surplus) && surplus >= 800;
    const pvToday = situation?.pvTodayKwh ?? null;
    const pvTomorrow = situation?.pvTomorrowKwh ?? null;
    const tomorrowMuchBetter = pvToday !== null &&
        pvTomorrow !== null &&
        Number.isFinite(pvToday) &&
        Number.isFinite(pvTomorrow) &&
        pvTomorrow >= pvToday * 1.35 &&
        pvTomorrow - pvToday >= 3;
    return decisions.map((d) => {
        if (!d || d.action === "keep_plan_a")
            return d;
        const note = (d.note ?? "").toLowerCase();
        const notePv = /pv|überschuss|ueberschuss|sonne|solar/.test(note);
        const noteCheap = /günstig|guenstig|preis|billig|tibber|netz/.test(note);
        const noteTomorrow = /morgen|tomorrow|warten|wait/.test(note);
        if (d.addonId === "wallbox") {
            if (d.action === "charge_cheap_grid_now" && noteTomorrow && tomorrowMuchBetter) {
                return {
                    ...d,
                    action: "prefer_pv_tomorrow",
                    note: `${d.note} [→PV morgen]`.slice(0, 400),
                };
            }
            // Action „Netz günstig“ aber Begründung/Situation sagt PV → PV-heute (kein Netz-Peak).
            if (d.action === "charge_cheap_grid_now" && (notePv || surplusHigh) && !noteCheap) {
                return {
                    ...d,
                    action: "prefer_pv_today",
                    note: `${d.note} [→PV heute]`.slice(0, 400),
                };
            }
            if (d.action === "prefer_pv_today" && noteTomorrow && tomorrowMuchBetter) {
                return {
                    ...d,
                    action: "prefer_pv_tomorrow",
                    note: `${d.note} [→PV morgen]`.slice(0, 400),
                };
            }
        }
        if (d.addonId === "immersion_heater" && d.action === "heat_today" && noteTomorrow && tomorrowMuchBetter) {
            return {
                ...d,
                action: "defer_tomorrow",
                note: `${d.note} [→aufschieben]`.slice(0, 400),
            };
        }
        if (d.addonId === "battery" && d.action === "charge_now" && notePv && !noteCheap && surplusHigh) {
            return {
                ...d,
                action: "wait_pv",
                note: `${d.note} [→auf PV warten]`.slice(0, 400),
            };
        }
        return d;
    });
}
exports.normalizeAddonDecisions = normalizeAddonDecisions;
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
            const windowIso = new Set(window.map((s) => s.startIso));
            // Günstig + möglichst viel Überschuss (menschlich: „jetzt laden wenn billig UND Sonne“).
            const blended = blendWeightMaps(window, [
                { map: priceQuartileWeights(window), share: 0.55 },
                { map: surplusWeights(window, HIGH_W, 0.4), share: 0.45 },
            ]);
            // Außerhalb Fenster meiden — sonst bleibt Energie mit Default-Gewicht 1 stehen.
            for (const s of allSlots) {
                if (!windowIso.has(s.startIso))
                    blended.set(s.startIso, LOW_W);
            }
            return prefsFromMap(addonId, blended);
        }
        if (action === "prefer_pv_tomorrow") {
            const out = new Map();
            const tomorrowSlots = allSlots.filter((s) => Number.isFinite(s.startMs) && s.startMs >= tomorrowMs);
            const todaySlots = allSlots.filter((s) => Number.isFinite(s.startMs) && s.startMs < tomorrowMs);
            for (const [iso, w] of surplusWeights(tomorrowSlots, HIGH_W, 1))
                out.set(iso, w);
            for (const s of todaySlots)
                out.set(s.startIso, LOW_W);
            return prefsFromMap(addonId, out);
        }
        if (action === "prefer_pv_today") {
            const todaySlots = allSlots.filter((s) => Number.isFinite(s.startMs) && s.startMs < tomorrowMs);
            const laterSlots = allSlots.filter((s) => Number.isFinite(s.startMs) && s.startMs >= tomorrowMs);
            const blended = blendWeightMaps(todaySlots, [
                { map: surplusWeights(todaySlots, HIGH_W, LOW_W), share: 0.7 },
                { map: priceQuartileWeights(todaySlots), share: 0.3 },
            ]);
            for (const s of laterSlots)
                blended.set(s.startIso, LOW_W);
            return prefsFromMap(addonId, blended);
        }
    }
    if (addonId === "immersion_heater") {
        if (action === "heat_today") {
            const todaySlots = allSlots.filter((s) => Number.isFinite(s.startMs) && s.startMs < tomorrowMs);
            const laterSlots = allSlots.filter((s) => Number.isFinite(s.startMs) && s.startMs >= tomorrowMs);
            const blended = blendWeightMaps(todaySlots, [
                { map: surplusWeights(todaySlots, HIGH_W, LOW_W), share: 0.65 },
                { map: priceQuartileWeights(todaySlots), share: 0.35 },
            ]);
            for (const s of laterSlots)
                blended.set(s.startIso, LOW_W);
            return prefsFromMap(addonId, blended);
        }
        if (action === "defer_tomorrow") {
            const out = new Map();
            const tomorrowSlots = allSlots.filter((s) => Number.isFinite(s.startMs) && s.startMs >= tomorrowMs);
            const todaySlots = allSlots.filter((s) => Number.isFinite(s.startMs) && s.startMs < tomorrowMs);
            for (const [iso, w] of surplusWeights(tomorrowSlots, HIGH_W, 1))
                out.set(iso, w);
            // Gewicht 0 = harter Ausschluss (kein Fallback auf heute).
            for (const s of todaySlots)
                out.set(s.startIso, 0);
            return prefsFromMap(addonId, out);
        }
    }
    if (addonId === "battery") {
        if (action === "hold") {
            return allSlots.map((s) => ({ addonId, slotStartIso: s.startIso, weight: HOLD_W }));
        }
        if (action === "charge_now") {
            const window = allSlots.filter((s) => Number.isFinite(s.startMs) && s.startMs >= nowMs && s.startMs < horizonEnd12);
            const blended = blendWeightMaps(window, [
                { map: priceQuartileWeights(window), share: 0.5 },
                { map: surplusWeights(window, HIGH_W, 0.4), share: 0.5 },
            ]);
            return prefsFromMap(addonId, blended);
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
/** Explizite KI-Entscheidung: flexiblen Heizstab heute meiden / auf morgen verschieben. */
function immersionDeferTomorrowFromDecisions(decisions) {
    return decisions.some((d) => d.addonId === "immersion_heater" && d.action === "defer_tomorrow");
}
exports.immersionDeferTomorrowFromDecisions = immersionDeferTomorrowFromDecisions;
/** Slot-ISOs mit Gewicht 0 aus retained IH-Prefs — keine Decision-JSON. */
function immersionSoftDisallowedSlotIsosFromRetainedPrefs(prefs) {
    const out = [];
    const seen = new Set();
    for (const p of prefs) {
        if (!p || p.addonId !== "immersion_heater" || p.weight !== 0)
            continue;
        if (typeof p.slotStartIso !== "string" || !p.slotStartIso)
            continue;
        if (seen.has(p.slotStartIso))
            continue;
        seen.add(p.slotStartIso);
        out.push(p.slotStartIso);
    }
    return out;
}
exports.immersionSoftDisallowedSlotIsosFromRetainedPrefs = immersionSoftDisallowedSlotIsosFromRetainedPrefs;
/**
 * Compare-Gate: nur wenn Plan B akzeptiert wurde und retained Prefs heutige Flex-Slots
 * mit Gewicht 0 markieren. Rohe Decisions allein reichen nicht.
 */
function acceptedImmersionSoftDisallowedSlotIsos(input) {
    if (input.activePlan !== "b")
        return [];
    return immersionSoftDisallowedSlotIsosFromRetainedPrefs(input.prefs ?? []);
}
exports.acceptedImmersionSoftDisallowedSlotIsos = acceptedImmersionSoftDisallowedSlotIsos;
function parseAiSlotPreferencesJson(raw) {
    if (typeof raw !== "string" || !raw)
        return [];
    try {
        const parsed = JSON.parse(raw);
        if (!Array.isArray(parsed))
            return [];
        return parsed.filter((p) => !!p &&
            typeof p === "object" &&
            typeof p.addonId === "string" &&
            typeof p.slotStartIso === "string" &&
            typeof p.weight === "number");
    }
    catch {
        return [];
    }
}
exports.parseAiSlotPreferencesJson = parseAiSlotPreferencesJson;
