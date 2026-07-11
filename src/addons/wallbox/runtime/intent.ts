import type { AllocationEnergySource } from "../../../operator/daily_plan/types";
import type { WallboxPlanDecision } from "./daily_plan";

export type WallboxDispatchAction = "none" | "hold" | "charge";

export type WallboxChargeSource = "pv_surplus" | "grid" | "mixed" | "none" | "unknown";

export interface WallboxDispatchIntent {
	action: WallboxDispatchAction;
	enabled: boolean;
	targetPowerW: number | null;
	targetCurrentA: number | null;
	phases: number | null;
	source: WallboxChargeSource;
	deadlineIso: string | null;
	requestedEnergyKwh: number | null;
	allocatedEnergyKwh: number | null;
	generatedAt: string;
	validUntil: string | null;
	dailyPlanRevision: number | null;
	reasonDe: string;
}

function mapSource(src: AllocationEnergySource | "none"): WallboxChargeSource {
	if (src === "pv_surplus") return "pv_surplus";
	if (src === "grid") return "grid";
	if (src === "mixed") return "mixed";
	if (src === "none") return "none";
	return "unknown";
}

function noneIntent(reasonDe: string, now: Date, revision: number | null = null): WallboxDispatchIntent {
	return {
		action: "none",
		enabled: false,
		targetPowerW: 0,
		targetCurrentA: null,
		phases: null,
		source: "none",
		deadlineIso: null,
		requestedEnergyKwh: null,
		allocatedEnergyKwh: null,
		generatedAt: now.toISOString(),
		validUntil: null,
		dailyPlanRevision: revision,
		reasonDe,
	};
}

function holdIntent(decision: WallboxPlanDecision, now: Date, reasonDe: string): WallboxDispatchIntent {
	return {
		action: "hold",
		enabled: false,
		targetPowerW: 0,
		targetCurrentA: null,
		phases: null,
		source: mapSource(decision.energySource),
		deadlineIso: decision.deadlineIso,
		requestedEnergyKwh: decision.requestedEnergyKwh,
		allocatedEnergyKwh: decision.allocatedEnergyKwh,
		generatedAt: now.toISOString(),
		validUntil: decision.slotEndIso,
		dailyPlanRevision: decision.dailyPlanRevision,
		reasonDe,
	};
}

export interface BuildWallboxDispatchIntentInput {
	decision: WallboxPlanDecision;
	governanceEnabled: boolean;
	addonEnabled: boolean;
	phases: number | null;
	now: Date;
}

export function buildWallboxDispatchIntent(input: BuildWallboxDispatchIntentInput): WallboxDispatchIntent {
	const { decision, governanceEnabled, addonEnabled, phases, now } = input;
	const revision = decision.dailyPlanRevision;

	if (!addonEnabled) {
		return noneIntent("Wallbox-Add-on deaktiviert — kein Dispatch.", now, revision);
	}
	if (!governanceEnabled) {
		return noneIntent("Wallbox-Governance deaktiviert — kein Dispatch.", now, revision);
	}
	if (!decision.connected) {
		return noneIntent(
			"Fahrzeug ist nicht verbunden; es wird kein Lade-Dispatch erzeugt.",
			now,
			revision,
		);
	}
	if (decision.decisionSource === "missing_telemetry" || decision.decisionSource === "mapping_incomplete") {
		return noneIntent(decision.reasonDe, now, revision);
	}

	if (!decision.useDailyPlan || !decision.planValid) {
		return noneIntent(
			"Kein gültiger EMS Daily Plan — Wallbox bleibt ohne Dispatch-Ziel.",
			now,
			revision,
		);
	}

	if (decision.chargingAllowedByPlan && (decision.allocatedPowerW ?? 0) > 0) {
		const power = decision.allocatedPowerW!;
		let reasonDe = decision.reasonDe;
		if (decision.energySource === "pv_surplus") {
			reasonDe = `Dryrun — PV-Überschussladung mit maximal ${power} W vorgesehen.`;
		} else if (decision.energySource === "grid") {
			reasonDe = `Dryrun — Netzladung mit ${power} W vorgesehen.`;
		} else if (decision.energySource === "mixed") {
			reasonDe = `Dryrun — gemischte Energiequelle; Zielgesamtleistung ${power} W.`;
		} else {
			reasonDe = `Dryrun — Ladung mit ${power} W laut Daily Plan vorgesehen.`;
		}
		return {
			action: "charge",
			enabled: true,
			targetPowerW: power,
			targetCurrentA: null,
			phases,
			source: mapSource(decision.energySource),
			deadlineIso: decision.deadlineIso,
			requestedEnergyKwh: decision.requestedEnergyKwh,
			allocatedEnergyKwh: decision.allocatedEnergyKwh,
			generatedAt: now.toISOString(),
			validUntil: decision.slotEndIso,
			dailyPlanRevision: revision,
			reasonDe,
		};
	}

	if (decision.dailyPlanStatus === "allocation_below_min_power") {
		return holdIntent(
			decision,
			now,
			"Die allozierte Leistung liegt unter der technisch möglichen Mindestladeleistung.",
		);
	}

	if (decision.useDailyPlan) {
		return holdIntent(
			decision,
			now,
			"Daily Plan: im aktuellen Slot keine aktive Wallbox-Ladefreigabe (Hold).",
		);
	}

	return noneIntent("Kein Dispatch-Ziel — sicherer Grundzustand.", now, revision);
}
