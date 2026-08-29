import { intentAdminConfigFromAdapter } from "../../../intent/config";
import { acUnitContributionId } from "../../../operator/contribution_ids";
import {
	ALLOCATION_ADDON_STATE_IDS,
	DAILY_PLAN_STATE_IDS,
} from "../../../operator/daily_plan/states";
import { slotStartIsoFloored, slotKey, DAILY_PLAN_SLOT_MS } from "../../../operator/daily_plan/slots";
import { isoFromMs, isValidIsoTimestamp, localDateKeyInTimezone } from "../../../operator/time";
import type { DailyAllocationEntry, DailyPlan, DailyPlanStatus, AllocationStatus } from "../../../operator/daily_plan/types";
import type { ConsumerPersistEntry } from "../../../learning/consumer_stats/types";
import {
	resolveConsumerEffectivePowerW,
	type LearnedConsumerPower,
} from "../../../learning/consumer_stats/learned_power";
import type { AcUnitConfig } from "../types";
import type { AcUnitFsmResult } from "./fsm";
import { AC_UNIT_COUNT } from "../constants";
import { computeAcCoolingDesired, controlToPermission } from "./compute_desired";

const ACTIVE_ALLOCATION_STATUSES = new Set<AllocationStatus>(["allocated", "partially_allocated"]);
const USABLE_DAILY_PLAN_STATUSES = new Set<DailyPlanStatus>(["ready", "degraded"]);

export type AcDailyPlanStatus =
	| "daily_plan_valid"
	| "daily_plan_zero_allocation"
	| "daily_plan_missing"
	| "daily_plan_invalid"
	| "daily_plan_expired"
	| "daily_plan_wrong_date"
	| "daily_plan_slot_missing"
	| "daily_plan_allocation_invalid"
	| "missing_power_model"
	| "allocation_below_expected_power"
	| "fallback_active";

export type AcDecisionSource =
	| "unit_disabled"
	| "governance_disabled"
	| "manual_off"
	| "manual_force"
	| "manual_override"
	| "hard_off_not_worthwhile"
	| "daily_plan"
	| "climate_fallback"
	| "temperature_no_demand"
	| "safety"
	| "fault"
	| "lockout"
	| "cleaning"
	| "rate_limited"
	| "safe_default";

export interface AcUnitDailyPlanResolution {
	unitIndex: number;
	contributionId: string;
	dailyPlanStatus: AcDailyPlanStatus;
	dailyPlanRevision: number | null;
	slotStartIso: string | null;
	slotEndIso: string | null;
	allocatedPowerW: number | null;
	expectedPowerW: number | null;
	powerModelSource: string;
	allocationStatus: string;
	allocationReasonDe: string;
	useDailyPlan: boolean;
	powerModelValid: boolean;
	allocationAllowsStart: boolean;
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
}

let planCache: ParsedPlanCache | null = null;

