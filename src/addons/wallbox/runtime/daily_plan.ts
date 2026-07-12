import { CONTRIBUTION_IDS } from "../../../operator/contribution_ids";
import {
	ALLOCATION_ADDON_STATE_IDS,
	DAILY_PLAN_STATE_IDS,
} from "../../../operator/daily_plan/states";
import { readDailyPlanJsonRaw } from "../../../operator/daily_plan/load";
import {
	slotStartIsoFloored,
	slotKey,
	DAILY_PLAN_SLOT_MS,
	slotDurationHours,
} from "../../../operator/daily_plan/slots";
import { isoFromMs, isValidIsoTimestamp, localDateKeyInTimezone } from "../../../operator/time";
import { intentAdminConfigFromAdapter } from "../../../intent/config";
import type {
	AllocationEnergySource,
	AllocationStatus,
	DailyAllocationEntry,
	DailyPlan,
	DailyPlanStatus,
} from "../../../operator/daily_plan/types";
import { wallboxMaxChargePowerW, round3 } from "../../../operator/contributions/flexible/types";
import type { EvccTelemetrySnapshot } from "../evcc_telemetry";
import type { WallboxEvccTelemetryConfig } from "../evcc_config";

const WALLBOX_CONTRIBUTION_ID = CONTRIBUTION_IDS.WALLBOX_EV_SESSION;
const ACTIVE_ALLOCATION_STATUSES = new Set<AllocationStatus>(["allocated", "partially_allocated"]);
const USABLE_DAILY_PLAN_STATUSES = new Set<DailyPlanStatus>(["ready", "degraded"]);
const SLOT_HOURS = slotDurationHours(15);

export type WallboxDailyPlanStatus =
	| "daily_plan_valid"
	| "daily_plan_zero_allocation"
	| "daily_plan_missing"
	| "daily_plan_invalid"
	| "daily_plan_expired"
	| "daily_plan_wrong_date"
	| "daily_plan_slot_missing"
	| "daily_plan_allocation_invalid"
	| "allocation_below_min_power"
	| "power_limits_unknown";

export type WallboxDecisionSource =
	| "daily_plan"
	| "daily_plan_zero"
	| "vehicle_disconnected"
	| "external_plan_only"
	| "no_plan"
	| "invalid_plan"
	| "governance_disabled"
	| "addon_disabled"
	| "missing_telemetry"
	| "mapping_incomplete"
	| "safe_default";

export type WallboxPlanExecutionStatus =
	| "in_plan"
	| "charging_without_plan"
	| "planned_but_not_charging"
	| "not_planned_not_charging"
	| "vehicle_disconnected"
	| "charging_below_plan"
	| "charging_above_plan"
	| "unknown";

/** Abweichungstoleranz zwischen geplanter und tatsächlicher Ladeleistung (W). */
export const WALLBOX_PLAN_POWER_TOLERANCE_W = 300;

export interface WallboxTelemetryInput {
	connected: boolean | null;
	charging: boolean | null;
	vehicleSocPct: number | null;
	planSocPct: number | null;
	planActive: boolean | null;
	sessionEnergyKwh: number | null;
	effectivePlanTime: string | null;
	planTime: string | null;
	activePhases: number | null;
	configuredPhases: number | null;
	minCurrentA: number | null;
	maxCurrentA: number | null;
	chargePowerW: number | null;
	evccConfigured: boolean;
	mappingsReady: boolean;
}

export interface WallboxPlanDecision {
	connected: boolean;
	planValid: boolean;
	useDailyPlan: boolean;
	chargingAllowedByPlan: boolean;
	dailyPlanStatus: WallboxDailyPlanStatus;
	dailyPlanRevision: number | null;
	slotStartIso: string | null;
	slotEndIso: string | null;
	allocatedPowerW: number | null;
	allocatedEnergyKwh: number | null;
	requestedPowerW: number | null;
	requestedEnergyKwh: number | null;
	pvPowerW: number | null;
	gridPowerW: number | null;
	energySource: AllocationEnergySource | "none";
	deadlineIso: string | null;
	estimatedCostCt: number | null;
	remainingEnergyKwh: number | null;
	minChargePowerW: number | null;
	maxChargePowerW: number | null;
	plannedEnergyUntilDeadlineKwh: number;
	plannedPvEnergyUntilDeadlineKwh: number;
	plannedGridEnergyUntilDeadlineKwh: number;
	plannedCostUntilDeadlineCt: number | null;
	deadlineReachable: boolean | null;
	firstPlannedSlot: string | null;
	lastPlannedSlot: string | null;
	activePlannedSlots: number;
	maxPlannedPowerW: number;
	planExecutionStatus: WallboxPlanExecutionStatus;
	decisionSource: WallboxDecisionSource;
	reasonDe: string;
	externalPlanActive: boolean;
	externalPlanTime: string | null;
	runtimeControlAvailable: false;
	writeAllowed: false;
}

export type DailyPlanReadHost = {
	config?: unknown;
	getStateAsync: (id: string) => Promise<ioBroker.State | null | undefined>;
};

interface DailyPlanMeta {
	status: string;
	date: string;
	revision: number;
	validUntil: string | null;
	timezone: string;
}

interface ParsedPlanCache {
	revision: number;
	entries: DailyAllocationEntry[];
	fullPlan: DailyPlan | null;
	parseError: boolean;
}

let planCache: ParsedPlanCache | null = null;

export function resetWallboxDailyPlanCache(): void {
	planCache = null;
}

export function wallboxMinChargePowerW(
	phases: number | null,
	minCurrentA: number | null,
	voltage = 230,
): number | null {
	if (phases === null || minCurrentA === null || phases <= 0 || minCurrentA <= 0) return null;
	return Math.round(phases * voltage * minCurrentA);
}

