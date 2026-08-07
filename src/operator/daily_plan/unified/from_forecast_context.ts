/**
 * Real Data Bridge: ForecastPlan (+ Contribution-Details + Live-Overrides)
 * → UnifiedDayPlannerInput.
 *
 * PV im ForecastPlan ist bereits bias-korrigiert (learning.pv_bias → Contribution).
 * Keine zweite Bias-Korrektur hier. Keine Geräte-Writes.
 *
 * Wallbox/Battery: Planung/Simulation — kein Unified-Live-Takeover.
 */

import type { ForecastPlan } from "../../forecast/types";
import type { OperatorDataQuality, PlanContribution } from "../../types";
import { CONTRIBUTION_IDS } from "../../contribution_ids";
import { operatorQuality } from "../../quality";
import { estimateImmersionRequiredEnergyKwh } from "../../contributions/flexible/flex_demand";
import type {
	UnifiedClimateUnitInput,
	UnifiedDataFreshness,
	UnifiedDayPlannerInput,
	UnifiedWallboxInput,
} from "./types";
import { AC_UNIT_COUNT } from "../../../addons/air_conditioning/constants";

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

function bool(d: Record<string, unknown> | null | undefined, key: string): boolean | null {
	if (!d) return null;
	const v = d[key];
	return typeof v === "boolean" ? v : null;
}

function qualityOf(c: PlanContribution | undefined, fallbackReason: string): OperatorDataQuality {
	if (!c) return operatorQuality("missing", fallbackReason, null);
	return c.quality;
}

function freshnessFrom(
	nowMs: number,
	observedAtIso: string | null,
	quality: OperatorDataQuality,
): UnifiedDataFreshness {
	if (!observedAtIso) {
		return { observedAtIso: null, ageSec: null, quality };
	}
	const t = Date.parse(observedAtIso);
	if (!Number.isFinite(t)) {
		return { observedAtIso, ageSec: null, quality };
	}
	return {
		observedAtIso,
		ageSec: Math.max(0, Math.round((nowMs - t) / 1000)),
		quality,
	};
}

function slotEnergyKwh(powerW: number | null): number | null {
	if (powerW === null) return null;
	return (powerW / 1000) * 0.25;
}

function biasPctFromRawCorrected(raw: number | null, corrected: number | null): number | null {
	if (raw === null || corrected === null || !(raw > 0)) return null;
	return Math.round(((corrected - raw) / raw) * 1000) / 10;
}

export type UnifiedForecastContext = {
	now: Date;
	timezone: string;
	globalMode: string;
	forecastPlan: Pick<ForecastPlan, "slots" | "days" | "contributions">;
	/** Live/Telemetrie-Overrides — null = aus Contribution-Details. */
	bufferTempC?: number | null;
	bufferTempObservedAtIso?: string | null;
	batterySocPct?: number | null;
	batteryCapacityKwh?: number | null;
	batterySocObservedAtIso?: string | null;
	batteryMaxChargePowerW?: number | null;
	batteryMaxDischargePowerW?: number | null;
	batteryMinSocPct?: number | null;
	batteryMaxSocPct?: number | null;
	roomTemps?: Partial<Record<number, number | null>>;
	/** Ist-Werte für aktuellen Slot (Replanning); null = unbekannt. */
	observedPvPowerW?: number | null;
	observedHouseLoadPowerW?: number | null;
	contributionRevision?: number | null;
	/** Vorherige PV-Tageserwartung (für Forecast-Replan-Vergleich). */
	previousExpectedDayEnergyKwh?: number | null;
	/** Bereits realisierte PV heute (kWh), falls bekannt. */
	realizedPvKwhToday?: number | null;
};

/**
 * Baut UnifiedDayPlannerInput aus dem bestehenden ForecastPlan-Snapshot.
 * Keine parallelen 30-State-Reads — Contributions + optionale Live-Overrides.
 */
