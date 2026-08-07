/**
 * Baut einen UnifiedDayPlannerInput aus ForecastPlan-Slots + Contribution-Details.
 * Keine Geräte-Writes. Wallbox bleibt null (kein Unified-Live-Takeover).
 */

import type { ForecastPlan } from "../../forecast/types";
import type { PlanContribution } from "../../types";
import { CONTRIBUTION_IDS } from "../../contribution_ids";
import { operatorQuality } from "../../quality";
import type { UnifiedClimateUnitInput, UnifiedDayPlannerInput } from "./types";
import { AC_UNIT_COUNT } from "../../../addons/air_conditioning/constants";

const Q = operatorQuality("valid", "from forecast context", 80);

function num(d: Record<string, unknown> | null | undefined, key: string): number | null {
	if (!d) return null;
	const v = d[key];
	return typeof v === "number" && Number.isFinite(v) ? v : null;
}

function str(d: Record<string, unknown> | null | undefined, key: string): string | null {
	if (!d) return null;
	const v = d[key];
	return typeof v === "string" && v.trim() ? v : null;
}

export type UnifiedForecastContext = {
	now: Date;
	timezone: string;
	globalMode: string;
	forecastPlan: Pick<ForecastPlan, "slots" | "days" | "contributions">;
	/** Live/Telemetrie-Overrides — null = aus Contribution-Details. */
	bufferTempC?: number | null;
	batterySocPct?: number | null;
	batteryCapacityKwh?: number | null;
	roomTemps?: Partial<Record<number, number | null>>;
};

