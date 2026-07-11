import type {
	ForecastPlanDay,
	ForecastPlanSlot,
	ForecastPlanStatus,
	OperatorContributorRef,
	OperatorDataQuality,
	PlanContribution,
} from "../types";
import type { ForecastPlan, ForecastPlanExcludedContributor } from "./types";
import { contributorRefKey } from "../contributor";
import { mergeOperatorQuality, operatorQuality } from "../quality";
import { OPERATOR_MS_PER_15MIN, addDaysToDateKey, isValidIsoTimestamp, isoAtTimezoneLocal, localDateKeyInTimezone } from "../time";

export interface ForecastPlanBuildInput {
	now: Date;
	timezone: string;
	contributions: PlanContribution[];
	slotMinutes?: number;
}

function findContribution(
	contributions: PlanContribution[],
	key: string,
): PlanContribution | undefined {
	return contributions.find((c) => contributorRefKey(c.contributor) === key);
}

function pvDayEnergy(contribution: PlanContribution | undefined, dateKey: string): number | null {
	if (!contribution?.enabled) return null;
	const details = contribution.details;
	const todayKey = details.todayDateKey as string | undefined;
	const tomorrowKey = details.tomorrowDateKey as string | undefined;
	if (dateKey === todayKey && details.correctedTodayKwh !== undefined) {
		const v = details.correctedTodayKwh;
		return typeof v === "number" && Number.isFinite(v) ? v : null;
	}
	if (dateKey === tomorrowKey && details.correctedTomorrowKwh !== undefined) {
		const v = details.correctedTomorrowKwh;
		return typeof v === "number" && Number.isFinite(v) ? v : null;
	}
	const horizonDays = details.horizonDays as Array<{ dateKey: string; correctedKwh: number | null }> | undefined;
	const match = horizonDays?.find((d) => d.dateKey === dateKey);
	if (match && match.correctedKwh !== null && Number.isFinite(match.correctedKwh)) {
		return match.correctedKwh;
	}
	return null;
}

