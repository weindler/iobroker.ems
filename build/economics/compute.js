"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.sumEconomicsDays = exports.buildEconomicsDayRecord = void 0;
function round2(n) {
    return Math.round(n * 100) / 100;
}
/**
 * Baut die Tagesbuchung. EMS-Vorteil/KI-Mehrwert bleiben `null` (nicht 0!) wenn die
 * zugrunde liegende Shadow-Welt nicht bewertbar ist — keine erfundene wirtschaftliche Aussage.
 */
function buildEconomicsDayRecord(input) {
    const real = input.shadow?.real ?? null;
    const noEms = input.shadow?.strategies.reference_no_ems ?? null;
    const withoutAi = input.shadow?.strategies.ems_without_ai ?? null;
    const notesDe = [];
    const emsVorteilEvaluable = !!(real &&
        noEms?.evaluable &&
        real.netCostEur !== null &&
        noEms.netCostEur !== null);
    const emsVorteilEur = emsVorteilEvaluable ? round2(noEms.netCostEur - real.netCostEur) : null;
    if (!emsVorteilEvaluable) {
        notesDe.push(input.shadow
            ? "EMS-Vorteil nicht bewertbar (Shadow-Welt reference_no_ems unvollständig/nicht bewertbar)."
            : "EMS-Vorteil nicht bewertbar (noch keine Shadow-Simulation für diesen Tag).");
    }
    const kiMehrwertEvaluable = !!(real &&
        withoutAi?.evaluable &&
        real.netCostEur !== null &&
        withoutAi.netCostEur !== null);
    const kiMehrwertEur = kiMehrwertEvaluable
        ? round2(withoutAi.netCostEur - real.netCostEur)
        : null;
    if (!kiMehrwertEvaluable) {
        notesDe.push(input.shadow
            ? "KI-Mehrwert nicht bewertbar (Shadow-Welt ems_without_ai unvollständig/nicht bewertbar)."
            : "KI-Mehrwert nicht bewertbar (noch keine Shadow-Simulation für diesen Tag).");
    }
    if (input.tarifvorteilEur === null) {
        notesDe.push("Tarifvorteil nicht bewertbar (Vergleichstarif/Netzbezug im Admin unvollständig).");
    }
    return {
        dateKey: input.dateKey,
        generatedAtIso: input.now.toISOString(),
        final: input.final,
        tarifvorteilEur: input.tarifvorteilEur,
        emsVorteilEur,
        kiMehrwertEur,
        gridRewardsCreditEur: input.gridRewardsCreditEur,
        gridRewardsSource: input.gridRewardsSource,
        realNetCostEur: real?.netCostEur ?? null,
        referenceNoEmsNetCostEur: noEms?.netCostEur ?? null,
        emsWithoutAiNetCostEur: withoutAi?.netCostEur ?? null,
        emsVorteilEvaluable,
        kiMehrwertEvaluable,
        notesDe,
    };
}
exports.buildEconomicsDayRecord = buildEconomicsDayRecord;
/** Summiert nur bewertbare Tage; null bleibt null statt einer erfundenen 0, wenn kein Tag bewertbar ist. */
function sumEconomicsDays(days, meta) {
    let tarif = 0;
    let tarifN = 0;
    let ems = 0;
    let emsN = 0;
    let ki = 0;
    let kiN = 0;
    let rewards = 0;
    let rewardsN = 0;
    for (const d of days) {
        if (d.tarifvorteilEur !== null) {
            tarif += d.tarifvorteilEur;
            tarifN += 1;
        }
        if (d.emsVorteilEvaluable && d.emsVorteilEur !== null) {
            ems += d.emsVorteilEur;
            emsN += 1;
        }
        if (d.kiMehrwertEvaluable && d.kiMehrwertEur !== null) {
            ki += d.kiMehrwertEur;
            kiN += 1;
        }
        if (d.gridRewardsCreditEur !== null && d.gridRewardsSource === "billing" && d.gridRewardsCreditEur >= 0) {
            rewards += d.gridRewardsCreditEur;
            rewardsN += 1;
        }
    }
    const reasonParts = [];
    if (tarifN === 0)
        reasonParts.push("Kein Tag mit bewertbarem Tarifvorteil.");
    if (emsN === 0)
        reasonParts.push("Kein Tag mit bewertbarem EMS-Vorteil (Shadow Engine).");
    if (kiN === 0)
        reasonParts.push("Kein Tag mit bewertbarem KI-Mehrwert.");
    return {
        period: meta.period,
        periodLabelDe: meta.periodLabelDe,
        fromKey: meta.fromKey,
        toKey: meta.toKey,
        daysTotal: days.length,
        daysTarifvorteilEvaluable: tarifN,
        daysEmsVorteilEvaluable: emsN,
        daysKiMehrwertEvaluable: kiN,
        tarifvorteilEur: tarifN > 0 ? round2(tarif) : null,
        emsVorteilEur: emsN > 0 ? round2(ems) : null,
        kiMehrwertEur: kiN > 0 ? round2(ki) : null,
        gridRewardsCreditEur: rewardsN > 0 ? round2(rewards) : null,
        reasonDe: reasonParts.join(" ") || `${meta.periodLabelDe}: ${days.length} Tag(e) verbucht.`,
    };
}
exports.sumEconomicsDays = sumEconomicsDays;