export function buildUnifiedInputFromForecastContext(ctx: UnifiedForecastContext): UnifiedDayPlannerInput {
	const slots = ctx.forecastPlan.slots.map((s) => s.slot);
	const contribById = new Map(ctx.forecastPlan.contributions.map((c) => [c.contributionId, c]));
	const ih =
		contribById.get(CONTRIBUTION_IDS.IMMERSION_FLEXIBLE) ??
		contribById.get(CONTRIBUTION_IDS.IMMERSION_MANDATORY);
	const ihD = (ih?.details ?? null) as Record<string, unknown> | null;

	const day0 = ctx.forecastPlan.days[0];
	const pvSlots = ctx.forecastPlan.slots.map((s) => ({
		slot: s.slot,
		forecastPowerW: s.pvPowerW,
		observedPowerW: null,
		energyKwh: s.pvPowerW !== null ? (s.pvPowerW / 1000) * 0.25 : null,
	}));
	const loadSlots = ctx.forecastPlan.slots.map((s) => ({
		slot: s.slot,
		forecastPowerW: s.houseLoadPowerW,
		observedPowerW: null,
		energyKwh: s.houseLoadPowerW !== null ? (s.houseLoadPowerW / 1000) * 0.25 : null,
	}));
	const priceSlots = ctx.forecastPlan.slots.map((s) => ({
		slot: s.slot,
		importCtPerKwh: s.gridPriceCtPerKwh,
		exportCtPerKwh: null as number | null,
		gridImportAllowed: s.gridImportAllowed,
	}));

	const bufferTempC = ctx.bufferTempC ?? num(ihD, "bufferTempC");
	const targetTempC = num(ihD, "targetTempC");
	const maxPowerW = num(ihD, "maxPowerW");
	const minPowerW = num(ihD, "minPowerW");
	const headroom =
		bufferTempC !== null && targetTempC !== null && targetTempC > bufferTempC
			? (targetTempC - bufferTempC) * 0.38
			: num(ihD, "requiredEnergyKwh");

	const climateUnits: UnifiedClimateUnitInput[] = [];
	for (let u = 1; u <= AC_UNIT_COUNT; u++) {
		const c = contribById.get(CONTRIBUTION_IDS.AC_UNIT(u));
		if (!c || !c.enabled) continue;
		const d = c.details as Record<string, unknown>;
		const room = ctx.roomTemps?.[u] ?? num(d, "roomTempC");
		const comfortMax = num(d, "offTempC") ?? num(d, "comfortMaxC") ?? num(d, "onTempC");
		const onTemp = num(d, "onTempC") ?? comfortMax;
		const typical = num(d, "estimatedPowerW") ?? num(d, "typicalPowerW") ?? 900;
		const expected = num(d, "expectedKwhToday") ?? num(d, "expectedEnergyKwh");
		const overComfort = room !== null && onTemp !== null && room >= onTemp;
		climateUnits.push({
			unitId: CONTRIBUTION_IDS.AC_UNIT(u),
			label: str(d, "name") ?? `unit_${u}`,
			roomTempC: room,
			comfortMinC: null,
			comfortMaxC: comfortMax,
			targetTempC: onTemp,
			mandatoryComfort: overComfort,
			expectedEnergyKwh: expected ?? (overComfort ? typical / 1000 : null),
			typicalPowerW: typical,
			maxShiftHours: overComfort ? 0 : 3,
			uncertainty: c.quality,
		});
	}

	const horizonStart = slots[0]?.startIso ?? ctx.now.toISOString();
	const horizonEnd = slots[slots.length - 1]?.endIso ?? ctx.now.toISOString();

	return {
		schemaVersion: 1,
		planIntent: "unified_day",
		time: {
			nowIso: ctx.now.toISOString(),
			timezone: ctx.timezone,
			horizonStartIso: horizonStart,
			horizonEndIso: horizonEnd,
			slotMinutes: 15,
			slots,
			freshness: { observedAtIso: ctx.now.toISOString(), ageSec: 0, quality: Q },
		},
		pv: {
			slots: pvSlots,
			expectedDayEnergyKwh: day0?.pvEnergyKwh ?? null,
			previousExpectedDayEnergyKwh: null,
			biasCorrected: true,
			biasPct: null,
			uncertainty: Q,
			freshness: { observedAtIso: ctx.now.toISOString(), ageSec: 0, quality: Q },
		},
		prices: {
			slots: priceSlots,
			uncertainty: Q,
			freshness: { observedAtIso: ctx.now.toISOString(), ageSec: 0, quality: Q },
		},
		houseLoad: {
			slots: loadSlots,
			expectedDayEnergyKwh: day0?.houseLoadEnergyKwh ?? null,
			uncertainty: Q,
			freshness: { observedAtIso: ctx.now.toISOString(), ageSec: 0, quality: Q },
		},
		battery: {
			socPct: ctx.batterySocPct ?? 50,
			usableCapacityKwh: ctx.batteryCapacityKwh ?? 10,
			minSocPct: 10,
			maxSocPct: 100,
			maxChargePowerW: 5000,
			maxDischargePowerW: 5000,
			chargeEfficiency: 0.95,
			dischargeEfficiency: 0.95,
			allowedModes: ["charge", "idle"],
			reserveSocPct: 20,
			uncertainty: Q,
			freshness: { observedAtIso: ctx.now.toISOString(), ageSec: 0, quality: Q },
		},
		wallbox: null,
		thermal: ih
			? {
					bufferTempC,
					minTempC: num(ihD, "mandatoryMinTempC") ?? num(ihD, "planningMinTempC") ?? 44,
					maxTempC: num(ihD, "planningMaxTempC") ?? 63,
					dayTargetTempC: targetTempC,
					availablePowerW: maxPowerW ?? 1700,
					minPowerW: minPowerW ?? 1700,
					headroomEnergyKwh: headroom,
					estimatedEmptyAtIso: str(ihD, "estimatedEmptyAt"),
					coolingRateCPerH: num(ihD, "coolingRateCPerHAvg"),
					minimumRuntimeSec: num(ihD, "minimumRuntimeSec"),
					hysteresisK: num(ihD, "reheatHysteresisK"),
					uncertainty: ih.quality,
					freshness: { observedAtIso: ctx.now.toISOString(), ageSec: 0, quality: ih.quality },
				}
			: null,
		climate: climateUnits.length
			? { units: climateUnits, freshness: { observedAtIso: ctx.now.toISOString(), ageSec: 0, quality: Q } }
			: null,
		otherFlex: [],
		contributionRevision: 1,
		globalMode: ctx.globalMode,
	};
}

/** Nur für Typ-Hinweise / Tests — Contributions unverändert lassen. */
export type ForecastContributionSlice = PlanContribution;
