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
import { minutesUntilHardOff } from "../../../addons/air_conditioning/runtime/hard_off_worth_it";
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
import {
	evManagementFromWallbox,
	parseExternalReservations,
	resolveEvEnergyClasses,
} from "./ev_energy";
import { isLiveNowTelemetryUsable } from "../live_surplus";
import { effectiveCoolingRateCPerH } from "../../contributions/flexible/thermal_cooling_rate";
import { resolveWallboxBatteryHold } from "../../../addons/wallbox/charge_hold";
import { OPERATOR_MS_PER_15MIN } from "../../time";

type SlotWindow = { startIso: string; endIso: string };

/**
 * Aktueller 15-Min-Slot für Live-PV: now im Fenster und exakt 900000 ms Dauer.
 * Mehrstunden-Segmente (Hauslast/Wetter) werden bewusst ausgeschlossen.
 */
export function findCurrentFifteenMinuteSlot(
	slots: SlotWindow[],
	nowMs: number,
): SlotWindow | null {
	for (const s of slots) {
		const start = Date.parse(s.startIso);
		const end = Date.parse(s.endIso);
		if (!Number.isFinite(start) || !Number.isFinite(end)) continue;
		if (end - start !== OPERATOR_MS_PER_15MIN) continue;
		if (nowMs >= start && nowMs < end) return s;
	}
	return null;
}

/**
 * Aktuelles Hauslast-Fenster: now im Slot und Slot trägt Hauslast-Leistung.
 * Segment-Auflösung bleibt unverändert (Mehrstunden ok); kein smearing per startIso.
 */
export function findCurrentHouseLoadSlot(
	slots: Array<{ slot: SlotWindow; houseLoadPowerW: number | null }>,
	nowMs: number,
): SlotWindow | null {
	for (const s of slots) {
		if (s.houseLoadPowerW == null) continue;
		const start = Date.parse(s.slot.startIso);
		const end = Date.parse(s.slot.endIso);
		if (!Number.isFinite(start) || !Number.isFinite(end)) continue;
		if (nowMs >= start && nowMs < end) return s.slot;
	}
	return null;
}

function slotWindowsEqual(a: SlotWindow, b: SlotWindow): boolean {
	return a.startIso === b.startIso && a.endIso === b.endIso;
}

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

function sanitizeDisallowedSlotIsos(raw: string[] | null | undefined): string[] | undefined {
	if (!Array.isArray(raw) || raw.length === 0) return undefined;
	const out: string[] = [];
	const seen = new Set<string>();
	for (const iso of raw) {
		if (typeof iso !== "string" || !iso) continue;
		if (seen.has(iso)) continue;
		seen.add(iso);
		out.push(iso);
	}
	return out.length > 0 ? out : undefined;
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
	/** Soft-IH im angebrochenen Slot fortsetzen (Anti-Relais-Takten). */
	continueImmersionSoftCurrentSlot?: boolean | null;
	/**
	 * Compare-akzeptierte Soft-IH-Sperr-ISOs (retained Prefs, Gewicht 0).
	 * Leer/fehlt = kein Einfluss.
	 */
	immersionSoftDisallowedSlotIsos?: string[] | null;
	/**
	 * Boiler-emptyAt aus Learning-State — falls Contribution den Wert noch nicht hat
	 * (Race: Plan vor Contribution-Refresh).
	 */
	boilerEstimatedEmptyAtOverride?: string | null;
	/**
	 * Einspeisevergütung aus `economics.config.feed_in_ct_per_kwh` (ct/kWh).
	 * null/ungültig → exportCtPerKwh bleibt null (Scorer-Fallback 6 ct).
	 */
	feedInCtPerKwh?: number | null;
	/**
	 * BLOCK B (Learned Planner, additiv/optional): tatsächliche Block-A-Metrik
	 * `thermalPriceTimingScore` aus `learning/daily_evaluator/learning_state_v1.json`
	 * (Read-Only-Bridge, siehe `../block_a_learning_bridge.ts`). `undefined`/`null` = kein
	 * Learning verfügbar → exakt bisheriges Verhalten (siehe `thermal_opportunity_gate.ts`).
	 */
	thermalLearnedPriceTimingScore?: {
		value: number | null;
		sampleCount: number | null;
		confidencePct: number | null;
	} | null;
};

