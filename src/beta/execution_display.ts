/**
 * Operator-/VIS-Darstellung Plan ≠ reale Ausführung.
 *
 * Befund 003 — zwei getrennte Ebenen:
 * - Execution-Authority: LIVE | DRYRUN (nur aus global∧addon mode)
 * - Operation/Plan: läuft / geplant / hold / wartet / … (strategischer Status + Runtime)
 *
 * Legacy `resolveExecutionDisplayPhase` bleibt für Heizstab-Agenda-Meta kompatibel.
 * Keine Write-Gates.
 */

import { parseAddonMode, parseGlobalMode } from "../execution_mode";
import {
	climateHeuteLineFromPlanDe,
	climatePlanLineFromWindowsDe,
	isOutsideClockWindowReason,
	type PlanVisWindow,
} from "./plan_visibility";
import type {
	BatteryStrategicStatus,
	WallboxStrategicStatus,
} from "./strategic_status";

export type ExecutionDisplayPhase = "idle" | "planned" | "dryrun" | "running";

export type ExecutionDisplayBadge = {
	phase: ExecutionDisplayPhase;
	/** CSS-Klasse für VIS-Badge */
	cls: "idle" | "plan" | "dryrun" | "on";
	/** Kurzlabel (VIS-Badge) */
	labelDe: string;
};

/** Add-on-Modus / effektive Execution — nie mit Operation vermischen. */
export type ExecutionAuthority = "live" | "dryrun" | "off";

export type ExecutionAuthorityBadge = {
	authority: ExecutionAuthority;
	cls: "live" | "dryrun" | "idle";
	labelDe: "LIVE" | "DRYRUN" | "AUS";
};

export type OperationDisplayKind =
	| "running"
	| "planned"
	| "ready"
	| "hold"
	| "reserve_protected"
	| "waiting"
	| "idle";

export type OperationDisplay = {
	kind: OperationDisplayKind;
	labelDe: string;
	detailDe: string;
};

const DEFAULT_ON_W = 50;

/** Hierarchie wie Execution-Gate: nur Global Live ∧ Addon Live → echte Writes. */
export function isEffectiveLiveWriteAllowed(globalMode: unknown, addonModeVal: unknown): boolean {
	return parseGlobalMode(globalMode) === "live" && parseAddonMode(addonModeVal) === "live";
}

/**
 * Execution-Badge aus Modes — unabhängig von Operation (Gesperrt/Hold/…).
 * Add-on off → AUS; sonst LIVE nur bei global∧addon live, sonst DRYRUN.
 */
export function resolveExecutionAuthorityFromModes(
	globalMode: unknown,
	addonModeVal: unknown,
): ExecutionAuthority {
	if (parseAddonMode(addonModeVal) === "off") return "off";
	return isEffectiveLiveWriteAllowed(globalMode, addonModeVal) ? "live" : "dryrun";
}

/** @deprecated Prefer resolveExecutionAuthorityFromModes — liveWriteAllowed allein kennt Off nicht. */
export function resolveExecutionAuthority(liveWriteAllowed: boolean): ExecutionAuthority {
	return liveWriteAllowed ? "live" : "dryrun";
}

export function executionAuthorityBadge(authority: ExecutionAuthority): ExecutionAuthorityBadge {
	if (authority === "live") return { authority: "live", cls: "live", labelDe: "LIVE" };
	if (authority === "off") return { authority: "off", cls: "idle", labelDe: "AUS" };
	return { authority: "dryrun", cls: "dryrun", labelDe: "DRYRUN" };
}

export function addonOffSummaryDe(addonId: string): string {
	switch (addonId) {
		case "wallbox":
			return "Wallbox: AUS · EVCC autonom";
		case "immersion_heater":
			return "Heizstab: AUS · EMS-Steuerung deaktiviert";
		case "battery":
			return "Batterie: AUS · EMS-Steuerung deaktiviert";
		case "air_conditioning":
			return "Klima: AUS · EMS-Steuerung deaktiviert";
		default:
			return `${addonId}: AUS · EMS-Steuerung deaktiviert`;
	}
}

