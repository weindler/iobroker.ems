"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.applyStatisticsAdjust = exports.parseStatisticsAdjustSubmit = void 0;
const state_util_1 = require("../ems_light/state_util");
const persist_1 = require("./persist");
const compute_1 = require("./compute");
function parseDateKey(raw) {
    if (typeof raw !== "string")
        return null;
    const s = raw.trim();
    return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null;
}
function parseStatisticsAdjustSubmit(raw) {
    if (raw == null || raw === "")
        return null;
    try {
        const obj = typeof raw === "string" ? JSON.parse(raw) : raw;
        if (!obj || typeof obj !== "object")
            return null;
        const o = obj;
        const homeRaw = o.home;
        const mobRaw = o.mobility;
        const home = homeRaw && typeof homeRaw === "object"
            ? {
                gridImportKwh: (0, state_util_1.asNum)(homeRaw.gridImportKwh),
                gridExportKwh: (0, state_util_1.asNum)(homeRaw.gridExportKwh),
                dynamicCostEur: (0, state_util_1.asNum)(homeRaw.dynamicCostEur),
                fixedTariffCostEur: (0, state_util_1.asNum)(homeRaw.fixedTariffCostEur),
                gridRewardsCreditEur: (0, state_util_1.asNum)(homeRaw.gridRewardsCreditEur),
                feedInCreditEur: (0, state_util_1.asNum)(homeRaw.feedInCreditEur),
            }
            : undefined;
        const mobility = mobRaw && typeof mobRaw === "object"
            ? {
                homePvKwh: (0, state_util_1.asNum)(mobRaw.homePvKwh),
                homeGridKwh: (0, state_util_1.asNum)(mobRaw.homeGridKwh),
                homePvCostEur: (0, state_util_1.asNum)(mobRaw.homePvCostEur),
                homeGridCostEur: (0, state_util_1.asNum)(mobRaw.homeGridCostEur),
            }
            : undefined;
        return {
            date: parseDateKey(o.date) ?? undefined,
            resetToday: o.resetToday === true,
            resetMonth: o.resetMonth === true,
            resetAll: o.resetAll === true,
            home,
            mobility,
            noteDe: typeof o.noteDe === "string" ? o.noteDe.trim().slice(0, 200) : undefined,
        };
    }
    catch {
        return null;
    }
}
exports.parseStatisticsAdjustSubmit = parseStatisticsAdjustSubmit;
function monthPrefix(dateKey) {
    return dateKey.slice(0, 7);
}
function ensureDay(persist, dateKey) {
    if (!persist.days[dateKey]) {
        persist.days[dateKey] = (0, persist_1.emptyDayRecord)(dateKey);
    }
    return persist.days[dateKey];
}
function mergeHome(day, patch) {
    if (patch.gridImportKwh !== null && patch.gridImportKwh !== undefined) {
        day.home.gridImportKwh = patch.gridImportKwh;
    }
    if (patch.gridExportKwh !== null && patch.gridExportKwh !== undefined) {
        day.home.gridExportKwh = patch.gridExportKwh;
    }
    if (patch.dynamicCostEur !== null && patch.dynamicCostEur !== undefined) {
        day.home.dynamicCostEur = patch.dynamicCostEur;
    }
    if (patch.fixedTariffCostEur !== null && patch.fixedTariffCostEur !== undefined) {
        day.home.fixedTariffCostEur = patch.fixedTariffCostEur;
    }
    if (patch.gridRewardsCreditEur !== null && patch.gridRewardsCreditEur !== undefined) {
        day.home.gridRewardsCreditEur = patch.gridRewardsCreditEur;
    }
    if (patch.feedInCreditEur !== null && patch.feedInCreditEur !== undefined) {
        day.home.feedInCreditEur = patch.feedInCreditEur;
    }
}
function mergeMobilityDay(day, patch) {
    if (patch.homePvKwh !== null && patch.homePvKwh !== undefined) {
        day.mobility.homePvKwh = patch.homePvKwh;
    }
    if (patch.homeGridKwh !== null && patch.homeGridKwh !== undefined) {
        day.mobility.homeGridKwh = patch.homeGridKwh;
    }
    if (patch.homePvCostEur !== null && patch.homePvCostEur !== undefined) {
        day.mobility.homePvCostEur = patch.homePvCostEur;
    }
    if (patch.homeGridCostEur !== null && patch.homeGridCostEur !== undefined) {
        day.mobility.homeGridCostEur = patch.homeGridCostEur;
    }
}
function syncRuntimeMobility(persist, patch) {
    const rt = persist.runtime;
    if (patch.homePvKwh !== null && patch.homePvKwh !== undefined) {
        rt.homePvKwh = Math.max(0, patch.homePvKwh);
    }
    if (patch.homeGridKwh !== null && patch.homeGridKwh !== undefined) {
        rt.homeGridKwh = Math.max(0, patch.homeGridKwh);
    }
    if (patch.homePvCostEur !== null && patch.homePvCostEur !== undefined) {
        rt.homePvCostEur = Math.max(0, patch.homePvCostEur);
    }
    if (patch.homeGridCostEur !== null && patch.homeGridCostEur !== undefined) {
        rt.homeGridCostEur = Math.max(0, patch.homeGridCostEur);
    }
    /** Baseline neu — nächster Tick addiert nur echte Session-Deltas. */
    rt.wallboxSessionEnergyBaselineKwh = null;
}
function resetDay(persist, dateKey) {
    delete persist.days[dateKey];
    if (persist.runtime.dateKey === dateKey) {
        persist.runtime = (0, persist_1.emptyRuntime)(dateKey);
    }
}
/** Wendet manuelle Korrektur / Startwerte an — gibt neues Persist-Objekt bei resetAll. */
function applyStatisticsAdjust(persist, submit, now) {
    const todayKey = (0, compute_1.localDateKey)(now);
    const dateKey = submit.date ?? todayKey;
    if (submit.resetAll) {
        const fresh = (0, persist_1.emptyPersist)(now);
        persist.days = fresh.days;
        persist.runtime = fresh.runtime;
        persist.generatedAt = fresh.generatedAt;
        persist.version = fresh.version;
        return {
            persist,
            ackDe: submit.noteDe || "Statistik komplett zurückgesetzt.",
        };
    }
    if (submit.resetMonth) {
        const prefix = monthPrefix(dateKey);
        for (const key of Object.keys(persist.days)) {
            if (key.startsWith(prefix)) {
                delete persist.days[key];
            }
        }
        if (persist.runtime.dateKey.startsWith(prefix)) {
            persist.runtime = (0, persist_1.emptyRuntime)(todayKey);
        }
        return {
            persist,
            ackDe: submit.noteDe || `Statistik Monat ${prefix} zurückgesetzt.`,
        };
    }
    if (submit.resetToday) {
        resetDay(persist, dateKey);
        return {
            persist,
            ackDe: submit.noteDe || `Statistik ${dateKey} zurückgesetzt.`,
        };
    }
    const parts = [];
    if (submit.home && Object.values(submit.home).some((v) => v !== null && v !== undefined)) {
        const day = ensureDay(persist, dateKey);
        mergeHome(day, submit.home);
        parts.push("Haus");
    }
    if (submit.mobility && Object.values(submit.mobility).some((v) => v !== null && v !== undefined)) {
        const day = ensureDay(persist, dateKey);
        mergeMobilityDay(day, submit.mobility);
        if (dateKey === todayKey) {
            syncRuntimeMobility(persist, submit.mobility);
        }
        parts.push("Mobilität");
    }
    if (parts.length === 0) {
        return {
            persist,
            ackDe: "Nichts geändert — resetToday/resetMonth/resetAll oder home/mobility angeben.",
        };
    }
    return {
        persist,
        ackDe: submit.noteDe ||
            `Statistik ${dateKey}: ${parts.join(" + ")} gesetzt — ab nächstem Tick weitergezählt.`,
    };
}
exports.applyStatisticsAdjust = applyStatisticsAdjust;
