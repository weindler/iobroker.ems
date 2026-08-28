import { asNum } from "../ems_light/state_util";
import { emptyDayRecord, emptyPersist, emptyRuntime } from "./persist";
import type { HomeDayTotals, MobilityDayTotals, StatisticsDayRecord, StatisticsPersist } from "./types";
import { localDateKey } from "./compute";

export type StatisticsAdjustSubmit = {
	/** YYYY-MM-DD — Standard: heute (lokal). */
	date?: string;
	resetToday?: boolean;
	resetMonth?: boolean;
	resetAll?: boolean;
	home?: Partial<
		Pick<
			HomeDayTotals,
			| "gridImportKwh"
			| "gridExportKwh"
			| "dynamicCostEur"
			| "fixedTariffCostEur"
			| "gridRewardsCreditEur"
			| "feedInCreditEur"
		>
	>;
	mobility?: Partial<
		Pick<
			MobilityDayTotals,
			"homePvKwh" | "homeGridKwh" | "homePvCostEur" | "homeGridCostEur" | "iceFuelPriceEurPerL"
		>
	>;
	noteDe?: string;
	/** Nur neu berechnen (Monats-Mobilität aus gespeicherten Tagen) — kein Reset/Seed. */
	refresh?: boolean;
};

function parseDateKey(raw: unknown): string | null {
	if (typeof raw !== "string") return null;
	const s = raw.trim();
	return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null;
}

export function parseStatisticsAdjustSubmit(raw: unknown): StatisticsAdjustSubmit | null {
	if (raw == null || raw === "") return null;
	try {
		const obj = typeof raw === "string" ? (JSON.parse(raw) as unknown) : raw;
		if (!obj || typeof obj !== "object") return null;
		const o = obj as Record<string, unknown>;
		const homeRaw = o.home;
		const mobRaw = o.mobility;
		const home =
			homeRaw && typeof homeRaw === "object"
				? {
						gridImportKwh: asNum((homeRaw as Record<string, unknown>).gridImportKwh),
						gridExportKwh: asNum((homeRaw as Record<string, unknown>).gridExportKwh),
						dynamicCostEur: asNum((homeRaw as Record<string, unknown>).dynamicCostEur),
						fixedTariffCostEur: asNum((homeRaw as Record<string, unknown>).fixedTariffCostEur),
						gridRewardsCreditEur: asNum((homeRaw as Record<string, unknown>).gridRewardsCreditEur),
						feedInCreditEur: asNum((homeRaw as Record<string, unknown>).feedInCreditEur),
					}
				: undefined;
		const mobility =
			mobRaw && typeof mobRaw === "object"
				? {
						homePvKwh: asNum((mobRaw as Record<string, unknown>).homePvKwh),
						homeGridKwh: asNum((mobRaw as Record<string, unknown>).homeGridKwh),
						homePvCostEur: asNum((mobRaw as Record<string, unknown>).homePvCostEur),
						homeGridCostEur: asNum((mobRaw as Record<string, unknown>).homeGridCostEur),
						iceFuelPriceEurPerL: asNum((mobRaw as Record<string, unknown>).iceFuelPriceEurPerL),
					}
				: undefined;
		return {
			date: parseDateKey(o.date) ?? undefined,
			resetToday: o.resetToday === true,
			resetMonth: o.resetMonth === true,
			resetAll: o.resetAll === true,
			refresh: o.refresh === true,
			home,
			mobility,
			noteDe: typeof o.noteDe === "string" ? o.noteDe.trim().slice(0, 200) : undefined,
		};
	} catch {
		return null;
	}
}

function monthPrefix(dateKey: string): string {
	return dateKey.slice(0, 7);
}

function ensureDay(persist: StatisticsPersist, dateKey: string): StatisticsDayRecord {
	if (!persist.days[dateKey]) {
		persist.days[dateKey] = emptyDayRecord(dateKey);
	}
	return persist.days[dateKey]!;
}

function mergeHome(day: StatisticsDayRecord, patch: NonNullable<StatisticsAdjustSubmit["home"]>): void {
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

function mergeMobilityDay(
	day: StatisticsDayRecord,
	patch: NonNullable<StatisticsAdjustSubmit["mobility"]>,
): void {
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
	if (patch.iceFuelPriceEurPerL !== null && patch.iceFuelPriceEurPerL !== undefined) {
		day.mobility.iceFuelPriceEurPerL = patch.iceFuelPriceEurPerL;
	}
}

function syncRuntimeMobility(
	persist: StatisticsPersist,
	patch: NonNullable<StatisticsAdjustSubmit["mobility"]>,
): void {
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

function resetDay(persist: StatisticsPersist, dateKey: string): void {
	delete persist.days[dateKey];
	if (persist.runtime.dateKey === dateKey) {
		persist.runtime = emptyRuntime(dateKey);
	}
}

function hasAdjustData(submit: StatisticsAdjustSubmit): boolean {
	if (submit.resetToday || submit.resetMonth || submit.resetAll) return true;
	if (submit.home && Object.values(submit.home).some((v) => v !== null && v !== undefined)) {
		return true;
	}
	if (submit.mobility && Object.values(submit.mobility).some((v) => v !== null && v !== undefined)) {
		return true;
	}
	return false;
}

/** Wendet manuelle Korrektur / Startwerte an — gibt neues Persist-Objekt bei resetAll. */
export function applyStatisticsAdjust(
	persist: StatisticsPersist,
	submit: StatisticsAdjustSubmit,
	now: Date,
): { persist: StatisticsPersist; ackDe: string } {
	const todayKey = localDateKey(now);
	const dateKey = submit.date ?? todayKey;

	if (submit.refresh && !hasAdjustData(submit)) {
		return {
			persist,
			ackDe: submit.noteDe || "Statistik neu berechnet.",
		};
	}

	if (submit.resetAll) {
		const fresh = emptyPersist(now);
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
			persist.runtime = emptyRuntime(todayKey);
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

	const parts: string[] = [];
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
		ackDe:
			submit.noteDe ||
			`Statistik ${dateKey}: ${parts.join(" + ")} gesetzt — ab nächstem Tick weitergezählt.`,
	};
}