function houseLoadDayEnergy(contribution: PlanContribution | undefined, dateKey: string): number | null {
	if (!contribution?.enabled) return null;
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

function weatherDayMinMax(
	contribution: PlanContribution | undefined,
	dateKey: string,
	todayKey: string,
	tomorrowKey: string,
): { min: number | null; max: number | null } {
	if (!contribution?.enabled) return { min: null, max: null };
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

function buildDays(
	input: ForecastPlanBuildInput,
	pv: PlanContribution | undefined,
	house: PlanContribution | undefined,
	weather: PlanContribution | undefined,
): ForecastPlanDay[] {
	const todayKey = localDateKeyInTimezone(input.now, input.timezone);
	const dayKeys = [todayKey, addDaysToDateKey(todayKey, 1)];

	const horizonDays = pv?.details.horizonDays as Array<{ dateKey: string }> | undefined;
	if (horizonDays) {
		for (const d of horizonDays) {
			if (!dayKeys.includes(d.dateKey)) dayKeys.push(d.dateKey);
		}
	}

	const tomorrowKey = addDaysToDateKey(todayKey, 1);
	const days: ForecastPlanDay[] = [];

	for (const dateKey of dayKeys.sort()) {
		const pvKwh = pvDayEnergy(pv, dateKey);
		const loadKwh = houseLoadDayEnergy(house, dateKey);
		const weatherTemps = weatherDayMinMax(weather, dateKey, todayKey, tomorrowKey);

		let renewableBalance: number | null = null;
		if (pvKwh !== null && loadKwh !== null) {
			renewableBalance = Math.round((pvKwh - loadKwh) * 1000) / 1000;
		}

		let dayQuality = operatorQuality("missing", "Keine Tagesdaten.");
		if (pvKwh !== null || loadKwh !== null) {
			dayQuality = mergeOperatorQuality(
				pvKwh !== null ? (pv?.quality ?? dayQuality) : operatorQuality("missing", "PV fehlt."),
				loadKwh !== null ? (house?.quality ?? dayQuality) : operatorQuality("missing", "Hauslast fehlt."),
			);
		}

		const parts: string[] = [];
		if (pvKwh !== null) parts.push(`PV ${pvKwh} kWh`);
		if (loadKwh !== null) parts.push(`Hauslast ${loadKwh} kWh`);
		if (renewableBalance !== null) parts.push(`Bilanz ${renewableBalance} kWh`);

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

function slotKey(startIso: string, endIso: string): string {
	return `${startIso}|${endIso}`;
}

function buildSlots(
	input: ForecastPlanBuildInput,
	pv: PlanContribution | undefined,
	house: PlanContribution | undefined,
	weather: PlanContribution | undefined,
	grid: PlanContribution | undefined,
	globalConstraints: PlanContribution | undefined,
): ForecastPlanSlot[] {
	const byKey = new Map<string, ForecastPlanSlot>();

	const upsert = (startIso: string, endIso: string, patch: Partial<ForecastPlanSlot>): void => {
		if (!isValidIsoTimestamp(startIso) || !isValidIsoTimestamp(endIso)) return;
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
			quality: operatorQuality("missing", "Keine Slotdaten."),
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
			quality: mergeOperatorQuality(
				byKey.get(slotKey(s.slot.startIso, s.slot.endIso))?.quality ??
					operatorQuality("missing", ""),
				s.quality,
			),
			reasonDe: "Hauslast-Segment-Baseline.",
		});
	}

	for (const s of weather?.slots ?? []) {
		if (!s.available) continue;
		const details = weather?.details.hourlyPoints as
			| Array<{ startIso: string; endIso: string; outdoorTempC: number | null }>
			| undefined;
		const point = details?.find(
			(p) => p.startIso === s.slot.startIso && p.endIso === s.slot.endIso,
		);
		const temp =
			point?.outdoorTempC ??
			(s.slot.startIso === weather?.generatedAt ? (weather.details.outdoorTempC as number | null) : null);
		if (temp !== null) {
			upsert(s.slot.startIso, s.slot.endIso, {
				outdoorTempC: temp,
				reasonDe: "Wetter-Kontext.",
			});
		}
	}

	const importAllowedDefault =
		(globalConstraints?.details.gridImportAllowed as boolean | undefined) ?? true;
	const maxImportDefault =
		(globalConstraints?.details.effectiveMaxGridImportW as number | null | undefined) ?? null;

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
		const reasons: string[] = [];
		if (slot.gridPriceCtPerKwh !== null) reasons.push("Preis");
		if (slot.houseLoadPowerW !== null) reasons.push("Hauslast");
		if (slot.outdoorTempC !== null) reasons.push("Temperatur");
		slot.reasonDe = reasons.length > 0 ? reasons.join(", ") + "." : "Keine zeitlich aufgelösten Werte.";
		byKey.set(key, slot);
	}

	return [...byKey.values()].sort((a, b) => {
		const cmp = a.slot.startIso.localeCompare(b.slot.startIso);
		return cmp !== 0 ? cmp : a.slot.endIso.localeCompare(b.slot.endIso);
	});
}

function resolveStatus(
	pv: PlanContribution | undefined,
	house: PlanContribution | undefined,
	weather: PlanContribution | undefined,
	grid: PlanContribution | undefined,
	timezone: string,
): ForecastPlanStatus {
	if (!timezone.trim()) return "error";

	const pvOk = pv?.enabled && pv.quality.status !== "missing" && pv.quality.status !== "invalid";
	const houseOk =
		house?.enabled && house.quality.status !== "missing" && house.quality.status !== "invalid";

	if (!pvOk || !houseOk) return "missing_inputs";

	const weatherMissing = !weather?.enabled || weather.quality.status === "missing";
	const gridMissing = !grid?.enabled || grid.quality.status === "missing";
	const anyDegraded = [pv, house, weather, grid].some(
		(c) => c?.enabled && c.quality.status === "degraded",
	);

	if (weatherMissing || gridMissing || anyDegraded) return "degraded";
	return "ready";
}

function partitionContributors(contributions: PlanContribution[]): {
	active: OperatorContributorRef[];
	excluded: ForecastPlanExcludedContributor[];
} {
	const active: OperatorContributorRef[] = [];
	const excluded: ForecastPlanExcludedContributor[] = [];
	for (const c of contributions) {
		if (c.enabled && c.quality.status !== "missing" && c.quality.status !== "invalid") {
			active.push(c.contributor);
		} else {
			excluded.push({ contributor: c.contributor, reasonDe: c.reasonDe || c.quality.reasonDe });
		}
	}
	return { active, excluded };
}

function overallQuality(status: ForecastPlanStatus, contributions: PlanContribution[]): OperatorDataQuality {
	if (status === "error") return operatorQuality("invalid", "Forecast Plan Fehler.");
	if (status === "missing_inputs") return operatorQuality("missing", "Pflichtquellen PV oder Hauslast fehlen.");
	if (status === "disabled") return operatorQuality("disabled", "Forecast Plan deaktiviert.");
	if (status === "degraded") {
		return operatorQuality("degraded", "Forecast Plan nutzbar, aber mit Lücken.");
	}
	let q = operatorQuality("valid", "Forecast Plan bereit.");
	for (const c of contributions) {
		if (c.enabled) q = mergeOperatorQuality(q, c.quality);
	}
	return q;
}

function planReasonDe(status: ForecastPlanStatus, excluded: ForecastPlanExcludedContributor[]): string {
	if (status === "ready") return "Deterministischer Forecast Plan mit PV und Hauslast bereit.";
	if (status === "degraded") {
		const names = excluded.map((e) => e.contributor.id).join(", ");
		return names
			? `Forecast Plan nutzbar; ausgeschlossen: ${names}.`
			: "Forecast Plan nutzbar mit eingeschränkten Nebenquellen.";
	}
	if (status === "missing_inputs") return "PV- oder Hauslast-Prognose fehlt — keine Energiebilanz erfunden.";
	return "Forecast Plan nicht vollständig.";
}

export function buildForecastPlan(input: ForecastPlanBuildInput): ForecastPlan {
	const slotMinutes = input.slotMinutes ?? OPERATOR_MS_PER_15MIN / 60_000;
	const pv = findContribution(input.contributions, "addon:pv_forecast");
	const house = findContribution(input.contributions, "system:house_load");
	const weather = findContribution(input.contributions, "addon:weather_forecast");
	const grid = findContribution(input.contributions, "system:grid_supply");
	const globalConstraints = findContribution(input.contributions, "system:global_constraints");

	const days = buildDays(input, pv, house, weather);
	const slots = buildSlots(input, pv, house, weather, grid, globalConstraints);
	const { active, excluded } = partitionContributors(input.contributions);
	const status = resolveStatus(pv, house, weather, grid, input.timezone);

	const todayKey = localDateKeyInTimezone(input.now, input.timezone);
	const horizonStart = input.now.toISOString();
	const horizonEnd = isoEndOfDay(addDaysToDateKey(todayKey, 1), input.timezone);

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

function isoEndOfDay(dateKey: string, timezone: string): string {
	const next = addDaysToDateKey(dateKey, 1);
	return isoAtTimezoneLocal(next, 0, 0, timezone);
}

export function forecastPlanRevisionPayload(plan: ForecastPlan): string {
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
