/**
 * Prinzip-Bewertung für Unified Day Plans — kein Optimizer.
 * Golden Tests prüfen diese Prinzipien an Szenario-Plänen.
 */

import type {
	UnifiedDayPlan,
	UnifiedDayPlannerInput,
	UnifiedPrincipleEvaluation,
	UnifiedPrincipleId,
	UnifiedPrincipleVerdict,
} from "./types";

function sumAllocEnergy(
	plan: UnifiedDayPlan,
	kind: string,
	predicate?: (a: UnifiedDayPlan["allocations"][number]) => boolean,
): number {
	let s = 0;
	for (const a of plan.allocations) {
		if (a.kind !== kind) continue;
		if (predicate && !predicate(a)) continue;
		s += a.allocatedEnergyKwh;
	}
	return s;
}

function inWindow(iso: string, startIso: string, endIso: string): boolean {
	const t = Date.parse(iso);
	return t >= Date.parse(startIso) && t < Date.parse(endIso);
}

function vehicleAbsentDuring(input: UnifiedDayPlannerInput, slotStartIso: string): boolean {
	const wb = input.wallbox;
	if (!wb) return true;
	for (const w of wb.presenceWindows) {
		if (!inWindow(slotStartIso, w.startIso, w.endIso)) continue;
		const status = w.status ?? (w.available ? "available" : "unavailable");
		// nur status=available zählt als anwesend; unknown ≠ available
		return status !== "available";
	}
	return true;
}

export function evaluatePreallocateForeseeablePv(
	input: UnifiedDayPlannerInput,
	plan: UnifiedDayPlan,
): UnifiedPrincipleVerdict {
	const principleId: UnifiedPrincipleId = "preallocate_foreseeable_pv_to_flex";
	const pvDay = input.pv.expectedDayEnergyKwh;
	const exportKwh = plan.expectedGridExportEnergyKwh;
	const thermal = input.thermal;
	const thermalHeadroom = thermal?.headroomEnergyKwh ?? null;
	const thermalAlloc = sumAllocEnergy(plan, "immersion_heater");

	if (pvDay === null || exportKwh === null || thermalHeadroom === null) {
		return {
			principleId,
			passed: true,
			reasonCodes: ["SKIP_MISSING_DATA"],
			detailDe: "PV/Export/Thermal-Headroom unvollständig — Prinzip nicht bewertbar.",
		};
	}

	// Vorhersehbarer Surplus-Anteil: Export, während thermischer Speicher noch Kopf hat.
	// Schwelle relativ zum Szenario (nicht fixe 22 kWh / 47 °C).
	const wastedFlexShare = thermalHeadroom > 0 ? Math.min(exportKwh, thermalHeadroom) : 0;
	const significantWaste = wastedFlexShare >= Math.max(1, thermalHeadroom * 0.35);
	const underAllocatedThermal = thermalAlloc < thermalHeadroom * 0.5;

	const failed = significantWaste && underAllocatedThermal;
	return {
		principleId,
		passed: !failed,
		reasonCodes: failed
			? ["WASTED_PV_EXPORT_WITH_THERMAL_HEADROOM", "THERMAL_UNDER_ALLOCATED"]
			: ["PV_FLEX_PREALLOC_OK"],
		detailDe: failed
			? `Vermeidbarer Export (~${wastedFlexShare.toFixed(1)} kWh) bei thermischem Headroom ${thermalHeadroom.toFixed(1)} kWh, Allocation nur ${thermalAlloc.toFixed(1)} kWh.`
			: `Thermische Vorallocation ${thermalAlloc.toFixed(1)} kWh bei Headroom ${thermalHeadroom.toFixed(1)} kWh; Export ${exportKwh.toFixed(1)} kWh.`,
	};
}

export function evaluateNoChargeWhileAbsent(
	input: UnifiedDayPlannerInput,
	plan: UnifiedDayPlan,
): UnifiedPrincipleVerdict {
	const principleId: UnifiedPrincipleId = "no_charge_while_vehicle_absent";
	const bad = plan.allocations.filter(
		(a) =>
			a.kind === "wallbox" &&
			a.allocatedEnergyKwh > 0.01 &&
			vehicleAbsentDuring(input, a.slot.startIso),
	);
	const failed = bad.length > 0;
	return {
		principleId,
		passed: !failed,
		reasonCodes: failed ? ["WALLBOX_ALLOC_WHILE_ABSENT"] : ["WALLBOX_PRESENCE_RESPECTED"],
		detailDe: failed
			? `${bad.length} Wallbox-Allocation(en) außerhalb der Verfügbarkeit.`
			: "Keine Wallbox-Energie während Abwesenheit.",
	};
}

