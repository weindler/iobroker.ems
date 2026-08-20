import { governedAddonEntry, governedAddonIds } from "../addons/governance/registry";
import { isAddonAiOptimizationAllowed, isAddonEnabled } from "../addons/governance/config";
import { WALLBOX_EVCC_STATES } from "../addons/wallbox/ensure_evcc_states";
import { IMMERSION_RUNTIME_STATES } from "../addons/immersion_heater/runtime/types";
import { acUnitRuntimeStates } from "../addons/air_conditioning/runtime/ensure_states";
import { PV_HORIZON_DAY_COUNT } from "../learning/pv_horizon/constants";
import type {
	AiDailyPlanDigest,
	AiDigestSlot,
	AiLearningDigest,
	AiOptimizationRequestContext,
	AiSituationBrief,
} from "./types";
import type { DailyPlan, DailyPlanSlot } from "../operator/daily_plan/types";
import { asBool, asNum } from "../ems_light/state_util";
import { liveRemainingHoursFromEmptyAt } from "../learning/thermal_runtime/math";
import { formatLocalDateTimeDe } from "../operator/time";
import { batteryRuntimeConfigFromAdapter } from "../learning/battery_runtime/config";

export type ContextHost = {
	config: unknown;
	getStateAsync: (id: string) => Promise<ioBroker.State | null | undefined>;
};

/** Nur Add-ons, die aktiv UND per Governance für KI-Optimierung freigegeben sind — sonst darf die KI sie nicht mal erwähnen. */
export function resolveAllowedAddonIds(config: unknown): string[] {
	return governedAddonIds().filter((id) => isAddonEnabled(config, id) && isAddonAiOptimizationAllowed(config, id));
}

/** Summe der flexiblen (nicht-mandatory) Allokation eines Add-on-Präfixes in einem Slot. */
export function addonFlexPowerInSlot(slot: DailyPlanSlot, contributionPrefix: string): number {
	let sum = 0;
	for (const a of slot.allocations) {
		if (a.mandatory) continue;
		if (!a.contributionId.startsWith(contributionPrefix)) continue;
		sum += a.allocatedPowerW ?? 0;
	}
	return sum;
}

function addonAnyPowerInSlot(slot: DailyPlanSlot, contributionPrefix: string): number {
	let sum = 0;
	for (const a of slot.allocations) {
		if (!a.contributionId.startsWith(contributionPrefix)) continue;
		sum += a.allocatedPowerW ?? 0;
	}
	return sum;
}

/** Vollständige Slot-Zeilen über den gesamten Daily-Plan-Horizont (Block 6 — kein slot-only-Minimalkontext). */
function buildSlotDigest(plan: DailyPlan, allowedAddonIds: string[]): AiDigestSlot[] {
	const ihAllowed = allowedAddonIds.includes("immersion_heater");
	const acAllowed = allowedAddonIds.includes("climate");
	const ihPrefix = governedAddonEntry("immersion_heater").runtimeAddonId;
	const acPrefix = governedAddonEntry("climate").runtimeAddonId;
	const batPrefix = governedAddonEntry("battery").runtimeAddonId;
	const wbPrefix = governedAddonEntry("wallbox").runtimeAddonId;
	return plan.slots.map((slot) => ({
		t: slot.slot.startIso,
		priceCtPerKwh: slot.gridPriceCtPerKwh,
		pvSurplusW: slot.availablePvSurplusPowerW,
		houseLoadW: slot.fixedHouseLoadPowerW,
		ihFlexW: ihAllowed ? Math.round(addonFlexPowerInSlot(slot, ihPrefix)) : 0,
		acW: acAllowed ? Math.round(addonFlexPowerInSlot(slot, acPrefix)) : 0,
		batteryChargeW: Math.round(addonAnyPowerInSlot(slot, batPrefix)),
		wallboxW: Math.round(addonAnyPowerInSlot(slot, wbPrefix)),
		allocatedPvW: Math.round(slot.allocatedPvPowerW),
		allocatedGridW: Math.round(slot.allocatedGridPowerW),
	}));
}

