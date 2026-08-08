import { deriveEnergy, resolveCapacity } from "../../../addons/battery/core/capacity";
import { CONTRIBUTION_IDS } from "../../contribution_ids";
import type { PlanContribution } from "../../types";
import { operatorQuality } from "../../quality";
import { addonContributorRef } from "../../contributor";
import type { PlannerModePolicy } from "../../../planner/mode_policy";
import type { GridSupplyForecast } from "../../types";
import { baseContribution } from "../types";
import type { BatteryChargeLogicDecision } from "./battery_charge_logic";
import { planDynamicBatteryEndSoc } from "./battery_end_soc";
import type { BatteryLearningSignal } from "./battery_learning";
import { pvSurplusCoversChargeNeed } from "./battery_pv_cover";
import { evaluateParticipation, round3 } from "./types";

export interface BatteryContributionBuildInput {
	now: Date;
	addonEnabled: boolean;
	governanceEnabled: boolean;
	globalModeOff: boolean;
	modePolicy: PlannerModePolicy;
	gridForecast: GridSupplyForecast | null;
	profileId: string;
	socPct: number | null;
	capacityManualKwh: number | null;
	capacityMappedKwh: number | null;
	capacitySource: string | null;
	minSocPct: number | null;
	maxSocPct: number | null;
	maxChargeW: number | null;
	chargeCapable: boolean;
	dischargeCapable: boolean;
	fault: boolean;
	lockout: boolean;
	telemetryValid: boolean;
	telemetryStale: boolean;
	mappingsReady: boolean;
	topOffRequested: boolean;
	ownershipActive: boolean;
	/**
	 * PV-Defizit-Ladelogik aktiv (ehem. "winterGridActive"/Battery-Winter) — generisch für
	 * mehrtägiges PV-Defizit, nicht jahreszeitgebunden. Steuert die Netz-Freigabe im eco-Modus.
	 */
	deficitChargeActive: boolean;
	/**
	 * Diagnose nur: Zustand des auslaufenden Legacy-Planners (`planner.intent.battery.winter.active`)
	 * für den Parallel-Vergleich alt/neu (Block 2.2) — beeinflusst keine Entscheidung.
	 */
	legacyDeficitChargeActive?: boolean;
	/** Battery-Runtime-Learning (`learning.battery_runtime.*`) — optional, `null`/fehlend → reine Policy/Intent-Logik. */
	batteryLearning?: BatteryLearningSignal | null;
	/** PV-Defizit-Ladelogik-Entscheidung (Block 2, `battery_charge_logic.ts`) — optional, `null` → keine Defizit-Anhebung. */
	chargeLogic?: BatteryChargeLogicDecision | null;
	/**
	 * Erwarteter Tages-PV-Überschuss (kWh): korrigierte PV-Tagesenergie − Hauslast-Tagesprognose.
	 * Wenn ≥ Ladebedarf → keine EMS-Lade-Slots (passive PV-/Eigenverbrauch-Ladung reicht).
	 */
	todayPvSurplusKwh?: number | null;
	/**
	 * Eco/Preis: späterer Netzstrom klar günstiger — dynamisches Ziel auf Nacht-/Safety-Floor
	 * (Befund 004). Keine Write-Änderung.
	 */
	deferForCheapFutureGrid?: boolean;
}

/** Top-Off durch Nutzer-Intent ODER gelerntes Intervall (`topoff_due`) überschritten. */
function learnedTopoffDue(input: BatteryContributionBuildInput): boolean {
	return input.batteryLearning?.status === "valid" && input.batteryLearning.topoffDue === true;
}

function resolveCapacityKwh(input: BatteryContributionBuildInput): number | null {
	const cap = resolveCapacity({
		source: input.capacitySource === "mapped" ? "mapped" : "manual",
		manualKwh: input.capacityManualKwh,
		mappedKwh: input.capacityMappedKwh,
	});
	return cap.valid && cap.effectiveKwh !== null && cap.effectiveKwh > 0 ? cap.effectiveKwh : null;
}

/**
 * Dynamisches Ladeziel (Befund 004): Nacht + Recovery-Bilanz; 100 % nur Top-off.
 * Keine pauschale Policy-Untergrenze mehr (90/95 %), außer Fallback ohne Daten.
 */
