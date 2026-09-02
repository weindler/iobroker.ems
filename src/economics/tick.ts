/**
 * PHASE 7 — Wirtschaftlichkeit: periodischer Buchungslauf.
 *
 * Bucht abgeschlossene Kalendertage EINMAL (idempotent) sobald Statistik-Tagesdaten UND die
 * Shadow-Engine-Simulation für diesen Tag verfügbar sind. "Heute" wird nur live angezeigt
 * (transient, nie in der Historie gespeichert) — der Tag ist noch nicht abgeschlossen.
 */

import { localDateKeyInTimezone } from "../operator/time";
import { readStatisticsPersist, STATISTICS_PERSIST_CATEGORY } from "../statistics/persist";
import {
	clipPeriodRangeToStart,
	dayKeysInRange,
	normalizePeriodId,
	resolvePeriodRange,
	resolveStatisticsStartKey,
} from "../statistics/period";
import { STATISTICS_STATES } from "../statistics/ensure_states";
import { statisticsConfigFromAdapter } from "../statistics/config";
import { SHADOW_ENGINE_RESULTS_CATEGORY } from "../learning/shadow_engine";
import { readShadowDayRecord } from "../learning/shadow_engine/persist";
import { buildEconomicsDayRecord, sumEconomicsDays } from "./compute";
import { ECONOMICS_FLAT, ECONOMICS_STATES, ensureEconomicsStates } from "./ensure_states";
import type { StateHost } from "../ems_light/state_util";
import { ECONOMICS_PERSIST_CATEGORY, readEconomicsPersist, writeEconomicsPersist } from "./persist";
import type { EconomicsDayRecord, EconomicsPersist } from "./types";

export type EconomicsHost = {
	config: unknown;
	getAbsolutePath: (category?: string) => string;
	getStateAsync: (id: string) => Promise<ioBroker.State | null | undefined>;
	setStateAsync: (id: string, state: ioBroker.SettableState) => Promise<unknown>;
	log?: { warn?: (m: string) => void; debug?: (m: string) => void };
};

async function setIfChanged(host: EconomicsHost, id: string, val: ioBroker.StateValue): Promise<void> {
	const cur = await host.getStateAsync(id);
	if (cur?.val === val) return;
	await host.setStateAsync(id, { val, ack: true });
}

function timezoneFromConfig(config: unknown): string {
	const tz = typeof (config as Record<string, unknown>)?.timezone === "string"
		? ((config as Record<string, unknown>).timezone as string).trim()
		: "";
	return tz || "Europe/Berlin";
}

