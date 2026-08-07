/**
 * Fixtures für ALLOC-001…007 — rufen den echten Allocator auf.
 */

import type { UnifiedDayPlannerInput } from "./types";
import { buildSlots, golden001Input, golden002Input, golden003Input } from "./fixtures";

const Q = (confidencePct: number) => ({
	status: "valid" as const,
	confidencePct,
	reasonDe: "alloc-fixture",
});

function withConfidence(input: UnifiedDayPlannerInput, pct: number): UnifiedDayPlannerInput {
	return {
		...input,
		pv: {
			...input.pv,
			uncertainty: Q(pct),
			freshness: { ...input.pv.freshness, quality: Q(pct) },
		},
	};
}

/** ALLOC-001: hoher PV, Batterie teils leer, Thermal, keine Wallbox. */
export function alloc001Input(): UnifiedDayPlannerInput {
	const input = golden001Input();
	input.battery = { ...input.battery, socPct: 25, usableCapacityKwh: 18 };
	input.wallbox = null;
	input.thermal = {
		...input.thermal!,
		headroomEnergyKwh: 5,
		dayTargetTempC: 56,
	};
	return withConfidence(input, 85);
}

/** ALLOC-002: hohe PV während Abwesenheit. */
export function alloc002Input(): UnifiedDayPlannerInput {
	return withConfidence(golden002Input(), 85);
}

/** ALLOC-003: PV reicht vor Deadline, billiger früher Netzslot. */
export function alloc003Input(): UnifiedDayPlannerInput {
	return withConfidence(golden003Input(), 90);
}

/** ALLOC-004: harte Deadline, PV unzureichend. */
export function alloc004Input(): UnifiedDayPlannerInput {
	const input = golden002Input();
	input.wallbox = {
		...input.wallbox!,
		presenceWindows: [
			{ available: true, startIso: "2026-08-04T00:00:00.000Z", endIso: "2026-08-05T00:00:00.000Z" },
		],
		requiredEnergyKwh: 25,
		deadlineIso: "2026-08-04T18:00:00.000Z",
		energyGoalHard: true,
	};
	// Flatten PV to weak
	input.pv.slots = input.pv.slots.map((s) => ({
		...s,
		forecastPowerW: 400,
		energyKwh: 0.1,
	}));
	input.pv.expectedDayEnergyKwh = input.pv.slots.reduce((a, s) => a + (s.energyKwh ?? 0), 0);
	return withConfidence(input, 80);
}

/** ALLOC-005: PV nominal genug, Confidence niedrig, harte Deadline. */
export function alloc005Input(): UnifiedDayPlannerInput {
	const input = golden003Input();
	input.wallbox = {
		...input.wallbox!,
		requiredEnergyKwh: 6,
		energyGoalHard: true,
	};
	return withConfidence(input, 40);
}

/** ALLOC-006: Batterie fast voll, Thermal Headroom, hoher Surplus. */
export function alloc006Input(): UnifiedDayPlannerInput {
	const input = golden001Input();
	input.battery = { ...input.battery, socPct: 92 };
	input.wallbox = null;
	input.thermal = {
		...input.thermal!,
		headroomEnergyKwh: 4,
	};
	return withConfidence(input, 85);
}

/** ALLOC-007: Thermal tagsüber aus PV, nicht abends Batterie. */
export function alloc007Input(): UnifiedDayPlannerInput {
	const day = buildSlots("2026-08-04T08:00:00.000Z", 8);
	const evening = buildSlots("2026-08-04T20:00:00.000Z", 2);
	const slots = [...day, ...evening];
	const base = golden001Input();
	base.time = {
		...base.time,
		slots,
		horizonStartIso: slots[0].startIso,
		horizonEndIso: slots[slots.length - 1].endIso,
	};
	base.pv.slots = slots.map((s) => {
		const daySlot = Date.parse(s.startIso) < Date.parse("2026-08-04T18:00:00.000Z");
		const power = daySlot ? 3500 : 0;
		return {
			slot: s,
			forecastPowerW: power,
			observedPowerW: null,
			energyKwh: (power / 1000) * 0.25,
		};
	});
	base.pv.expectedDayEnergyKwh = base.pv.slots.reduce((a, s) => a + (s.energyKwh ?? 0), 0);
	base.pv.previousExpectedDayEnergyKwh = null;
	base.houseLoad.slots = slots.map((s) => ({
		slot: s,
		forecastPowerW: 600,
		observedPowerW: null,
		energyKwh: 0.15,
	}));
	base.prices.slots = slots.map((s) => ({
		slot: s,
		importCtPerKwh: 20,
		exportCtPerKwh: 9,
		gridImportAllowed: true,
	}));
	base.wallbox = null;
	base.thermal = {
		...base.thermal!,
		headroomEnergyKwh: 2.5,
	};
	base.battery = { ...base.battery, socPct: 70 };
	return withConfidence(base, 85);
}
