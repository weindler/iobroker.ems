"use strict";
/**
 * PHASE 7 — Wirtschaftlichkeit: periodischer Buchungslauf.
 *
 * Bucht abgeschlossene Kalendertage EINMAL (idempotent) sobald Statistik-Tagesdaten UND die
 * Shadow-Engine-Simulation für diesen Tag verfügbar sind. "Heute" wird nur live angezeigt
 * (transient, nie in der Historie gespeichert) — der Tag ist noch nicht abgeschlossen.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.tickEconomics = void 0;
const time_1 = require("../operator/time");
const persist_1 = require("../statistics/persist");
const period_1 = require("../statistics/period");
const config_1 = require("../statistics/config");
const shadow_engine_1 = require("../learning/shadow_engine");
const persist_2 = require("../learning/shadow_engine/persist");
const compute_1 = require("./compute");
const ensure_states_1 = require("./ensure_states");
const persist_3 = require("./persist");
async function setIfChanged(host, id, val) {
    const cur = await host.getStateAsync(id);
    if (cur?.val === val)
        return;
    await host.setStateAsync(id, { val, ack: true });
}
function timezoneFromConfig(config) {
    const tz = typeof config?.timezone === "string"
        ? config.timezone.trim()
        : "";
    return tz || "Europe/Berlin";
}
async function tickEconomics(host, now = new Date()) {
    await (0, ensure_states_1.ensureEconomicsStates)(host);
    const statsCfg = (0, config_1.statisticsConfigFromAdapter)(host.config);
    if (!statsCfg.enabled) {
        await setIfChanged(host, ensure_states_1.ECONOMICS_STATES.enabled, false);
        await setIfChanged(host, ensure_states_1.ECONOMICS_STATES.reasonDe, "Wirtschaftlichkeit inaktiv (Statistik im Admin deaktiviert).");
        return;
    }
    const timezone = timezoneFromConfig(host.config);
    const todayKey = (0, time_1.localDateKeyInTimezone)(now, timezone);
    const statsDir = host.getAbsolutePath(persist_1.STATISTICS_PERSIST_CATEGORY);
    const econDir = host.getAbsolutePath(persist_3.ECONOMICS_PERSIST_CATEGORY);
    const shadowDir = host.getAbsolutePath(shadow_engine_1.SHADOW_ENGINE_RESULTS_CATEGORY);
    const statsPersist = await (0, persist_1.readStatisticsPersist)(statsDir);
    let econPersist = await (0, persist_3.readEconomicsPersist)(econDir);
    let dirty = false;
    // --- abgeschlossene Tage EINMAL verbuchen (idempotent) ---
    for (const dateKey of Object.keys(statsPersist.days).sort()) {
        if (dateKey >= todayKey)
            continue;
        if (econPersist.days[dateKey]?.final)
            continue;
        const statsDay = statsPersist.days[dateKey];
        if (!statsDay)
            continue;
        const shadow = await (0, persist_2.readShadowDayRecord)(shadowDir, dateKey);
        if (!shadow)
            continue; // Shadow-Engine hat diesen Tag noch nicht simuliert — nächster Lauf holt nach.
        const rec = (0, compute_1.buildEconomicsDayRecord)({
            dateKey,
            final: true,
            tarifvorteilEur: statsDay.home.savingsVsFixedEur,
            gridRewardsCreditEur: statsDay.home.gridRewardsCreditEur,
            gridRewardsSource: statsDay.home.gridRewardsSource,
            shadow,
            now,
        });
        econPersist.days[dateKey] = rec;
        dirty = true;
    }
    if (dirty) {
        await (0, persist_3.writeEconomicsPersist)(econDir, econPersist);
        econPersist = await (0, persist_3.readEconomicsPersist)(econDir);
    }
    // --- "heute" nur live, nie persistiert (Tag ist noch nicht abgeschlossen) ---
    const statsToday = statsPersist.days[todayKey];
    const todayRecord = (0, compute_1.buildEconomicsDayRecord)({
        dateKey: todayKey,
        final: false,
        tarifvorteilEur: statsToday?.home.savingsVsFixedEur ?? null,
        gridRewardsCreditEur: statsToday?.home.gridRewardsCreditEur ?? null,
        gridRewardsSource: statsToday?.home.gridRewardsSource ?? null,
        shadow: null,
        now,
    });
    await setIfChanged(host, ensure_states_1.ECONOMICS_FLAT.todayTarifvorteilEur, todayRecord.tarifvorteilEur);
    await setIfChanged(host, ensure_states_1.ECONOMICS_FLAT.todayEmsVorteilEur, todayRecord.emsVorteilEur);
    await setIfChanged(host, ensure_states_1.ECONOMICS_FLAT.todayKiMehrwertEur, todayRecord.kiMehrwertEur);
    // --- Zeitraum-Aggregation (analog Statistik-Perioden) ---
    const dayKeysAll = Object.keys(econPersist.days);
    const statisticsStartKey = (0, period_1.resolveStatisticsStartKey)({
        adminStartKey: statsCfg.statisticsStartDate,
        persistDayKeys: dayKeysAll,
        tibberEarliestKey: null,
    });
    const periodIdSt = await host.getStateAsync(ensure_states_1.ECONOMICS_STATES.periodId);
    const periodId = typeof periodIdSt?.val === "string" && periodIdSt.val ? periodIdSt.val : "this_month";
    if (periodIdSt?.val !== periodId) {
        await host.setStateAsync(ensure_states_1.ECONOMICS_STATES.periodId, { val: periodId, ack: true });
    }
    function summaryForPeriod(id) {
        const raw = (0, period_1.resolvePeriodRange)(id, todayKey);
        if (!raw)
            return null;
        const clipped = (0, period_1.clipPeriodRangeToStart)(raw, statisticsStartKey);
        if (!clipped) {
            return (0, compute_1.sumEconomicsDays)([], { period: id, periodLabelDe: raw.labelDe, fromKey: raw.fromKey, toKey: raw.toKey });
        }
        const keys = (0, period_1.dayKeysInRange)(econPersist.days, clipped.fromKey, clipped.toKey);
        const days = keys.map((k) => econPersist.days[k]);
        if (clipped.toKey >= todayKey)
            days.push(todayRecord);
        return (0, compute_1.sumEconomicsDays)(days, {
            period: id,
            periodLabelDe: clipped.labelDe,
            fromKey: clipped.fromKey,
            toKey: clipped.toKey,
        });
    }
    const periodSummary = summaryForPeriod(periodId);
    const cumulativeDays = dayKeysAll.map((k) => econPersist.days[k]);
    cumulativeDays.push(todayRecord);
    const cumulativeSummary = (0, compute_1.sumEconomicsDays)(cumulativeDays, {
        period: "cumulative",
        periodLabelDe: "Gesamt (seit Statistik-Start)",
        fromKey: statisticsStartKey ?? (dayKeysAll[0] ?? todayKey),
        toKey: todayKey,
    });
    if (periodSummary) {
        await setIfChanged(host, ensure_states_1.ECONOMICS_FLAT.periodTarifvorteilEur, periodSummary.tarifvorteilEur);
        await setIfChanged(host, ensure_states_1.ECONOMICS_FLAT.periodEmsVorteilEur, periodSummary.emsVorteilEur);
        await setIfChanged(host, ensure_states_1.ECONOMICS_FLAT.periodKiMehrwertEur, periodSummary.kiMehrwertEur);
        await setIfChanged(host, ensure_states_1.ECONOMICS_FLAT.periodGridRewardsEur, periodSummary.gridRewardsCreditEur);
        await setIfChanged(host, ensure_states_1.ECONOMICS_FLAT.periodLabelDe, periodSummary.periodLabelDe);
    }
    await setIfChanged(host, ensure_states_1.ECONOMICS_FLAT.cumulativeTarifvorteilEur, cumulativeSummary.tarifvorteilEur);
    await setIfChanged(host, ensure_states_1.ECONOMICS_FLAT.cumulativeEmsVorteilEur, cumulativeSummary.emsVorteilEur);
    await setIfChanged(host, ensure_states_1.ECONOMICS_FLAT.cumulativeKiMehrwertEur, cumulativeSummary.kiMehrwertEur);
    await setIfChanged(host, ensure_states_1.ECONOMICS_STATES.enabled, true);
    await setIfChanged(host, ensure_states_1.ECONOMICS_STATES.lastRunAt, now.toISOString());
    await setIfChanged(host, ensure_states_1.ECONOMICS_STATES.reasonDe, `Tarifvorteil ${periodSummary?.periodLabelDe ?? ""}: ${periodSummary?.tarifvorteilEur ?? "—"} €, EMS-Vorteil: ${periodSummary?.emsVorteilEur ?? "—"} €, KI-Mehrwert: ${periodSummary?.kiMehrwertEur ?? "—"} €.`);
}
exports.tickEconomics = tickEconomics;
