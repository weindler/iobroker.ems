/**
 * Unified Day Planner — gemeinsamer serialisierbarer Vertrag (Schritt 1).
 *
 * Erweitert das bestehende Operator-Modell (PlanContribution → ForecastPlan → DailyPlan),
 * ersetzt es nicht. Keine Live-Writes, keine Takeover in diesem Modul.
 *
 * Produktziel: docs/EMS_LIGHT_ONE_PLAN.md
 */

import type { OperatorDataQuality, OperatorTimeSlot } from "../../types";
import type { DailyPlan, DailyPlanTotals } from "../types";

/** Slotlänge — kompatibel zum bestehenden Daily Plan. */
export type UnifiedSlotMinutes = 15;

export type UnifiedDataFreshness = {
	/** ISO Zeitpunkt der Messung/Forecast-Erzeugung. */
	observedAtIso: string | null;
	/** Alter in Sekunden relativ zu `nowIso`; null wenn unbekannt. */
	ageSec: number | null;
	quality: OperatorDataQuality;
};

export type UnifiedTimeContext = {
	nowIso: string;
	timezone: string;
	horizonStartIso: string;
	horizonEndIso: string;
	slotMinutes: UnifiedSlotMinutes;
	slots: OperatorTimeSlot[];
	/** Aggregierte Freshness der kritischen Eingänge (PV/Preis/Last). */
	freshness: UnifiedDataFreshness;
};

export type UnifiedPvSlot = {
	slot: OperatorTimeSlot;
	/** Erwartete Erzeugung W im Slot (Mittel/Leistung). */
	forecastPowerW: number | null;
	/** Beobachtete Ist-Erzeugung W (Replanning); null wenn unbekannt. */
	observedPowerW: number | null;
	energyKwh: number | null;
};

export type UnifiedPvInput = {
	slots: UnifiedPvSlot[];
	expectedDayEnergyKwh: number | null;
	/**
	 * Vorherige Tages-PV-Prognose vor einer Forecast-Revision (kWh).
	 * null = keine Revisions-Historie im Input — Replan-Prinzip dann nicht bewertbar.
	 */
	previousExpectedDayEnergyKwh: number | null;
	/** Bias-Korrektur bereits eingerechnet, falls vorhanden. */
	biasCorrected: boolean;
	biasPct: number | null;
	uncertainty: OperatorDataQuality;
	freshness: UnifiedDataFreshness;
};

export type UnifiedPriceSlot = {
	slot: OperatorTimeSlot;
	/** Netzbezugskosten ct/kWh — gesamter Horizont, keine Nacht-Hardcodes. */
	importCtPerKwh: number | null;
	/** Einspeisevergütung ct/kWh, falls bekannt; sonst null. */
	exportCtPerKwh: number | null;
	gridImportAllowed: boolean;
};

export type UnifiedPriceInput = {
	slots: UnifiedPriceSlot[];
	uncertainty: OperatorDataQuality;
	freshness: UnifiedDataFreshness;
};

export type UnifiedHouseLoadSlot = {
	slot: OperatorTimeSlot;
	forecastPowerW: number | null;
	observedPowerW: number | null;
	energyKwh: number | null;
};

export type UnifiedHouseLoadInput = {
	slots: UnifiedHouseLoadSlot[];
	expectedDayEnergyKwh: number | null;
	uncertainty: OperatorDataQuality;
	freshness: UnifiedDataFreshness;
};

export type UnifiedBatteryInput = {
	socPct: number | null;
	usableCapacityKwh: number | null;
	minSocPct: number | null;
	maxSocPct: number | null;
	maxChargePowerW: number | null;
	maxDischargePowerW: number | null;
	/** Wirkungsgrad Laden 0–1; null wenn unbekannt. */
	chargeEfficiency: number | null;
	dischargeEfficiency: number | null;
	/** Erlaubte Betriebsarten — frei erweiterbar, keine Sommer/Winter-Enums. */
	allowedModes: string[];
	reserveSocPct: number | null;
	uncertainty: OperatorDataQuality;
	freshness: UnifiedDataFreshness;
};

export type UnifiedVehiclePresenceWindow = {
	/** Fahrzeug an Wallbox verfügbar. */
	available: boolean;
	startIso: string;
	endIso: string;
};

