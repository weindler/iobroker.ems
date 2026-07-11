import { operatorQuality } from "../quality";
import type {
	AllocationCandidate,
	AllocationEnergySource,
	AllocationStatus,
	DailyAllocationEntry,
	DailyPlanSlot,
	DailyPlanUnallocated,
} from "./types";
import {
	buildAllocationCandidate,
	gridImportEffective,
	isMutualExclusionPair,
	resolveMutualExclusionAddonId,
	sortAllocationCandidates,
} from "./policy";
import {
	energyKwhFromPower,
	minPowerForDeadline,
	powerWFromEnergyKwh,
	slotsUntilDeadline,
} from "./slots";

const SLOT_MINUTES = 15;

interface RemainingEnergy {
	contributionId: string;
	remainingKwh: number;
	requestedKwh: number | null;
}

function round3(n: number): number {
	return Math.round(n * 1000) / 1000;
}

function slotKeyInternal(slot: DailyPlanSlot): string {
	return `${slot.slot.startIso}|${slot.slot.endIso}`;
}

function isGridBlockedInSlot(
	candidate: AllocationCandidate,
	gridAllocatedAddonIds: Map<string, string>,
	mutualExclusions: Array<{ addonA: string; addonB: string }>,
): boolean {
	const addonId = resolveMutualExclusionAddonId(candidate.contributionId, candidate.addonId, mutualExclusions);
	for (const otherAddonId of gridAllocatedAddonIds.values()) {
		if (otherAddonId === addonId) continue;
		if (isMutualExclusionPair(addonId, otherAddonId, mutualExclusions)) {
			return true;
		}
	}
	return false;
}

function createAllocationEntry(
	candidate: AllocationCandidate,
	slot: DailyPlanSlot,
	allocatedPowerW: number,
	pvPowerW: number,
	gridPowerW: number,
	status: AllocationStatus,
	energySource: AllocationEnergySource,
	reasonDe: string,
	requestedEnergyKwh: number | null,
): DailyAllocationEntry {
	const allocatedEnergyKwh = energyKwhFromPower(allocatedPowerW, SLOT_MINUTES);
	let estimatedCostCt: number | null = null;
	if (gridPowerW > 0 && slot.gridPriceCtPerKwh !== null) {
		estimatedCostCt = round3(energyKwhFromPower(gridPowerW, SLOT_MINUTES) * slot.gridPriceCtPerKwh);
	}
	return {
		contributionId: candidate.contributionId,
		contributor: candidate.contribution.contributor,
		slot: slot.slot,
		status,
		energySource,
		requestedPowerW: candidate.maxPowerW,
		allocatedPowerW,
		requestedEnergyKwh,
		allocatedEnergyKwh,
		gridPowerW,
		pvPowerW,
		mandatory: candidate.mandatory,
		priorityRank: candidate.priorityRank,
		deadlineIso: candidate.deadlineIso,
		estimatedCostCt,
		reasonDe,
	};
}

function applyAllocationToSlot(slot: DailyPlanSlot, entry: DailyAllocationEntry): void {
	slot.allocations.push(entry);
	slot.allocatedFlexiblePowerW += entry.allocatedPowerW ?? 0;
	slot.allocatedPvPowerW += entry.pvPowerW;
	slot.allocatedGridPowerW += entry.gridPowerW;
	if (slot.remainingPvSurplusPowerW !== null) {
		slot.remainingPvSurplusPowerW = Math.max(0, slot.remainingPvSurplusPowerW - entry.pvPowerW);
	}
	if (slot.remainingGridImportPowerWAfterAlloc !== null) {
		slot.remainingGridImportPowerWAfterAlloc = Math.max(
			0,
			slot.remainingGridImportPowerWAfterAlloc - entry.gridPowerW,
		);
	}
}

function gridAddonIdsInSlot(
	slot: DailyPlanSlot,
	mutualExclusions: Array<{ addonA: string; addonB: string }>,
): Map<string, string> {
	const map = new Map<string, string>();
	for (const a of slot.allocations) {
		if (a.gridPowerW > 0) {
			map.set(
				a.contributionId,
				resolveMutualExclusionAddonId(a.contributionId, a.contributor.id, mutualExclusions),
			);
		}
	}
	return map;
}

