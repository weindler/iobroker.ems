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

import { parseMode } from "../execution_mode";
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

/** Nur Write-Authority — nie mit Operation vermischen. */
export type ExecutionAuthority = "live" | "dryrun";

export type ExecutionAuthorityBadge = {
	authority: ExecutionAuthority;
	cls: "live" | "dryrun";
	labelDe: "LIVE" | "DRYRUN";
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
export function isEffectiveLiveWriteAllowed(globalMode: unknown, addonMode: unknown): boolean {
	return parseMode(globalMode) === "live" && parseMode(addonMode) === "live";
}

/** Execution-Badge ausschließlich aus Modes — unabhängig von Allocation/Hardware. */
export function resolveExecutionAuthority(liveWriteAllowed: boolean): ExecutionAuthority {
	return liveWriteAllowed ? "live" : "dryrun";
}

export function executionAuthorityBadge(authority: ExecutionAuthority): ExecutionAuthorityBadge {
	return authority === "live"
		? { authority: "live", cls: "live", labelDe: "LIVE" }
		: { authority: "dryrun", cls: "dryrun", labelDe: "DRYRUN" };
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
	};
	battery: {
		liveWriteAllowed: boolean;
		hardwareActive: boolean;
		currentAllocatedW: number | null;
	};
	wallbox: {
		liveWriteAllowed: boolean;
		hardwareActive: boolean;
		currentAllocatedW: number | null;
	};
	climate: {
		liveWriteAllowed: boolean;
		hardwareActive: boolean;
		currentAllocatedW: number | null;
	};
} {
	const thr = input.thresholdW ?? DEFAULT_ON_W;
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
			currentAllocatedW: ih.allocatedPowerW ?? null,
		},
		battery: {
			liveWriteAllowed: batLive,
			hardwareActive: isPowerActive(bat.chargingPowerW, thr),
			currentAllocatedW: bat.allocatedChargePowerW ?? null,
		},
		wallbox: {
			liveWriteAllowed: wbLive,
			hardwareActive: wb.charging === true || isPowerActive(wb.chargePowerW, thr),
			currentAllocatedW: wb.allocatedPowerW ?? null,
		},
		climate: {
			liveWriteAllowed: acLive,
			hardwareActive: acRunning,
			currentAllocatedW: ac.allocatedPowerW ?? null,
		},
	};
}

/** Aktueller Kühl-/Dry-Bedarf vs. nur Restlauf (Hysterese/Mindeslauf). */
export type ClimateDemandKind = "active" | "hold" | "none";

export type ClimateUnitDisplay = {
	phase: ExecutionDisplayPhase;
	badge: ExecutionDisplayBadge;
	demand: ClimateDemandKind;
	/** Jetzt-Zeile — Plan, Runtime und Ist konsistent. */
	nowLineDe: string;
	/** Hinweis unter der Karte. */
	noteDe: string;
	/** Planner-Energiebudget (nicht gleich Kühlbedarf). */
	planLineDe: string;
	/** Tagesprognose aus Learning/Contribution. */
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

function climateHeuteLineDe(input: {
	likelyActiveToday?: boolean | null;
	expectedHoursToday?: number | null;
	expectedKwhToday?: number | null;
}): string {
	if (
		input.likelyActiveToday === true &&
		input.expectedHoursToday != null &&
		Number.isFinite(input.expectedHoursToday) &&
		input.expectedKwhToday != null &&
		Number.isFinite(input.expectedKwhToday)
	) {
		const h = input.expectedHoursToday;
		const k = input.expectedKwhToday;
		return `~${h.toFixed(1).replace(/\.0$/, "")} h / ${k.toFixed(1).replace(".", ",")} kWh heute`;
	}
	return "kein Kühlbedarf geplant";
}

function climatePlanLineDe(allocatedPowerW: number | null | undefined): string {
	if (isPowerActive(allocatedPowerW)) return `Budget ${Math.round(allocatedPowerW!)} W`;
	return "kein Budget";
}

/**
 * Klima-Unit-Karte: Hardware-Ist + Runtime-Bedarf + Planner-Budget — ohne Widerspruch.
 *
 * - Hardware on + Bedarf → LÄUFT · Kühlbedarf aktiv
 * - Hardware on + kein neuer Bedarf (Hysterese/Restlauf) → LÄUFT · läuft wegen &lt;Grund&gt; weiter
 * - Hardware off + Budget + kein Bedarf → Bereit · aktuell kein Kühlbedarf
 * - Dryrun: niemals LÄUFT allein aus Allocation
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
}): ClimateUnitDisplay {
	const allocOn = isPowerActive(input.allocatedPowerW);
	const demand = classifyClimateDemand({
		hardwareRunning: input.hardwareRunning,
		decisionSource: input.decisionSource,
		reasonDe: input.reasonDe,
	});
	const heuteLineDe = climateHeuteLineDe(input);
	const planLineDe = climatePlanLineDe(input.allocatedPowerW ?? null);
	const reason = String(input.reasonDe ?? "").trim();

	if (!input.liveWriteAllowed) {
		const phase = resolveExecutionDisplayPhase({
			currentPlannedActive: allocOn,
			hasFuturePlan: input.hasFuturePlan === true,
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
		const noteDe =
			demand === "none" && allocOn
				? `Dryrun · Budget freigegeben, aktuell kein Kühlbedarf.`
				: reason || (phase === "dryrun" ? "Dryrun — keine realen Klima-Writes." : "Klima im Dryrun.");
		return { phase, badge, demand, nowLineDe, noteDe, planLineDe, heuteLineDe };
	}

	if (input.hardwareRunning) {
		const badge = executionDisplayBadge("running");
		if (demand === "active") {
			return {
				phase: "running",
				badge,
				demand,
				nowLineDe: "Läuft · Kühlbedarf aktiv",
				noteDe: reason || "Kühlbedarf aktiv.",
				planLineDe,
				heuteLineDe,
			};
		}
		const hold = climateHoldReasonDe(input.reasonDe);
		return {
			phase: "running",
			badge,
			demand: "hold",
			nowLineDe: `Läuft · kein neuer Kühlbedarf, läuft wegen ${hold} weiter`,
			noteDe: reason || `Kein neuer Kühlbedarf — läuft wegen ${hold} weiter.`,
			planLineDe,
			heuteLineDe,
		};
	}

	if (allocOn && demand === "none") {
		return {
			phase: "planned",
			badge: { phase: "planned", cls: "plan", labelDe: "Bereit" },
			demand,
			nowLineDe: "aktuell kein Kühlbedarf",
			noteDe:
				reason ||
				`Daily Plan stellt ${Math.round(input.allocatedPowerW!)} W bereit, aktuell kein Kühlbedarf.`,
			planLineDe,
			heuteLineDe,
		};
	}

	if (allocOn || input.hasFuturePlan === true || input.likelyActiveToday === true) {
		const phase: ExecutionDisplayPhase = "planned";
		return {
			phase,
			badge: executionDisplayBadge(phase),
			demand,
			nowLineDe: demand === "active" ? "Kühlbedarf — Start ausstehend" : "aus",
			noteDe: reason || "Klima geplant.",
			planLineDe,
			heuteLineDe,
		};
	}

	return {
		phase: "idle",
		badge: { phase: "idle", cls: "idle", labelDe: "Aus" },
		demand,
		nowLineDe: "aus",
		noteDe: reason || "Klima aus.",
		planLineDe,
		heuteLineDe,
	};
}