function digestFromDailyPlan(plan: DailyPlan, allowedAddonIds: string[]): AiDailyPlanDigest {
	return {
		date: plan.date,
		globalMode: plan.globalMode,
		status: plan.status,
		timezone: plan.timezone,
		slotMinutes: plan.slotMinutes,
		horizonSlotCount: plan.slots.length,
		validUntil: plan.validUntil,
		activeContributionIds: plan.activeContributionIds,
		excludedContributionIds: plan.excludedContributions.map((e) => e.contributionId),
		totals: {
			pvForecastEnergyKwh: plan.totals.pvForecastEnergyKwh,
			fixedHouseLoadEnergyKwh: plan.totals.fixedHouseLoadEnergyKwh,
			flexibleRequestedEnergyKwh: plan.totals.flexibleRequestedEnergyKwh,
			flexibleAllocatedEnergyKwh: plan.totals.flexibleAllocatedEnergyKwh,
			flexibleUnallocatedEnergyKwh: plan.totals.flexibleUnallocatedEnergyKwh,
			pvAllocatedEnergyKwh: plan.totals.pvAllocatedEnergyKwh,
			gridAllocatedEnergyKwh: plan.totals.gridAllocatedEnergyKwh,
			batteryChargeEnergyKwh: plan.totals.batteryChargeEnergyKwh,
			wallboxEnergyKwh: plan.totals.wallboxEnergyKwh,
			immersionHeaterEnergyKwh: plan.totals.immersionHeaterEnergyKwh,
			airConditioningEnergyKwh: plan.totals.airConditioningEnergyKwh,
			estimatedGridCostCt: plan.totals.estimatedGridCostCt,
		},
		unallocated: plan.unallocated.map((u) => ({
			contributionId: u.contributionId,
			unallocatedEnergyKwh: u.unallocatedEnergyKwh,
			reasonDe: u.reasonDe,
		})),
		slots: buildSlotDigest(plan, allowedAddonIds),
	};
}

async function readStr(host: ContextHost, id: string): Promise<string | null> {
	try {
		const st = await host.getStateAsync(id);
		if (st?.val == null) return null;
		const s = String(st.val).trim();
		return s.length > 0 ? s : null;
	} catch {
		return null;
	}
}

async function readNum(host: ContextHost, id: string): Promise<number | null> {
	try {
		return asNum((await host.getStateAsync(id))?.val);
	} catch {
		return null;
	}
}

async function readBool(host: ContextHost, id: string): Promise<boolean | null> {
	try {
		return asBool((await host.getStateAsync(id))?.val);
	} catch {
		return null;
	}
}

async function readJson(host: ContextHost, id: string): Promise<Record<string, unknown>> {
	try {
		const st = await host.getStateAsync(id);
		if (typeof st?.val !== "string" || !st.val) return {};
		const parsed = JSON.parse(st.val) as unknown;
		return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};
	} catch {
		return {};
	}
}

function validIsoDeadline(raw: string | null): string | null {
	if (!raw?.trim()) return null;
	if (raw.startsWith("0001-01-01T00:00:00")) return null;
	const ms = Date.parse(raw);
	return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
}

function wallboxDeadlineFromPlan(plan: DailyPlan): string | null {
	let bestMs: number | null = null;
	let bestIso: string | null = null;
	for (const slot of plan.slots) {
		for (const a of slot.allocations) {
			if (!a.contributionId.startsWith("wallbox") || !a.deadlineIso) continue;
			const t = Date.parse(a.deadlineIso);
			if (!Number.isFinite(t)) continue;
			if (bestMs === null || t < bestMs) {
				bestMs = t;
				bestIso = a.deadlineIso;
			}
		}
	}
	return bestIso;
}

function nextHoursFromPlan(plan: DailyPlan): AiSituationBrief["nextHours"] {
	const slotMs = plan.slotMinutes * 60_000;
	const windowMs = 4 * 3_600_000;
	const maxSlots = slotMs > 0 ? Math.ceil(windowMs / slotMs) : 16;
	const window = plan.slots.slice(0, maxSlots);
	if (window.length === 0) {
		return {
			avgPvForecastPowerW: null,
			avgAvailablePvSurplusPowerW: null,
			minPriceCt: null,
			maxPriceCt: null,
		};
	}

	const avgOrNull = (vals: Array<number | null>): number | null => {
		const nums = vals.filter((v): v is number => v !== null && Number.isFinite(v));
		if (nums.length === 0) return null;
		return Math.round(nums.reduce((a, b) => a + b, 0) / nums.length);
	};

	const prices = window
		.map((s) => s.gridPriceCtPerKwh)
		.filter((v): v is number => v !== null && Number.isFinite(v));

	return {
		avgPvForecastPowerW: avgOrNull(window.map((s) => s.pvForecastPowerW)),
		avgAvailablePvSurplusPowerW: avgOrNull(window.map((s) => s.availablePvSurplusPowerW)),
		minPriceCt: prices.length > 0 ? Math.min(...prices) : null,
		maxPriceCt: prices.length > 0 ? Math.max(...prices) : null,
	};
}