export function chargeTargetSocPct(input: BatteryContributionBuildInput): number {
	if (input.topOffRequested || learnedTopoffDue(input)) return 100;
	const cap = resolveCapacityKwh(input);
	if (cap === null || input.socPct === null) {
		return input.modePolicy.chargeTargetSocPct;
	}
	const dyn = planDynamicBatteryEndSoc({
		capacityKwh: cap,
		socPct: input.socPct,
		minSocPct: input.minSocPct ?? 0,
		maxSocPct: input.maxSocPct ?? 100,
		modePolicy: input.modePolicy,
		avgNightDischargeKwh:
			input.batteryLearning?.status === "valid"
				? (input.batteryLearning.avgNightDischargeKwh ?? null)
				: null,
		chargeLogic: input.chargeLogic ?? null,
		deferForCheapFutureGrid: input.deferForCheapFutureGrid === true,
	});
	return dyn.socTargetPct;
}

function dynamicEndSocDetails(input: BatteryContributionBuildInput): Record<string, unknown> {
	const cap = resolveCapacityKwh(input);
	if (cap === null || input.socPct === null) {
		return {
			endSocDynamic: false,
			endSocReasonDe: null,
			endSocUsedPolicyFallback: null,
		};
	}
	if (input.topOffRequested || learnedTopoffDue(input)) {
		return {
			endSocDynamic: true,
			endSocReasonDe: "Top-off fällig — Ziel 100 %.",
			endSocUsedPolicyFallback: false,
		};
	}
	const dyn = planDynamicBatteryEndSoc({
		capacityKwh: cap,
		socPct: input.socPct,
		minSocPct: input.minSocPct ?? 0,
		maxSocPct: input.maxSocPct ?? 100,
		modePolicy: input.modePolicy,
		avgNightDischargeKwh:
			input.batteryLearning?.status === "valid"
				? (input.batteryLearning.avgNightDischargeKwh ?? null)
				: null,
		chargeLogic: input.chargeLogic ?? null,
		deferForCheapFutureGrid: input.deferForCheapFutureGrid === true,
	});
	return {
		endSocDynamic: true,
		endSocReasonDe: dyn.reasonDe,
		endSocUsedPolicyFallback: dyn.usedPolicyFallback,
		endSocEnergyTargetKwh: dyn.energyTargetKwh,
	};
}

function batteryLearningDetails(input: BatteryContributionBuildInput): Record<string, unknown> {
	const learning = input.batteryLearning ?? null;
	return {
		batteryLearningStatus: learning?.status ?? "missing",
		avgNightDischargeKwh: learning?.avgNightDischargeKwh ?? null,
		avgChargePowerW: learning?.avgChargePowerW ?? null,
		topoffDueLearned: learning?.topoffDue ?? null,
		topoffDaysRemaining: learning?.topoffDaysRemaining ?? null,
		estimatedRuntimeDays: learning?.estimatedRuntimeDays ?? null,
	};
}

function chargeLogicDetails(input: BatteryContributionBuildInput): Record<string, unknown> {
	const d = input.chargeLogic ?? null;
	return {
		chargeLogicActive: d?.active ?? false,
		chargeLogicHorizonDays: d?.horizonDays ?? null,
		chargeLogicBridgeUntilIso: d?.bridgeUntilIso ?? null,
		chargeLogicPvRecoveryDay: d?.pvRecoveryDay ?? null,
		chargeLogicEnergyDeficitKwh: d?.energyDeficitKwh ?? null,
		chargeLogicEnergyTargetKwh: d?.energyTargetKwh ?? null,
		chargeLogicSocTargetPct: d?.socTargetPct ?? null,
		chargeLogicConfidenceMinPct: d?.confidenceMinPct ?? null,
		chargeLogicReasonDe: d?.reasonDe ?? null,
		legacyDeficitChargeActive: input.legacyDeficitChargeActive ?? null,
	};
}

function requiredChargeEnergyKwh(input: BatteryContributionBuildInput): number | null {
	const cap = resolveCapacity({
		source: input.capacitySource === "mapped" ? "mapped" : "manual",
		manualKwh: input.capacityManualKwh,
		mappedKwh: input.capacityMappedKwh,
	});
	if (!cap.valid || cap.effectiveKwh === null || input.socPct === null) return null;
	const target = chargeTargetSocPct(input);
	if (input.socPct >= target) return 0;
	const need = ((target - input.socPct) / 100) * cap.effectiveKwh;
	return round3(Math.max(0, need));
}

function gridChargeEligible(input: BatteryContributionBuildInput): boolean {
	if (!input.gridForecast?.gridImportAllowed) return false;
	if (input.globalModeOff || !input.modePolicy.allowOptimization) return false;
	if (input.modePolicy.mode === "eco" && !input.deficitChargeActive) return false;
	return input.chargeCapable;
}

