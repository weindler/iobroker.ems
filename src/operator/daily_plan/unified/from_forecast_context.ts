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
import type { VehiclePresenceLearningStore } from "../../../learning/vehicle_presence";
import {
	buildVehicleAvailabilityWindows,
	type ExplicitPresenceWindow,
} from "./vehicle_availability";
import { isLiveNowTelemetryUsable } from "../live_surplus";

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
	observedPvAgeSec?: number | null;
	observedHouseAgeSec?: number | null;
	/** Klima Runtime-Ist für Hold-Bilanz (kein FSM-Eingriff). */
	acRuntime?: Array<{
		unitIndex: number;
		running: boolean;
		decisionSource?: string | null;
		allocatedPowerW?: number | null;
		estimatedPowerW?: number | null;
	}>;
	contributionRevision?: number | null;
	/** Vorherige PV-Tageserwartung (für Forecast-Replan-Vergleich). */
	previousExpectedDayEnergyKwh?: number | null;
	/** Bereits realisierte PV heute (kWh), falls bekannt. */
	realizedPvKwhToday?: number | null;
	/** Explizite Presence-Fenster (Admin/Intent), schlagen Learning. */
	explicitVehiclePresenceWindows?: ExplicitPresenceWindow[] | null;
	/** Gelerntes Presence-Profil (Wochentag×Bucket×Fahrzeug). */
	vehiclePresenceLearning?: VehiclePresenceLearningStore | null;
	/** Sichere Map-ID für Learning/Prediction; null = kein predicted Learning. */
	vehiclePresenceVehicleKey?: string | null;
	/** Live-Override für connected (EVCC), schlägt Contribution-Detail. */
	connectedNowOverride?: boolean | null;
	/**
	 * Passive Battery-Energiequelle (Self-Consumption vs Manual/Hold/unknown).
	 * Wenn nicht gesetzt → konservativ false.
	 */
	passiveBatteryEnergyAvailable?: boolean | null;
	/** B1: IH-NOW bei stabilem Live-Überschuss bevorzugen. */
	preferImmersionLiveSurplusNow?: boolean | null;
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

	const liveNowUsable = isLiveNowTelemetryUsable({
		pvPowerW: ctx.observedPvPowerW ?? null,
		houseLoadW: ctx.observedHouseLoadPowerW ?? null,
		pvAgeSec: ctx.observedPvAgeSec,
		houseAgeSec: ctx.observedHouseAgeSec,
	});

	const pvSlots = ctx.forecastPlan.slots.map((s) => {
		const power = s.pvPowerW;
		const observed =
			liveNowUsable && currentSlotStart && s.slot.startIso === currentSlotStart
				? (ctx.observedPvPowerW ?? null)
				: null;
		const effective = observed ?? power;
		return {
			slot: s.slot,
			forecastPowerW: power,
			observedPowerW: observed,
			energyKwh: slotEnergyKwh(effective),
		};
	});
	const loadSlots = ctx.forecastPlan.slots.map((s) => {
		const power = s.houseLoadPowerW;
		const observed =
			liveNowUsable && currentSlotStart && s.slot.startIso === currentSlotStart
				? (ctx.observedHouseLoadPowerW ?? null)
				: null;
		const effective = observed ?? power;
		return {
			slot: s.slot,
			forecastPowerW: power,
			observedPowerW: observed,
			energyKwh: slotEnergyKwh(effective),
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

	// --- Battery (Unified Live via bestehende Runtime; Discharge Live unsupported) ---
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

	// --- Wallbox (Unified Live via EVCC-Runtime; Presence: live > explicit > predicted > unknown) ---
	const wallbox = mapWallbox(wbC, wbD, nowIso, slots, currentSlotStart, ctx);

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
	const acRtByUnit = new Map((ctx.acRuntime ?? []).map((r) => [r.unitIndex, r]));
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
		const rt = acRtByUnit.get(u);
		const hardwareRunning = rt?.running === true;
		const allocW = rt?.allocatedPowerW;
		const noNewDemand =
			rt?.decisionSource === "temperature_no_demand" ||
			(allocW != null && Number.isFinite(allocW) && allocW < 50);
		const runtimeHold = hardwareRunning && noNewDemand;
		const holdPowerW =
			rt?.estimatedPowerW ?? typical ?? (allocW != null && allocW > 0 ? allocW : null);
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
			hardwareRunning,
			runtimeHold,
			holdPowerW,
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
			nightReserveKwh: num(batD, "avgNightDischargeKwh"),
			profileId: str(batD, "profileId") ?? str(resD, "profileId"),
			// Produktiv: Discharge Live unsupported (Sonnen EM discharge_unverified) — nie erfinden
			dischargeLiveSupported: false,
			passiveBatteryEnergyAvailable: ctx.passiveBatteryEnergyAvailable === true,
			requiredChargeEnergyKwh: num(batD, "requiredEnergyKwh") ?? num(batD, "socGapEnergyKwh"),
			endSocTargetPct: num(batD, "targetSocPct"),
			chargeDeadlineIso: batCharge?.deadlineIso ?? str(batD, "chargeLogicBridgeUntilIso"),
			gridChargeAllowed:
				bool(batD, "gridImportAllowed") !== false &&
				(batCharge?.gridEligible !== false),
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
					deadlineIso:
						headroom !== null && headroom > 0
							? ih.deadlineIso ?? str(ihD, "estimatedEmptyAt")
							: ih.deadlineIso,
					emptyAtSource: (() => {
						const s = str(ihD, "emptyAtSource");
						if (s === "learned" || s === "estimated") return s;
						const st = str(ihD, "thermalLearningStatus");
						if (st === "valid" && str(ihD, "estimatedEmptyAt")) return "learned";
						if (st === "degraded" && str(ihD, "estimatedEmptyAt")) return "estimated";
						return null;
					})(),
					nightBridgeActive: bool(ihD, "nightBridgeActive") === true,
					coolingRateCPerH: num(ihD, "coolingRateCPerHAvg"),
					minimumRuntimeSec: num(ihD, "minimumRuntimeSec"),
					hysteresisK: num(ihD, "reheatHysteresisK") ?? num(ihD, "temperatureHysteresisK"),
					reheatHysteresisActive: bool(ihD, "reheatHysteresisActive") === true,
					uncertainty: thermalQuality,
					freshness: thermalFresh,
				}
			: null,
		climate: climateUnits.length ? { units: climateUnits, freshness: climateFresh } : null,
		otherFlex: [],
		contributionRevision: ctx.contributionRevision ?? 1,
		globalMode: ctx.globalMode,
		preferImmersionLiveSurplusNow: ctx.preferImmersionLiveSurplusNow === true,
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
 * Fahrzeug-Presence: live (aktueller Slot) > explicit > predicted Learning > unknown.
 * Keine erfundenen Anwesenheitszeiten.
 */
function mapWallbox(
	wbC: PlanContribution | undefined,
	wbD: Record<string, unknown> | null,
	nowIso: string,
	slots: Array<{ startIso: string; endIso: string }>,
	_currentSlotStart: string | undefined,
	ctx: UnifiedForecastContext,
): UnifiedWallboxInput | null {
	if (!wbC && !wbD) {
		return null;
	}
	const connectedNow =
		ctx.connectedNowOverride !== undefined && ctx.connectedNowOverride !== null
			? ctx.connectedNowOverride === true
			: bool(wbD, "connected") === true;
	const explicitFromDetails = parseExplicitWindows(wbD);
	const explicit =
		ctx.explicitVehiclePresenceWindows ??
		explicitFromDetails;

	const presenceWindows = buildVehicleAvailabilityWindows({
		nowIso,
		timezone: ctx.timezone,
		slots,
		connectedNow,
		explicitWindows: explicit,
		learningStore: ctx.vehiclePresenceLearning ?? null,
		learningVehicleKey: ctx.vehiclePresenceVehicleKey ?? null,
		observedAtIso: wbC?.generatedAt ?? nowIso,
	});

	const hasHardFuture = presenceWindows.some(
		(w) =>
			(w.source === "explicit" || w.hard === true) &&
			(w.status ?? (w.available ? "available" : "unavailable")) === "available" &&
			Date.parse(w.endIso) > Date.parse(nowIso),
	);
	const hasPredictedFuture = presenceWindows.some(
		(w) =>
			w.source === "predicted" &&
			(w.status ?? (w.available ? "available" : "unavailable")) === "available",
	);

	const socSourceRaw = str(wbD, "socSource") ?? str(wbD, "vehicleSocSource");
	const socSource =
		socSourceRaw === "direct" ||
		socSourceRaw === "energy_rollforward" ||
		socSourceRaw === "range_estimate" ||
		socSourceRaw === "last_trusted"
			? socSourceRaw
			: num(wbD, "vehicleSocPct") !== null
				? ("direct" as const)
				: ("unknown" as const);
	const vehicleSocPct = num(wbD, "vehicleSocPct");
	const requiredFromSoc =
		vehicleSocPct !== null &&
		num(wbD, "vehicleCapacityKwh") !== null &&
		(num(wbD, "planSocPct") ?? num(wbD, "effectiveLimitSocPct")) !== null
			? (Math.max(
					0,
					(num(wbD, "planSocPct") ?? num(wbD, "effectiveLimitSocPct")!) - vehicleSocPct,
				) /
					100) *
				num(wbD, "vehicleCapacityKwh")!
			: null;
	const requiredEnergyKwh =
		num(wbD, "requiredEnergyKwh") ??
		num(wbD, "remainingEnergyKwh") ??
		(socSource === "unknown" ? null : requiredFromSoc);

	let uncertainty = wbC
		? connectedNow || hasHardFuture || hasPredictedFuture
			? wbC.quality
			: operatorQuality(
					"degraded",
					"Fahrzeug-Presence teilweise unknown — keine Phantom-Ladung.",
					wbC.quality.confidencePct,
				)
		: operatorQuality("missing", "Wallbox-Contribution fehlt.", null);
	if (socSource === "unknown" && requiredEnergyKwh === null) {
		uncertainty = operatorQuality(
			"degraded",
			"Fahrzeug-SOC unknown und kein belastbarer Energiebedarf.",
			uncertainty.confidencePct,
		);
	}

	return {
		connectedNow,
		presenceWindows,
		presenceHardConstraint: true,
		vehicleProfileId: ctx.vehiclePresenceVehicleKey ?? str(wbD, "vehicleProfileId") ?? str(wbD, "evccVehicleId"),
		vehicleSocPct,
		socSource,
		fallbackEnergyNeedKwh: num(wbD, "sessionEnergyKwh"),
		vehicleCapacityKwh: num(wbD, "vehicleCapacityKwh"),
		targetSocPct: num(wbD, "planSocPct") ?? num(wbD, "effectiveLimitSocPct"),
		requiredEnergyKwh,
		deadlineIso: wbC?.deadlineIso ?? str(wbD, "deadlineIso") ?? str(wbD, "effectivePlanTime"),
		// Hartes Ziel nur mit belastbarer Presence (explicit/live-Zukunft oder predicted)
		energyGoalHard: connectedNow || hasHardFuture || hasPredictedFuture,
		minChargePowerW: num(wbD, "minChargePowerW"),
		maxChargePowerW: num(wbD, "maxChargePowerW") ?? num(wbD, "vehicleMaxAcChargePowerW"),
		chargeLossFactor: num(wbD, "chargeLossFactor"),
		evccExecutionMaster: true,
		uncertainty,
		freshness: freshnessFrom(
			Date.parse(nowIso),
			wbC?.generatedAt ?? nowIso,
			wbC?.quality ?? operatorQuality("missing", "wb", null),
		),
	};
}

function parseExplicitWindows(
	wbD: Record<string, unknown> | null,
): ExplicitPresenceWindow[] | null {
	if (!wbD) return null;
	const raw = wbD.explicitPresenceWindows ?? wbD.presenceWindowsExplicit;
	if (!Array.isArray(raw)) return null;
	const out: ExplicitPresenceWindow[] = [];
	for (const item of raw) {
		if (!item || typeof item !== "object") continue;
		const o = item as Record<string, unknown>;
		const startIso = typeof o.startIso === "string" ? o.startIso : null;
		const endIso = typeof o.endIso === "string" ? o.endIso : null;
		const available = typeof o.available === "boolean" ? o.available : null;
		if (!startIso || !endIso || available === null) continue;
		out.push({ available, startIso, endIso });
	}
	return out.length ? out : null;
}

/** Kurzsummary für Daily-Plan reason_de (keine neuen States). */
export function summarizeUnifiedDayPlanForReason(plan: {
	planId: string;
	inputRevision: number;
	expectedPvEnergyTodayKwh: number | null;
	expectedHouseLoadEnergyTodayKwh: number | null;
	expectedPvEnergyHorizonKwh?: number | null;
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
	const horizonPv =
		plan.expectedPvEnergyHorizonKwh !== undefined && plan.expectedPvEnergyHorizonKwh !== null
			? ` PV_H=${plan.expectedPvEnergyHorizonKwh}kWh`
			: "";
	return (
		`Unified ${plan.planId} rev=${plan.inputRevision}: ` +
		`PV_today=${plan.expectedPvEnergyTodayKwh ?? "?"}kWh Load_today=${plan.expectedHouseLoadEnergyTodayKwh ?? "?"}kWh` +
		`${horizonPv} ` +
		`Imp=${plan.expectedGridImportEnergyKwh ?? "?"} Exp=${plan.expectedGridExportEnergyKwh ?? "?"} ` +
		`Cost=${plan.expectedCostCt ?? "?"}ct ${vehicleTxt}`
	).slice(0, 320);
}

/** Nur für Typ-Hinweise / Tests — Contributions unverändert lassen. */
export type ForecastContributionSlice = PlanContribution;