export function telemetryInputFromSnapshot(
	snap: EvccTelemetrySnapshot,
	cfg: WallboxEvccTelemetryConfig,
): WallboxTelemetryInput {
	const pickBool = (f: { status: string; value: boolean | null }): boolean | null =>
		f.status === "valid" ? f.value : null;
	const pickNum = (f: { status: string; value: number | null }): number | null =>
		f.status === "valid" ? f.value : null;
	const pickStr = (f: { status: string; value: string | null }): string | null =>
		f.status === "valid" ? f.value : null;

	return {
		connected: pickBool(snap.connected),
		charging: pickBool(snap.charging),
		vehicleSocPct: pickNum(snap.vehicle_soc_pct),
		planSocPct: pickNum(snap.plan_soc_pct),
		planActive: pickBool(snap.plan_active),
		sessionEnergyKwh: pickNum(snap.session_energy_kwh),
		effectivePlanTime: pickStr(snap.effective_plan_time),
		planTime: pickStr(snap.plan_time),
		activePhases: pickNum(snap.active_phases),
		configuredPhases: pickNum(snap.configured_phases),
		minCurrentA: pickNum(snap.min_current_a),
		maxCurrentA: pickNum(snap.max_current_a),
		chargePowerW: pickNum(snap.charge_power_w),
		evccConfigured: cfg.enabledStateId.trim().length > 0,
		mappingsReady: cfg.enabledStateId.trim().length > 0 && cfg.connectedStateId.trim().length > 0,
	};
}

export function computeRemainingEnergyKwh(
	telemetry: WallboxTelemetryInput,
	vehicleCapacityKwh: number | null = null,
): number | null {
	if (vehicleCapacityKwh !== null && vehicleCapacityKwh > 0) {
		const targetSoc = telemetry.planActive && telemetry.planSocPct !== null ? telemetry.planSocPct : telemetry.planSocPct;
		if (targetSoc !== null && telemetry.vehicleSocPct !== null) {
			const delta = targetSoc - telemetry.vehicleSocPct;
			if (delta <= 0) return 0;
			return round3((delta / 100) * vehicleCapacityKwh);
		}
	}
	return null;
}

function isValidTimezone(timezone: string): boolean {
	if (!timezone.trim()) return false;
	try {
		Intl.DateTimeFormat(undefined, { timeZone: timezone });
		return true;
	} catch {
		return false;
	}
}

function parseJson(raw: string | null): unknown {
	if (!raw || !raw.trim()) return null;
	try {
		return JSON.parse(raw);
	} catch {
		return undefined;
	}
}

function isDailyAllocationEntry(v: unknown): v is DailyAllocationEntry {
	if (!v || typeof v !== "object") return false;
	const o = v as Record<string, unknown>;
	return (
		typeof o.contributionId === "string" &&
		o.slot !== null &&
		typeof o.slot === "object" &&
		typeof (o.slot as { startIso?: unknown }).startIso === "string" &&
		typeof (o.slot as { endIso?: unknown }).endIso === "string" &&
		typeof o.status === "string"
	);
}

export function parseDailyAllocationEntries(raw: unknown): DailyAllocationEntry[] | null {
	if (raw === null || raw === undefined) return null;
	if (typeof raw === "string") {
		if (!raw.trim()) return null;
		try {
			raw = JSON.parse(raw);
		} catch {
			return null;
		}
	}
	if (!Array.isArray(raw)) return null;
	const out: DailyAllocationEntry[] = [];
	for (const item of raw) {
		if (!isDailyAllocationEntry(item)) return null;
		out.push(item);
	}
	return out;
}

function parseFullDailyPlan(raw: unknown): DailyPlan | null {
	if (raw === null || raw === undefined) return null;
	if (typeof raw === "string") {
		if (!raw.trim()) return null;
		try {
			raw = JSON.parse(raw);
		} catch {
			return null;
		}
	}
	if (!raw || typeof raw !== "object") return null;
	const p = raw as Partial<DailyPlan>;
	if (typeof p.date !== "string" || !Array.isArray(p.allocations)) return null;
	return raw as DailyPlan;
}

function wallboxEntriesFromSources(
	allocationEntries: DailyAllocationEntry[] | null,
	fullPlan: DailyPlan | null,
): DailyAllocationEntry[] {
	const seen = new Set<string>();
	const out: DailyAllocationEntry[] = [];
	const add = (entries: DailyAllocationEntry[]): void => {
		for (const e of entries) {
			if (e.contributionId !== WALLBOX_CONTRIBUTION_ID) continue;
			const key = `${e.contributionId}|${slotKey(e.slot.startIso, e.slot.endIso)}`;
			if (seen.has(key)) continue;
			seen.add(key);
			out.push(e);
		}
	};
	if (allocationEntries) add(allocationEntries);
	if (fullPlan) {
		add(fullPlan.allocations.filter((a) => a.contributionId === WALLBOX_CONTRIBUTION_ID));
	}
	return out;
}

function entryEnergyKwh(entry: DailyAllocationEntry): number {
	if (entry.allocatedEnergyKwh !== null && Number.isFinite(entry.allocatedEnergyKwh)) {
		return entry.allocatedEnergyKwh;
	}
	if (entry.allocatedPowerW !== null && entry.allocatedPowerW > 0) {
		return round3((entry.allocatedPowerW * SLOT_HOURS) / 1000);
	}
	return 0;
}

export interface WallboxPowerLimits {
	minChargePowerW: number | null;
	maxChargePowerW: number | null;
	degraded: boolean;
	reasonDe: string;
}

export function resolveWallboxPowerLimits(telemetry: WallboxTelemetryInput): WallboxPowerLimits {
	const phases = telemetry.activePhases ?? telemetry.configuredPhases;
	const maxW = wallboxMaxChargePowerW(phases, telemetry.maxCurrentA);
	const minW = wallboxMinChargePowerW(phases, telemetry.minCurrentA);
	if (maxW === null) {
		return {
			minChargePowerW: minW,
			maxChargePowerW: null,
			degraded: true,
			reasonDe: "Phasen- oder Stromdaten fehlen — technische Leistungsgrenze unbekannt.",
		};
	}
	return {
		minChargePowerW: minW,
		maxChargePowerW: maxW,
		degraded: false,
		reasonDe: `Technische Leistungsgrenze ${maxW} W (${phases ?? "?"} Phasen).`,
	};
}