export function buildUnifiedInputFromForecastContext(ctx: UnifiedForecastContext): UnifiedDayPlannerInput {
	const nowMs = ctx.now.getTime();
	const nowIso = ctx.now.toISOString();
	const slots = ctx.forecastPlan.slots.map((s) => s.slot);
	const contribById = new Map(ctx.forecastPlan.contributions.map((c) => [c.contributionId, c]));

	const pvC = contribById.get(CONTRIBUTION_IDS.PV_SUPPLY);
	const loadC = contribById.get(CONTRIBUTION_IDS.HOUSE_LOAD_FIXED);
	const gridC = contribById.get(CONTRIBUTION_IDS.GRID_SUPPLY);
	const batCharge = contribById.get(CONTRIBUTION_IDS.BATTERY_CHARGE);
	const batReserve = contribById.get(CONTRIBUTION_IDS.BATTERY_RESERVE);
	const batDischarge = contribById.get(CONTRIBUTION_IDS.BATTERY_DISCHARGE);
	const wbC = contribById.get(CONTRIBUTION_IDS.WALLBOX_EV_SESSION);
	const ih =
		contribById.get(CONTRIBUTION_IDS.IMMERSION_FLEXIBLE) ??
		contribById.get(CONTRIBUTION_IDS.IMMERSION_MANDATORY);
	const ihD = (ih?.details ?? null) as Record<string, unknown> | null;
	const pvD = (pvC?.details ?? null) as Record<string, unknown> | null;
	const loadD = (loadC?.details ?? null) as Record<string, unknown> | null;
	const batD = (batCharge?.details ?? null) as Record<string, unknown> | null;
	const resD = (batReserve?.details ?? null) as Record<string, unknown> | null;
	const wbD = (wbC?.details ?? null) as Record<string, unknown> | null;

	const day0 = ctx.forecastPlan.days[0];
	const currentSlotStart = slots.find((s) => {
		const a = Date.parse(s.startIso);
		const b = Date.parse(s.endIso);
		return Number.isFinite(a) && Number.isFinite(b) && nowMs >= a && nowMs < b;
	})?.startIso;

	const pvSlots = ctx.forecastPlan.slots.map((s) => {
		const power = s.pvPowerW;
		const observed =
			currentSlotStart && s.slot.startIso === currentSlotStart
				? (ctx.observedPvPowerW ?? null)
				: null;
		return {
			slot: s.slot,
			forecastPowerW: power,
			observedPowerW: observed,
			energyKwh: slotEnergyKwh(power),
		};
	});
	const loadSlots = ctx.forecastPlan.slots.map((s) => {
		const power = s.houseLoadPowerW;
		const observed =
			currentSlotStart && s.slot.startIso === currentSlotStart
				? (ctx.observedHouseLoadPowerW ?? null)
				: null;
		return {
			slot: s.slot,
			forecastPowerW: power,
			observedPowerW: observed,
			energyKwh: slotEnergyKwh(power),
		};
	});
	const priceSlots = ctx.forecastPlan.slots.map((s) => ({
		slot: s.slot,
		importCtPerKwh: s.gridPriceCtPerKwh,
		exportCtPerKwh: null as number | null, // keine produktive Exporttarif-Quelle
		gridImportAllowed: s.gridImportAllowed,
	}));

	const rawToday = num(pvD, "rawTodayKwh");
	const correctedToday = num(pvD, "correctedTodayKwh") ?? day0?.pvEnergyKwh ?? null;
	const biasPct = biasPctFromRawCorrected(rawToday, correctedToday);
	const pvLastUpdate = str(pvD, "lastUpdateTs");
	const pvQuality = qualityOf(pvC, "PV-Prognose fehlt.");
	const pvFresh = freshnessFrom(nowMs, pvLastUpdate ?? pvC?.generatedAt ?? null, pvQuality);

	const loadLastUpdate = str(loadD, "lastUpdate") ?? loadC?.generatedAt ?? null;
	const loadQuality = qualityOf(loadC, "Hauslast-Prognose fehlt.");
	const loadFresh = freshnessFrom(nowMs, loadLastUpdate, loadQuality);

	const priceQuality = qualityOf(gridC, "Netzpreis-Prognose fehlt.");
	const priceFresh = freshnessFrom(nowMs, gridC?.generatedAt ?? null, priceQuality);

	const timeQuality = mergeWorstQuality([pvQuality, loadQuality, priceQuality]);
	const timeFresh = freshnessFrom(nowMs, nowIso, timeQuality);

	// --- Battery (Simulation only) ---
	const socPct =
		ctx.batterySocPct !== undefined && ctx.batterySocPct !== null
			? ctx.batterySocPct
			: num(batD, "socPct");
	const usableCapacityKwh =
		ctx.batteryCapacityKwh !== undefined && ctx.batteryCapacityKwh !== null
			? ctx.batteryCapacityKwh
			: num(batD, "capacityEffectiveKwh") ?? num(batD, "usableCapacityKwh");
	const maxChargePowerW =
		ctx.batteryMaxChargePowerW ?? num(batD, "maxChargePowerW");
	const maxDischargePowerW =
		ctx.batteryMaxDischargePowerW ??
		(batDischarge?.enabled ? num(batDischarge.details as Record<string, unknown>, "maxDischargePowerW") : null);
	const minSocPct = ctx.batteryMinSocPct ?? num(resD, "minSocPct");
	const maxSocPct = ctx.batteryMaxSocPct ?? num(resD, "maxSocPct");
	const batFault = bool(resD, "fault") === true || bool(batD, "fault") === true;
	const batLockout = bool(resD, "lockout") === true || bool(batD, "lockout") === true;
	let batQuality = qualityOf(batCharge ?? batReserve, "Batterie-Telemetrie fehlt.");
	if (socPct === null || usableCapacityKwh === null) {
		batQuality = operatorQuality("missing", "Batterie SOC oder Kapazität unbekannt.", batQuality.confidencePct);
	} else if (batFault || batLockout) {
		batQuality = operatorQuality("blocked", "Batterie Fault/Lockout — keine Flex-Annahme.", batQuality.confidencePct);
	} else if (batCharge && batCharge.quality.status !== "valid") {
		batQuality = batCharge.quality;
	}
	const batFresh = freshnessFrom(
		nowMs,
		ctx.batterySocObservedAtIso ?? batCharge?.generatedAt ?? null,
		batQuality,
	);
	const allowedModes: string[] = ["idle"];
	if (!batFault && !batLockout && (batCharge?.enabled !== false)) {
		allowedModes.unshift("charge");
	}
	// discharge: nur wenn Contribution nicht unsupported
	if (batDischarge && batDischarge.quality.status !== "unsupported" && batDischarge.enabled) {
		allowedModes.push("discharge");
	}

	// --- Wallbox (Simulation; Presence future = unknown) ---
	const wallbox = mapWallbox(wbC, wbD, nowIso, slots, currentSlotStart);

	// --- Thermal ---
	const bufferTempC = ctx.bufferTempC !== undefined ? ctx.bufferTempC : num(ihD, "bufferTempC");
	const targetTempC = num(ihD, "targetTempC");
	const maxPowerW = num(ihD, "maxPowerW");
	const minPowerW = num(ihD, "minPowerW");
	const ihEnabled = ih?.enabled === true;
	const ihBlocked =
		ih?.quality.status === "blocked" ||
		ih?.quality.status === "unsupported" ||
		ih?.quality.status === "disabled";
	// Headroom: bevorzugt Contribution (`requiredEnergyKwh` aus flex_demand/Learning).
	// Keine eigene 0.38-Formel in der Bridge — bei fehlendem Beitrag fallback auf
	// dieselbe Schätzfunktion wie die Contribution, sonst null (unknown).
	let headroom: number | null = null;
	if (!ih || !ihEnabled || ihBlocked) {
		headroom = ih ? 0 : null;
	} else {
		const fromContrib = num(ihD, "requiredEnergyKwh");
		if (fromContrib !== null) {
			headroom = fromContrib;
		} else if (bufferTempC !== null && targetTempC !== null) {
			const learningStatus = str(ihD, "thermalLearningStatus");
			headroom = estimateImmersionRequiredEnergyKwh(bufferTempC, targetTempC, maxPowerW, {
				status:
					learningStatus === "valid" || learningStatus === "degraded" || learningStatus === "missing"
						? learningStatus
						: "missing",
				coolingRateCPerHAvg: num(ihD, "coolingRateCPerHAvg"),
			});
		} else {
			headroom = null;
		}
	}
	const thermalQuality = ih
		? ihBlocked
			? operatorQuality("blocked", "Heizstab Safety/Fault — kein Flex-Headroom.", ih.quality.confidencePct)
			: ih.quality
		: operatorQuality("missing", "Heizstab-Contribution fehlt.", null);
	const thermalFresh = freshnessFrom(
		nowMs,
		ctx.bufferTempObservedAtIso ?? ih?.generatedAt ?? null,
		thermalQuality,
	);

	// --- Climate ---
	const climateUnits: UnifiedClimateUnitInput[] = [];
	for (let u = 1; u <= AC_UNIT_COUNT; u++) {
		const c = contribById.get(CONTRIBUTION_IDS.AC_UNIT(u));
		if (!c || !c.enabled) continue;
		const d = c.details as Record<string, unknown>;
		const room = ctx.roomTemps?.[u] ?? num(d, "roomTempC");
		const comfortMax = num(d, "offTempC") ?? num(d, "comfortMaxC") ?? num(d, "onTempC");
		const onTemp = num(d, "onTempC") ?? comfortMax;
		const typical = num(d, "estimatedPowerW") ?? num(d, "typicalPowerW") ?? num(d, "expectedPeakW");
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
			expectedEnergyKwh: expected,
			typicalPowerW: typical,
			maxShiftHours: overComfort ? 0 : 3,
			uncertainty: c.quality,
		});
	}
	const climateFresh = freshnessFrom(
		nowMs,
		nowIso,
		climateUnits[0]?.uncertainty ?? operatorQuality("missing", "Keine Klima-Units.", null),
	);

	const horizonStart = slots[0]?.startIso ?? nowIso;
	const horizonEnd = slots[slots.length - 1]?.endIso ?? nowIso;

	return {
		schemaVersion: 1,
		planIntent: "unified_day",
		time: {
			nowIso,
			timezone: ctx.timezone,
			horizonStartIso: horizonStart,
			horizonEndIso: horizonEnd,
			slotMinutes: 15,
			slots,
			freshness: timeFresh,
		},
		pv: {
			slots: pvSlots,
			expectedDayEnergyKwh: correctedToday,
			previousExpectedDayEnergyKwh: ctx.previousExpectedDayEnergyKwh ?? null,
			// ForecastPlan-Slots / Day-Energy stammen aus korrigierten Tages-kWh (pv_bias).
			biasCorrected: true,
			biasPct,
			uncertainty: pvQuality,
			freshness: pvFresh,
		},
		prices: {
			slots: priceSlots,
			uncertainty: priceQuality,
			freshness: priceFresh,
		},
		houseLoad: {
			slots: loadSlots,
			expectedDayEnergyKwh: day0?.houseLoadEnergyKwh ?? null,
			uncertainty: loadQuality,
			freshness: loadFresh,
		},
		battery: {
			socPct,
			usableCapacityKwh,
			minSocPct,
			maxSocPct,
			maxChargePowerW,
			maxDischargePowerW,
			chargeEfficiency: null, // nicht produktiv modelliert → unknown
			dischargeEfficiency: null,
			allowedModes,
			reserveSocPct: minSocPct,
			uncertainty: batQuality,
			freshness: batFresh,
		},
		wallbox,
		thermal: ih
			? {
					bufferTempC,
					minTempC: num(ihD, "mandatoryMinTempC") ?? num(ihD, "planningMinTempC"),
					maxTempC: num(ihD, "planningMaxTempC"),
					dayTargetTempC: targetTempC,
					availablePowerW: maxPowerW,
					minPowerW: minPowerW,
					headroomEnergyKwh: headroom,
					estimatedEmptyAtIso: str(ihD, "estimatedEmptyAt"),
					coolingRateCPerH: num(ihD, "coolingRateCPerHAvg"),
					minimumRuntimeSec: num(ihD, "minimumRuntimeSec"),
					hysteresisK: num(ihD, "reheatHysteresisK") ?? num(ihD, "temperatureHysteresisK"),
					uncertainty: thermalQuality,
					freshness: thermalFresh,
				}
			: null,
		climate: climateUnits.length ? { units: climateUnits, freshness: climateFresh } : null,
		otherFlex: [],
		contributionRevision: ctx.contributionRevision ?? 1,
		globalMode: ctx.globalMode,
	};
}