export function resetAcDailyPlanCache(): void {
	planCache = null;
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

function acEntriesFromSources(
	allocationEntries: DailyAllocationEntry[] | null,
	fullPlan: DailyPlan | null,
): DailyAllocationEntry[] {
	const seen = new Set<string>();
	const out: DailyAllocationEntry[] = [];

	const add = (entries: DailyAllocationEntry[]): void => {
		for (const e of entries) {
			if (!e.contributionId.startsWith("air_conditioning.unit_")) continue;
			const key = `${e.contributionId}|${slotKey(e.slot.startIso, e.slot.endIso)}`;
			if (seen.has(key)) continue;
			seen.add(key);
			out.push(e);
		}
	};

	if (allocationEntries) add(allocationEntries);
	if (fullPlan) {
		add(fullPlan.allocations.filter((a) => a.contributionId.startsWith("air_conditioning.unit_")));
	}
	return out;
}

export function resolveUnitExpectedPower(
	unit: AcUnitConfig,
	consumerStats: ConsumerPersistEntry | undefined,
	nowMs: number,
): LearnedConsumerPower & { valid: boolean } {
	const learned = resolveConsumerEffectivePowerW(consumerStats, unit.estimatedPowerW, nowMs);
	return {
		...learned,
		valid: learned.powerW > 0,
	};
}

export interface UnitSlotAllocationMerge {
	allocatedPowerW: number;
	allocationStatus: string;
	reasonDe: string;
	valid: boolean;
}

export function mergeUnitSlotAllocation(
	entries: DailyAllocationEntry[],
	contributionId: string,
	slotStartIso: string,
	slotEndIso: string,
): UnitSlotAllocationMerge {
	const key = slotKey(slotStartIso, slotEndIso);
	let count = 0;
	let allocatedPowerW = 0;
	const statuses: string[] = [];

	for (const entry of entries) {
		if (entry.contributionId !== contributionId) continue;
		if (slotKey(entry.slot.startIso, entry.slot.endIso) !== key) continue;
		count += 1;
		if (count > 1) {
			return {
				allocatedPowerW: 0,
				allocationStatus: "duplicate",
				reasonDe: `Doppelte Daily-Plan-Allocation für ${contributionId}.`,
				valid: false,
			};
		}
		if (!ACTIVE_ALLOCATION_STATUSES.has(entry.status)) {
			continue;
		}
		if (entry.allocatedPowerW === null || !Number.isFinite(entry.allocatedPowerW) || entry.allocatedPowerW < 0) {
			return {
				allocatedPowerW: 0,
				allocationStatus: "invalid_power",
				reasonDe: "Ungültige Daily-Plan-Allocation-Leistung.",
				valid: false,
			};
		}
		statuses.push(entry.status);
		allocatedPowerW = entry.allocatedPowerW;
	}

	const allocationStatus =
		statuses.length === 0
			? "none"
			: statuses.includes("partially_allocated")
				? "partially_allocated"
				: "allocated";

	return {
		allocatedPowerW,
		allocationStatus,
		reasonDe:
			allocatedPowerW > 0
				? `Daily Plan: ${allocatedPowerW} W für ${contributionId}.`
				: `Daily Plan: keine aktive Allocation für ${contributionId} (0 W).`,
		valid: true,
	};
}

export interface ResolveAcUnitDailyPlanInput {
	unitIndex: number;
	now: Date;
	timezone: string;
	meta: DailyPlanMeta;
	entries: DailyAllocationEntry[];
	expectedPower: LearnedConsumerPower & { valid: boolean };
}

export function resolveAcUnitDailyPlanFromData(input: ResolveAcUnitDailyPlanInput): AcUnitDailyPlanResolution {
	const { unitIndex, now, timezone, meta, entries, expectedPower } = input;
	const nowMs = now.getTime();
	const contributionId = acUnitContributionId(unitIndex);

	const base: AcUnitDailyPlanResolution = {
		unitIndex,
		contributionId,
		dailyPlanStatus: "daily_plan_missing",
		dailyPlanRevision: meta.revision,
		slotStartIso: null,
		slotEndIso: null,
		allocatedPowerW: null,
		expectedPowerW: expectedPower.valid ? expectedPower.powerW : null,
		powerModelSource: expectedPower.valid ? expectedPower.source : "missing",
		allocationStatus: "unknown",
		allocationReasonDe: "",
		useDailyPlan: false,
		powerModelValid: expectedPower.valid,
		allocationAllowsStart: false,
	};

	if (!USABLE_DAILY_PLAN_STATUSES.has(meta.status as DailyPlanStatus)) {
		return {
			...base,
			dailyPlanStatus: "daily_plan_invalid",
			allocationReasonDe: `Daily Plan Status „${meta.status}“ ist nicht verwendbar — autonomer Klima-Fallback aktiv.`,
		};
	}

	if (!isValidTimezone(timezone)) {
		return {
			...base,
			dailyPlanStatus: "daily_plan_invalid",
			allocationReasonDe: "Zeitzone ungültig — autonomer Klima-Fallback aktiv.",
		};
	}

	const localDate = localDateKeyInTimezone(now, timezone);
	if (meta.date !== localDate) {
		return {
			...base,
			dailyPlanStatus: "daily_plan_wrong_date",
			allocationReasonDe: `Daily Plan Datum (${meta.date}) entspricht nicht dem lokalen Tag (${localDate}) — Klima-Fallback aktiv.`,
		};
	}

	if (meta.validUntil) {
		const validUntilMs = Date.parse(meta.validUntil);
		if (!Number.isFinite(validUntilMs) || nowMs > validUntilMs) {
			return {
				...base,
				dailyPlanStatus: "daily_plan_expired",
				allocationReasonDe: "Daily Plan ist abgelaufen — Klima-Fallback aktiv.",
			};
		}
	}

	const slotStartIso = slotStartIsoFloored(now, timezone);
	if (!isValidIsoTimestamp(slotStartIso)) {
		return {
			...base,
			dailyPlanStatus: "daily_plan_slot_missing",
			allocationReasonDe: "Aktueller Daily-Plan-Slot konnte nicht bestimmt werden — Klima-Fallback aktiv.",
		};
	}

	const slotStartMs = Date.parse(slotStartIso);
	const slotEndMs = slotStartMs + DAILY_PLAN_SLOT_MS;
	const slotEndIso = isoFromMs(slotEndMs);

	if (nowMs < slotStartMs || nowMs >= slotEndMs) {
		return {
			...base,
			dailyPlanStatus: "daily_plan_slot_missing",
			slotStartIso,
			slotEndIso,
			allocationReasonDe: "Aktueller Zeitpunkt liegt nicht im Daily-Plan-Slot — Klima-Fallback aktiv.",
		};
	}

	const merge = mergeUnitSlotAllocation(entries, contributionId, slotStartIso, slotEndIso);
	if (!merge.valid) {
		return {
			...base,
			dailyPlanStatus: "daily_plan_allocation_invalid",
			slotStartIso,
			slotEndIso,
			allocationStatus: merge.allocationStatus,
			allocationReasonDe: `${merge.reasonDe} Klima-Fallback aktiv.`,
		};
	}

	if (!expectedPower.valid) {
		return {
			...base,
			dailyPlanStatus: "missing_power_model",
			slotStartIso,
			slotEndIso,
			allocatedPowerW: merge.allocatedPowerW,
			allocationStatus: merge.allocationStatus,
			allocationReasonDe: "Kein belastbares Leistungsmodell für die Unit — Climate-Fallback aktiv.",
			useDailyPlan: false,
			allocationAllowsStart: false,
		};
	}

	let dailyPlanStatus: AcDailyPlanStatus =
		merge.allocatedPowerW <= 0 ? "daily_plan_zero_allocation" : "daily_plan_valid";
	let allocationReasonDe = merge.reasonDe;
	let allocationAllowsStart = merge.allocatedPowerW > 0;

	/*
	 * Config = Planner-/Fallback-Nominal. Learned = operative Prognose.
	 * Abweichung Config↔Learned und insbesondere allocated < learned darf
	 * Start/Permission NICHT pauschal blockieren (z. B. 700 W Alloc vs. 715 W learned).
	 * Unter-Config-Allocation bleibt ein hartes Gate nur gegen Config-Quelle.
	 */
	if (
		merge.allocatedPowerW > 0 &&
		expectedPower.source === "config" &&
		merge.allocatedPowerW < expectedPower.powerW
	) {
		dailyPlanStatus = "allocation_below_expected_power";
		allocationAllowsStart = false;
		allocationReasonDe = `Allocation ${merge.allocatedPowerW} W kleiner als konfigurierte Unit-Leistung ${expectedPower.powerW} W.`;
	}

	if (merge.allocatedPowerW <= 0) {
		allocationReasonDe = `${merge.reasonDe} Planner-OFF für diesen Slot — kein Climate-Fallback.`;
	}

	return {
		unitIndex,
		contributionId,
		dailyPlanStatus,
		dailyPlanRevision: meta.revision,
		slotStartIso,
		slotEndIso,
		allocatedPowerW: merge.allocatedPowerW,
		expectedPowerW: expectedPower.powerW,
		powerModelSource: expectedPower.source,
		allocationStatus: merge.allocationStatus,
		allocationReasonDe,
		/**
		 * Gültiger anwendbarer Unified Plan besitzt Authority — auch bei 0 W (Planner-OFF).
		 * Climate-Fallback nur wenn Plan fehlt/ungültig/nicht anwendbar (früher return).
		 */
		useDailyPlan: true,
		powerModelValid: true,
		allocationAllowsStart,
	};
}

async function loadSharedPlanData(host: DailyPlanReadHost): Promise<{
	meta: DailyPlanMeta;
	entries: DailyAllocationEntry[];
}> {
	const adminCfg = intentAdminConfigFromAdapter(host.config);
	const timezone = adminCfg.timezone || "Europe/Berlin";

	const status = (await readStr(host, DAILY_PLAN_STATE_IDS.status)) ?? "";
	const date = (await readStr(host, DAILY_PLAN_STATE_IDS.date)) ?? "";
	const revision = (await readNum(host, DAILY_PLAN_STATE_IDS.revision)) ?? 0;
	const validUntilRaw = await readStr(host, DAILY_PLAN_STATE_IDS.validUntil);
	const validUntil = validUntilRaw && validUntilRaw.trim() ? validUntilRaw : null;

	const meta: DailyPlanMeta = { status, date, revision, validUntil, timezone };

	if (planCache && planCache.revision === revision) {
		return { meta, entries: planCache.entries };
	}

	const allocationStatus = (await readStr(host, ALLOCATION_ADDON_STATE_IDS.air_conditioning.status)) ?? "";
	const allocationRaw = parseJson(await readStr(host, ALLOCATION_ADDON_STATE_IDS.air_conditioning.planJson));
	const allocationEntries = parseDailyAllocationEntries(allocationRaw);
	const fullPlanRaw = parseJson(await readStr(host, DAILY_PLAN_STATE_IDS.planJson));
	const fullPlan = parseFullDailyPlan(fullPlanRaw);
	// ready/idle = Addon-Slice besitzt die Steuerung (auch bei [] = bewusst keine Fenster).
	const allocationOwns = allocationStatus === "ready" || allocationStatus === "idle";
	const entries = acEntriesFromSources(allocationEntries, allocationOwns ? null : fullPlan);
	planCache = { revision, entries, fullPlan };
	return { meta, entries };
}

export async function resolveAcUnitDailyPlanAllocation(
	host: DailyPlanReadHost,
	unit: AcUnitConfig,
	consumerStats: ConsumerPersistEntry | undefined,
	now: Date,
): Promise<AcUnitDailyPlanResolution> {
	const expectedPower = resolveUnitExpectedPower(unit, consumerStats, now.getTime());
	const { meta, entries } = await loadSharedPlanData(host);

	if (!meta.status || meta.status === "not_initialized") {
		return {
			unitIndex: unit.index,
			contributionId: acUnitContributionId(unit.index),
			dailyPlanStatus: "daily_plan_missing",
			dailyPlanRevision: meta.revision,
			slotStartIso: null,
			slotEndIso: null,
			allocatedPowerW: null,
			expectedPowerW: expectedPower.valid ? expectedPower.powerW : null,
			powerModelSource: expectedPower.valid ? expectedPower.source : "missing",
			allocationStatus: "missing",
			allocationReasonDe: "Daily Plan fehlt — bisherige autonome Klimaentscheidung wird verwendet.",
			useDailyPlan: false,
			powerModelValid: expectedPower.valid,
			allocationAllowsStart: false,
		};
	}

	return resolveAcUnitDailyPlanFromData({
		unitIndex: unit.index,
		now,
		timezone: meta.timezone,
		meta,
		entries,
		expectedPower,
	});
}

export interface AcCoolingPermissionInput {
	unitEnabled: boolean;
	governanceEnabled: boolean;
	addonEnabled: boolean;
	cleaningActive: boolean;
	fsm: AcUnitFsmResult;
	dailyPlan: AcUnitDailyPlanResolution;
	startRetryReady: boolean;
	stopRetryReady: boolean;
}

export interface AcCoolingPermissionResult {
	decisionSource: AcDecisionSource;
	reasonDe: string;
	allowStart: boolean;
	allowStop: boolean;
	allowCleaningWrites: boolean;
	deviceWritesAllowed: boolean;
}

/**
 * Permission leitet sich ausschließlich aus computeAcCoolingDesired ab.
 * feedbackOn aus FSM-State (running ≈ Feedback ON) — Engine nutzt computeAcCoolingDesired direkt.
 */
export function evaluateAcCoolingPermission(input: AcCoolingPermissionInput): AcCoolingPermissionResult {
	const decision = computeAcCoolingDesired({
		unitEnabled: input.unitEnabled,
		governanceEnabled: input.governanceEnabled,
		addonEnabled: input.addonEnabled,
		cleaningActive: input.cleaningActive,
		fsm: input.fsm,
		dailyPlan: input.dailyPlan,
		feedbackOn: input.fsm.state === "running",
		startRetryReady: input.startRetryReady,
	});
	return controlToPermission(decision);
}

export function acUnitContributionIds(): string[] {
	const out: string[] = [];
	for (let i = 1; i <= AC_UNIT_COUNT; i++) {
		out.push(acUnitContributionId(i));
	}
	return out;
}