export function buildBatteryChargeContribution(input: BatteryContributionBuildInput): PlanContribution {
	const generatedAt = input.now.toISOString();
	const participation = evaluateParticipation({
		addonEnabled: input.addonEnabled,
		governanceEnabled: input.governanceEnabled,
		configured: input.profileId !== "generic_readonly" || input.mappingsReady,
		mappingsReady: input.mappingsReady,
		fault: input.fault,
		lockout: input.lockout,
		globalModeOff: input.globalModeOff,
		telemetryValid: input.telemetryValid,
		telemetryStale: input.telemetryStale,
	});
	const requiredKwh = participation.allowed ? requiredChargeEnergyKwh(input) : null;
	const maxW = input.maxChargeW !== null && input.maxChargeW > 0 ? input.maxChargeW : null;
	const gridEligible = gridChargeEligible(input);
	const enabled = participation.allowed && input.chargeCapable && requiredKwh !== null && maxW !== null;
	const deficitDriven = input.chargeLogic?.active === true;
	const todayPvSurplusKwh = input.todayPvSurplusKwh ?? null;
	const pvCovers = pvSurplusCoversChargeNeed({
		requiredChargeEnergyKwh: requiredKwh,
		todayPvSurplusKwh,
		topOffRequested: input.topOffRequested,
		learnedTopoffDue: learnedTopoffDue(input),
	});
	/** Allocation-Energie: 0 wenn Tages-PV den SOC-Bedarf deckt (keine EMS-Lade-Slots). */
	const allocEnergyKwh = pvCovers ? 0 : requiredKwh;

	let status = participation.status;
	let reasonDe = participation.reasonDe;
	if (participation.allowed) {
		if (!input.chargeCapable) {
			status = "unsupported";
			reasonDe = "Profil unterstützt keine Ladeleistungssteuerung.";
		} else if (maxW === null) {
			status = "degraded";
			reasonDe = "Hardware-Maximal-Ladeleistung fehlt — keine Batterie-Allocation.";
		} else if (requiredKwh === null) {
			status = "degraded";
			reasonDe = "Ladebedarf nicht berechenbar (SOC oder Kapazität fehlt).";
		} else if (requiredKwh === 0) {
			status = "valid";
			reasonDe = "Batterie am Ladeziel — kein weiterer Ladebedarf.";
		} else if (pvCovers) {
			status = "valid";
			reasonDe = `Tages-PV-Überschuss ${todayPvSurplusKwh} kWh deckt Ladebedarf ${requiredKwh} kWh — keine EMS-Lade-Slots.`;
		} else {
			status = participation.status === "degraded" ? "degraded" : "valid";
			reasonDe = `Ladebedarf ${requiredKwh} kWh bis ${chargeTargetSocPct(input)} % SOC (Config-Max ${maxW} W).`;
			if (!input.topOffRequested && learnedTopoffDue(input)) {
				reasonDe = `${reasonDe} Gelerntes Top-Off-Intervall überschritten (${input.batteryLearning?.topoffDaysRemaining !== null && input.batteryLearning?.topoffDaysRemaining !== undefined ? `${input.batteryLearning.topoffDaysRemaining} Tage überfällig` : "fällig"}).`;
			}
			if (deficitDriven) {
				reasonDe = `${reasonDe} PV-Defizit-Ladelogik aktiv (${input.chargeLogic?.reasonDe ?? ""})`.trim();
			}
		}
	}

	/*
	 * Deadline aus der PV-Defizit-Ladelogik (Block 2, `battery_charge_logic.ts`) nur setzen,
	 * wenn sie aktuell den Bedarf treibt — sonst füllt die Allocation (Top-Off/Policy-Ziel)
	 * weiterhin ohne feste Frist, PV-first.
	 */
	const deadlineIso =
		!pvCovers && deficitDriven && requiredKwh !== null && requiredKwh > 0
			? input.chargeLogic?.bridgeUntilIso ?? null
			: null;

	const publishSlots =
		maxW !== null &&
		participation.allowed &&
		allocEnergyKwh !== null &&
		allocEnergyKwh > 0;

	return baseContribution(
		CONTRIBUTION_IDS.BATTERY_CHARGE,
		addonContributorRef("battery"),
		"consume",
		["storage", "demand_flex", "dispatch"],
		{
			generatedAt,
			validUntil: null,
			revision: 1,
			enabled: enabled && status !== "unsupported",
			flexible: true,
			gridEligible,
			deadlineIso,
			quality: operatorQuality(status, reasonDe),
			reasonDe,
			details: {
				socPct: input.socPct,
				targetSocPct: chargeTargetSocPct(input),
				requiredEnergyKwh: allocEnergyKwh,
				socGapEnergyKwh: requiredKwh,
				todayPvSurplusKwh,
				pvCoversChargeNeed: pvCovers,
				maxChargePowerW: maxW,
				topOffRequested: input.topOffRequested,
				profileId: input.profileId,
				globalMode: input.modePolicy.mode,
				pvChargeAllowed: input.modePolicy.allowPvCharge,
				gridImportAllowed: input.gridForecast?.gridImportAllowed ?? null,
				ownershipActive: input.ownershipActive,
				deficitChargeActive: input.deficitChargeActive,
				...batteryLearningDetails(input),
				...chargeLogicDetails(input),
				...dynamicEndSocDetails(input),
			},
			slots: publishSlots
				? [
						{
							slot: { startIso: generatedAt, endIso: generatedAt },
							minPowerW: null,
							preferredPowerW: null,
							maxPowerW: maxW,
							requiredEnergyKwh: allocEnergyKwh,
							availableEnergyKwh: null,
							priceCtPerKwh: null,
							available: input.chargeCapable,
							mandatory: false,
							quality: operatorQuality(status, "Technische Ladeverfügbarkeit."),
						},
					]
				: [],
		},
	);
}