export type UnifiedWallboxInput = {
	connectedNow: boolean;
	/** Zeitfenster der erwarteten Verfügbarkeit an der Wallbox. */
	presenceWindows: UnifiedVehiclePresenceWindow[];
	/**
	 * Presence ist ein **harter** Availability-Constraint (nicht nur Reason Code).
	 * Allocation außerhalb available=true ist Vertragsverletzung.
	 */
	presenceHardConstraint: true;
	vehicleSocPct: number | null;
	/** Fallback-Energiebedarf wenn kein SOC — nie Fake-0 erfinden; null = missing. */
	fallbackEnergyNeedKwh: number | null;
	vehicleCapacityKwh: number | null;
	targetSocPct: number | null;
	requiredEnergyKwh: number | null;
	deadlineIso: string | null;
	/**
	 * Fahrzeug-Energieziel: hard = Deadline/Zielenergie muss erfüllt werden (soweit möglich),
	 * soft = best effort. Modellierbar unabhängig von Presence (Presence bleibt zusätzlich hard).
	 */
	energyGoalHard: boolean;
	minChargePowerW: number | null;
	maxChargePowerW: number | null;
	chargeLossFactor: number | null;
	/** EVCC bleibt Ausführungs-Master — nur Planungsbedarf. */
	evccExecutionMaster: true;
	uncertainty: OperatorDataQuality;
	freshness: UnifiedDataFreshness;
};

export type UnifiedThermalInput = {
	bufferTempC: number | null;
	minTempC: number | null;
	maxTempC: number | null;
	/** Sinnvolles Tagesziel °C (Forecast/Learning), nicht hart 60. */
	dayTargetTempC: number | null;
	availablePowerW: number | null;
	minPowerW: number | null;
	/** Zusätzliche kWh bis Tagesziel, falls schätzbar. */
	headroomEnergyKwh: number | null;
	estimatedEmptyAtIso: string | null;
	coolingRateCPerH: number | null;
	minimumRuntimeSec: number | null;
	hysteresisK: number | null;
	uncertainty: OperatorDataQuality;
	freshness: UnifiedDataFreshness;
};

export type UnifiedClimateUnitInput = {
	unitId: string;
	label: string;
	roomTempC: number | null;
	comfortMinC: number | null;
	comfortMaxC: number | null;
	targetTempC: number | null;
	/** Pflicht/Komfortzwang vs. frei verschiebbar. */
	mandatoryComfort: boolean;
	expectedEnergyKwh: number | null;
	typicalPowerW: number | null;
	/** Max. Verschiebung in Stunden; null = unbekannt. */
	maxShiftHours: number | null;
	uncertainty: OperatorDataQuality;
};

export type UnifiedClimateInput = {
	units: UnifiedClimateUnitInput[];
	freshness: UnifiedDataFreshness;
};

/** Kleine Erweiterungsmöglichkeit — kein generisches Plugin-Framework. */
export type UnifiedFlexConsumerKind =
	| "battery_charge"
	| "battery_discharge"
	| "immersion_heater"
	| "wallbox"
	| "climate"
	| "other";

export type UnifiedOtherFlexConsumer = {
	consumerId: string;
	kind: UnifiedFlexConsumerKind;
	label: string;
	requiredEnergyKwh: number | null;
	maxPowerW: number | null;
	minPowerW: number | null;
	deadlineIso: string | null;
	gridEligible: boolean;
	pvFirst: boolean;
	availableWindows: OperatorTimeSlot[];
	details: Record<string, unknown>;
};

/**
 * Gemeinsamer Planner-Input — serialisierbar (JSON).
 * Abbildbar aus ForecastPlan + Contributions + Telemetrie (Schritt 2 verdrahten).
 */
export type UnifiedDayPlannerInput = {
	schemaVersion: 1;
	planIntent: "unified_day";
	time: UnifiedTimeContext;
	pv: UnifiedPvInput;
	prices: UnifiedPriceInput;
	houseLoad: UnifiedHouseLoadInput;
	battery: UnifiedBatteryInput;
	wallbox: UnifiedWallboxInput | null;
	thermal: UnifiedThermalInput | null;
	climate: UnifiedClimateInput | null;
	otherFlex: UnifiedOtherFlexConsumer[];
	/** Optionale Verknüpfung zur bestehenden Contribution-Revision. */
	contributionRevision: number | null;
	globalMode: string;
};