export function evaluatePreferPvOverUnnecessaryGrid(
	input: UnifiedDayPlannerInput,
	plan: UnifiedDayPlan,
): UnifiedPrincipleVerdict {
	const principleId: UnifiedPrincipleId = "prefer_pv_over_unnecessary_grid";
	const wb = input.wallbox;
	if (!wb?.deadlineIso || wb.requiredEnergyKwh === null) {
		return {
			principleId,
			passed: true,
			reasonCodes: ["SKIP_NO_VEHICLE_NEED"],
			detailDe: "Kein bewertbarer Fahrzeugbedarf.",
		};
	}

	const gridWb = sumAllocEnergy(
		plan,
		"wallbox",
		(a) => a.energySource === "grid" || a.energySource === "mixed",
	);
	const pvWb = sumAllocEnergy(plan, "wallbox", (a) => a.energySource === "pv_surplus");

	// PV-Fenster vor Deadline mit genug Energie?
	const deadlineMs = Date.parse(wb.deadlineIso);
	let pvBeforeDeadlineKwh = 0;
	for (const s of input.pv.slots) {
		if (Date.parse(s.slot.startIso) >= deadlineMs) continue;
		if (!vehicleAbsentDuring(input, s.slot.startIso)) {
			pvBeforeDeadlineKwh += s.energyKwh ?? 0;
		}
	}
	const houseBefore = input.houseLoad.slots
		.filter((s) => Date.parse(s.slot.startIso) < deadlineMs)
		.reduce((acc, s) => acc + (s.energyKwh ?? 0), 0);
	const surplusBefore = Math.max(0, pvBeforeDeadlineKwh - houseBefore * 0.5);
	const pvCanCover = surplusBefore >= wb.requiredEnergyKwh * 0.9;

	const failed = pvCanCover && gridWb > wb.requiredEnergyKwh * 0.5 && pvWb < wb.requiredEnergyKwh * 0.5;
	return {
		principleId,
		passed: !failed,
		reasonCodes: failed
			? ["UNNECESSARY_GRID_DESPITE_PV_WINDOW"]
			: ["GRID_VS_PV_OK"],
		detailDe: failed
			? `Netz-Wallbox ${gridWb.toFixed(1)} kWh obwohl PV-Surplus vor Deadline ~${surplusBefore.toFixed(1)} kWh reicht.`
			: `Wallbox PV ${pvWb.toFixed(1)} / Netz ${gridWb.toFixed(1)} kWh bei Bedarf ${wb.requiredEnergyKwh.toFixed(1)} kWh.`,
	};
}

/**
 * Relevante Forecast-Verschlechterung: Tages-PV fällt auf ≤55 % der vorherigen Prognose.
 * Plan muss die **revidierte** PV widerspiegeln und Pflichtenergie ggf. auf Netz legen —
 * nicht nur Reason-Codes setzen.
 */
export function evaluateReplanWhenForecastCollapses(
	input: UnifiedDayPlannerInput,
	plan: UnifiedDayPlan,
): UnifiedPrincipleVerdict {
	const principleId: UnifiedPrincipleId = "replan_when_forecast_collapses";
	const prev = input.pv.previousExpectedDayEnergyKwh;
	const cur = input.pv.expectedDayEnergyKwh;
	if (prev === null || cur === null || prev <= 0) {
		return {
			principleId,
			passed: true,
			reasonCodes: ["SKIP_NO_FORECAST_REVISION"],
			detailDe: "Keine previousExpectedDayEnergyKwh — Forecast-Kollaps nicht bewertbar.",
		};
	}
	const ratio = cur / prev;
	const collapsed = ratio <= 0.55;
	if (!collapsed) {
		return {
			principleId,
			passed: true,
			reasonCodes: ["SKIP_NO_RELEVANT_COLLAPSE"],
			detailDe: `PV-Revision ${prev.toFixed(1)}→${cur.toFixed(1)} kWh (Ratio ${ratio.toFixed(2)}) — kein relevanter Kollaps.`,
		};
	}

	const planPv = plan.expectedPvEnergyTodayKwh;
	const reflectsRevision =
		planPv !== null && Math.abs(planPv - cur) / Math.max(cur, 0.1) <= 0.25;
	const staleHighPv =
		planPv !== null && planPv > cur * 1.35 && Math.abs(planPv - prev) / prev <= 0.25;

	const dutyNeedKwh = input.thermal?.headroomEnergyKwh ?? 0;
	const dutyOnGrid = sumAllocEnergy(
		plan,
		"immersion_heater",
		(a) => a.energySource === "grid" || a.energySource === "mixed",
	);
	const needsDutyShift = dutyNeedKwh > 0.5;
	const dutyShifted = !needsDutyShift || dutyOnGrid >= Math.min(0.5, dutyNeedKwh * 0.2);

	const failed = staleHighPv || !reflectsRevision || !dutyShifted;
	return {
		principleId,
		passed: !failed,
		reasonCodes: failed
			? [
					...(staleHighPv || !reflectsRevision ? ["PLAN_STALE_AFTER_FORECAST_COLLAPSE"] : []),
					...(!dutyShifted ? ["DUTY_NOT_SHIFTED_AFTER_COLLAPSE"] : []),
				]
			: ["FORECAST_COLLAPSE_HANDLED"],
		detailDe: failed
			? `Forecast-Kollaps ${prev.toFixed(1)}→${cur.toFixed(1)} kWh: Plan-PV=${planPv ?? "null"}, Netz-Pflicht=${dutyOnGrid.toFixed(1)} kWh.`
			: `Plan spiegelt revidierte PV (${planPv?.toFixed(1)} kWh) und verschiebt Pflichtenergie bei Bedarf auf Netz.`,
	};
}