function mergeWorstQuality(list: OperatorDataQuality[]): OperatorDataQuality {
	const rank: Record<string, number> = {
		invalid: 7,
		unsupported: 6,
		blocked: 5,
		missing: 4,
		disabled: 3,
		degraded: 2,
		valid: 1,
	};
	let best = list[0] ?? operatorQuality("missing", "keine Daten", null);
	for (const q of list.slice(1)) {
		if ((rank[q.status] ?? 0) > (rank[best.status] ?? 0)) best = q;
	}
	return best;
}

/**
 * Fahrzeug: connectedNow ≠ zukünftige Presence.
 * Nur der aktuelle Slot gilt als available, wenn jetzt verbunden —
 * keine erfundene Anwesenheitsprognose.
 */
function mapWallbox(
	wbC: PlanContribution | undefined,
	wbD: Record<string, unknown> | null,
	nowIso: string,
	slots: Array<{ startIso: string; endIso: string }>,
	currentSlotStart: string | undefined,
): UnifiedWallboxInput | null {
	if (!wbC && !wbD) {
		// Contribution fehlt komplett → unknown wallbox (nicht null-erzwingen wenn nie konfiguriert)
		return null;
	}
	const connectedNow = bool(wbD, "connected") === true;
	const currentSlot = slots.find((s) => s.startIso === currentSlotStart) ?? null;
	const presenceWindows =
		connectedNow && currentSlot
			? [{ available: true, startIso: currentSlot.startIso, endIso: currentSlot.endIso }]
			: [];

	return {
		connectedNow,
		presenceWindows,
		presenceHardConstraint: true,
		vehicleSocPct: num(wbD, "vehicleSocPct"),
		fallbackEnergyNeedKwh: num(wbD, "sessionEnergyKwh"),
		vehicleCapacityKwh: num(wbD, "vehicleCapacityKwh"),
		targetSocPct: num(wbD, "planSocPct") ?? num(wbD, "effectiveLimitSocPct"),
		requiredEnergyKwh: num(wbD, "requiredEnergyKwh") ?? num(wbD, "remainingEnergyKwh"),
		deadlineIso: wbC?.deadlineIso ?? null,
		energyGoalHard: false, // ohne belastbare Presence-Prognose kein hartes Zukunftsziel
		minChargePowerW: null,
		maxChargePowerW: num(wbD, "maxChargePowerW"),
		chargeLossFactor: null,
		evccExecutionMaster: true,
		uncertainty: wbC
			? connectedNow
				? wbC.quality
				: operatorQuality(
						"disabled",
						"Fahrzeug nicht verbunden — zukünftige Presence unknown.",
						wbC.quality.confidencePct,
					)
			: operatorQuality("missing", "Wallbox-Contribution fehlt.", null),
		freshness: freshnessFrom(Date.parse(nowIso), wbC?.generatedAt ?? nowIso, wbC?.quality ?? operatorQuality("missing", "wb", null)),
	};
}