/** ct/kWh → Planner; ungültig/negativ → null (kein NaN in Allocation). */
export function normalizeFeedInCtPerKwh(raw: unknown): number | null {
	if (typeof raw !== "number" || !Number.isFinite(raw) || raw < 0) return null;
	return raw;
}

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
	const liveNowUsable = isLiveNowTelemetryUsable({
		pvPowerW: ctx.observedPvPowerW ?? null,
		houseLoadW: ctx.observedHouseLoadPowerW ?? null,
		pvAgeSec: ctx.observedPvAgeSec,
		houseAgeSec: ctx.observedHouseAgeSec,
	});
	const currentPvSlot = liveNowUsable ? findCurrentFifteenMinuteSlot(slots, nowMs) : null;
	const currentHouseLoadSlot = liveNowUsable
		? findCurrentHouseLoadSlot(ctx.forecastPlan.slots, nowMs)
		: null;

	const pvSlots = ctx.forecastPlan.slots.map((s) => {
		const power = s.pvPowerW;
		const observed =
			liveNowUsable && currentPvSlot && slotWindowsEqual(s.slot, currentPvSlot)
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
			liveNowUsable &&
			currentHouseLoadSlot &&
			slotWindowsEqual(s.slot, currentHouseLoadSlot)
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
	const exportCtPerKwh = normalizeFeedInCtPerKwh(ctx.feedInCtPerKwh ?? null);
	const priceSlots = ctx.forecastPlan.slots.map((s) => ({
		slot: s.slot,
		importCtPerKwh: s.gridPriceCtPerKwh,
		/** ct/kWh — gleiche Einheit wie importCt; Scorer: exportCt * 0.01 → €/kWh. */
		exportCtPerKwh,
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
	const wallbox = mapWallbox(wbC, wbD, nowIso, slots, ctx);

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
		const heatSetpoint = num(d, "heatSetpointC");
		const roomHumidityPct = num(d, "roomHumidityPct");
		const maxHumidityPct = num(d, "maxHumidityPct");
		const overCool = room !== null && onTemp !== null && room >= onTemp;
		const overHeat = room !== null && heatSetpoint !== null && room <= heatSetpoint;
		const overHum =
			roomHumidityPct !== null &&
			maxHumidityPct !== null &&
			roomHumidityPct >= maxHumidityPct;
		const overComfort = overCool || overHeat || overHum;
		const rt = acRtByUnit.get(u);
		const hardwareRunning = rt?.running === true;
		/*
		 * Runtime-Hold: Gerät läuft, kein neuer Startbedarf.
		 * Wichtig: allocW<50 darf Hold NICHT triggern — sonst erzeugt ein kurzzeitig
		 * fehlender NOW-Eintrag Hold→leerer NOW→Runtime-Planner-OFF-Schleife.
		 * Hold reduziert nur Flex-Mehr-Allocation im NOW-Slot (score_allocate);
		 * Runtime behandelt fehlenden NOW-Eintrag als HOLD, nicht als Planner-OFF.
		 */
		const noNewDemand = rt?.decisionSource === "temperature_no_demand";
		const runtimeHold = hardwareRunning && noNewDemand;
		const allocW = rt?.allocatedPowerW;
		const holdPowerW =
			rt?.estimatedPowerW ?? typical ?? (allocW != null && allocW > 0 ? allocW : null);
		/*
		 * Klima-/Ownership-Block: nächstes Hard-Off ab jetzt (über Mitternacht gewickelt) —
		 * harte Planner-Deadline, kein künstliches Zeitfenster (siehe score_allocate.ts).
		 */
		const hardOffAtRaw = str(d, "hardOffAt");
		const nowDate = new Date(nowMs);
		const nowMinLocal = nowDate.getHours() * 60 + nowDate.getMinutes();
		const minsToHardOff = hardOffAtRaw ? minutesUntilHardOff(nowMinLocal, hardOffAtRaw) : null;
		const hardStopMs = minsToHardOff !== null ? nowMs + minsToHardOff * 60_000 : null;
		const sharedRaw = str(d, "sharedPowerGroupId");
		const sharedPowerGroupId = sharedRaw && sharedRaw.trim() ? sharedRaw.trim() : null;
		const demandModelRaw = str(d, "demand_model") ?? str(d, "demandModel");
		const demandModel =
			demandModelRaw === "bootstrap" || demandModelRaw === "predictive" || demandModelRaw === "legacy_fallback"
				? demandModelRaw
				: null;
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
			hardStopMs,
			sharedPowerGroupId,
			roomHumidityPct,
			maxHumidityPct,
			heatSetpointC: heatSetpoint,
			demandModel,
			fallbackReasonDe: str(d, "fallback_reason_de") ?? str(d, "fallbackReasonDe"),
			predictiveConfidence: num(d, "predictive_confidence") ?? num(d, "predictiveConfidence"),
			predictedCrossingAtIso: str(d, "predicted_threshold_crossing_at"),
			predictedPeakRoomTempC: num(d, "predicted_peak_room_temp_c"),
			predictedLowRoomTempC: num(d, "predicted_low_room_temp_c"),
			predictedPeakHumidityPct: num(d, "predicted_peak_humidity_pct"),
			expectedHoursToday: num(d, "expectedHoursToday"),
		});
	}
	/*
	 * Shared Outdoor Unit: typische elektrische Leistung je Gruppe = max(Unit-Schätzungen),
	 * damit score_allocate / Hard-PV-Bound dieselbe Obergrenze sieht (nie Summe).
	 */
	const groupMaxW = new Map<string, number>();
	for (const u of climateUnits) {
		const g = u.sharedPowerGroupId;
		if (!g || u.typicalPowerW == null || !(u.typicalPowerW > 0)) continue;
		groupMaxW.set(g, Math.max(groupMaxW.get(g) ?? 0, u.typicalPowerW));
	}
	for (const u of climateUnits) {
		const g = u.sharedPowerGroupId;
		if (!g) continue;
		const maxW = groupMaxW.get(g);
		if (maxW != null && maxW > 0) u.typicalPowerW = maxW;
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
			? (() => {
					const boilerMinTempC =
						num(ihD, "boilerMinTempC") ?? num(ihD, "mandatoryMinTempC");
					const boilerTempC = num(ihD, "boilerTempC");
					const fromOverride =
						typeof ctx.boilerEstimatedEmptyAtOverride === "string" &&
						ctx.boilerEstimatedEmptyAtOverride.trim()
							? ctx.boilerEstimatedEmptyAtOverride.trim()
							: null;
					const estimatedEmptyAtIso =
						fromOverride ??
						str(ihD, "boilerEstimatedEmptyAt") ??
						str(ihD, "estimatedEmptyAt");
					/*
					 * Hard-Bridge: nur mit Contribution-Flag (belastbares Learning).
					 * Soft-Deadline: Boiler-emptyAt-Zeitpunkt trotzdem durchreichen, wenn gesetzt —
					 * sonst wandert Soft auf Wochenend-PV obwohl VIS emptyAt heute Abend zeigt
					 * (Export 2026-08-20: usable=true im Contribution-State, Plan trotzdem Sa/So).
					 */
					const emptyUsable = bool(ihD, "emptyAtPlanningUsable") === true;
					const emptyAtIsoForSoft = estimatedEmptyAtIso;
					const emptyMsForRate =
						estimatedEmptyAtIso != null ? Date.parse(estimatedEmptyAtIso) : Number.NaN;
					const coolingRateCPerH = effectiveCoolingRateCPerH({
						coolingRateCPerHAvg: num(ihD, "boilerCoolingRateCPerHAvg"),
						coolingConstantPerH: num(ihD, "boilerCoolingConstantPerH"),
						coolingAsymptoteC: num(ihD, "boilerCoolingAsymptoteC"),
						currentTempC: boilerTempC,
						bufferTempC: boilerTempC,
						minTempC: boilerMinTempC,
						estimatedEmptyAtMs:
							emptyUsable && Number.isFinite(emptyMsForRate) ? emptyMsForRate : null,
						nowMs,
					});
					const forecastTargetTempC = num(ihD, "forecastTargetTempC");
					const emptyAtSource = ((): "learned" | "estimated" | null => {
						const s = str(ihD, "emptyAtSource");
						if (!estimatedEmptyAtIso) return null;
						if (s === "learned" || s === "estimated") return s;
						return emptyUsable ? null : "estimated";
					})();
					return {
						bufferTempC,
						boilerTempC,
						minTempC: boilerMinTempC,
						boilerMinTempC,
						maxTempC: num(ihD, "planningMaxTempC"),
						dayTargetTempC: targetTempC,
						forecastTargetTempC,
						pvPrechargeActive: bool(ihD, "pvPrechargeActive") === true,
						availablePowerW: maxPowerW,
						minPowerW: minPowerW,
						headroomEnergyKwh: headroom,
						estimatedEmptyAtIso: emptyAtIsoForSoft,
						deadlineIso: emptyUsable ? estimatedEmptyAtIso : emptyAtIsoForSoft,
						emptyAtSource,
						boilerEmptyAtUsable: emptyUsable,
						boilerSensorDegraded: bool(ihD, "boilerSensorDegraded") === true || boilerTempC === null,
						hygieneMandatoryKwh: num(ihD, "hygieneMandatoryKwh"),
						hygieneDue: bool(ihD, "hygieneDue") === true,
						nightBridgeActive: bool(ihD, "nightBridgeActive") === true,
						coolingRateCPerH: emptyUsable ? coolingRateCPerH : null,
						minimumRuntimeSec: num(ihD, "minimumRuntimeSec"),
						hysteresisK: num(ihD, "reheatHysteresisK") ?? num(ihD, "temperatureHysteresisK"),
						reheatHysteresisActive: bool(ihD, "reheatHysteresisActive") === true,
						uncertainty: thermalQuality,
						freshness: thermalFresh,
						learnedPriceTimingScore: ctx.thermalLearnedPriceTimingScore ?? null,
					};
				})()
			: null,
		climate: climateUnits.length ? { units: climateUnits, freshness: climateFresh } : null,
		otherFlex: [],
		contributionRevision: ctx.contributionRevision ?? 1,
		globalMode: ctx.globalMode,
		preferImmersionLiveSurplusNow: ctx.preferImmersionLiveSurplusNow === true,
		continueImmersionSoftCurrentSlot: ctx.continueImmersionSoftCurrentSlot === true,
		immersionSoftDisallowedSlotIsos: sanitizeDisallowedSlotIsos(ctx.immersionSoftDisallowedSlotIsos),
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

	const chargingEfficiency = num(wbD, "chargingEfficiency");
	const minimumDepartureSocPct = num(wbD, "minimumDepartureSocPct");
	const externalSmartChargingMinSocPct = num(wbD, "externalSmartChargingMinSocPct");
	const departureAt = str(wbD, "departureAt");
	const deadlineIso =
		departureAt ??
		(minimumDepartureSocPct != null
			? (wbC?.deadlineIso ?? str(wbD, "deadlineIso"))
			: null);

	let uncertainty = wbC
		? connectedNow || hasHardFuture || hasPredictedFuture
			? wbC.quality
			: operatorQuality(
					"degraded",
					"Fahrzeug-Presence teilweise unknown — keine Phantom-Ladung.",
					wbC.quality.confidencePct,
				)
		: operatorQuality("missing", "Wallbox-Contribution fehlt.", null);
	if (socSource === "unknown" && requiredEnergyKwh === null && num(wbD, "energyToTargetKwh") === null) {
		uncertainty = operatorQuality(
			"degraded",
			"Fahrzeug-SOC unknown und kein belastbarer Energiebedarf.",
			uncertainty.confidencePct,
		);
	}

	const reservations = parseExternalReservations(
		wbD?.externalReservations ?? wbD?.externalSmartPlanJson ?? wbD?.externalSmartPlanSlots,
	);
	const planQualityRaw = str(wbD, "externalPlanQuality") ?? str(wbD, "externalSourceQuality");
	const externalPlanQuality =
		planQualityRaw === "ok" || planQualityRaw === "degraded" || planQualityRaw === "unknown"
			? planQualityRaw
			: reservations.some((r) => r.quality === "degraded")
				? "degraded"
				: reservations.length
					? "ok"
					: null;

	const draft: UnifiedWallboxInput = {
		connectedNow,
		presenceWindows,
		presenceHardConstraint: true,
		vehicleProfileId: ctx.vehiclePresenceVehicleKey ?? str(wbD, "vehicleProfileId") ?? str(wbD, "evccVehicleId"),
		vehicleSocPct,
		socSource,
		fallbackEnergyNeedKwh: null,
		vehicleCapacityKwh: num(wbD, "vehicleCapacityKwh"),
		targetSocPct: num(wbD, "planSocPct") ?? num(wbD, "effectiveLimitSocPct"),
		requiredEnergyKwh,
		deadlineIso,
		energyGoalHard: false,
		minChargePowerW: num(wbD, "minChargePowerW"),
		maxChargePowerW: num(wbD, "maxChargePowerW") ?? num(wbD, "vehicleMaxAcChargePowerW"),
		chargeLossFactor: chargingEfficiency != null ? 1 : num(wbD, "chargeLossFactor"),
		evccExecutionMaster: true,
		minimumDepartureSocPct,
		externalSmartChargingMinSocPct,
		chargingEfficiency,
		hardRequiredEnergyKwh: num(wbD, "energyToDepartureMinimumKwh") ?? num(wbD, "hardRequiredEnergyKwh"),
		targetEnergyKwh: num(wbD, "energyToTargetKwh") ?? num(wbD, "targetEnergyKwh"),
		externalAuthorityState: str(wbD, "externalAuthorityState"),
		takeoverSeverity: str(wbD, "takeoverSeverity"),
		externalReservations: reservations.length ? reservations : undefined,
		externalPlanQuality,
		uncertainty,
		freshness: freshnessFrom(
			Date.parse(nowIso),
			wbC?.generatedAt ?? nowIso,
			wbC?.quality ?? operatorQuality("missing", "wb", null),
		),
	};
	draft.managementMode = evManagementFromWallbox(draft);
	const classes = resolveEvEnergyClasses(draft);
	draft.energyGoalHard = classes.energyGoalHard;
	const observedHold = resolveWallboxBatteryHold({
		vehicleConnected: connectedNow,
		charging: bool(wbD, "charging"),
		chargePowerW: num(wbD, "chargePowerW"),
		batteryBoost: bool(wbD, "batteryBoost"),
		loadpointMode: str(wbD, "loadpointMode"),
		externalVehicleChargeRaw: null,
		tibberGridRewardsActive: bool(wbD, "tibberGridRewardsActive"),
	});
	draft.batteryHoldRequested = observedHold.hold;
	return draft;
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