export interface DeadlineHorizonSummary {
	plannedEnergyUntilDeadlineKwh: number;
	plannedPvEnergyUntilDeadlineKwh: number;
	plannedGridEnergyUntilDeadlineKwh: number;
	plannedCostUntilDeadlineCt: number | null;
	firstPlannedSlot: string | null;
	lastPlannedSlot: string | null;
	activePlannedSlots: number;
	maxPlannedPowerW: number;
}

export function summarizeWallboxPlanUntilDeadline(
	entries: DailyAllocationEntry[],
	deadlineIso: string | null,
	nowMs: number,
): DeadlineHorizonSummary {
	const deadlineMs = deadlineIso ? Date.parse(deadlineIso) : null;
	let plannedEnergy = 0;
	let plannedPv = 0;
	let plannedGrid = 0;
	let plannedCost: number | null = null;
	let hasCost = false;
	let activeSlots = 0;
	let maxPower = 0;
	let firstSlot: string | null = null;
	let lastSlot: string | null = null;

	for (const entry of entries) {
		if (entry.contributionId !== WALLBOX_CONTRIBUTION_ID) continue;
		if (!ACTIVE_ALLOCATION_STATUSES.has(entry.status)) continue;
		const startMs = Date.parse(entry.slot.startIso);
		if (!Number.isFinite(startMs) || startMs < nowMs) continue;
		if (deadlineMs !== null && Number.isFinite(deadlineMs) && startMs >= deadlineMs) continue;

		const energy = entryEnergyKwh(entry);
		plannedEnergy += energy;

		if (entry.energySource === "pv_surplus") {
			plannedPv += energy;
		} else if (entry.energySource === "grid") {
			plannedGrid += energy;
		} else if (entry.energySource === "mixed") {
			const total = entry.pvPowerW + entry.gridPowerW;
			if (total > 0) {
				plannedPv += energy * (entry.pvPowerW / total);
				plannedGrid += energy * (entry.gridPowerW / total);
			}
		}

		if (entry.estimatedCostCt !== null && Number.isFinite(entry.estimatedCostCt)) {
			plannedCost = (plannedCost ?? 0) + entry.estimatedCostCt;
			hasCost = true;
		}

		activeSlots += 1;
		if (entry.allocatedPowerW !== null) {
			maxPower = Math.max(maxPower, entry.allocatedPowerW);
		}
		if (!firstSlot || entry.slot.startIso < firstSlot) firstSlot = entry.slot.startIso;
		if (!lastSlot || entry.slot.startIso > lastSlot) lastSlot = entry.slot.startIso;
	}

	return {
		plannedEnergyUntilDeadlineKwh: round3(plannedEnergy),
		plannedPvEnergyUntilDeadlineKwh: round3(plannedPv),
		plannedGridEnergyUntilDeadlineKwh: round3(plannedGrid),
		plannedCostUntilDeadlineCt: hasCost ? round3(plannedCost ?? 0) : null,
		firstPlannedSlot: firstSlot,
		lastPlannedSlot: lastSlot,
		activePlannedSlots: activeSlots,
		maxPlannedPowerW: maxPower,
	};
}

function mergeCurrentSlotAllocation(
	entries: DailyAllocationEntry[],
	slotStartIso: string,
	slotEndIso: string,
): {
	valid: boolean;
	entry: DailyAllocationEntry | null;
	reasonDe: string;
} {
	const key = slotKey(slotStartIso, slotEndIso);
	let found: DailyAllocationEntry | null = null;
	for (const entry of entries) {
		if (entry.contributionId !== WALLBOX_CONTRIBUTION_ID) continue;
		if (slotKey(entry.slot.startIso, entry.slot.endIso) !== key) continue;
		if (found) {
			return { valid: false, entry: null, reasonDe: "Doppelte Wallbox-Allocation im selben Slot." };
		}
		found = entry;
	}
	return { valid: true, entry: found, reasonDe: "" };
}

function planExecutionStatus(
	connected: boolean,
	charging: boolean | null,
	chargingAllowedByPlan: boolean,
	allocatedPowerW: number | null,
	chargePowerW: number | null = null,
): WallboxPlanExecutionStatus {
	if (!connected) return "vehicle_disconnected";
	if (charging === true) {
		if (chargingAllowedByPlan && (allocatedPowerW ?? 0) > 0) {
			if (chargePowerW !== null && allocatedPowerW !== null) {
				if (chargePowerW < allocatedPowerW - WALLBOX_PLAN_POWER_TOLERANCE_W) {
					return "charging_below_plan";
				}
				if (chargePowerW > allocatedPowerW + WALLBOX_PLAN_POWER_TOLERANCE_W) {
					return "charging_above_plan";
				}
			}
			return "in_plan";
		}
		return "charging_without_plan";
	}
	if (charging === false) {
		if (chargingAllowedByPlan && (allocatedPowerW ?? 0) > 0) return "planned_but_not_charging";
		return "not_planned_not_charging";
	}
	return "unknown";
}

export function resolveWallboxPlanExecutionStatus(
	connected: boolean,
	charging: boolean | null,
	chargingAllowedByPlan: boolean,
	allocatedPowerW: number | null,
	chargePowerW: number | null = null,
): WallboxPlanExecutionStatus {
	return planExecutionStatus(connected, charging, chargingAllowedByPlan, allocatedPowerW, chargePowerW);
}

