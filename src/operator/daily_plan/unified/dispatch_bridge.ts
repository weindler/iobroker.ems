/**
 * Unified Day Plan → bestehende DailyAllocationEntry-Form für IH/AC/Battery/Wallbox.
 * Keine Geräte-Writes — nur Plan-/Dispatch-Übersetzung.
 * Battery: nur charge (kein Discharge-Live). Wallbox: Intent für EVCC-Runtime.
 */

import { CONTRIBUTION_IDS, acUnitContributionId } from "../../contribution_ids";
import type { DailyAllocationEntry } from "../types";
import type { OperatorContributorRef } from "../../types";
import type { UnifiedAllocationCell, UnifiedDayPlan } from "./types";
import { filterRunnableAllocations, RUNNABLE_ALLOCATION_FLOOR_W } from "../addon_plan_publish";
import {
	executableGeometryRejectReasonDe,
	isExecutableDailyEntry,
} from "./slot_geometry";

const IH_CONTRIBUTOR: OperatorContributorRef = {
	type: "addon",
	id: "immersion_heater",
	addonId: "immersion_heater",
};

const AC_CONTRIBUTOR: OperatorContributorRef = {
	type: "addon",
	id: "air_conditioning",
	addonId: "air_conditioning",
};

const BAT_CONTRIBUTOR: OperatorContributorRef = {
	type: "addon",
	id: "battery",
	addonId: "battery",
};

const WB_CONTRIBUTOR: OperatorContributorRef = {
	type: "addon",
	id: "wallbox",
	addonId: "wallbox",
};

function cellToEntry(
	cell: UnifiedAllocationCell,
	contributionId: string,
	contributor: OperatorContributorRef,
	opts?: { deadlineIso?: string | null; estimatedCostCt?: number | null },
): DailyAllocationEntry {
	const source = cell.energySource;
	const pv = source === "pv_surplus" || source === "mixed" ? cell.allocatedPowerW : 0;
	const grid = source === "grid" || source === "mixed" ? cell.allocatedPowerW : 0;
	const bat = source === "battery" || source === "mixed" ? cell.allocatedPowerW : 0;
	return {
		contributionId,
		contributor,
		slot: cell.slot,
		status: cell.allocatedPowerW > 0 ? "allocated" : "unallocated",
		energySource: source,
		requestedPowerW: cell.allocatedPowerW,
		allocatedPowerW: cell.allocatedPowerW,
		requestedEnergyKwh: cell.allocatedEnergyKwh,
		allocatedEnergyKwh: cell.allocatedEnergyKwh,
		gridPowerW: grid,
		pvPowerW: pv,
		batteryPowerW: bat,
		mandatory: cell.constraintIds.some(
			(id) => id.includes("mandatory") || id.includes("comfort") || id.includes("min_temp") || id.includes("energy_goal"),
		),
		priorityRank: null,
		deadlineIso: opts?.deadlineIso ?? null,
		estimatedCostCt: opts?.estimatedCostCt ?? null,
		reasonDe: cell.reasonCodes.join(", ") || "unified_day_plan",
	};
}

/** Nur kanonische 15-Min-Zellen mit konsistenter Energy↔Power — nie Multi-Hour-Dispatch. */
function filterExecutableGeometry(entries: DailyAllocationEntry[]): DailyAllocationEntry[] {
	return entries.filter((e) => {
		if (isExecutableDailyEntry(e)) return true;
		return false;
	});
}