/** Prioritätsordnung — Vertrag + Tests; noch kein Solver. */
export const UNIFIED_OBJECTIVE_PRIORITY = [
	"safety_constraints",
	"hard_user_deadlines",
	"physical_availability",
	"anticipate_surplus_and_deficit",
	"minimize_horizon_cost",
	"increase_pv_self_consumption",
	"avoid_needless_battery_cycles",
	"comfort_goals",
] as const;

export type UnifiedObjectiveId = (typeof UNIFIED_OBJECTIVE_PRIORITY)[number];

export type UnifiedConstraintKind =
	| "safety"
	| "technical"
	| "availability"
	| "deadline"
	| "policy"
	| "user";

export type UnifiedConstraint = {
	id: string;
	kind: UnifiedConstraintKind;
	/** true = harte Verletzung verboten. */
	hard: boolean;
	descriptionDe: string;
	/** Optionaler Bezug (z. B. Presence-Fenster, Goal-Id). */
	ref?: string;
};

/** Kanonische harte Constraints aus dem Input ableiten (Contract-Sanity, kein Solver). */
export function deriveUnifiedHardConstraints(input: UnifiedDayPlannerInput): UnifiedConstraint[] {
	const out: UnifiedConstraint[] = [];
	const wb = input.wallbox;
	if (wb) {
		out.push({
			id: "wallbox.presence",
			kind: "availability",
			hard: true,
			descriptionDe:
				"Wallbox-Allocation nur in Presence-Fenstern mit available=true (harter Constraint).",
			ref: "presenceHardConstraint",
		});
		if (wb.deadlineIso || wb.requiredEnergyKwh !== null) {
			out.push({
				id: "wallbox.energy_goal",
				kind: "deadline",
				hard: wb.energyGoalHard,
				descriptionDe: wb.energyGoalHard
					? "Fahrzeug Zielenergie/Deadline ist hartes Goal (soweit physisch möglich)."
					: "Fahrzeug Zielenergie/Deadline ist weiches Goal (best effort).",
				ref: wb.deadlineIso ?? "requiredEnergyKwh",
			});
		}
	}
	if (input.thermal?.minTempC != null) {
		out.push({
			id: "thermal.min_temp",
			kind: "safety",
			hard: true,
			descriptionDe: `Thermische Pflicht-Untergrenze ${input.thermal.minTempC} °C.`,
		});
	}
	return out;
}

export type UnifiedAllocationCell = {
	slot: OperatorTimeSlot;
	consumerId: string;
	kind: UnifiedFlexConsumerKind;
	allocatedPowerW: number;
	allocatedEnergyKwh: number;
	energySource: "pv_surplus" | "grid" | "battery" | "mixed" | "none";
	constraintIds: string[];
	reasonCodes: string[];
};

export type UnifiedBatteryTrajectoryPoint = {
	slotStartIso: string;
	socPct: number | null;
	chargeEnergyKwh: number;
	dischargeEnergyKwh: number;
};

export type UnifiedGoalStatus = {
	consumerId: string;
	goalId: string;
	met: boolean | null;
	detailDe: string;
};

/**
 * Gemeinsamer Day-Plan-Output — serialisierbar.
 * Kompatibel genug, um später aus/zu `DailyPlan` zu mappen.
 */
export type UnifiedDayPlan = {
	schemaVersion: 1;
	planId: string;
	generation: number;
	inputRevision: number;
	createdAtIso: string;
	timezone: string;
	horizonStartIso: string;
	horizonEndIso: string;
	slotMinutes: UnifiedSlotMinutes;

	expectedPvEnergyKwh: number | null;
	expectedHouseLoadEnergyKwh: number | null;
	expectedGridImportEnergyKwh: number | null;
	expectedGridExportEnergyKwh: number | null;
	expectedCostCt: number | null;

	batteryTrajectory: UnifiedBatteryTrajectoryPoint[];
	allocations: UnifiedAllocationCell[];
	goalStatuses: UnifiedGoalStatus[];
	constraints: UnifiedConstraint[];
	/** Maschinenlesbare Codes — UI/Briefing später. */
	reasonCodes: string[];
	confidence: OperatorDataQuality;

	totals: DailyPlanTotals | null;
	/** Optionaler Link zum bestehenden DailyPlan-Objekt (gleiche Generation). */
	legacyDailyPlan: DailyPlan | null;
};