function pvPowerAtSlot(input: UnifiedDayPlannerInput, startIso: string): number {
	for (const s of input.pv.slots) {
		if (s.slot.startIso === startIso) return s.forecastPowerW ?? 0;
	}
	return 0;
}

/**
 * Batterie→Heizstab in Slots **ohne** nennenswerten PV-Forecast, nachdem tagsüber
 * vermeidbar exportiert wurde — ohne Uhrzeit-/Nacht-Hardcode.
 */
export function evaluateNoNightBatteryHeatAfterWastedPv(
	input: UnifiedDayPlannerInput,
	plan: UnifiedDayPlan,
): UnifiedPrincipleVerdict {
	const principleId: UnifiedPrincipleId = "no_night_battery_heat_after_wasted_pv";
	const exportKwh = plan.expectedGridExportEnergyKwh ?? 0;
	const thermalHeadroom = input.thermal?.headroomEnergyKwh ?? 0;
	const zeroPvBatteryHeat = sumAllocEnergy(
		plan,
		"immersion_heater",
		(a) =>
			(a.energySource === "battery" || a.energySource === "mixed") &&
			pvPowerAtSlot(input, a.slot.startIso) < 200,
	);
	const dayPvThermal = sumAllocEnergy(
		plan,
		"immersion_heater",
		(a) => a.energySource === "pv_surplus",
	);

	const emergencyOk = plan.constraints.some(
		(c) => c.id === "thermal.emergency_battery" && c.hard,
	);
	const wastedDayPv =
		exportKwh >= Math.max(1, thermalHeadroom * 0.35) && dayPvThermal < thermalHeadroom * 0.5;
	const failed = !emergencyOk && wastedDayPv && zeroPvBatteryHeat > 0.2;

	return {
		principleId,
		passed: !failed,
		reasonCodes: failed
			? ["BATTERY_HEAT_IN_ZERO_PV_AFTER_WASTED_DAY_PV"]
			: emergencyOk
				? ["THERMAL_EMERGENCY_EXCEPTION"]
				: ["NO_NEEDLESS_ZERO_PV_BATTERY_HEAT"],
		detailDe: failed
			? `Batterie-Heizen ${zeroPvBatteryHeat.toFixed(1)} kWh in PV≈0-Slots nach Tages-Export ${exportKwh.toFixed(1)} kWh (Headroom ${thermalHeadroom.toFixed(1)} kWh).`
			: "Kein unnötiges Batterie-Heizen in PV-armen Slots nach verschwendetem Tages-PV.",
	};
}

const EVALUATORS: Array<
	(input: UnifiedDayPlannerInput, plan: UnifiedDayPlan) => UnifiedPrincipleVerdict
> = [
	evaluatePreallocateForeseeablePv,
	evaluateNoChargeWhileAbsent,
	evaluatePreferPvOverUnnecessaryGrid,
	evaluateReplanWhenForecastCollapses,
	evaluateNoNightBatteryHeatAfterWastedPv,
];

/** Alle Prinzipien — für Gesamtchecks; Golden Tests rufen gezielt einzelne Evaluator auf. */
export function evaluateUnifiedDayPlanPrinciples(
	input: UnifiedDayPlannerInput,
	plan: UnifiedDayPlan,
): UnifiedPrincipleEvaluation {
	const verdicts = EVALUATORS.map((fn) => fn(input, plan));
	return { ok: verdicts.every((v) => v.passed), verdicts };
}