async function readPvHorizonDays(
	host: ContextHost,
): Promise<Array<{ day: number; correctedKwh: number | null }>> {
	const days: Array<{ day: number; correctedKwh: number | null }> = [];
	for (let d = 1; d <= PV_HORIZON_DAY_COUNT; d++) {
		days.push({
			day: d,
			correctedKwh: await readNum(host, `learning.pv_horizon.day${d}.corrected_kwh`),
		});
	}
	return days;
}

/** Kuratierter Learning-Digest — Skalare aus Learning-States, keine History-Dumps. */
export async function buildLearningDigest(
	host: ContextHost,
	timezone: string = "Europe/Berlin",
): Promise<AiLearningDigest> {
	const now = new Date();
	const [
		pvBiasStatus,
		pvToday,
		pvTomorrow,
		bufferStatus,
		bufferEmpty,
		boilerStatus,
		boilerEmpty,
		batteryStatus,
		priceStatus,
		priceAvg,
		houseStatus,
		pvHorizonDays,
	] = await Promise.all([
		readStr(host, "learning.pv_bias.status"),
		readNum(host, "learning.pv_bias.corrected_today_kwh"),
		readNum(host, "learning.pv_bias.corrected_tomorrow_kwh"),
		readStr(host, "learning.thermal_runtime.status"),
		readStr(host, "learning.thermal_runtime.estimated_empty_at"),
		readStr(host, "learning.thermal_boiler.status"),
		readStr(host, "learning.thermal_boiler.estimated_empty_at"),
		readStr(host, "learning.battery_runtime.status"),
		readStr(host, "learning.price_learning.status"),
		readNum(host, "learning.price_learning.avg_price_7d"),
		readStr(host, "learning.house_load.status"),
		readPvHorizonDays(host),
	]);
	const topOffDays = batteryRuntimeConfigFromAdapter(host.config).topoffIntervalDays;
	const bufferLocalDe = bufferEmpty ? formatLocalDateTimeDe(bufferEmpty, timezone) : null;
	const bufferHours = liveRemainingHoursFromEmptyAt(bufferEmpty, now);
	const boilerLocalDe = boilerEmpty ? formatLocalDateTimeDe(boilerEmpty, timezone) : null;
	const boilerHours = liveRemainingHoursFromEmptyAt(boilerEmpty, now);
	return {
		pvBiasStatus,
		pvCorrectedTodayKwh: pvToday,
		pvCorrectedTomorrowKwh: pvTomorrow,
		pvHorizonDays,
		thermalRuntimeStatus: bufferStatus,
		thermalBufferStatus: bufferStatus,
		thermalBufferEstimatedEmptyAt: bufferEmpty,
		thermalBufferEstimatedEmptyAtLocalDe: bufferLocalDe,
		thermalBufferEstimatedRemainingHours: bufferHours,
		thermalBoilerStatus: boilerStatus,
		thermalBoilerEstimatedEmptyAt: boilerEmpty,
		thermalBoilerEstimatedEmptyAtLocalDe: boilerLocalDe,
		thermalBoilerEstimatedRemainingHours: boilerHours,
		thermalEstimatedEmptyAt: boilerEmpty,
		thermalEstimatedEmptyAtLocalDe: boilerLocalDe,
		thermalEstimatedRemainingHours: boilerHours,
		batteryRuntimeStatus: batteryStatus,
		batteryTopOffIntervalDays: topOffDays,
		priceLearningStatus: priceStatus,
		priceAvgEurPerKwh7d: priceAvg,
		houseLoadStatus: houseStatus,
	};
}