export function operationFromBatteryStrategy(
	status: BatteryStrategicStatus,
	hardwareActive: boolean,
): OperationDisplay {
	if (hardwareActive) {
		return { kind: "running", labelDe: "Läuft", detailDe: "Hardware lädt." };
	}
	switch (status) {
		case "charge":
			return { kind: "planned", labelDe: "Geplant", detailDe: "Ladung im Unified-Plan." };
		case "hold":
			return {
				kind: "hold",
				labelDe: "Hold",
				detailDe: "Strategie: Hold · aktuell keine Ladeaktion",
			};
		case "reserve_protected":
			return {
				kind: "reserve_protected",
				labelDe: "Reserve geschützt",
				detailDe: "Strategie: Reserve/Hold · aktuell keine Ladeaktion",
			};
		case "available_for_discharge":
			return {
				kind: "ready",
				labelDe: "Bereit",
				detailDe: "Entladung/Defizitdeckung im Plan vorgesehen (kein neuer Write).",
			};
		default:
			return { kind: "idle", labelDe: "Kein Bedarf", detailDe: "Kein strategischer Ladebedarf." };
	}
}

export function operationFromWallboxStrategy(
	status: WallboxStrategicStatus,
	hardwareActive: boolean,
): OperationDisplay {
	if (hardwareActive && (status === "charging" || status === "scheduled")) {
		return { kind: "running", labelDe: "Läuft", detailDe: "Fahrzeug lädt." };
	}
	if (hardwareActive) {
		return { kind: "running", labelDe: "Läuft", detailDe: "Fahrzeug lädt (Hardware)." };
	}
	switch (status) {
		case "charging":
			return { kind: "planned", labelDe: "Geplant", detailDe: "Plan-Allocation aktiv." };
		case "scheduled":
			return { kind: "planned", labelDe: "Geplant", detailDe: "Ladung in späteren Fenstern." };
		case "waiting_for_vehicle":
			return {
				kind: "waiting",
				labelDe: "Wartet auf Fahrzeug",
				detailDe: "Kein Ladeplan erforderlich",
			};
		case "waiting_for_goal":
			return { kind: "waiting", labelDe: "Wartet auf Ladeziel", detailDe: "Ziel/Deadline fehlt." };
		case "goal_satisfied":
			return { kind: "ready", labelDe: "Ziel erreicht", detailDe: "Kein weiterer Ladebedarf." };
		default:
			return { kind: "idle", labelDe: "Kein Bedarf", detailDe: "Kein Wallbox-Ladebedarf." };
	}
}

export function isPowerActive(powerW: number | null | undefined, thresholdW: number = DEFAULT_ON_W): boolean {
	return powerW != null && Number.isFinite(powerW) && powerW >= thresholdW;
}

/**
 * Immersion: Feedback/Messung sind verlässlicher Istzustand.
 * Commanded allein zählt nur unter Live-Write-Authority (Dryrun setzt commanded ebenfalls).
 */
export function isImmersionHardwareActive(input: {
	liveWriteAllowed: boolean;
	feedbackStage: number | null | undefined;
	measuredPowerW: number | null | undefined;
	commandedPowerW: number | null | undefined;
	thresholdW?: number;
}): boolean {
	const thr = input.thresholdW ?? DEFAULT_ON_W;
	if ((input.feedbackStage ?? 0) > 0) return true;
	if (isPowerActive(input.measuredPowerW, thr)) return true;
	if (input.liveWriteAllowed && isPowerActive(input.commandedPowerW, thr)) return true;
	return false;
}

export function resolveExecutionDisplayPhase(input: {
	/** Aktueller Slot: Planner-Allocation aktiv (Leistung/Energie). */
	currentPlannedActive: boolean;
	/** Zukünftige Allocation im Horizont. */
	hasFuturePlan: boolean;
	liveWriteAllowed: boolean;
	hardwareActive: boolean;
}): ExecutionDisplayPhase {
	if (input.liveWriteAllowed && input.hardwareActive) return "running";
	if (input.currentPlannedActive && !input.liveWriteAllowed) return "dryrun";
	if (input.currentPlannedActive || input.hasFuturePlan) return "planned";
	return "idle";
}