function tryAllocateInSlot(
	candidate: AllocationCandidate,
	slot: DailyPlanSlot,
	remaining: RemainingEnergy,
	gridAllowed: boolean,
	gridAddonIds: Map<string, string>,
	mutualExclusions: Array<{ addonA: string; addonB: string }>,
	forceMinPowerW: number | null,
): DailyAllocationEntry | null {
	if (remaining.remainingKwh <= 0) return null;

	const maxFromEnergy = powerWFromEnergyKwh(remaining.remainingKwh, SLOT_MINUTES);
	let targetW = forceMinPowerW ?? maxFromEnergy;
	if (candidate.maxPowerW !== null) targetW = Math.min(targetW, candidate.maxPowerW);
	if (targetW <= 0) return null;

	let pvW = 0;
	let gridW = 0;

	if (slot.remainingPvSurplusPowerW !== null && slot.remainingPvSurplusPowerW > 0) {
		pvW = Math.min(targetW, slot.remainingPvSurplusPowerW);
	}

	const rest = targetW - pvW;
	if (
		candidate.gridEligible &&
		!candidate.pvFirst &&
		gridAllowed &&
		rest > 0 &&
		slot.remainingGridImportPowerWAfterAlloc !== null &&
		slot.remainingGridImportPowerWAfterAlloc > 0 &&
		!isGridBlockedInSlot(candidate, gridAddonIds, mutualExclusions)
	) {
		gridW = Math.min(rest, slot.remainingGridImportPowerWAfterAlloc);
	}

	const allocatedW = pvW + gridW;
	if (allocatedW <= 0) return null;

	let energySource: AllocationEnergySource = "none";
	if (pvW > 0 && gridW > 0) energySource = "mixed";
	else if (pvW > 0) energySource = "pv_surplus";
	else if (gridW > 0) energySource = "grid";

	const entry = createAllocationEntry(
		candidate,
		slot,
		allocatedW,
		pvW,
		gridW,
		"allocated",
		energySource,
		energySource === "pv_surplus"
			? "PV-Überschuss zugewiesen."
			: energySource === "grid"
				? "Netzenergie zugewiesen."
				: "Gemischte Zuweisung.",
		remaining.requestedKwh,
	);

	remaining.remainingKwh = round3(Math.max(0, remaining.remainingKwh - (entry.allocatedEnergyKwh ?? 0)));
	applyAllocationToSlot(slot, entry);
	return entry;
}

export interface RunAllocationInput {
	slots: DailyPlanSlot[];
	candidates: AllocationCandidate[];
	globalMode: string;
	modeAllowsOptimization: boolean;
	gridImportAllowedPolicy: boolean | null;
	mutualExclusions: Array<{ id: string; addonA: string; addonB: string; reason?: string }>;
	nowMs: number;
}

export interface RunAllocationResult {
	slots: DailyPlanSlot[];
	allocations: DailyAllocationEntry[];
	unallocated: DailyPlanUnallocated[];
}