function disconnectedDecision(telemetry: WallboxTelemetryInput): WallboxPlanDecision {
	return {
		connected: false,
		planValid: false,
		useDailyPlan: false,
		chargingAllowedByPlan: false,
		dailyPlanStatus: "daily_plan_missing",
		dailyPlanRevision: null,
		slotStartIso: null,
		slotEndIso: null,
		allocatedPowerW: null,
		allocatedEnergyKwh: null,
		requestedPowerW: null,
		requestedEnergyKwh: null,
		pvPowerW: null,
		gridPowerW: null,
		energySource: "none",
		deadlineIso: null,
		estimatedCostCt: null,
		remainingEnergyKwh: null,
		minChargePowerW: null,
		maxChargePowerW: null,
		plannedEnergyUntilDeadlineKwh: 0,
		plannedPvEnergyUntilDeadlineKwh: 0,
		plannedGridEnergyUntilDeadlineKwh: 0,
		plannedCostUntilDeadlineCt: null,
		deadlineReachable: null,
		firstPlannedSlot: null,
		lastPlannedSlot: null,
		activePlannedSlots: 0,
		maxPlannedPowerW: 0,
		planExecutionStatus: "vehicle_disconnected",
		decisionSource: "vehicle_disconnected",
		reasonDe: "Fahrzeug ist nicht verbunden; es wird keine Ladeaktion geplant.",
		externalPlanActive: telemetry.planActive === true,
		externalPlanTime: telemetry.effectivePlanTime ?? telemetry.planTime,
		runtimeControlAvailable: false,
		writeAllowed: false,
	};
}

export interface EvaluateWallboxPlanInput {
	now: Date;
	timezone: string;
	meta: DailyPlanMeta;
	entries: DailyAllocationEntry[];
	telemetry: WallboxTelemetryInput;
	governanceEnabled: boolean;
	addonEnabled: boolean;
	vehicleCapacityKwh?: number | null;
}

