/**
 * Frozen Planner Allocation — multi-consumer, Shared-AC elektrisch einmal.
 */

import type { UnifiedAllocationCell } from "../../operator/daily_plan/unified/types";
import type { FrozenPlannedConsumer } from "./types";

export type SharedGroupMap = Map<string, string>; // consumerId → sharedPowerGroupId

/**
 * Baut kompakte Frozen Allocation für einen Slot.
 * Klima-Komfort: pro Unit.
 * Elektrische Shared-Power: max() je sharedPowerGroupId als kind=climate_shared_electric.
 */
export function freezePlannedConsumersForSlot(
	allocations: UnifiedAllocationCell[],
	slotStartIso: string,
	sharedGroupByConsumerId?: SharedGroupMap | null,
): FrozenPlannedConsumer[] {
	const forSlot = allocations.filter((a) => a.slot.startIso === slotStartIso);
	const out: FrozenPlannedConsumer[] = [];
	const sharedMax = new Map<string, number>();

	for (const a of forSlot) {
		if (a.kind === "climate") {
			const group = sharedGroupByConsumerId?.get(a.consumerId)?.trim() || null;
			out.push({
				consumerId: a.consumerId,
				kind: "climate",
				energyKwh: a.allocatedEnergyKwh,
			});
			if (group) {
				const prev = sharedMax.get(group) ?? 0;
				sharedMax.set(group, Math.max(prev, a.allocatedEnergyKwh));
			} else {
				/* ohne Gruppe: Unit selbst zählt elektrisch (kein max-Sharing) */
				out.push({
					consumerId: a.consumerId,
					kind: "climate_shared_electric",
					energyKwh: a.allocatedEnergyKwh,
				});
			}
			continue;
		}
		out.push({
			consumerId: a.consumerId,
			kind: a.kind,
			energyKwh: a.allocatedEnergyKwh,
		});
	}

	for (const [groupId, kwh] of sharedMax) {
		out.push({
			consumerId: groupId,
			kind: "climate_shared_electric",
			energyKwh: kwh,
		});
	}

	return out;
}

/** Dedup: gleicher Inhalt → bestehender Index, sonst push. */
export function dedupePlannedConsumers(
	table: FrozenPlannedConsumer[][],
	entry: FrozenPlannedConsumer[],
): { table: FrozenPlannedConsumer[][]; index: number } {
	const key = JSON.stringify(entry);
	for (let i = 0; i < table.length; i++) {
		if (JSON.stringify(table[i]) === key) {
			return { table, index: i };
		}
	}
	return { table: [...table, entry], index: table.length };
}

export function sharedGroupMapFromClimateUnits(
	units: Array<{ unitId?: string; consumerId?: string; sharedPowerGroupId?: string | null }>,
): SharedGroupMap {
	const m = new Map<string, string>();
	for (const u of units) {
		const id = (u.consumerId ?? u.unitId)?.trim();
		const g = u.sharedPowerGroupId?.trim();
		if (id && g) m.set(id, g);
	}
	return m;
}
