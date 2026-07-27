import { CONTRIBUTION_IDS } from "../contribution_ids";
import type { PlanContribution } from "../types";
import type { AllocationCandidate } from "./types";

const NON_ALLOCATABLE_IDS = new Set<string>([
	CONTRIBUTION_IDS.BATTERY_DISCHARGE,
	CONTRIBUTION_IDS.BATTERY_RESERVE,
	CONTRIBUTION_IDS.PV_SUPPLY,
	CONTRIBUTION_IDS.HOUSE_LOAD_FIXED,
	CONTRIBUTION_IDS.WEATHER_CONTEXT,
	CONTRIBUTION_IDS.GRID_SUPPLY,
	CONTRIBUTION_IDS.HOUSE_MAIN_FUSE,
	CONTRIBUTION_IDS.GLOBAL_CONSTRAINTS,
]);

const BLOCKING_STATUSES = new Set(["disabled", "blocked", "unsupported", "missing", "invalid"]);

export function contributionAddonId(contributionId: string, contributorId: string): string {
	if (contributorId.startsWith("air_conditioning.unit_")) return "air_conditioning";
	return contributorId;
}

export function matchesPolicyRef(ref: string, contributionId: string, addonId: string): boolean {
	const r = ref.trim();
	if (!r) return false;
	if (r === contributionId) return true;
	if (r === addonId) return true;
	return false;
}

export function policyOrderFor(
	contributionId: string,
	addonId: string,
	energyPriority: string[],
): number {
	for (let i = 0; i < energyPriority.length; i++) {
		if (matchesPolicyRef(energyPriority[i], contributionId, addonId)) {
			return i;
		}
	}
	return energyPriority.length + 1000;
}

export function isMutualExclusionPair(
	a: string,
	b: string,
	rules: Array<{ addonA: string; addonB: string }>,
): boolean {
	for (const rule of rules) {
		if (
			(a === rule.addonA && b === rule.addonB) ||
			(a === rule.addonB && b === rule.addonA) ||
			(matchesPolicyRef(rule.addonA, a, a) && matchesPolicyRef(rule.addonB, b, b)) ||
			(matchesPolicyRef(rule.addonA, b, b) && matchesPolicyRef(rule.addonB, a, a))
		) {
			return true;
		}
	}
	return false;
}

export function resolveMutualExclusionAddonId(
	contributionId: string,
	addonId: string,
	rules: Array<{ addonA: string; addonB: string }>,
): string {
	return addonId || contributionAddonId(contributionId, addonId);
}

function requiredEnergyFromContribution(c: PlanContribution): number | null {
	const fromDetails = c.details.requiredEnergyKwh;
	if (typeof fromDetails === "number" && Number.isFinite(fromDetails)) {
		return Math.max(0, fromDetails);
	}
	const slotNeed = c.slots.find((s) => s.requiredEnergyKwh !== null)?.requiredEnergyKwh;
	if (typeof slotNeed === "number" && Number.isFinite(slotNeed)) {
		return Math.max(0, slotNeed);
	}
	return null;
}

function maxPowerFromContribution(c: PlanContribution): number | null {
	const fromDetails = c.details.maxChargePowerW ?? c.details.maxPowerW ?? c.details.expectedPeakW;
	if (typeof fromDetails === "number" && Number.isFinite(fromDetails) && fromDetails > 0) {
		return fromDetails;
	}
	const slotMax = c.slots.find((s) => s.maxPowerW !== null)?.maxPowerW;
	if (typeof slotMax === "number" && Number.isFinite(slotMax) && slotMax > 0) {
		return slotMax;
	}
	return null;
}

function minPowerFromContribution(c: PlanContribution): number | null {
	const fromDetails = c.details.minPowerW;
	if (typeof fromDetails === "number" && Number.isFinite(fromDetails) && fromDetails > 0) {
		return fromDetails;
	}
	const slotMin = c.slots.find((s) => s.minPowerW !== null)?.minPowerW;
	if (typeof slotMin === "number" && Number.isFinite(slotMin) && slotMin > 0) {
		return slotMin;
	}
	return null;
}