export function buildBatteryDischargeContribution(input: BatteryContributionBuildInput): PlanContribution {
	const generatedAt = input.now.toISOString();
	const unsupported = input.profileId === "sonnen_em" || !input.dischargeCapable;
	const reasonDe = unsupported
		? "Profil sonnen_em unterstützt keinen getrennten Entlade-Sollwert — nur passives Eigenverbrauch."
		: "Entladesteuerung nicht verfügbar.";

	return baseContribution(
		CONTRIBUTION_IDS.BATTERY_DISCHARGE,
		addonContributorRef("battery"),
		"provide",
		["storage", "supply", "dispatch"],
		{
			generatedAt,
			validUntil: null,
			revision: 1,
			enabled: false,
			flexible: false,
			gridEligible: false,
			quality: operatorQuality("unsupported", reasonDe),
			reasonDe,
			details: {
				profileId: input.profileId,
				passiveSelfConsumptionOnly: input.profileId === "sonnen_em",
				dischargeCapableFlag: input.dischargeCapable,
				runtimeControlAvailable: false,
			},
			slots: [],
		},
	);
}

export function buildBatteryReserveContribution(input: BatteryContributionBuildInput): PlanContribution {
	const generatedAt = input.now.toISOString();
	const cap = resolveCapacity({
		source: input.capacitySource === "mapped" ? "mapped" : "manual",
		manualKwh: input.capacityManualKwh,
		mappedKwh: input.capacityMappedKwh,
	});
	const energy = deriveEnergy(input.socPct, cap.effectiveKwh, input.minSocPct);
	const participation = evaluateParticipation({
		addonEnabled: input.addonEnabled,
		governanceEnabled: true,
		configured: true,
		mappingsReady: input.mappingsReady,
		fault: input.fault,
		lockout: input.lockout,
		globalModeOff: false,
	});

	const enabled = participation.allowed || input.minSocPct !== null;
	let status: "valid" | "degraded" | "missing" = enabled ? "valid" : "missing";
	if (input.socPct === null || cap.effectiveKwh === null) status = "degraded";

	return baseContribution(
		CONTRIBUTION_IDS.BATTERY_RESERVE,
		addonContributorRef("battery"),
		"constraint",
		["storage", "constraint"],
		{
			generatedAt,
			validUntil: null,
			revision: 1,
			enabled,
			flexible: false,
			gridEligible: false,
			quality: operatorQuality(status, "Batteriereserve und SOC-Grenzen."),
			reasonDe: `Min-SOC ${input.minSocPct ?? "—"} %, Max-SOC ${input.maxSocPct ?? "—"} %.`,
			details: {
				minSocPct: input.minSocPct,
				maxSocPct: input.maxSocPct,
				energyStoredKwh: energy.energyStoredKwh,
				energyAboveReserveKwh: energy.energyAboveTechnicalMinKwh,
				energyFreeToFullKwh: energy.energyFreeToFullKwh,
				topOffTargetSocPct: input.topOffRequested || learnedTopoffDue(input) ? 100 : null,
				fault: input.fault,
				lockout: input.lockout,
				ownershipActive: input.ownershipActive,
				...batteryLearningDetails(input),
				...chargeLogicDetails(input),
			},
			slots: [],
		},
	);
}

export function buildBatteryContributions(input: BatteryContributionBuildInput): PlanContribution[] {
	return [
		buildBatteryChargeContribution(input),
		buildBatteryDischargeContribution(input),
		buildBatteryReserveContribution(input),
	];
}
