/**
 * KI-Optimierungsschicht — Verträge.
 *
 * Rahmen (siehe docs/EMS_LIGHT_MASTERPLAN.md Abschnitt 4/8/13):
 * - Die KI optimiert ausschließlich innerhalb bestehender Policy-/Safety-/Add-on-Grenzen.
 * - Sie schreibt niemals direkt auf Geräte-States, ändert niemals Policies und
 *   plant niemals ein Add-on ohne dessen individuelle "KI-Optimierung erlaubt"-Freigabe.
 * - Beta: Plan B / Slot-Prefs sind advisory. AI mutiert keine Live-Allocations;
 *   Unified Planner ist alleinige Planwahrheit. Learning → Input → Unified bleibt erlaubt.
 */

export type AiProviderId = "openai";

/** Slot-Zeile für die KI (volle Plan-Sicht, nicht nur Mini-Digest). */
export interface AiDigestSlot {
	/** ISO-Start des 15-Minuten-Slots — exakt so für slot_preferences zurückzugeben. */
	t: string;
	priceCtPerKwh: number | null;
	pvSurplusW: number | null;
	houseLoadW: number | null;
	/** Aktuelle (deterministische) flexible Heizstab-Leistung in diesem Slot — 0 wenn Add-on nicht erlaubt. */
	ihFlexW: number;
	/** Aktuelle (deterministische) Klimaanlagen-Leistung in diesem Slot — 0 wenn Add-on nicht erlaubt. */
	acW: number;
	batteryChargeW: number;
	wallboxW: number;
	allocatedPvW: number;
	allocatedGridW: number;
}

/** Learning-Kurzdigest — skalare Kennzahlen, keine Roh-History. */
export interface AiLearningDigest {
	pvBiasStatus: string | null;
	pvCorrectedTodayKwh: number | null;
	pvCorrectedTomorrowKwh: number | null;
	/** PV-Horizon Tag 1–7 (corrected_kwh), fehlende Tage als null. */
	pvHorizonDays: Array<{ day: number; correctedKwh: number | null }>;
	thermalRuntimeStatus: string | null;
	/** ISO/UTC — Maschinenwert. */
	thermalEstimatedEmptyAt: string | null;
	/** Ortszeit Europe/Berlin (oder Plan-TZ) für deutsche Prosa — nicht die UTC-Ziffern aus ISO. */
	thermalEstimatedEmptyAtLocalDe: string | null;
	/** Live-Countdown aus empty_at − now (h), nie eingefrorener Snapshot. */
	thermalEstimatedRemainingHours: number | null;
	batteryRuntimeStatus: string | null;
	batteryTopOffIntervalDays: number | null;
	priceLearningStatus: string | null;
	/** Ø 7d aus Learning — Einheit €/kWh (Adapter-State). */
	priceAvgEurPerKwh7d: number | null;
	houseLoadStatus: string | null;
}

/** Live + Horizont-Snapshot für die denkende KI (null ok, nie erfundene 0). */
export interface AiSituationBrief {
	live: {
		pvPowerW: number | null;
		houseLoadW: number | null;
		surplusW: number | null;
		deficitW: number | null;
	};
	wallbox: {
		connected: boolean | null;
		charging: boolean | null;
		mode: string | null;
		socPct: number | null;
		remainingEnergyKwh: number | null;
		effectiveLimitSoc: number | null;
		planActive: boolean | null;
		deadlineIso: string | null;
	};
	immersion: {
		bufferTempC: number | null;
		thermalEstimatedEmptyAt: string | null;
		thermalEstimatedEmptyAtLocalDe: string | null;
		thermalEstimatedRemainingHours: number | null;
	};
	climate: {
		units: Array<{
			unitIndex: number;
			running: boolean | null;
			roomTempC: number | null;
		}>;
	};
	/** Tag 1–7 corrected_kwh (day1 = heute). */
	pvHorizon: Array<{ day: number; correctedKwh: number | null }>;
	pvTodayKwh: number | null;
	pvTomorrowKwh: number | null;
	priceNowCt: number | null;
	/** Ø 7d aus Learning — €/kWh, nie erfunden. */
	priceAvg7d: number | null;
	nextHours: {
		avgPvForecastPowerW: number | null;
		avgAvailablePvSurplusPowerW: number | null;
		minPriceCt: number | null;
		maxPriceCt: number | null;
	};
}