export function buildAllocationCandidate(
	c: PlanContribution,
	globalMode: string,
	energyPriority: string[],
): AllocationCandidate {
	const addonId = c.contributor.addonId ?? c.contributor.id;
	const contributionId = c.contributionId;
	const mandatory =
		contributionId === CONTRIBUTION_IDS.IMMERSION_MANDATORY ||
		c.slots.some((s) => s.mandatory) ||
		c.details.mandatory === true;
	const forced = globalMode === "forced" || c.details.thermalMode === "force";
	const hasDeadline = c.deadlineIso !== null && c.deadlineIso.trim().length > 0;
	const pvFirst =
		contributionId === CONTRIBUTION_IDS.IMMERSION_FLEXIBLE || c.details.pvFirst === true;
	const gridEligible = c.gridEligible && !pvFirst;
	const batteryEligible = c.details.batteryEligible === true;

	let allocatable = true;
	let allocationStatus: AllocationCandidate["allocationStatus"] = "allocated";
	let reasonDe = c.reasonDe || c.quality.reasonDe;

	if (NON_ALLOCATABLE_IDS.has(contributionId) || c.flow === "constraint" || c.flow === "provide") {
		allocatable = false;
		allocationStatus =
			contributionId === CONTRIBUTION_IDS.BATTERY_DISCHARGE ? "unsupported" : "disabled";
		reasonDe =
			contributionId === CONTRIBUTION_IDS.BATTERY_DISCHARGE
				? "Entladung nicht unterstützt — keine Allocation."
				: "Constraint-Beitrag — keine Verbrauchs-Allocation.";
	} else if (!c.enabled) {
		allocatable = false;
		allocationStatus = "disabled";
	} else if (BLOCKING_STATUSES.has(c.quality.status)) {
		allocatable = false;
		allocationStatus =
			c.quality.status === "blocked"
				? "blocked"
				: c.quality.status === "unsupported"
					? "unsupported"
					: c.quality.status === "missing"
						? "missing_data"
						: "disabled";
	} else if (requiredEnergyFromContribution(c) === null && !mandatory) {
		allocationStatus = "missing_data";
		reasonDe = "Energiebedarf nicht belastbar — keine Allocation.";
	}

	const policyOrder = policyOrderFor(contributionId, addonId, energyPriority);

	let maxPowerW = maxPowerFromContribution(c);
	// Batterie-Laden ohne technische Obergrenze darf nie bis zur Haus-/Netzgrenze alloziert werden.
	if (
		contributionId === CONTRIBUTION_IDS.BATTERY_CHARGE &&
		(maxPowerW === null || maxPowerW <= 0) &&
		allocatable
	) {
		allocatable = false;
		allocationStatus = "missing_data";
		reasonDe = "Keine technische Max-Ladeleistung — keine Batterie-Allocation.";
		maxPowerW = null;
	}

	return {
		contribution: c,
		contributionId,
		addonId,
		mandatory,
		forced,
		hasDeadline,
		deadlineIso: c.deadlineIso,
		gridEligible,
		pvFirst,
		batteryEligible,
		maxPowerW,
		minPowerW: minPowerFromContribution(c),
		requiredEnergyKwh: requiredEnergyFromContribution(c),
		priorityRank: c.priorityBand ?? null,
		policyOrder,
		priorityBand: c.priorityBand ?? null,
		allocatable,
		allocationStatus,
		reasonDe,
	};
}

export function compareAllocationCandidates(a: AllocationCandidate, b: AllocationCandidate): number {
	if (a.mandatory !== b.mandatory) return a.mandatory ? -1 : 1;
	if (a.forced !== b.forced) return a.forced ? -1 : 1;
	if (a.hasDeadline !== b.hasDeadline) return a.hasDeadline ? -1 : 1;
	if (a.policyOrder !== b.policyOrder) return a.policyOrder - b.policyOrder;
	const bandA = a.priorityBand ?? 9999;
	const bandB = b.priorityBand ?? 9999;
	if (bandA !== bandB) return bandA - bandB;
	return a.contributionId.localeCompare(b.contributionId);
}

export function sortAllocationCandidates(candidates: AllocationCandidate[]): AllocationCandidate[] {
	return [...candidates].sort(compareAllocationCandidates);
}

export function gridImportEffective(
	slotImportAllowed: boolean,
	policyAllowed: boolean | null,
	modeAllowsOptimization: boolean,
	globalMode: string,
): boolean {
	if (!modeAllowsOptimization || globalMode === "off") return false;
	if (policyAllowed === false) return false;
	return slotImportAllowed;
}

export function resolvePolicySnapshotForPlan(
	policySnapshot: Record<string, unknown> | null,
	energyPriority: string[],
	mutualExclusions: Array<{ id: string; addonA: string; addonB: string; reason?: string }>,
	gridImportAllowedPolicy: boolean | null,
	effectiveMaxGridImportW: number | null,
	configuredHouseFuseLimitW: number | null,
	batteryConsumerAccess?: Partial<
		Record<string, { allowed: boolean; reasonDe: string; minSocPct: number | null }>
	>,
): { policySnapshot: Record<string, unknown>; constraintSnapshot: Record<string, unknown> } {
	return {
		policySnapshot: {
			energyPriority,
			gridImportAllowed: gridImportAllowedPolicy,
			effectiveMaxGridImportW,
			configuredHouseFuseLimitW,
			effectivePolicyPresent: policySnapshot !== null,
		},
		constraintSnapshot: {
			effectiveMaxGridImportW,
			configuredHouseFuseLimitW,
			mutualExclusions,
			batteryConsumers: batteryConsumerAccess
				? Object.fromEntries(
						Object.entries(batteryConsumerAccess).map(([k, v]) => [
							k,
							v
								? {
										allowed: v.allowed,
										reasonDe: v.reasonDe,
										minSocPct: v.minSocPct,
									}
								: null,
						]),
					)
				: {},
		},
	};
}
