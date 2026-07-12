import { CONTRIBUTION_IDS } from "../contribution_ids";
import { operatorQuality } from "../quality";
import { localDateKeyInTimezone } from "../time";
import type { ForecastPlan } from "../forecast/types";
import {
	allocationQualityFromUnallocated,
	buildAllocationCandidates,
	runAllocation,
} from "./allocation";
import { buildDailyPlanSlots } from "./constraints";
import {
	buildAllocationCandidate,
	resolvePolicySnapshotForPlan,
} from "./policy";
import { buildDailyHorizonSlots, energyKwhFromPower } from "./slots";
import type {
	DailyPlan,
	DailyPlanExcludedContribution,
	DailyPlanStatus,
	DailyPlanTotals,
	DailyPlanBuildInput,
} from "./types";

const SLOT_MINUTES = 15 as const;

function round3(n: number): number {
	return Math.round(n * 1000) / 1000;
}

function computeTotals(
	slots: DailyPlan["slots"],
	allocations: DailyPlan["allocations"],
	day: { pvEnergyKwh: number | null; houseLoadEnergyKwh: number | null; renewableBalanceKwh: number | null },
): DailyPlanTotals {
	let pvAllocated = 0;
	let gridAllocated = 0;
	let gridCost = 0;
	let hasCost = false;
	let battery = 0;
	let wallbox = 0;
	let immersion = 0;
	let ac = 0;
	let mandatoryReq = 0;
	let mandatoryAlloc = 0;
	let flexReq = 0;
	let flexAlloc = 0;

	for (const a of allocations) {
		const e = a.allocatedEnergyKwh ?? 0;
		if (a.pvPowerW > 0) pvAllocated += energyKwhFromPower(a.pvPowerW, SLOT_MINUTES);
		if (a.gridPowerW > 0) gridAllocated += energyKwhFromPower(a.gridPowerW, SLOT_MINUTES);
		if (a.estimatedCostCt !== null) {
			gridCost += a.estimatedCostCt;
			hasCost = true;
		}
		if (a.contributionId === CONTRIBUTION_IDS.BATTERY_CHARGE) battery += e;
		else if (a.contributionId === CONTRIBUTION_IDS.WALLBOX_EV_SESSION) wallbox += e;
		else if (a.contributionId.startsWith("immersion_heater")) immersion += e;
		else if (a.contributionId.startsWith("air_conditioning")) ac += e;

		if (a.mandatory) {
			mandatoryAlloc += e;
			if (a.requestedEnergyKwh !== null) mandatoryReq += a.requestedEnergyKwh;
		} else {
			flexAlloc += e;
			if (a.requestedEnergyKwh !== null) flexReq += a.requestedEnergyKwh;
		}
	}

	return {
		pvForecastEnergyKwh: day.pvEnergyKwh,
		fixedHouseLoadEnergyKwh: day.houseLoadEnergyKwh,
		fixedRenewableBalanceKwh: day.renewableBalanceKwh,
		flexibleRequestedEnergyKwh: flexReq > 0 ? round3(flexReq) : null,
		flexibleAllocatedEnergyKwh: round3(flexAlloc),
		flexibleUnallocatedEnergyKwh: flexReq > 0 ? round3(Math.max(0, flexReq - flexAlloc)) : null,
		pvAllocatedEnergyKwh: round3(pvAllocated),
		gridAllocatedEnergyKwh: round3(gridAllocated),
		batteryChargeEnergyKwh: round3(battery),
		wallboxEnergyKwh: round3(wallbox),
		immersionHeaterEnergyKwh: round3(immersion),
		airConditioningEnergyKwh: round3(ac),
		estimatedGridCostCt: hasCost ? round3(gridCost) : null,
		mandatoryRequestedEnergyKwh: mandatoryReq > 0 ? round3(mandatoryReq) : null,
		mandatoryAllocatedEnergyKwh: round3(mandatoryAlloc),
		mandatoryUnallocatedEnergyKwh:
			mandatoryReq > 0 ? round3(Math.max(0, mandatoryReq - mandatoryAlloc)) : null,
	};
}

function resolveDailyPlanStatus(
	forecastStatus: string,
	timezone: string,
	hasSlots: boolean,
	degraded: boolean,
): DailyPlanStatus {
	if (!timezone.trim()) return "error";
	if (forecastStatus === "missing_inputs") return "missing_inputs";
	if (!hasSlots) return "degraded";
	if (degraded) return "degraded";
	return "ready";
}

function partitionExcluded(
	candidates: ReturnType<typeof buildAllocationCandidates>,
): DailyPlanExcludedContribution[] {
	return candidates
		.filter((c) => !c.allocatable)
		.map((c) => ({
			contributionId: c.contributionId,
			reasonDe: c.reasonDe,
		}));
}