export function executionDisplayBadge(phase: ExecutionDisplayPhase): ExecutionDisplayBadge {
	switch (phase) {
		case "running":
			return { phase, cls: "on", labelDe: "Läuft" };
		case "dryrun":
			return { phase, cls: "dryrun", labelDe: "Dryrun" };
		case "planned":
			return { phase, cls: "plan", labelDe: "Geplant" };
		default:
			return { phase: "idle", cls: "idle", labelDe: "Pausiert" };
	}
}

/** Agenda-/Timeline-Status in Großbuchstaben (GEPLANT / DRYRUN / LÄUFT). */
export function agendaStatusLabelDe(phase: ExecutionDisplayPhase): string | null {
	switch (phase) {
		case "running":
			return "LÄUFT";
		case "dryrun":
			return "DRYRUN";
		case "planned":
			return "GEPLANT";
		default:
			return null;
	}
}

/**
 * „Jetzt“-Zeile: bei Dryrun Planner und Hardware getrennt; LÄUFT nur realer Ist.
 */
export function formatExecutionNowLineDe(input: {
	phase: ExecutionDisplayPhase;
	plannerPowerW: number | null | undefined;
	/** z. B. „aus“, „unverändert“, „an · 1700 W“, „lädt · 7000 W“ */
	hardwareLabelDe: string;
}): string {
	const plannerW =
		input.plannerPowerW != null && Number.isFinite(input.plannerPowerW) && input.plannerPowerW > 0
			? Math.round(input.plannerPowerW)
			: null;
	if (input.phase === "running") {
		return input.hardwareLabelDe;
	}
	if (input.phase === "dryrun") {
		const planPart = plannerW != null ? `Planner: ${plannerW} W` : "Planner: aktiv";
		return `${planPart} · Hardware: ${input.hardwareLabelDe}`;
	}
	if (input.phase === "planned" && plannerW != null) {
		return `geplant ${plannerW} W · Hardware: ${input.hardwareLabelDe}`;
	}
	return input.hardwareLabelDe;
}

/** Agenda-Meta für den aktuellen Dryrun-/Plan-Slot. */
export function formatAgendaSlotMetaDe(input: {
	phase: ExecutionDisplayPhase;
	plannerPowerW: number | null | undefined;
}): string | null {
	const status = agendaStatusLabelDe(input.phase);
	if (!status) return null;
	const plannerW =
		input.plannerPowerW != null && Number.isFinite(input.plannerPowerW) && input.plannerPowerW > 0
			? Math.round(input.plannerPowerW)
			: null;
	if (input.phase === "dryrun" && plannerW != null) {
		return `${status} · geplant ${plannerW} W`;
	}
	if (plannerW != null && (input.phase === "planned" || input.phase === "running")) {
		return `${status} · ${plannerW} W`;
	}
	return status;
}

/** Rohwerte für Agenda-/VIS-Hardware-Ist (ohne State-I/O). */
export type AddonHardwareHints = {
	immersion?: {
		feedbackStage?: number | null;
		measuredPowerW?: number | null;
		commandedPowerW?: number | null;
		allocatedPowerW?: number | null;
	};
	battery?: {
		chargingPowerW?: number | null;
		allocatedChargePowerW?: number | null;
	};
	wallbox?: {
		charging?: boolean;
		chargePowerW?: number | null;
		allocatedPowerW?: number | null;
	};
	climate?: {
		unitRunning?: boolean[];
		allocatedPowerW?: number | null;
	};
};