export function evaluateWallboxDailyPlan(input: EvaluateWallboxPlanInput): WallboxPlanDecision {
	const { now, timezone, meta, entries, telemetry, governanceEnabled, addonEnabled } = input;
	const nowMs = now.getTime();
	const powerLimits = resolveWallboxPowerLimits(telemetry);
	const externalPlanActive = telemetry.planActive === true;
	const externalPlanTime = telemetry.effectivePlanTime ?? telemetry.planTime;

	if (!addonEnabled) {
		return {
			...disconnectedDecision({ ...telemetry, connected: false }),
			decisionSource: "addon_disabled",
			reasonDe: "Wallbox-Add-on deaktiviert — keine Planfreigabe.",
			externalPlanActive,
			externalPlanTime,
		};
	}

	if (!telemetry.mappingsReady) {
		return {
			...disconnectedDecision({ ...telemetry, connected: telemetry.connected }),
			decisionSource: "mapping_incomplete",
			reasonDe: "EVCC-Mapping unvollständig — keine Ladefreigabe.",
			minChargePowerW: powerLimits.minChargePowerW,
			maxChargePowerW: powerLimits.maxChargePowerW,
			externalPlanActive,
			externalPlanTime,
		};
	}

	if (telemetry.connected === null) {
		return {
			...disconnectedDecision({ ...telemetry, connected: false }),
			decisionSource: "missing_telemetry",
			reasonDe: "Verbindungsstatus unbekannt — keine Ladefreigabe.",
			externalPlanActive,
			externalPlanTime,
		};
	}

	if (telemetry.connected === false) {
		return disconnectedDecision(telemetry);
	}

	if (!governanceEnabled) {
		const remaining = null;
		return {
			connected: true,
			planValid: false,
			useDailyPlan: false,
			chargingAllowedByPlan: false,
			dailyPlanStatus: "daily_plan_missing",
			dailyPlanRevision: meta.revision,
			slotStartIso: null,
			slotEndIso: null,
			allocatedPowerW: null,
			allocatedEnergyKwh: null,
			requestedPowerW: null,
			requestedEnergyKwh: null,
			pvPowerW: null,
			gridPowerW: null,
			energySource: "none",
			deadlineIso: telemetry.effectivePlanTime,
			estimatedCostCt: null,
			remainingEnergyKwh: remaining,
			minChargePowerW: powerLimits.minChargePowerW,
			maxChargePowerW: powerLimits.maxChargePowerW,
			plannedEnergyUntilDeadlineKwh: 0,
			plannedPvEnergyUntilDeadlineKwh: 0,
			plannedGridEnergyUntilDeadlineKwh: 0,
			plannedCostUntilDeadlineCt: null,
			deadlineReachable: null,
			firstPlannedSlot: null,
			lastPlannedSlot: null,
			activePlannedSlots: 0,
			maxPlannedPowerW: 0,
			planExecutionStatus: planExecutionStatus(true, telemetry.charging, false, null),
			decisionSource: "governance_disabled",
			reasonDe: "Wallbox-Governance deaktiviert — keine aktive Planfreigabe.",
			externalPlanActive,
			externalPlanTime,
			runtimeControlAvailable: false,
			writeAllowed: false,
		};
	}

	const remainingEnergyKwh = computeRemainingEnergyKwh(telemetry, input.vehicleCapacityKwh ?? null);
	const deadlineIso = telemetry.effectivePlanTime;

	const horizon = summarizeWallboxPlanUntilDeadline(entries, deadlineIso, nowMs);

	let deadlineReachable: boolean | null = null;
	if (remainingEnergyKwh !== null && horizon.plannedEnergyUntilDeadlineKwh > 0) {
		deadlineReachable = horizon.plannedEnergyUntilDeadlineKwh >= remainingEnergyKwh;
	} else if (remainingEnergyKwh !== null && horizon.plannedEnergyUntilDeadlineKwh === 0) {
		deadlineReachable = remainingEnergyKwh <= 0;
	}

	if (!meta.status || meta.status === "not_initialized") {
		const decisionSource: WallboxDecisionSource = externalPlanActive ? "external_plan_only" : "no_plan";
		return {
			connected: true,
			planValid: false,
			useDailyPlan: false,
			chargingAllowedByPlan: false,
			dailyPlanStatus: "daily_plan_missing",
			dailyPlanRevision: meta.revision,
			slotStartIso: null,
			slotEndIso: null,
			allocatedPowerW: null,
			allocatedEnergyKwh: null,
			requestedPowerW: null,
			requestedEnergyKwh: null,
			pvPowerW: null,
			gridPowerW: null,
			energySource: "none",
			deadlineIso,
			estimatedCostCt: null,
			remainingEnergyKwh,
			minChargePowerW: powerLimits.minChargePowerW,
			maxChargePowerW: powerLimits.maxChargePowerW,
			plannedEnergyUntilDeadlineKwh: horizon.plannedEnergyUntilDeadlineKwh,
			plannedPvEnergyUntilDeadlineKwh: horizon.plannedPvEnergyUntilDeadlineKwh,
			plannedGridEnergyUntilDeadlineKwh: horizon.plannedGridEnergyUntilDeadlineKwh,
			plannedCostUntilDeadlineCt: horizon.plannedCostUntilDeadlineCt,
			deadlineReachable,
			firstPlannedSlot: horizon.firstPlannedSlot,
			lastPlannedSlot: horizon.lastPlannedSlot,
			activePlannedSlots: horizon.activePlannedSlots,
			maxPlannedPowerW: horizon.maxPlannedPowerW,
			planExecutionStatus: planExecutionStatus(true, telemetry.charging, false, null),
			decisionSource,
			reasonDe:
				decisionSource === "external_plan_only"
					? "Kein gültiger EMS Daily Plan — externer EVCC-Plan nur diagnostisch."
					: "Daily Plan fehlt — Wallbox bleibt read-only.",
			externalPlanActive,
			externalPlanTime,
			runtimeControlAvailable: false,
			writeAllowed: false,
		};
	}

	if (!USABLE_DAILY_PLAN_STATUSES.has(meta.status as DailyPlanStatus)) {
		return {
			connected: true,
			planValid: false,
			useDailyPlan: false,
			chargingAllowedByPlan: false,
			dailyPlanStatus: "daily_plan_invalid",
			dailyPlanRevision: meta.revision,
			slotStartIso: null,
			slotEndIso: null,
			allocatedPowerW: null,
			allocatedEnergyKwh: null,
			requestedPowerW: null,
			requestedEnergyKwh: null,
			pvPowerW: null,
			gridPowerW: null,
			energySource: "none",
			deadlineIso,
			estimatedCostCt: null,
			remainingEnergyKwh,
			minChargePowerW: powerLimits.minChargePowerW,
			maxChargePowerW: powerLimits.maxChargePowerW,
			plannedEnergyUntilDeadlineKwh: horizon.plannedEnergyUntilDeadlineKwh,
			plannedPvEnergyUntilDeadlineKwh: horizon.plannedPvEnergyUntilDeadlineKwh,
			plannedGridEnergyUntilDeadlineKwh: horizon.plannedGridEnergyUntilDeadlineKwh,
			plannedCostUntilDeadlineCt: horizon.plannedCostUntilDeadlineCt,
			deadlineReachable,
			firstPlannedSlot: horizon.firstPlannedSlot,
			lastPlannedSlot: horizon.lastPlannedSlot,
			activePlannedSlots: horizon.activePlannedSlots,
			maxPlannedPowerW: horizon.maxPlannedPowerW,
			planExecutionStatus: planExecutionStatus(true, telemetry.charging, false, null),
			decisionSource: "invalid_plan",
			reasonDe: `Daily Plan Status „${meta.status}“ ungültig — keine EMS-Ladefreigabe.`,
			externalPlanActive,
			externalPlanTime,
			runtimeControlAvailable: false,
			writeAllowed: false,
		};
	}

	if (!isValidTimezone(timezone)) {
		return {
			connected: true,
			planValid: false,
			useDailyPlan: false,
			chargingAllowedByPlan: false,
			dailyPlanStatus: "daily_plan_invalid",
			dailyPlanRevision: meta.revision,
			slotStartIso: null,
			slotEndIso: null,
			allocatedPowerW: null,
			allocatedEnergyKwh: null,
			requestedPowerW: null,
			requestedEnergyKwh: null,
			pvPowerW: null,
			gridPowerW: null,
			energySource: "none",
			deadlineIso,
			estimatedCostCt: null,
			remainingEnergyKwh,
			minChargePowerW: powerLimits.minChargePowerW,
			maxChargePowerW: powerLimits.maxChargePowerW,
			plannedEnergyUntilDeadlineKwh: horizon.plannedEnergyUntilDeadlineKwh,
			plannedPvEnergyUntilDeadlineKwh: horizon.plannedPvEnergyUntilDeadlineKwh,
			plannedGridEnergyUntilDeadlineKwh: horizon.plannedGridEnergyUntilDeadlineKwh,
			plannedCostUntilDeadlineCt: horizon.plannedCostUntilDeadlineCt,
			deadlineReachable,
			firstPlannedSlot: horizon.firstPlannedSlot,
			lastPlannedSlot: horizon.lastPlannedSlot,
			activePlannedSlots: horizon.activePlannedSlots,
			maxPlannedPowerW: horizon.maxPlannedPowerW,
			planExecutionStatus: planExecutionStatus(true, telemetry.charging, false, null),
			decisionSource: "invalid_plan",
			reasonDe: "Zeitzone ungültig — Daily Plan nicht verwendbar.",
			externalPlanActive,
			externalPlanTime,
			runtimeControlAvailable: false,
			writeAllowed: false,
		};
	}

	const localDate = localDateKeyInTimezone(now, timezone);
	if (meta.date !== localDate) {
		return {
			connected: true,
			planValid: false,
			useDailyPlan: false,
			chargingAllowedByPlan: false,
			dailyPlanStatus: "daily_plan_wrong_date",
			dailyPlanRevision: meta.revision,
			slotStartIso: null,
			slotEndIso: null,
			allocatedPowerW: null,
			allocatedEnergyKwh: null,
			requestedPowerW: null,
			requestedEnergyKwh: null,
			pvPowerW: null,
			gridPowerW: null,
			energySource: "none",
			deadlineIso,
			estimatedCostCt: null,
			remainingEnergyKwh,
			minChargePowerW: powerLimits.minChargePowerW,
			maxChargePowerW: powerLimits.maxChargePowerW,
			plannedEnergyUntilDeadlineKwh: horizon.plannedEnergyUntilDeadlineKwh,
			plannedPvEnergyUntilDeadlineKwh: horizon.plannedPvEnergyUntilDeadlineKwh,
			plannedGridEnergyUntilDeadlineKwh: horizon.plannedGridEnergyUntilDeadlineKwh,
			plannedCostUntilDeadlineCt: horizon.plannedCostUntilDeadlineCt,
			deadlineReachable,
			firstPlannedSlot: horizon.firstPlannedSlot,
			lastPlannedSlot: horizon.lastPlannedSlot,
			activePlannedSlots: horizon.activePlannedSlots,
			maxPlannedPowerW: horizon.maxPlannedPowerW,
			planExecutionStatus: planExecutionStatus(true, telemetry.charging, false, null),
			decisionSource: "invalid_plan",
			reasonDe: `Daily Plan Datum (${meta.date}) passt nicht zum lokalen Tag (${localDate}).`,
			externalPlanActive,
			externalPlanTime,
			runtimeControlAvailable: false,
			writeAllowed: false,
		};
	}

	if (meta.validUntil) {
		const validUntilMs = Date.parse(meta.validUntil);
		if (!Number.isFinite(validUntilMs) || nowMs > validUntilMs) {
			return {
				connected: true,
				planValid: false,
				useDailyPlan: false,
				chargingAllowedByPlan: false,
				dailyPlanStatus: "daily_plan_expired",
				dailyPlanRevision: meta.revision,
				slotStartIso: null,
				slotEndIso: null,
				allocatedPowerW: null,
				allocatedEnergyKwh: null,
				requestedPowerW: null,
				requestedEnergyKwh: null,
				pvPowerW: null,
				gridPowerW: null,
				energySource: "none",
				deadlineIso,
				estimatedCostCt: null,
				remainingEnergyKwh,
				minChargePowerW: powerLimits.minChargePowerW,
				maxChargePowerW: powerLimits.maxChargePowerW,
				plannedEnergyUntilDeadlineKwh: horizon.plannedEnergyUntilDeadlineKwh,
				plannedPvEnergyUntilDeadlineKwh: horizon.plannedPvEnergyUntilDeadlineKwh,
				plannedGridEnergyUntilDeadlineKwh: horizon.plannedGridEnergyUntilDeadlineKwh,
				plannedCostUntilDeadlineCt: horizon.plannedCostUntilDeadlineCt,
				deadlineReachable,
				firstPlannedSlot: horizon.firstPlannedSlot,
				lastPlannedSlot: horizon.lastPlannedSlot,
				activePlannedSlots: horizon.activePlannedSlots,
				maxPlannedPowerW: horizon.maxPlannedPowerW,
				planExecutionStatus: planExecutionStatus(true, telemetry.charging, false, null),
				decisionSource: "invalid_plan",
				reasonDe: "Daily Plan abgelaufen — keine EMS-Ladefreigabe.",
				externalPlanActive,
				externalPlanTime,
				runtimeControlAvailable: false,
				writeAllowed: false,
			};
		}
	}

	const slotStartIso = slotStartIsoFloored(now, timezone);
	if (!isValidIsoTimestamp(slotStartIso)) {
		return {
			connected: true,
			planValid: false,
			useDailyPlan: false,
			chargingAllowedByPlan: false,
			dailyPlanStatus: "daily_plan_slot_missing",
			dailyPlanRevision: meta.revision,
			slotStartIso: null,
			slotEndIso: null,
			allocatedPowerW: null,
			allocatedEnergyKwh: null,
			requestedPowerW: null,
			requestedEnergyKwh: null,
			pvPowerW: null,
			gridPowerW: null,
			energySource: "none",
			deadlineIso,
			estimatedCostCt: null,
			remainingEnergyKwh,
			minChargePowerW: powerLimits.minChargePowerW,
			maxChargePowerW: powerLimits.maxChargePowerW,
			plannedEnergyUntilDeadlineKwh: horizon.plannedEnergyUntilDeadlineKwh,
			plannedPvEnergyUntilDeadlineKwh: horizon.plannedPvEnergyUntilDeadlineKwh,
			plannedGridEnergyUntilDeadlineKwh: horizon.plannedGridEnergyUntilDeadlineKwh,
			plannedCostUntilDeadlineCt: horizon.plannedCostUntilDeadlineCt,
			deadlineReachable,
			firstPlannedSlot: horizon.firstPlannedSlot,
			lastPlannedSlot: horizon.lastPlannedSlot,
			activePlannedSlots: horizon.activePlannedSlots,
			maxPlannedPowerW: horizon.maxPlannedPowerW,
			planExecutionStatus: planExecutionStatus(true, telemetry.charging, false, null),
			decisionSource: "invalid_plan",
			reasonDe: "Aktueller Daily-Plan-Slot nicht bestimmbar.",
			externalPlanActive,
			externalPlanTime,
			runtimeControlAvailable: false,
			writeAllowed: false,
		};
	}

	const slotStartMs = Date.parse(slotStartIso);
	const slotEndIso = isoFromMs(slotStartMs + DAILY_PLAN_SLOT_MS);

	const slotMerge = mergeCurrentSlotAllocation(entries, slotStartIso, slotEndIso);
	if (!slotMerge.valid) {
		return {
			connected: true,
			planValid: false,
			useDailyPlan: false,
			chargingAllowedByPlan: false,
			dailyPlanStatus: "daily_plan_allocation_invalid",
			dailyPlanRevision: meta.revision,
			slotStartIso,
			slotEndIso,
			allocatedPowerW: null,
			allocatedEnergyKwh: null,
			requestedPowerW: null,
			requestedEnergyKwh: null,
			pvPowerW: null,
			gridPowerW: null,
			energySource: "none",
			deadlineIso,
			estimatedCostCt: null,
			remainingEnergyKwh,
			minChargePowerW: powerLimits.minChargePowerW,
			maxChargePowerW: powerLimits.maxChargePowerW,
			plannedEnergyUntilDeadlineKwh: horizon.plannedEnergyUntilDeadlineKwh,
			plannedPvEnergyUntilDeadlineKwh: horizon.plannedPvEnergyUntilDeadlineKwh,
			plannedGridEnergyUntilDeadlineKwh: horizon.plannedGridEnergyUntilDeadlineKwh,
			plannedCostUntilDeadlineCt: horizon.plannedCostUntilDeadlineCt,
			deadlineReachable,
			firstPlannedSlot: horizon.firstPlannedSlot,
			lastPlannedSlot: horizon.lastPlannedSlot,
			activePlannedSlots: horizon.activePlannedSlots,
			maxPlannedPowerW: horizon.maxPlannedPowerW,
			planExecutionStatus: planExecutionStatus(true, telemetry.charging, false, null),
			decisionSource: "invalid_plan",
			reasonDe: slotMerge.reasonDe,
			externalPlanActive,
			externalPlanTime,
			runtimeControlAvailable: false,
			writeAllowed: false,
		};
	}

	const entry = slotMerge.entry;
	let allocatedPowerW: number | null = null;
	let allocatedEnergyKwh: number | null = null;
	let requestedPowerW: number | null = null;
	let requestedEnergyKwh: number | null = null;
	let pvPowerW: number | null = null;
	let gridPowerW: number | null = null;
	let energySource: AllocationEnergySource | "none" = "none";
	let estimatedCostCt: number | null = null;
	let dailyPlanStatus: WallboxDailyPlanStatus = "daily_plan_zero_allocation";
	let chargingAllowedByPlan = false;
	let reasonDe = "Daily Plan: im aktuellen Slot keine Wallbox-Ladefreigabe (0 W).";

	if (entry && ACTIVE_ALLOCATION_STATUSES.has(entry.status)) {
		if (entry.allocatedPowerW === null || !Number.isFinite(entry.allocatedPowerW) || entry.allocatedPowerW < 0) {
			return {
				connected: true,
				planValid: true,
				useDailyPlan: true,
				chargingAllowedByPlan: false,
				dailyPlanStatus: "daily_plan_allocation_invalid",
				dailyPlanRevision: meta.revision,
				slotStartIso,
				slotEndIso,
				allocatedPowerW: null,
				allocatedEnergyKwh: null,
				requestedPowerW: entry.requestedPowerW,
				requestedEnergyKwh: entry.requestedEnergyKwh,
				pvPowerW: null,
				gridPowerW: null,
				energySource: "none",
				deadlineIso: entry.deadlineIso ?? deadlineIso,
				estimatedCostCt: null,
				remainingEnergyKwh,
				minChargePowerW: powerLimits.minChargePowerW,
				maxChargePowerW: powerLimits.maxChargePowerW,
				plannedEnergyUntilDeadlineKwh: horizon.plannedEnergyUntilDeadlineKwh,
				plannedPvEnergyUntilDeadlineKwh: horizon.plannedPvEnergyUntilDeadlineKwh,
				plannedGridEnergyUntilDeadlineKwh: horizon.plannedGridEnergyUntilDeadlineKwh,
				plannedCostUntilDeadlineCt: horizon.plannedCostUntilDeadlineCt,
				deadlineReachable,
				firstPlannedSlot: horizon.firstPlannedSlot,
				lastPlannedSlot: horizon.lastPlannedSlot,
				activePlannedSlots: horizon.activePlannedSlots,
				maxPlannedPowerW: horizon.maxPlannedPowerW,
				planExecutionStatus: planExecutionStatus(true, telemetry.charging, false, null),
				decisionSource: "invalid_plan",
				reasonDe: "Ungültige Wallbox-Allocation-Leistung.",
				externalPlanActive,
				externalPlanTime,
				runtimeControlAvailable: false,
				writeAllowed: false,
			};
		}

		allocatedPowerW = entry.allocatedPowerW;
		if (powerLimits.maxChargePowerW !== null && allocatedPowerW > powerLimits.maxChargePowerW) {
			allocatedPowerW = powerLimits.maxChargePowerW;
		}
		allocatedEnergyKwh = entry.allocatedEnergyKwh;
		requestedPowerW = entry.requestedPowerW;
		requestedEnergyKwh = entry.requestedEnergyKwh;
		pvPowerW = entry.pvPowerW;
		gridPowerW = entry.gridPowerW;
		energySource = entry.energySource;
		estimatedCostCt = entry.estimatedCostCt;
		dailyPlanStatus = allocatedPowerW > 0 ? "daily_plan_valid" : "daily_plan_zero_allocation";

		if (powerLimits.degraded) {
			dailyPlanStatus = "power_limits_unknown";
			chargingAllowedByPlan = false;
			reasonDe = powerLimits.reasonDe;
		} else if (allocatedPowerW <= 0) {
			chargingAllowedByPlan = false;
			reasonDe = "Daily Plan: keine Ladefreigabe im aktuellen Slot.";
		} else if (
			powerLimits.minChargePowerW !== null &&
			allocatedPowerW < powerLimits.minChargePowerW
		) {
			dailyPlanStatus = "allocation_below_min_power";
			chargingAllowedByPlan = false;
			reasonDe = `Allozierte Leistung ${allocatedPowerW} W liegt unter der technischen Mindestladeleistung ${powerLimits.minChargePowerW} W.`;
		} else {
			chargingAllowedByPlan = true;
			reasonDe = `Daily Plan sieht ${allocatedPowerW} W Ladeleistung vor; Wallbox-Steuerung ist noch read-only.`;
		}
	}

	const decisionSource: WallboxDecisionSource =
		allocatedPowerW !== null && allocatedPowerW > 0 && chargingAllowedByPlan
			? "daily_plan"
			: allocatedPowerW !== null && allocatedPowerW === 0
				? "daily_plan_zero"
				: chargingAllowedByPlan
					? "daily_plan"
					: "daily_plan_zero";

	if (telemetry.charging && !chargingAllowedByPlan) {
		reasonDe = `Fahrzeug lädt aktuell${externalPlanActive ? " über EVCC" : ""}; EMS Daily Plan enthält im Slot keine Ladefreigabe.`;
	} else if (telemetry.charging && chargingAllowedByPlan) {
		reasonDe = `Fahrzeug lädt aktuell${externalPlanActive ? " über EVCC" : ""}; EMS Daily Plan sieht ${allocatedPowerW} W vor (read-only).`;
	}

	return {
		connected: true,
		planValid: true,
		useDailyPlan: true,
		chargingAllowedByPlan,
		dailyPlanStatus,
		dailyPlanRevision: meta.revision,
		slotStartIso,
		slotEndIso,
		allocatedPowerW,
		allocatedEnergyKwh,
		requestedPowerW,
		requestedEnergyKwh,
		pvPowerW,
		gridPowerW,
		energySource,
		deadlineIso: entry?.deadlineIso ?? deadlineIso,
		estimatedCostCt,
		remainingEnergyKwh,
		minChargePowerW: powerLimits.minChargePowerW,
		maxChargePowerW: powerLimits.maxChargePowerW,
		plannedEnergyUntilDeadlineKwh: horizon.plannedEnergyUntilDeadlineKwh,
		plannedPvEnergyUntilDeadlineKwh: horizon.plannedPvEnergyUntilDeadlineKwh,
		plannedGridEnergyUntilDeadlineKwh: horizon.plannedGridEnergyUntilDeadlineKwh,
		plannedCostUntilDeadlineCt: horizon.plannedCostUntilDeadlineCt,
		deadlineReachable,
		firstPlannedSlot: horizon.firstPlannedSlot,
		lastPlannedSlot: horizon.lastPlannedSlot,
		activePlannedSlots: horizon.activePlannedSlots,
		maxPlannedPowerW: horizon.maxPlannedPowerW,
		planExecutionStatus: planExecutionStatus(
			true,
			telemetry.charging,
			chargingAllowedByPlan,
			allocatedPowerW,
			telemetry.chargePowerW,
		),
		decisionSource,
		reasonDe,
		externalPlanActive,
		externalPlanTime,
		runtimeControlAvailable: false,
		writeAllowed: false,
	};
}