/** Daily-Plan-Auszug für die KI (vollständig genug für Zeitpunkt-Optimierung). */
export interface AiDailyPlanDigest {
	date: string;
	globalMode: string;
	status: string;
	timezone: string;
	slotMinutes: number;
	horizonSlotCount: number;
	validUntil: string | null;
	activeContributionIds: string[];
	excludedContributionIds: string[];
	totals: {
		pvForecastEnergyKwh: number | null;
		fixedHouseLoadEnergyKwh: number | null;
		flexibleRequestedEnergyKwh: number | null;
		flexibleAllocatedEnergyKwh: number;
		flexibleUnallocatedEnergyKwh: number | null;
		pvAllocatedEnergyKwh: number;
		gridAllocatedEnergyKwh: number;
		batteryChargeEnergyKwh: number;
		wallboxEnergyKwh: number;
		immersionHeaterEnergyKwh: number;
		airConditioningEnergyKwh: number;
		estimatedGridCostCt: number | null;
	};
	unallocated: Array<{ contributionId: string; unallocatedEnergyKwh: number | null; reasonDe: string }>;
	/** Alle Horizon-Slots; IH/AC-Leistungen nur wenn freigegeben. */
	slots: AiDigestSlot[];
}

export interface AiOptimizationRequestContext {
	generatedAt: string;
	timezone: string;
	globalMode: string;
	/** Add-ons mit Governance "aktiv" UND "KI-Optimierung erlaubt" — nur diese darf die KI je erwähnen. */
	allowedAddonIds: string[];
	dailyPlan: AiDailyPlanDigest;
	learning: AiLearningDigest;
	/** Live + PV-/Preis-Horizont für menschliche Abwägung (heute vs. morgen). */
	situation: AiSituationBrief;
	policyHighlights: Record<string, unknown>;
	triggerReason: string;
}

/** Vorschlag der KI für ein einzelnes freigegebenes Add-on — Empfehlung, keine Ausführung. */
export interface AiOptimizationProposal {
	addonId: string;
	note: string;
}

/**
 * Zeitpunkt-Präferenz der KI für ein freigegebenes Add-on — reine Gewichtung, keine Watt-Vorgabe.
 * weight 1 = neutral, >1 = bevorzugt, <1 = meiden.
 * Wird beim Plan-Vergleich / Write-back angewendet — nie direkt auf Geräte.
 */
export interface AiSlotPreference {
	addonId: string;
	slotStartIso: string;
	weight: number;
}

export type AiWallboxAction =
	| "charge_cheap_grid_now"
	| "prefer_pv_tomorrow"
	| "prefer_pv_today"
	| "keep_plan_a";

export type AiImmersionAction = "heat_today" | "defer_tomorrow" | "keep_plan_a";

export type AiBatteryAction = "charge_now" | "wait_pv" | "hold" | "keep_plan_a";

export type AiClimateAction = "advisory" | "keep_plan_a";

export type AiAddonAction = AiWallboxAction | AiImmersionAction | AiBatteryAction | AiClimateAction;

/** Strategische Entscheidung der denkenden KI — EMS leitet daraus ggf. Slot-Gewichte ab. */
export interface AiAddonDecision {
	addonId: string;
	action: AiAddonAction;
	note: string;
}

export interface AiOptimizationResult {
	ok: boolean;
	proposals: AiOptimizationProposal[];
	slotPreferences: AiSlotPreference[];
	/** Deutsche Denkspur der KI (immer sichtbar, auch ohne Write-back). */
	thinkingDe: string;
	/** Konkrete Add-on-Strategien (heute vs. morgen etc.). */
	decisions: AiAddonDecision[];
	reasonDe: string;
	usage: { promptTokens: number | null; completionTokens: number | null };
	error?: string;
}

export interface AiProviderCallOptions {
	apiKey: string;
	model: string;
	timeoutMs: number;
	/** false → Legacy-Prompt (nur slot_preferences), Decisions werden ignoriert. */
	thinkingMode?: boolean;
}

export interface AiProvider {
	id: AiProviderId;
	optimize(
		request: AiOptimizationRequestContext,
		opts: AiProviderCallOptions,
	): Promise<AiOptimizationResult>;
}

export type AiStatus =
	| "off"
	| "ready"
	| "limit_reached"
	| "error"
	| "no_token"
	| "no_addons_allowed"
	| "suspended";