export function buildAgendaExecutionHints(input: {
	globalMode: unknown;
	addonModes: {
		immersion_heater?: unknown;
		battery?: unknown;
		wallbox?: unknown;
		air_conditioning?: unknown;
	};
	hardware: AddonHardwareHints;
	nowMs?: number;
	thresholdW?: number;
}): {
	nowMs: number;
	immersion_heater: {
		liveWriteAllowed: boolean;
		hardwareActive: boolean;
		currentAllocatedW: number | null;
		executionOff: boolean;
	};
	battery: {
		liveWriteAllowed: boolean;
		hardwareActive: boolean;
		currentAllocatedW: number | null;
		executionOff: boolean;
	};
	wallbox: {
		liveWriteAllowed: boolean;
		hardwareActive: boolean;
		currentAllocatedW: number | null;
		executionOff: boolean;
	};
	climate: {
		liveWriteAllowed: boolean;
		hardwareActive: boolean;
		currentAllocatedW: number | null;
		executionOff: boolean;
	};
} {
	const thr = input.thresholdW ?? DEFAULT_ON_W;
	const ihOff = parseAddonMode(input.addonModes.immersion_heater) === "off";
	const batOff = parseAddonMode(input.addonModes.battery) === "off";
	const wbOff = parseAddonMode(input.addonModes.wallbox) === "off";
	const acOff = parseAddonMode(input.addonModes.air_conditioning) === "off";
	const ihLive = isEffectiveLiveWriteAllowed(input.globalMode, input.addonModes.immersion_heater);
	const batLive = isEffectiveLiveWriteAllowed(input.globalMode, input.addonModes.battery);
	const wbLive = isEffectiveLiveWriteAllowed(input.globalMode, input.addonModes.wallbox);
	const acLive = isEffectiveLiveWriteAllowed(input.globalMode, input.addonModes.air_conditioning);
	const ih = input.hardware.immersion ?? {};
	const bat = input.hardware.battery ?? {};
	const wb = input.hardware.wallbox ?? {};
	const ac = input.hardware.climate ?? {};
	const acRunning = (ac.unitRunning ?? []).some(Boolean);
	return {
		nowMs: input.nowMs ?? Date.now(),
		immersion_heater: {
			liveWriteAllowed: ihLive,
			hardwareActive: isImmersionHardwareActive({
				liveWriteAllowed: ihLive,
				feedbackStage: ih.feedbackStage,
				measuredPowerW: ih.measuredPowerW,
				commandedPowerW: ih.commandedPowerW,
				thresholdW: thr,
			}),
			currentAllocatedW: ihOff ? null : (ih.allocatedPowerW ?? null),
			executionOff: ihOff,
		},
		battery: {
			liveWriteAllowed: batLive,
			hardwareActive: isPowerActive(bat.chargingPowerW, thr),
			currentAllocatedW: batOff ? null : (bat.allocatedChargePowerW ?? null),
			executionOff: batOff,
		},
		wallbox: {
			liveWriteAllowed: wbLive,
			hardwareActive: wb.charging === true || isPowerActive(wb.chargePowerW, thr),
			currentAllocatedW: wbOff ? null : (wb.allocatedPowerW ?? null),
			executionOff: wbOff,
		},
		climate: {
			liveWriteAllowed: acLive,
			hardwareActive: acRunning,
			currentAllocatedW: acOff ? null : (ac.allocatedPowerW ?? null),
			executionOff: acOff,
		},
	};
}

/** Aktueller Kühl-/Dry-Bedarf vs. nur Restlauf (Hysterese/Mindeslauf). */
export type ClimateDemandKind = "active" | "hold" | "none";

export type ClimateUnitDisplay = {
	phase: ExecutionDisplayPhase;
	badge: ExecutionDisplayBadge;
	demand: ClimateDemandKind;
	/** Operativer Zustand (nicht Execution-Authority). */
	operationLabelDe: string;
	/** Jetzt-Zeile — Plan, Runtime und Ist konsistent. */
	nowLineDe: string;
	/** Hinweis unter der Karte. */
	noteDe: string;
	/** Aktuelle Allocation oder nächstes Planfenster. */
	planLineDe: string;
	/** Nächstes zukünftiges Fenster (leer wenn keines). */
	nextPlanLineDe: string;
	/** Tagesprognose / Tagesplan — nicht mit „jetzt außerhalb Fenster“ vermischen. */
	heuteLineDe: string;
};