/** Kurzsummary für Daily-Plan reason_de (keine neuen States). */
export function summarizeUnifiedDayPlanForReason(plan: {
	planId: string;
	inputRevision: number;
	expectedPvEnergyKwh: number | null;
	expectedHouseLoadEnergyKwh: number | null;
	expectedGridImportEnergyKwh: number | null;
	expectedGridExportEnergyKwh: number | null;
	expectedCostCt: number | null;
	goalStatuses: Array<{ consumerId: string; goalId: string; met: boolean | null }>;
	reasonCodes: string[];
}): string {
	const vehicle = plan.goalStatuses.find((g) => g.consumerId === "wallbox");
	const vehicleTxt = vehicle
		? vehicle.met === true
			? "EV-Ziel ok"
			: "EV-Ziel offen/unknown"
		: "EV n/a";
	return (
		`Unified ${plan.planId} rev=${plan.inputRevision}: ` +
		`PV=${plan.expectedPvEnergyKwh ?? "?"}kWh Load=${plan.expectedHouseLoadEnergyKwh ?? "?"}kWh ` +
		`Imp=${plan.expectedGridImportEnergyKwh ?? "?"} Exp=${plan.expectedGridExportEnergyKwh ?? "?"} ` +
		`Cost=${plan.expectedCostCt ?? "?"}ct ${vehicleTxt}`
	).slice(0, 320);
}

/** Nur für Typ-Hinweise / Tests — Contributions unverändert lassen. */
export type ForecastContributionSlice = PlanContribution;