async function readStr(host: DailyPlanReadHost, id: string): Promise<string | null> {
	try {
		const st = await host.getStateAsync(id);
		if (st?.val === null || st?.val === undefined) return null;
		return String(st.val);
	} catch {
		return null;
	}
}

async function readNum(host: DailyPlanReadHost, id: string): Promise<number | null> {
	const raw = await readStr(host, id);
	if (raw === null || raw === "") return null;
	const n = parseFloat(raw);
	return Number.isFinite(n) ? n : null;
}

async function loadPlanData(host: DailyPlanReadHost): Promise<{
	meta: DailyPlanMeta;
	entries: DailyAllocationEntry[];
	parseError: boolean;
}> {
	const adminCfg = intentAdminConfigFromAdapter(host.config);
	const timezone = adminCfg.timezone || "Europe/Berlin";
	const status = (await readStr(host, DAILY_PLAN_STATE_IDS.status)) ?? "";
	const date = (await readStr(host, DAILY_PLAN_STATE_IDS.date)) ?? "";
	const revision = (await readNum(host, DAILY_PLAN_STATE_IDS.revision)) ?? 0;
	const validUntilRaw = await readStr(host, DAILY_PLAN_STATE_IDS.validUntil);
	const validUntil = validUntilRaw && validUntilRaw.trim() ? validUntilRaw : null;
	const meta: DailyPlanMeta = { status, date, revision, validUntil, timezone };

	if (planCache && planCache.revision === revision && !planCache.parseError) {
		return { meta, entries: planCache.entries, parseError: false };
	}

	const allocationRaw = parseJson(await readStr(host, ALLOCATION_ADDON_STATE_IDS.wallbox.planJson));
	const allocationEntries = parseDailyAllocationEntries(allocationRaw);
	const fullPlanRaw = parseJson(await readDailyPlanJsonRaw(host));
	const fullPlan = parseFullDailyPlan(fullPlanRaw);
	const parseError = allocationRaw === undefined || (allocationEntries === null && allocationRaw !== null);

	if (parseError) {
		planCache = { revision, entries: [], fullPlan: null, parseError: true };
		return { meta, entries: [], parseError: true };
	}

	const entries = wallboxEntriesFromSources(allocationEntries, fullPlan);
	planCache = { revision, entries, fullPlan, parseError: false };
	return { meta, entries, parseError: false };
}

export async function resolveWallboxDailyPlanDecision(
	host: DailyPlanReadHost,
	snap: EvccTelemetrySnapshot,
	cfg: WallboxEvccTelemetryConfig,
	now: Date,
	opts: {
		governanceEnabled: boolean;
		addonEnabled: boolean;
		vehicleCapacityKwh?: number | null;
	},
): Promise<WallboxPlanDecision> {
	const telemetry = telemetryInputFromSnapshot(snap, cfg);
	const { meta, entries, parseError } = await loadPlanData(host);

	if (parseError) {
		return evaluateWallboxDailyPlan({
			now,
			timezone: meta.timezone,
			meta: { ...meta, status: "error" },
			entries: [],
			telemetry,
			governanceEnabled: opts.governanceEnabled,
			addonEnabled: opts.addonEnabled,
			vehicleCapacityKwh: opts.vehicleCapacityKwh,
		});
	}

	return evaluateWallboxDailyPlan({
		now,
		timezone: meta.timezone,
		meta,
		entries,
		telemetry,
		governanceEnabled: opts.governanceEnabled,
		addonEnabled: opts.addonEnabled,
		vehicleCapacityKwh: opts.vehicleCapacityKwh,
	});
}