export async function tickEconomics(host: EconomicsHost, now: Date = new Date()): Promise<void> {
	await ensureEconomicsStates(host as unknown as StateHost);

	const statsCfg = statisticsConfigFromAdapter(host.config);
	if (!statsCfg.enabled) {
		await setIfChanged(host, ECONOMICS_STATES.enabled, false);
		await setIfChanged(host, ECONOMICS_STATES.reasonDe, "Wirtschaftlichkeit inaktiv (Statistik im Admin deaktiviert).");
		return;
	}

	const timezone = timezoneFromConfig(host.config);
	const todayKey = localDateKeyInTimezone(now, timezone);

	const statsDir = host.getAbsolutePath(STATISTICS_PERSIST_CATEGORY);
	const econDir = host.getAbsolutePath(ECONOMICS_PERSIST_CATEGORY);
	const shadowDir = host.getAbsolutePath(SHADOW_ENGINE_RESULTS_CATEGORY);

	const statsPersist = await readStatisticsPersist(statsDir);
	let econPersist: EconomicsPersist = await readEconomicsPersist(econDir);
	let dirty = false;

	// --- abgeschlossene Tage EINMAL verbuchen (idempotent) ---
	for (const dateKey of Object.keys(statsPersist.days).sort()) {
		if (dateKey >= todayKey) continue;
		if (econPersist.days[dateKey]?.final) continue;
		const statsDay = statsPersist.days[dateKey];
		if (!statsDay) continue;
		const shadow = await readShadowDayRecord(shadowDir, dateKey);
		if (!shadow) continue; // Shadow-Engine hat diesen Tag noch nicht simuliert — nächster Lauf holt nach.
		const rec = buildEconomicsDayRecord({
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
		await writeEconomicsPersist(econDir, econPersist);
		econPersist = await readEconomicsPersist(econDir);
	}

	// --- "heute" nur live, nie persistiert (Tag ist noch nicht abgeschlossen) ---
	const statsToday = statsPersist.days[todayKey];
	const todayRecord: EconomicsDayRecord = buildEconomicsDayRecord({
		dateKey: todayKey,
		final: false,
		tarifvorteilEur: statsToday?.home.savingsVsFixedEur ?? null,
		gridRewardsCreditEur: statsToday?.home.gridRewardsCreditEur ?? null,
		gridRewardsSource: statsToday?.home.gridRewardsSource ?? null,
		shadow: null,
		now,
	});
	await setIfChanged(host, ECONOMICS_FLAT.todayTarifvorteilEur, todayRecord.tarifvorteilEur);
	await setIfChanged(host, ECONOMICS_FLAT.todayEmsVorteilEur, todayRecord.emsVorteilEur);
	await setIfChanged(host, ECONOMICS_FLAT.todayKiMehrwertEur, todayRecord.kiMehrwertEur);
	const todayRewardsPresent =
		todayRecord.gridRewardsSource === "billing" &&
		todayRecord.gridRewardsCreditEur !== null &&
		todayRecord.gridRewardsCreditEur >= 0;
	await setIfChanged(
		host,
		ECONOMICS_FLAT.todayGridRewardsEur,
		todayRewardsPresent ? todayRecord.gridRewardsCreditEur : null,
	);

	// --- Zeitraum-Aggregation (analog Statistik-Perioden) ---
	const dayKeysAll = Object.keys(econPersist.days);
	const statisticsStartKey = resolveStatisticsStartKey({
		adminStartKey: statsCfg.statisticsStartDate,
		persistDayKeys: dayKeysAll,
		tibberEarliestKey: null,
	});

	const periodIdSt = await host.getStateAsync(STATISTICS_STATES.periodId);
	const periodIdFallback = await host.getStateAsync(ECONOMICS_STATES.periodId);
	const periodId = normalizePeriodId(periodIdSt?.val ?? periodIdFallback?.val, "this_month");
	if (periodIdFallback?.val !== periodId) {
		await host.setStateAsync(ECONOMICS_STATES.periodId, { val: periodId, ack: true });
	}

	function summaryForPeriod(id: string) {
		const raw = resolvePeriodRange(id, todayKey);
		if (!raw) return null;
		const clipped = clipPeriodRangeToStart(raw, statisticsStartKey);
		if (!clipped) {
			return sumEconomicsDays([], { period: id, periodLabelDe: raw.labelDe, fromKey: raw.fromKey, toKey: raw.toKey });
		}
		const keys = dayKeysInRange(econPersist.days, clipped.fromKey, clipped.toKey);
		const days = keys.map((k) => econPersist.days[k]!);
		if (clipped.toKey >= todayKey) days.push(todayRecord);
		return sumEconomicsDays(days, {
			period: id,
			periodLabelDe: clipped.labelDe,
			fromKey: clipped.fromKey,
			toKey: clipped.toKey,
		});
	}

	const periodSummary = summaryForPeriod(periodId);

	const cumulativeDays = dayKeysAll.map((k) => econPersist.days[k]!);
	cumulativeDays.push(todayRecord);
	const cumulativeSummary = sumEconomicsDays(cumulativeDays, {
		period: "cumulative",
		periodLabelDe: "Gesamt (seit Statistik-Start)",
		fromKey: statisticsStartKey ?? (dayKeysAll[0] ?? todayKey),
		toKey: todayKey,
	});

	if (periodSummary) {
		await setIfChanged(host, ECONOMICS_FLAT.periodTarifvorteilEur, periodSummary.tarifvorteilEur);
		await setIfChanged(host, ECONOMICS_FLAT.periodEmsVorteilEur, periodSummary.emsVorteilEur);
		await setIfChanged(host, ECONOMICS_FLAT.periodKiMehrwertEur, periodSummary.kiMehrwertEur);
		await setIfChanged(host, ECONOMICS_FLAT.periodGridRewardsEur, periodSummary.gridRewardsCreditEur);
		await setIfChanged(host, ECONOMICS_FLAT.periodLabelDe, periodSummary.periodLabelDe);
	}
	await setIfChanged(host, ECONOMICS_FLAT.cumulativeTarifvorteilEur, cumulativeSummary.tarifvorteilEur);
	await setIfChanged(host, ECONOMICS_FLAT.cumulativeEmsVorteilEur, cumulativeSummary.emsVorteilEur);
	await setIfChanged(host, ECONOMICS_FLAT.cumulativeKiMehrwertEur, cumulativeSummary.kiMehrwertEur);
	await setIfChanged(host, ECONOMICS_FLAT.cumulativeGridRewardsEur, cumulativeSummary.gridRewardsCreditEur);

	await setIfChanged(host, ECONOMICS_STATES.enabled, true);
	await setIfChanged(host, ECONOMICS_STATES.lastRunAt, now.toISOString());
	const { formatEmsAdvantagePhraseDe } = await import("./format.js");
	await setIfChanged(
		host,
		ECONOMICS_STATES.reasonDe,
		`Tarifvorteil ${periodSummary?.periodLabelDe ?? ""}: ${periodSummary?.tarifvorteilEur ?? "—"} €. ${formatEmsAdvantagePhraseDe(periodSummary?.emsVorteilEur ?? null)}. KI-Mehrwert: ${periodSummary?.kiMehrwertEur ?? "—"} €.`,
	);
}