export function runAllocation(input: RunAllocationInput): RunAllocationResult {
	const slots = input.slots.map((s) => ({
		...s,
		allocations: [...s.allocations],
		remainingPvSurplusPowerW: s.remainingPvSurplusPowerW,
		remainingGridImportPowerWAfterAlloc: s.remainingGridImportPowerWAfterAlloc,
	}));

	const allEntries: DailyAllocationEntry[] = [];
	const unallocated: DailyPlanUnallocated[] = [];

	const remainingById = new Map<string, RemainingEnergy>();
	for (const c of input.candidates) {
		if (!c.allocatable && !c.mandatory) continue;
		const req = c.requiredEnergyKwh;
		if (req === null && !c.mandatory) continue;
		remainingById.set(c.contributionId, {
			contributionId: c.contributionId,
			remainingKwh: req ?? 0,
			requestedKwh: req,
		});
	}

	if (input.globalMode === "off" || !input.modeAllowsOptimization) {
		for (const c of input.candidates) {
			if (c.mandatory && c.requiredEnergyKwh !== null && c.requiredEnergyKwh > 0) {
				unallocated.push({
					contributionId: c.contributionId,
					requestedEnergyKwh: c.requiredEnergyKwh,
					allocatedEnergyKwh: 0,
					unallocatedEnergyKwh: c.requiredEnergyKwh,
					reasonDe: "Global Mode off — keine Allocation, Pflichtbedarf dokumentiert.",
				});
			}
		}
		return { slots, allocations: allEntries, unallocated };
	}

	const allocatable = input.candidates.filter((c) => c.allocatable);
	const mandatory = sortAllocationCandidates(allocatable.filter((c) => c.mandatory));
	const deadline = sortAllocationCandidates(allocatable.filter((c) => c.hasDeadline && !c.mandatory));
	const flexible = sortAllocationCandidates(allocatable.filter((c) => !c.mandatory && !c.hasDeadline));

	const gridAllowedForSlot = (slot: DailyPlanSlot): boolean =>
		gridImportEffective(
			slot.gridImportAllowed,
			input.gridImportAllowedPolicy,
			input.modeAllowsOptimization,
			input.globalMode,
		);

	for (const candidate of mandatory) {
		const rem = remainingById.get(candidate.contributionId);
		if (!rem) continue;
		for (const slot of slots) {
			if (rem.remainingKwh <= 0) break;
			const entry = tryAllocateInSlot(
				candidate,
				slot,
				rem,
				gridAllowedForSlot(slot) && candidate.gridEligible,
				gridAddonIdsInSlot(slot, input.mutualExclusions),
				input.mutualExclusions,
				null,
			);
			if (entry) allEntries.push(entry);
		}
	}

	for (const candidate of deadline) {
		const rem = remainingById.get(candidate.contributionId);
		if (!rem || !candidate.deadlineIso) continue;
		const eligible = slotsUntilDeadline(
			slots.map((s) => s.slot),
			candidate.deadlineIso,
			input.nowMs,
		);
		const eligibleKeys = new Set(eligible.map((s) => `${s.startIso}|${s.endIso}`));
		const deadlineSlots = slots
			.filter((s) => eligibleKeys.has(slotKeyInternal(s)))
			.sort((a, b) => {
				const pa = a.gridPriceCtPerKwh ?? 9999;
				const pb = b.gridPriceCtPerKwh ?? 9999;
				return pa - pb || a.slot.startIso.localeCompare(b.slot.startIso);
			});

		const minW = minPowerForDeadline(
			rem.remainingKwh,
			deadlineSlots.map((s) => s.slot),
			SLOT_MINUTES,
			candidate.maxPowerW,
		);

		for (const slot of deadlineSlots) {
			if (rem.remainingKwh <= 0) break;
			const entry = tryAllocateInSlot(
				candidate,
				slot,
				rem,
				gridAllowedForSlot(slot) && candidate.gridEligible,
				gridAddonIdsInSlot(slot, input.mutualExclusions),
				input.mutualExclusions,
				minW,
			);
			if (entry) allEntries.push(entry);
		}
	}

	for (const candidate of flexible) {
		const rem = remainingById.get(candidate.contributionId);
		if (!rem) continue;

		const orderedSlots = candidate.gridEligible
			? [...slots].sort((a, b) => {
					const pa = a.gridPriceCtPerKwh ?? 9999;
					const pb = b.gridPriceCtPerKwh ?? 9999;
					return pa - pb || a.slot.startIso.localeCompare(b.slot.startIso);
				})
			: slots;

		for (const slot of orderedSlots) {
			if (rem.remainingKwh <= 0) break;
			const entry = tryAllocateInSlot(
				candidate,
				slot,
				rem,
				gridAllowedForSlot(slot) && candidate.gridEligible,
				gridAddonIdsInSlot(slot, input.mutualExclusions),
				input.mutualExclusions,
				null,
			);
			if (entry) allEntries.push(entry);
		}
	}

	for (const c of allocatable) {
		const rem = remainingById.get(c.contributionId);
		if (!rem) {
			if (c.requiredEnergyKwh === null) {
				unallocated.push({
					contributionId: c.contributionId,
					requestedEnergyKwh: null,
					allocatedEnergyKwh: 0,
					unallocatedEnergyKwh: null,
					reasonDe: c.reasonDe || "Kein belastbarer Energiebedarf.",
				});
			}
			continue;
		}
		const allocated = round3((rem.requestedKwh ?? 0) - rem.remainingKwh);
		if (rem.remainingKwh > 0.001) {
			let reason = "Bedarf nicht vollständig zuweisbar.";
			if (c.pvFirst) reason = "PV-first — kein ausreichender PV-Überschuss in belastbaren Slots.";
			else if (!c.gridEligible) reason = "Netzbezug für diesen Beitrag nicht freigegeben.";
			else if (slots.every((s) => s.availablePvSurplusPowerW === null)) {
				reason = "Kein zeitaufgelöster PV-Forecast — PV-Allocation nicht möglich.";
			}
			unallocated.push({
				contributionId: c.contributionId,
				requestedEnergyKwh: rem.requestedKwh,
				allocatedEnergyKwh: allocated,
				unallocatedEnergyKwh: round3(rem.remainingKwh),
				reasonDe: reason,
			});
		}
	}

	return { slots, allocations: allEntries, unallocated };
}

export function buildAllocationCandidates(
	contributions: import("../types").PlanContribution[],
	globalMode: string,
	energyPriority: string[],
): AllocationCandidate[] {
	return contributions.map((c) => buildAllocationCandidate(c, globalMode, energyPriority));
}

export function allocationQualityFromUnallocated(
	unallocated: DailyPlanUnallocated[],
	hasMandatoryGap: boolean,
): ReturnType<typeof operatorQuality> {
	if (hasMandatoryGap) {
		return operatorQuality("degraded", "Pflichtbedarf nicht vollständig alloziert.");
	}
	if (unallocated.some((u) => (u.unallocatedEnergyKwh ?? 0) > 0)) {
		return operatorQuality("degraded", "Flexible Bedarfe teilweise nicht zugewiesen.");
	}
	return operatorQuality("valid", "Daily Plan Allocation bereit.");
}