/** Immersion: flexible Contribution (PV-first Soft); Pflicht separat wenn min_temp. */
export function unifiedPlanToImmersionAllocations(plan: UnifiedDayPlan): DailyAllocationEntry[] {
	const byKey = new Map<string, DailyAllocationEntry>();
	for (const cell of plan.allocations) {
		if (cell.kind !== "immersion_heater") continue;
		const mandatory =
			cell.constraintIds.includes("thermal.min_temp") || cell.reasonCodes.includes("thermal_mandatory");
		const id = mandatory ? CONTRIBUTION_IDS.IMMERSION_MANDATORY : CONTRIBUTION_IDS.IMMERSION_FLEXIBLE;
		const entry = cellToEntry(cell, id, IH_CONTRIBUTOR);
		const key = `${id}|${entry.slot.startIso}`;
		const existing = byKey.get(key);
		if (!existing) {
			byKey.set(key, entry);
			continue;
		}
		/** Hard+Soft-Zellen im selben Slot → eine Dispatch-Zeile (Leistungsstufe). */
		const eKwh = (existing.allocatedEnergyKwh ?? 0) + (entry.allocatedEnergyKwh ?? 0);
		const eW = (existing.allocatedPowerW ?? 0) + (entry.allocatedPowerW ?? 0);
		existing.allocatedEnergyKwh = Math.round(eKwh * 1000) / 1000;
		existing.allocatedPowerW = Math.round(eW * 10) / 10;
		existing.requestedEnergyKwh = existing.allocatedEnergyKwh;
		existing.requestedPowerW = existing.allocatedPowerW;
		existing.pvPowerW = (existing.pvPowerW ?? 0) + (entry.pvPowerW ?? 0);
		existing.gridPowerW = (existing.gridPowerW ?? 0) + (entry.gridPowerW ?? 0);
		existing.batteryPowerW = (existing.batteryPowerW ?? 0) + (entry.batteryPowerW ?? 0);
		if (existing.energySource !== entry.energySource) existing.energySource = "mixed";
		existing.mandatory = existing.mandatory || entry.mandatory;
		if (entry.reasonDe && !existing.reasonDe.includes(entry.reasonDe)) {
			existing.reasonDe = `${existing.reasonDe}; ${entry.reasonDe}`;
		}
	}
	return filterRunnableAllocations(
		filterExecutableGeometry([...byKey.values()]),
		RUNNABLE_ALLOCATION_FLOOR_W,
	);
}

/** Klima: air_conditioning.unit_N — Multi-Hour / Energy-Inkonsistenz nie publizieren. */
export function unifiedPlanToClimateAllocations(plan: UnifiedDayPlan): DailyAllocationEntry[] {
	const out: DailyAllocationEntry[] = [];
	for (const cell of plan.allocations) {
		if (cell.kind !== "climate") continue;
		const m =
			/^air_conditioning\.unit_(\d+)$/.exec(cell.consumerId) || /^unit_(\d+)$/.exec(cell.consumerId);
		const unitIndex = m ? Number(m[1]) : Number(String(cell.consumerId).replace(/\D/g, "")) || 0;
		if (unitIndex < 1 || unitIndex > 5) continue;
		const entry = cellToEntry(cell, acUnitContributionId(unitIndex), AC_CONTRIBUTOR);
		if (!isExecutableDailyEntry(entry)) {
			entry.reasonDe = `${entry.reasonDe}; ${executableGeometryRejectReasonDe({
				startIso: entry.slot.startIso,
				endIso: entry.slot.endIso,
				allocatedPowerW: entry.allocatedPowerW,
				allocatedEnergyKwh: entry.allocatedEnergyKwh,
			})}`;
			continue;
		}
		out.push(entry);
	}
	return filterRunnableAllocations(out, RUNNABLE_ALLOCATION_FLOOR_W);
}

/**
 * Battery Charge only — Discharge-Zellen werden bewusst nicht als Live-Dispatch publiziert
 * (Sonnen EM: discharge_unverified / unsupported).
 */
export function unifiedPlanToBatteryAllocations(plan: UnifiedDayPlan): DailyAllocationEntry[] {
	const out: DailyAllocationEntry[] = [];
	for (const cell of plan.allocations) {
		if (cell.kind !== "battery_charge") continue;
		out.push(cellToEntry(cell, CONTRIBUTION_IDS.BATTERY_CHARGE, BAT_CONTRIBUTOR));
	}
	return filterRunnableAllocations(filterExecutableGeometry(out), RUNNABLE_ALLOCATION_FLOOR_W);
}