/** Live + Horizont-Situation — fehlende Werte bleiben null (nie erfundene 0). */
export async function buildSituationBrief(
	host: ContextHost,
	plan: DailyPlan,
	learning: AiLearningDigest,
): Promise<AiSituationBrief> {
	const [
		pvPowerW,
		houseLoadW,
		surplusW,
		deficitW,
		wbConnected,
		wbCharging,
		wbMode,
		wbSoc,
		wbRemaining,
		wbLimitSoc,
		wbPlanActive,
		wbDeadlineRaw,
		bufferTempLive,
		bufferTempRuntime,
		boilerTempLive,
		boilerTempRuntime,
		climate1Running,
		climate1Temp,
		climate2Running,
		climate2Temp,
		priceNowCt,
	] = await Promise.all([
		readNum(host, "live.pv.power_w"),
		readNum(host, "live.battery.house_load_w"),
		readNum(host, "operator.diagnostics.surplus_w"),
		readNum(host, "operator.diagnostics.deficit_w"),
		readBool(host, WALLBOX_EVCC_STATES.connected),
		readBool(host, WALLBOX_EVCC_STATES.charging),
		readStr(host, WALLBOX_EVCC_STATES.loadpointMode),
		readNum(host, WALLBOX_EVCC_STATES.vehicleSocPct),
		readNum(host, WALLBOX_EVCC_STATES.chargeRemainingEnergyKwh),
		readNum(host, WALLBOX_EVCC_STATES.effectiveLimitSocPct),
		readBool(host, WALLBOX_EVCC_STATES.planActive),
		readStr(host, WALLBOX_EVCC_STATES.effectivePlanTime),
		readNum(host, "live.thermal.buffer_temp_c"),
		readNum(host, IMMERSION_RUNTIME_STATES.bufferTemperatureC),
		readNum(host, "live.thermal.boiler_temp_c"),
		readNum(host, IMMERSION_RUNTIME_STATES.boilerTemperatureC),
		readBool(host, acUnitRuntimeStates(1).running),
		readNum(host, acUnitRuntimeStates(1).roomTempC),
		readBool(host, acUnitRuntimeStates(2).running),
		readNum(host, acUnitRuntimeStates(2).roomTempC),
		readNum(host, "live.price.now_ct_per_kwh"),
	]);

	const deadlineIso = validIsoDeadline(wbDeadlineRaw) ?? wallboxDeadlineFromPlan(plan);

	return {
		live: {
			pvPowerW,
			houseLoadW,
			surplusW,
			deficitW,
		},
		wallbox: {
			connected: wbConnected,
			charging: wbCharging,
			mode: wbMode,
			socPct: wbSoc,
			remainingEnergyKwh: wbRemaining,
			effectiveLimitSoc: wbLimitSoc,
			planActive: wbPlanActive,
			deadlineIso,
		},
		immersion: {
			bufferTempC: bufferTempLive ?? bufferTempRuntime,
			boilerTempC: boilerTempLive ?? boilerTempRuntime,
			bufferEstimatedEmptyAt: learning.thermalBufferEstimatedEmptyAt,
			bufferEstimatedEmptyAtLocalDe: learning.thermalBufferEstimatedEmptyAtLocalDe,
			bufferEstimatedRemainingHours: learning.thermalBufferEstimatedRemainingHours,
			boilerEstimatedEmptyAt: learning.thermalBoilerEstimatedEmptyAt,
			boilerEstimatedEmptyAtLocalDe: learning.thermalBoilerEstimatedEmptyAtLocalDe,
			boilerEstimatedRemainingHours: learning.thermalBoilerEstimatedRemainingHours,
			thermalEstimatedEmptyAt: learning.thermalEstimatedEmptyAt,
			thermalEstimatedEmptyAtLocalDe: learning.thermalEstimatedEmptyAtLocalDe,
			thermalEstimatedRemainingHours: learning.thermalEstimatedRemainingHours,
		},
		climate: {
			units: [
				{ unitIndex: 1, running: climate1Running, roomTempC: climate1Temp },
				{ unitIndex: 2, running: climate2Running, roomTempC: climate2Temp },
			],
		},
		pvHorizon: learning.pvHorizonDays,
		pvTodayKwh: learning.pvCorrectedTodayKwh,
		pvTomorrowKwh: learning.pvCorrectedTomorrowKwh,
		priceNowCt,
		priceAvg7d: learning.priceAvgEurPerKwh7d,
		nextHours: nextHoursFromPlan(plan),
	};
}

/** Nur ausgewählte, unkritische Policy-Kennzahlen — kein voller Snapshot. */
function pickPolicyHighlights(policy: Record<string, unknown>): Record<string, unknown> {
	const limits = policy.limits as Record<string, { value?: unknown }> | undefined;
	const economics = policy.economics as Record<string, { value?: unknown }> | undefined;
	return {
		houseFuseLimitW: limits?.houseFuseLimitW?.value ?? null,
		maxGridImportW: limits?.maxGridImportW?.value ?? null,
		gridImportAllowed: economics?.gridImportAllowed?.value ?? null,
	};
}

export async function buildAiOptimizationContext(
	host: ContextHost,
	plan: DailyPlan,
	triggerReason: string,
): Promise<AiOptimizationRequestContext> {
	const policyRaw = await readJson(host, "policy.global.effective_json");
	const allowedAddonIds = resolveAllowedAddonIds(host.config);
	const learning = await buildLearningDigest(host, plan.timezone || "Europe/Berlin");
	const situation = await buildSituationBrief(host, plan, learning);
	return {
		generatedAt: new Date().toISOString(),
		timezone: plan.timezone,
		globalMode: plan.globalMode,
		allowedAddonIds,
		dailyPlan: digestFromDailyPlan(plan, allowedAddonIds),
		learning,
		situation,
		policyHighlights: pickPolicyHighlights(policyRaw),
		triggerReason,
	};
}
