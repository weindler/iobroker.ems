import type { ShadowDayRecord } from "../learning/shadow_engine/types";
import type { EconomicsDayRecord, EconomicsPeriodSummary } from "./types";

function round2(n: number): number {
	return Math.round(n * 100) / 100;
}

export type EconomicsDayInput = {
	dateKey: string;
	final: boolean;
	tarifvorteilEur: number | null;
	gridRewardsCreditEur: number | null;
	gridRewardsSource: string | null;
	shadow: ShadowDayRecord | null;
	now: Date;
};

/**
 * Baut die Tagesbuchung. EMS-Vorteil/KI-Mehrwert bleiben `null` (nicht 0!) wenn die
 * zugrunde liegende Shadow-Welt nicht bewertbar ist — keine erfundene wirtschaftliche Aussage.
 */
export function buildEconomicsDayRecord(input: EconomicsDayInput): EconomicsDayRecord {
	const real = input.shadow?.real ?? null;
	const noEms = input.shadow?.strategies.reference_no_ems ?? null;
	const sonnenNative = input.shadow?.strategies.reference_sonnen_native ?? null;
	const withoutAi = input.shadow?.strategies.ems_without_ai ?? null;
	const notesDe: string[] = [];

	/*
	 * EMS-Vorteil gegen die realistische Sonnen-ohne-EMS-Welt.
	 * Die Greedy-Idealwelt bleibt als Benchmark gespeichert, zählt aber nicht als reale Gegenwelt.
	 */
	const emsVorteilEvaluable = !!(
		real &&
		sonnenNative?.evaluable &&
		real.netCostEur !== null &&
		sonnenNative.netCostEur !== null
	);
	const emsVorteilEur = emsVorteilEvaluable ? round2(sonnenNative!.netCostEur! - real!.netCostEur!) : null;
	if (!emsVorteilEvaluable) {
		notesDe.push(
			input.shadow
				? "EMS-Vorteil nicht bewertbar (realistische Ohne-EMS-Welt reference_sonnen_native unvollständig/nicht bewertbar; Ideal-Greedy zählt nicht)."
				: "EMS-Vorteil nicht bewertbar (noch keine Shadow-Simulation für diesen Tag).",
		);
	}

	const kiMehrwertEvaluable = !!(
		real &&
		withoutAi?.evaluable &&
		real.netCostEur !== null &&
		withoutAi.netCostEur !== null
	);
	const kiMehrwertEur = kiMehrwertEvaluable
		? round2(withoutAi!.netCostEur! - real!.netCostEur!)
		: null;
	if (!kiMehrwertEvaluable) {
		notesDe.push(
			input.shadow
				? "KI-Mehrwert nicht bewertbar (Shadow-Welt ems_without_ai unvollständig/nicht bewertbar)."
				: "KI-Mehrwert nicht bewertbar (noch keine Shadow-Simulation für diesen Tag).",
		);
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
		referenceSonnenNativeNetCostEur: sonnenNative?.netCostEur ?? null,
		emsWithoutAiNetCostEur: withoutAi?.netCostEur ?? null,
		emsVorteilEvaluable,
		kiMehrwertEvaluable,
		notesDe,
	};
}

/** Summiert nur bewertbare Tage; null bleibt null statt einer erfundenen 0, wenn kein Tag bewertbar ist. */
export function sumEconomicsDays(
	days: EconomicsDayRecord[],
	meta: { period: string; periodLabelDe: string; fromKey: string; toKey: string },
): EconomicsPeriodSummary {
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

	const reasonParts: string[] = [];
	if (tarifN === 0) reasonParts.push("Kein Tag mit bewertbarem Tarifvorteil.");
	if (emsN === 0) reasonParts.push("Kein Tag mit bewertbarem EMS-Vorteil (Shadow Engine).");
	if (kiN === 0) reasonParts.push("Kein Tag mit bewertbarem KI-Mehrwert.");

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