function climateHoldReasonDe(reasonDe: string | null | undefined): string {
	const r = String(reasonDe ?? "").trim();
	if (/Hysterese/i.test(r)) return "Hysterese";
	if (/Mindes|min(?:imum)?[-\s]?runtime|Restlauf|minimum.?runtime/i.test(r)) return "Mindeslaufzeit";
	if (/Reinigung|cleaning/i.test(r)) return "Reinigung";
	if (/Rate-?Limit/i.test(r)) return "Rate-Limit";
	if (/kein Kühlbedarf/i.test(r)) return "Restlauf/Hysterese";
	const short = r.replace(/\.$/, "");
	return short.length > 0 && short.length <= 48 ? short : "Restlauf/Hysterese";
}

/**
 * Kühlbedarf aus Runtime-Entscheidung (decision_source + reason), nicht aus Allocation.
 * Allocation = Energiebudget; Feedback = Hardware-Ist.
 */
export function classifyClimateDemand(input: {
	hardwareRunning: boolean;
	decisionSource?: string | null;
	reasonDe?: string | null;
}): ClimateDemandKind {
	const src = String(input.decisionSource ?? "").toLowerCase();
	const reason = String(input.reasonDe ?? "");
	const noDemand =
		src === "temperature_no_demand" || /aktuell kein Kühlbedarf|kein cool\/dry-Bedarf/i.test(reason);
	const holdHint = /Hysterese|läuft weiter|Mindes|Restlauf|Reinigung/i.test(reason);

	if (input.hardwareRunning) {
		if (noDemand || holdHint) return "hold";
		if (/Läuft\s*\(|Einschalten|≥|Kühlbedarf aktiv/i.test(reason)) return "active";
		return "active";
	}
	if (/Einschalten/i.test(reason) && !noDemand) return "active";
	if (noDemand) return "none";
	return "none";
}

/**
 * Klima-Unit-Karte: Hardware-Ist + Runtime-Bedarf + Planner-Budget — ohne Widerspruch.
 *
 * - Hardware on + Bedarf → LÄUFT · Kühlbedarf aktiv
 * - Außerhalb Zeitfenster ≠ Addon-Aus: „GESPERRT“, Future-Plan bleibt sichtbar
 * - Dryrun: niemals LÄUFT allein aus Allocation
 * - Execution-Authority (LIVE/DRYRUN) bleibt getrennt von Operation
 */
export function resolveClimateUnitDisplay(input: {
	liveWriteAllowed: boolean;
	hardwareRunning: boolean;
	allocatedPowerW?: number | null;
	decisionSource?: string | null;
	reasonDe?: string | null;
	likelyActiveToday?: boolean | null;
	expectedHoursToday?: number | null;
	expectedKwhToday?: number | null;
	hasFuturePlan?: boolean;
	/** Nächstes zukünftiges Fenster aus autoritativem plan_json. */
	nextPlanWindow?: PlanVisWindow | null;
	timezone?: string;
}): ClimateUnitDisplay {
	const allocOn = isPowerActive(input.allocatedPowerW);
	const hasFuture = input.hasFuturePlan === true || Boolean(input.nextPlanWindow);
	const demand = classifyClimateDemand({
		hardwareRunning: input.hardwareRunning,
		decisionSource: input.decisionSource,
		reasonDe: input.reasonDe,
	});
	const heuteLineDe = climateHeuteLineFromPlanDe({
		likelyActiveToday: input.likelyActiveToday,
		expectedHoursToday: input.expectedHoursToday,
		expectedKwhToday: input.expectedKwhToday,
		hasPlanToday: allocOn || hasFuture,
	});
	const planLineDe = climatePlanLineFromWindowsDe({
		currentAllocatedPowerW: input.allocatedPowerW,
		nextWindow: allocOn ? null : (input.nextPlanWindow ?? null),
		timezone: input.timezone,
	});
	const nextPlanLineDe =
		input.nextPlanWindow != null
			? climatePlanLineFromWindowsDe({
					currentAllocatedPowerW: null,
					nextWindow: input.nextPlanWindow,
					timezone: input.timezone,
				})
			: "keines";
	const reason = String(input.reasonDe ?? "").trim();
	const outsideWindow = isOutsideClockWindowReason(reason);

	const finish = (
		partial: Omit<ClimateUnitDisplay, "planLineDe" | "heuteLineDe" | "nextPlanLineDe" | "operationLabelDe"> & {
			operationLabelDe?: string;
		},
	): ClimateUnitDisplay => ({
		...partial,
		operationLabelDe: partial.operationLabelDe ?? partial.badge.labelDe,
		planLineDe,
		heuteLineDe,
		nextPlanLineDe,
	});

	if (!input.liveWriteAllowed) {
		const phase = resolveExecutionDisplayPhase({
			currentPlannedActive: allocOn,
			hasFuturePlan: hasFuture,
			liveWriteAllowed: false,
			hardwareActive: false,
		});
		const badge = executionDisplayBadge(phase);
		const hw = input.hardwareRunning ? "eingeschaltet" : "aus";
		const nowLineDe = formatExecutionNowLineDe({
			phase,
			plannerPowerW: input.allocatedPowerW,
			hardwareLabelDe: hw,
		});
		const operationLabelDe = outsideWindow
			? "Gesperrt · außerhalb Zeitfenster"
			: badge.labelDe;
		const noteDe =
			demand === "none" && allocOn
				? `Dryrun · Budget freigegeben, aktuell kein Kühlbedarf.`
				: reason || (phase === "dryrun" ? "Dryrun — keine realen Klima-Writes." : "Klima im Dryrun.");
		return finish({ phase, badge, demand, nowLineDe, noteDe, operationLabelDe });
	}

	if (input.hardwareRunning) {
		const badge = executionDisplayBadge("running");
		if (demand === "active") {
			return finish({
				phase: "running",
				badge,
				demand,
				operationLabelDe: "Läuft",
				nowLineDe: "Läuft · Kühlbedarf aktiv",
				noteDe: reason || "Kühlbedarf aktiv.",
			});
		}
		const hold = climateHoldReasonDe(input.reasonDe);
		return finish({
			phase: "running",
			badge,
			demand: "hold",
			operationLabelDe: "Läuft",
			nowLineDe: `Läuft · kein neuer Kühlbedarf, läuft wegen ${hold} weiter`,
			noteDe: reason || `Kein neuer Kühlbedarf — läuft wegen ${hold} weiter.`,
		});
	}

	if (outsideWindow) {
		const phase = resolveExecutionDisplayPhase({
			currentPlannedActive: allocOn,
			hasFuturePlan: hasFuture,
			liveWriteAllowed: true,
			hardwareActive: false,
		});
		const badge: ExecutionDisplayBadge = hasFuture || allocOn
			? { phase: phase === "idle" ? "planned" : phase, cls: "plan", labelDe: "Gesperrt" }
			: { phase: "idle", cls: "idle", labelDe: "Gesperrt" };
		return finish({
			phase: badge.phase,
			badge,
			demand,
			operationLabelDe: "Gesperrt · außerhalb Zeitfenster",
			nowLineDe: "gesperrt · außerhalb Zeitfenster",
			noteDe: reason || "Außerhalb Zeitfenster — kein Start.",
		});
	}

	if (allocOn && demand === "none") {
		return finish({
			phase: "planned",
			badge: { phase: "planned", cls: "plan", labelDe: "Bereit" },
			demand,
			operationLabelDe: "Bereit",
			nowLineDe: "aktuell kein Kühlbedarf",
			noteDe:
				reason ||
				`Daily Plan stellt ${Math.round(input.allocatedPowerW!)} W bereit, aktuell kein Kühlbedarf.`,
		});
	}

	if (allocOn || hasFuture || input.likelyActiveToday === true) {
		const phase: ExecutionDisplayPhase = "planned";
		return finish({
			phase,
			badge: executionDisplayBadge(phase),
			demand,
			operationLabelDe: "Geplant",
			nowLineDe: demand === "active" ? "Kühlbedarf — Start ausstehend" : "aus",
			noteDe: reason || "Klima geplant.",
		});
	}

	return finish({
		phase: "idle",
		badge: { phase: "idle", cls: "idle", labelDe: "Aus" },
		demand,
		operationLabelDe: "Aus",
		nowLineDe: "aus",
		noteDe: reason || "Klima aus.",
	});
}