export type UnifiedReplanTriggerId =
	| "forecast_changed_significantly"
	| "pv_observed_deviates"
	| "house_load_deviates"
	| "new_price_interval"
	| "vehicle_plugged"
	| "vehicle_unplugged"
	| "vehicle_presence_changed"
	| "vehicle_target_or_deadline_changed"
	| "battery_soc_deviates"
	| "buffer_temp_deviates"
	| "manual_user_change"
	| "device_or_safety_change";

export type UnifiedReplanTrigger = {
	id: UnifiedReplanTriggerId;
	descriptionDe: string;
	/** Schwelle nur dokumentierend — Runtime-Schleife kommt später. */
	suggestedThresholdHintDe: string;
};

export const UNIFIED_REPLAN_TRIGGERS: UnifiedReplanTrigger[] = [
	{
		id: "forecast_changed_significantly",
		descriptionDe: "PV- oder Wetter-Forecast weicht deutlich vom Planungsstand ab.",
		suggestedThresholdHintDe: "z. B. Tagesenergie oder mehrstündiges Profil > konfigurierbarer Anteil",
	},
	{
		id: "pv_observed_deviates",
		descriptionDe: "PV-Ist weicht relevant vom geplanten Slot-Profil ab.",
		suggestedThresholdHintDe: "kumulierte kWh oder Leistung über N Slots",
	},
	{
		id: "house_load_deviates",
		descriptionDe: "Hauslast-Ist weicht relevant vom Plan ab.",
		suggestedThresholdHintDe: "kumulierte kWh über N Slots",
	},
	{
		id: "new_price_interval",
		descriptionDe: "Neues oder geändertes Strompreis-Intervall im Horizont.",
		suggestedThresholdHintDe: "jeder neue Tibber-/Tarif-Slot",
	},
	{
		id: "vehicle_plugged",
		descriptionDe: "Fahrzeug wurde angesteckt.",
		suggestedThresholdHintDe: "sofort",
	},
	{
		id: "vehicle_unplugged",
		descriptionDe: "Fahrzeug wurde abgesteckt.",
		suggestedThresholdHintDe: "sofort",
	},
	{
		id: "vehicle_presence_changed",
		descriptionDe: "Erwartete Verfügbarkeit an der Wallbox hat sich geändert.",
		suggestedThresholdHintDe: "Presence-Fenster geändert",
	},
	{
		id: "vehicle_target_or_deadline_changed",
		descriptionDe: "Ziel-SOC oder Abfahrts-Deadline geändert.",
		suggestedThresholdHintDe: "sofort",
	},
	{
		id: "battery_soc_deviates",
		descriptionDe: "Batterie-SOC weicht relevant von der Trajektorie ab.",
		suggestedThresholdHintDe: "ΔSOC oder ΔkWh",
	},
	{
		id: "buffer_temp_deviates",
		descriptionDe: "Puffertemperatur weicht relevant vom erwarteten Verlauf ab.",
		suggestedThresholdHintDe: "ΔK über Zeit",
	},
	{
		id: "manual_user_change",
		descriptionDe: "Manuelle Benutzeränderung (Modus, Ziele, Freigaben).",
		suggestedThresholdHintDe: "sofort",
	},
	{
		id: "device_or_safety_change",
		descriptionDe: "Relevante Geräte- oder Safety-Änderung (Fault, Lockout, Mapping).",
		suggestedThresholdHintDe: "sofort",
	},
];

export type UnifiedPrincipleId =
	| "preallocate_foreseeable_pv_to_flex"
	| "no_charge_while_vehicle_absent"
	| "prefer_pv_over_unnecessary_grid"
	| "replan_when_forecast_collapses"
	| "no_night_battery_heat_after_wasted_pv";

export type UnifiedPrincipleVerdict = {
	principleId: UnifiedPrincipleId;
	passed: boolean;
	reasonCodes: string[];
	detailDe: string;
};

export type UnifiedPrincipleEvaluation = {
	ok: boolean;
	verdicts: UnifiedPrincipleVerdict[];
};