export function buildDailyPlan(input: DailyPlanBuildInput): DailyPlan {
	const dateKey = localDateKeyInTimezone(input.now, input.timezone);
	const horizonSlots = buildDailyHorizonSlots(input.now, input.timezone, SLOT_MINUTES);
	const slots = buildDailyPlanSlots(
		horizonSlots,
		input.forecastPlan.slots,
		input.effectiveMaxGridImportW,
		input.configuredHouseFuseLimitW,
	);

	const candidates = buildAllocationCandidates(
		input.contributions,
		input.globalMode,
		input.energyPriority,
	);

	const { policySnapshot, constraintSnapshot } = resolvePolicySnapshotForPlan(
		input.policySnapshot,
		input.energyPriority,
		input.mutualExclusions,
		input.gridImportAllowedPolicy,
		input.effectiveMaxGridImportW,
		input.configuredHouseFuseLimitW,
	);

	const allocationResult = runAllocation({
		slots,
		candidates,
		globalMode: input.globalMode,
		modeAllowsOptimization: input.modePolicy.allowOptimization,
		gridImportAllowedPolicy: input.gridImportAllowedPolicy,
		mutualExclusions: input.mutualExclusions,
		nowMs: input.now.getTime(),
	});

	const dayForecast =
		input.forecastPlan.days.find((d) => d.date === dateKey) ?? {
			date: dateKey,
			pvEnergyKwh: null,
			houseLoadEnergyKwh: null,
			renewableBalanceKwh: null,
		};

	const totals = computeTotals(allocationResult.slots, allocationResult.allocations, dayForecast);
	const excluded = partitionExcluded(candidates);
	const activeIds = candidates.filter((c) => c.allocatable).map((c) => c.contributionId);

	const hasMandatoryGap = allocationResult.unallocated.some(
		(u) =>
			u.unallocatedEnergyKwh !== null &&
			u.unallocatedEnergyKwh > 0 &&
			candidates.find((c) => c.contributionId === u.contributionId)?.mandatory,
	);

	const hasDegradedContributions = input.contributions.some(
		(c) => c.enabled && c.quality.status === "degraded",
	);
	const hasUnallocated = allocationResult.unallocated.some((u) => (u.unallocatedEnergyKwh ?? 0) > 0);
	const noPvSlots = allocationResult.slots.every((s) => s.availablePvSurplusPowerW === null);

	const status = resolveDailyPlanStatus(
		input.forecastPlan.status,
		input.timezone,
		allocationResult.slots.length > 0,
		hasMandatoryGap || hasDegradedContributions || hasUnallocated || noPvSlots,
	);

	const quality = allocationQualityFromUnallocated(allocationResult.unallocated, hasMandatoryGap);

	let reasonDe = "Deterministischer Daily Plan für den aktuellen Tag.";
	if (input.globalMode === "off") {
		reasonDe = "Global Mode off — Plan dokumentiert, keine flexible Allocation.";
	} else if (status === "missing_inputs") {
		reasonDe = "Forecast Plan unvollständig — Daily Plan eingeschränkt.";
	} else if (status === "degraded") {
		reasonDe = "Daily Plan nutzbar mit Lücken oder unalloziertem Bedarf.";
	}

	return {
		generatedAt: input.now.toISOString(),
		validUntil: null,
		revision: 0,
		date: dateKey,
		timezone: input.timezone,
		slotMinutes: SLOT_MINUTES,
		globalMode: input.globalMode,
		status,
		policySnapshot,
		constraintSnapshot,
		activeContributionIds: activeIds,
		excludedContributions: excluded,
		slots: allocationResult.slots,
		allocations: allocationResult.allocations,
		unallocated: allocationResult.unallocated,
		totals,
		quality,
		reasonDe,
	};
}

export function buildDailyPlanFromForecast(
	now: Date,
	timezone: string,
	globalMode: string,
	forecastPlan: ForecastPlan,
	policy: {
		policySnapshot: Record<string, unknown> | null;
		energyPriority: string[];
		mutualExclusions: Array<{ id: string; addonA: string; addonB: string; reason?: string }>;
		gridImportAllowedPolicy: boolean | null;
		effectiveMaxGridImportW: number | null;
		configuredHouseFuseLimitW: number | null;
		modePolicy: { mode: string; allowOptimization: boolean };
	},
): DailyPlan {
	return buildDailyPlan({
		now,
		timezone,
		globalMode,
		forecastPlan: {
			slots: forecastPlan.slots.map((s) => ({
				slot: s.slot,
				pvPowerW: s.pvPowerW,
				houseLoadPowerW: s.houseLoadPowerW,
				fixedBalancePowerW: s.fixedBalancePowerW,
				gridPriceCtPerKwh: s.gridPriceCtPerKwh,
				gridImportAllowed: s.gridImportAllowed,
				gridMaxImportPowerW: s.gridMaxImportPowerW,
			})),
			days: forecastPlan.days,
			status: forecastPlan.status,
		},
		contributions: forecastPlan.contributions,
		policySnapshot: policy.policySnapshot,
		energyPriority: policy.energyPriority,
		mutualExclusions: policy.mutualExclusions,
		gridImportAllowedPolicy: policy.gridImportAllowedPolicy,
		effectiveMaxGridImportW: policy.effectiveMaxGridImportW,
		configuredHouseFuseLimitW: policy.configuredHouseFuseLimitW,
		modePolicy: policy.modePolicy,
	});
}

export { dailyPlanRevisionPayload } from "./revision";

export { buildAllocationCandidate };