/** Wallbox → wallbox.ev_session für bestehende EVCC-Runtime. */
export function unifiedPlanToWallboxAllocations(plan: UnifiedDayPlan): DailyAllocationEntry[] {
	const deadline =
		plan.vehicleChargeEconomics?.deadlineIso ??
		null;
	const out: DailyAllocationEntry[] = [];
	for (const cell of plan.allocations) {
		if (cell.kind !== "wallbox") continue;
		const cost =
			cell.energySource === "grid" || cell.energySource === "mixed"
				? plan.vehicleChargeEconomics?.slotCostsCtByStartIso?.[cell.slot.startIso] ?? null
				: null;
		out.push(
			cellToEntry(cell, CONTRIBUTION_IDS.WALLBOX_EV_SESSION, WB_CONTRIBUTOR, {
				deadlineIso: deadline,
				estimatedCostCt: cost,
			}),
		);
	}
	return filterRunnableAllocations(filterExecutableGeometry(out), RUNNABLE_ALLOCATION_FLOOR_W);
}

export type UnifiedIhAcDispatchPublish = {
	immersionEntries: DailyAllocationEntry[];
	climateEntries: DailyAllocationEntry[];
	immersionStatus: "ready" | "idle";
	climateStatus: "ready" | "idle";
	immersionReasonDe: string;
	climateReasonDe: string;
};

export type UnifiedDispatchPublish = UnifiedIhAcDispatchPublish & {
	batteryEntries: DailyAllocationEntry[];
	wallboxEntries: DailyAllocationEntry[];
	batteryStatus: "ready" | "idle";
	wallboxStatus: "ready" | "idle";
	batteryReasonDe: string;
	wallboxReasonDe: string;
};

export function buildUnifiedIhAcDispatchPublish(plan: UnifiedDayPlan): UnifiedIhAcDispatchPublish {
	const immersionEntries = unifiedPlanToImmersionAllocations(plan);
	const climateEntries = unifiedPlanToClimateAllocations(plan);
	return {
		immersionEntries,
		climateEntries,
		immersionStatus: immersionEntries.length > 0 ? "ready" : "idle",
		climateStatus: climateEntries.length > 0 ? "ready" : "idle",
		immersionReasonDe:
			immersionEntries.length > 0
				? `Unified Day Plan: ${immersionEntries.length} fahrbare Heizstab-Fenster.`
				: "Unified Day Plan: kein fahrbares Heizstab-Fenster.",
		climateReasonDe:
			climateEntries.length > 0
				? `Unified Day Plan: ${climateEntries.length} fahrbare Klima-Fenster.`
				: "Unified Day Plan: kein fahrbares Klima-Fenster.",
	};
}

export function buildUnifiedDispatchPublish(plan: UnifiedDayPlan): UnifiedDispatchPublish {
	const ihAc = buildUnifiedIhAcDispatchPublish(plan);
	const batteryEntries = unifiedPlanToBatteryAllocations(plan);
	const wallboxEntries = unifiedPlanToWallboxAllocations(plan);
	return {
		...ihAc,
		batteryEntries,
		wallboxEntries,
		batteryStatus: batteryEntries.length > 0 ? "ready" : "idle",
		wallboxStatus: wallboxEntries.length > 0 ? "ready" : "idle",
		batteryReasonDe:
			batteryEntries.length > 0
				? `Unified Day Plan: ${batteryEntries.length} fahrbare Batterie-Lade-Fenster (charge/hold; kein Discharge-Live).`
				: "Unified Day Plan: kein fahrbares Batterie-Lade-Fenster.",
		wallboxReasonDe:
			wallboxEntries.length > 0
				? `Unified Day Plan: ${wallboxEntries.length} fahrbare Wallbox-Fenster (EVCC).`
				: "Unified Day Plan: kein fahrbares Wallbox-Fenster.",
	};
}
