import { intentAdminConfigFromAdapter } from "../../../intent/config";
import { CONTRIBUTION_IDS } from "../../../operator/contribution_ids";
import {
	ALLOCATION_ADDON_STATE_IDS,
	DAILY_PLAN_STATE_IDS,
} from "../../../operator/daily_plan/states";
import { slotStartIsoFloored, slotKey, DAILY_PLAN_SLOT_MS } from "../../../operator/daily_plan/slots";
import { isoFromMs, isValidIsoTimestamp, localDateKeyInTimezone } from "../../../operator/time";
import type {
	AllocationEnergySource,
	AllocationStatus,
	DailyAllocationEntry,
	DailyPlan,
	DailyPlanStatus,
} from "../../../operator/daily_plan/types";
import type { BatteryDeviceIntent, BatteryEnergySource, BatteryHardwareLimits } from "../core/types";
import { isChargingAction } from "../core/intent";
import type { BatteryProfile } from "../profiles/types";

const BATTERY_CHARGE_ID = CONTRIBUTION_IDS.BATTERY_CHARGE;
const BATTERY_DISCHARGE_ID = CONTRIBUTION_IDS.BATTERY_DISCHARGE;
const ACTIVE_ALLOCATION_STATUSES = new Set<AllocationStatus>(["allocated", "partially_allocated"]);
const USABLE_DAILY_PLAN_STATUSES = new Set<DailyPlanStatus>(["ready", "degraded"]);

export type BatteryDailyPlanStatus =
	| "daily_plan_valid"
	| "daily_plan_zero_allocation"
	| "daily_plan_missing"
	| "daily_plan_invalid"
	| "daily_plan_expired"
	| "daily_plan_wrong_date"
	| "daily_plan_slot_missing"
	| "daily_plan_allocation_invalid"
	| "allocation_capped"
	| "grid_not_eligible"
	| "profile_read_only"
	| "soc_at_target";

export type BatteryDecisionSource =
	| "addon_disabled"
	| "governance_disabled"
	| "profile_read_only"
	| "manual_user_intent"
	| "daily_plan"
	| "daily_plan_passive_pv"
	| "daily_plan_zero"
	| "battery_winter_fallback"
	| "legacy_planner_fallback"
	| "grid_balance_fallback"
	| "safety"
	| "fault"
	| "lockout"
	| "restore"
	| "safe_default";

export interface BatteryDailyPlanRuntimeContext {
	useDailyPlan: boolean;
	dailyPlanAuthoritative: boolean;
	dailyPlanStatus: BatteryDailyPlanStatus;
	decisionSource: BatteryDecisionSource;
	dailyPlanRevision: number | null;
	slotStartIso: string | null;
	slotEndIso: string | null;
	allocationStatus: string;
	allocatedChargePowerW: number | null;
	effectiveChargePowerW: number | null;
	requestedChargePowerW: number | null;
	allocatedEnergyKwh: number | null;
	pvPowerW: number | null;
	gridPowerW: number | null;
	energySource: AllocationEnergySource | "none";
	estimatedCostCt: number | null;
	chargePowerCapped: boolean;
	targetSocPct: number | null;
	topOffActive: boolean;
	chargingAllowed: boolean;
	allocationReasonDe: string;
	legacyFallbackActive: boolean;
	legacyFallbackSource: string;
	legacyFallbackReasonDe: string;
	dailyPlanBlocksGridBalance: boolean;
	runtimeControlAvailable: boolean;
	dischargeIgnored: boolean;
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

export function resetBatteryDailyPlanCache(): void {
	planCache = null;
}

export function isBatteryDailyPlanAuthoritative(ctx: BatteryDailyPlanRuntimeContext): boolean {
	return ctx.dailyPlanAuthoritative;
}

/** Competing EMS charge from the Daily Plan — not 0 W / self_consumption. */
export function dailyPlanCompetesWithGridBalance(ctx: BatteryDailyPlanRuntimeContext): boolean {
	return Boolean(ctx.chargingAllowed && (ctx.effectiveChargePowerW ?? 0) > 0);
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

function batteryChargeEntriesFromSources(
	allocationEntries: DailyAllocationEntry[] | null,
	fullPlan: DailyPlan | null,
): { entries: DailyAllocationEntry[]; dischargePresent: boolean } {
	const seen = new Set<string>();
	const out: DailyAllocationEntry[] = [];
	let dischargePresent = false;

	const add = (entries: DailyAllocationEntry[]): void => {
		for (const e of entries) {
			if (e.contributionId === BATTERY_DISCHARGE_ID) {
				dischargePresent = true;
				continue;
			}
			if (e.contributionId !== BATTERY_CHARGE_ID) continue;
			const key = `${e.contributionId}|${slotKey(e.slot.startIso, e.slot.endIso)}`;
			if (seen.has(key)) continue;
			seen.add(key);
			out.push(e);
		}
	};

	if (allocationEntries) add(allocationEntries);
	if (fullPlan) add(fullPlan.allocations);
	return { entries: out, dischargePresent };
}

export interface SlotChargeMerge {
	valid: boolean;
	entry: DailyAllocationEntry | null;
	allocationStatus: string;
	reasonDe: string;
}

export function mergeBatteryChargeSlotAllocation(
	entries: DailyAllocationEntry[],
	slotStartIso: string,
	slotEndIso: string,
): SlotChargeMerge {
	const key = slotKey(slotStartIso, slotEndIso);
	let found: DailyAllocationEntry | null = null;
	for (const entry of entries) {
		if (entry.contributionId !== BATTERY_CHARGE_ID) continue;
		if (slotKey(entry.slot.startIso, entry.slot.endIso) !== key) continue;
		if (found) {
			return {
				valid: false,
				entry: null,
				allocationStatus: "duplicate",
				reasonDe: "Doppelte battery.charge-Allocation im selben Slot.",
			};
		}
		found = entry;
	}
	if (!found) {
		return {
			valid: true,
			entry: null,
			allocationStatus: "none",
			reasonDe: "Daily Plan: keine battery.charge-Allocation im aktuellen Slot.",
		};
	}
	return { valid: true, entry: found, allocationStatus: found.status, reasonDe: found.reasonDe || "" };
}

function mapEnergySource(src: AllocationEnergySource | "none"): BatteryEnergySource {
	if (src === "pv_surplus") return "pv";
	if (src === "grid") return "grid";
	if (src === "mixed") return "any";
	return "unknown";
}

function resolveTargetSocPct(input: {
	topOffActive: boolean;
	targetSocFromIntent: number | null;
	limits: BatteryHardwareLimits;
}): number | null {
	if (input.topOffActive) return input.limits.maxSocPct ?? 100;
	if (input.targetSocFromIntent !== null) return input.targetSocFromIntent;
	return input.limits.maxSocPct;
}

export interface ResolveBatteryDailyPlanInput {
	now: Date;
	timezone: string;
	meta: DailyPlanMeta;
	entries: DailyAllocationEntry[];
	dischargePresent: boolean;
	profile: BatteryProfile;
	limits: BatteryHardwareLimits;
	socPct: number | null;
	topOffActive: boolean;
	targetSocFromIntent: number | null;
	governanceEnabled: boolean;
}

export function resolveBatteryDailyPlanFromData(input: ResolveBatteryDailyPlanInput): BatteryDailyPlanRuntimeContext {
	const { now, timezone, meta, entries, dischargePresent, profile, limits, socPct, topOffActive, governanceEnabled } =
		input;
	const nowMs = now.getTime();

	const fallbackBase = (): BatteryDailyPlanRuntimeContext => ({
		useDailyPlan: false,
		dailyPlanAuthoritative: false,
		dailyPlanStatus: "daily_plan_missing",
		decisionSource: "battery_winter_fallback",
		dailyPlanRevision: meta.revision,
		slotStartIso: null,
		slotEndIso: null,
		allocationStatus: "unknown",
		allocatedChargePowerW: null,
		effectiveChargePowerW: null,
		requestedChargePowerW: null,
		allocatedEnergyKwh: null,
		pvPowerW: null,
		gridPowerW: null,
		energySource: "none",
		estimatedCostCt: null,
		chargePowerCapped: false,
		targetSocPct: null,
		topOffActive,
		chargingAllowed: false,
		allocationReasonDe: "",
		legacyFallbackActive: true,
		legacyFallbackSource: "pending",
		legacyFallbackReasonDe: "",
		dailyPlanBlocksGridBalance: false,
		runtimeControlAvailable: profile.supportsLive,
		dischargeIgnored: dischargePresent,
	});

	if (!governanceEnabled) {
		return {
			...fallbackBase(),
			decisionSource: "governance_disabled",
			legacyFallbackActive: false,
			allocationReasonDe: "Governance deaktiviert — kein Daily-Plan-Ladepfad.",
		};
	}

	if (!profile.supportsLive) {
		return {
			...fallbackBase(),
			dailyPlanStatus: "profile_read_only",
			decisionSource: "profile_read_only",
			legacyFallbackActive: false,
			allocationReasonDe: "Profil read-only — Daily Plan nur diagnostisch.",
		};
	}

	if (!meta.status || meta.status === "not_initialized") {
		return {
			...fallbackBase(),
			allocationReasonDe: "Daily Plan fehlt — Legacy-Fallback aktiv.",
			legacyFallbackReasonDe: "Daily Plan fehlt.",
		};
	}

	if (!USABLE_DAILY_PLAN_STATUSES.has(meta.status as DailyPlanStatus)) {
		return {
			...fallbackBase(),
			dailyPlanStatus: "daily_plan_invalid",
			allocationReasonDe: `Daily Plan Status „${meta.status}“ ungültig — Legacy-Fallback.`,
			legacyFallbackReasonDe: `Status ${meta.status}.`,
		};
	}

	if (!isValidTimezone(timezone)) {
		return {
			...fallbackBase(),
			dailyPlanStatus: "daily_plan_invalid",
			allocationReasonDe: "Zeitzone ungültig — Legacy-Fallback.",
			legacyFallbackReasonDe: "Zeitzone ungültig.",
		};
	}

	const localDate = localDateKeyInTimezone(now, timezone);
	if (meta.date !== localDate) {
		return {
			...fallbackBase(),
			dailyPlanStatus: "daily_plan_wrong_date",
			allocationReasonDe: `Daily Plan Datum (${meta.date}) passt nicht — Legacy-Fallback.`,
			legacyFallbackReasonDe: "Falsches Plan-Datum.",
		};
	}

	if (meta.validUntil) {
		const validUntilMs = Date.parse(meta.validUntil);
		if (!Number.isFinite(validUntilMs) || nowMs > validUntilMs) {
			return {
				...fallbackBase(),
				dailyPlanStatus: "daily_plan_expired",
				allocationReasonDe: "Daily Plan abgelaufen — Legacy-Fallback.",
				legacyFallbackReasonDe: "Plan abgelaufen.",
			};
		}
	}

	const slotStartIso = slotStartIsoFloored(now, timezone);
	if (!isValidIsoTimestamp(slotStartIso)) {
		return {
			...fallbackBase(),
			dailyPlanStatus: "daily_plan_slot_missing",
			allocationReasonDe: "Slot nicht bestimmbar — Legacy-Fallback.",
			legacyFallbackReasonDe: "Slot fehlt.",
		};
	}

	const slotStartMs = Date.parse(slotStartIso);
	const slotEndIso = isoFromMs(slotStartMs + DAILY_PLAN_SLOT_MS);
	if (nowMs < slotStartMs || nowMs >= slotStartMs + DAILY_PLAN_SLOT_MS) {
		return {
			...fallbackBase(),
			dailyPlanStatus: "daily_plan_slot_missing",
			slotStartIso,
			slotEndIso,
			allocationReasonDe: "Aktueller Zeitpunkt liegt nicht im Slot — Legacy-Fallback.",
			legacyFallbackReasonDe: "Zeitpunkt außerhalb Slot.",
		};
	}

	const merge = mergeBatteryChargeSlotAllocation(entries, slotStartIso, slotEndIso);
	if (!merge.valid) {
		return {
			...fallbackBase(),
			dailyPlanStatus: "daily_plan_allocation_invalid",
			slotStartIso,
			slotEndIso,
			allocationStatus: merge.allocationStatus,
			allocationReasonDe: `${merge.reasonDe} Legacy-Fallback.`,
			legacyFallbackReasonDe: merge.reasonDe,
		};
	}

	const targetSocPct = resolveTargetSocPct({
		topOffActive,
		targetSocFromIntent: input.targetSocFromIntent,
		limits,
	});

	const authoritativeBase = (): BatteryDailyPlanRuntimeContext => ({
		useDailyPlan: true,
		dailyPlanAuthoritative: true,
		dailyPlanStatus: "daily_plan_zero_allocation",
		decisionSource: "daily_plan_zero",
		dailyPlanRevision: meta.revision,
		slotStartIso,
		slotEndIso,
		allocationStatus: merge.allocationStatus,
		allocatedChargePowerW: 0,
		effectiveChargePowerW: 0,
		requestedChargePowerW: null,
		allocatedEnergyKwh: null,
		pvPowerW: 0,
		gridPowerW: 0,
		energySource: "none",
		estimatedCostCt: null,
		chargePowerCapped: false,
		targetSocPct,
		topOffActive,
		chargingAllowed: false,
		allocationReasonDe: "Daily Plan: keine aktive Batterieladung im aktuellen Slot.",
		legacyFallbackActive: false,
		legacyFallbackSource: "",
		legacyFallbackReasonDe: "",
		dailyPlanBlocksGridBalance: false,
		runtimeControlAvailable: profile.supportsLive,
		dischargeIgnored: dischargePresent,
	});

	const entry = merge.entry;
	if (!entry || !ACTIVE_ALLOCATION_STATUSES.has(entry.status)) {
		return authoritativeBase();
	}

	if (entry.allocatedPowerW === null || !Number.isFinite(entry.allocatedPowerW) || entry.allocatedPowerW < 0) {
		return {
			...authoritativeBase(),
			dailyPlanStatus: "daily_plan_allocation_invalid",
			decisionSource: "daily_plan_zero",
			allocationReasonDe: "Ungültige oder negative Daily-Plan-Ladeleistung abgelehnt.",
		};
	}

	if (entry.allocatedPowerW === 0) {
		return authoritativeBase();
	}

	const hwMax = limits.maxChargeW;
	let effective = Math.round(entry.allocatedPowerW);
	let chargePowerCapped = false;
	if (hwMax !== null && effective > hwMax) {
		effective = hwMax;
		chargePowerCapped = true;
	}

	const energySource = entry.energySource;
	if (energySource === "grid" && entry.gridPowerW <= 0) {
		return {
			...authoritativeBase(),
			dailyPlanStatus: "grid_not_eligible",
			allocationReasonDe: "Grid-Allocation ohne Netzanteil — keine Ladefreigabe.",
		};
	}

	if (socPct !== null && targetSocPct !== null && socPct >= targetSocPct) {
		return {
			...authoritativeBase(),
			dailyPlanStatus: "soc_at_target",
			allocationReasonDe: `SOC ${socPct} % erreicht Ziel ${targetSocPct} % — keine weitere Ladung.`,
		};
	}

	const dailyPlanStatus: BatteryDailyPlanStatus = chargePowerCapped ? "allocation_capped" : "daily_plan_valid";
	const passivePv = energySource === "pv_surplus" && entry.pvPowerW > 0 && entry.gridPowerW === 0;

	return {
		useDailyPlan: true,
		dailyPlanAuthoritative: true,
		dailyPlanStatus,
		decisionSource: passivePv ? "daily_plan_passive_pv" : "daily_plan",
		dailyPlanRevision: meta.revision,
		slotStartIso,
		slotEndIso,
		allocationStatus: merge.allocationStatus,
		allocatedChargePowerW: entry.allocatedPowerW,
		effectiveChargePowerW: effective,
		requestedChargePowerW: entry.requestedPowerW,
		allocatedEnergyKwh: entry.allocatedEnergyKwh,
		pvPowerW: entry.pvPowerW,
		gridPowerW: entry.gridPowerW,
		energySource,
		estimatedCostCt: entry.estimatedCostCt,
		chargePowerCapped,
		targetSocPct,
		topOffActive,
		chargingAllowed: true,
		allocationReasonDe: chargePowerCapped
			? `Daily Plan ${entry.allocatedPowerW} W auf technisches Maximum ${effective} W begrenzt.`
			: `Daily Plan sieht ${effective} W Batterieladung vor (${energySource}).`,
		legacyFallbackActive: false,
		legacyFallbackSource: "",
		legacyFallbackReasonDe: "",
		dailyPlanBlocksGridBalance: true,
		runtimeControlAvailable: profile.supportsLive,
		dischargeIgnored: dischargePresent,
	};
}

export function deviceIntentFromDailyPlan(
	ctx: BatteryDailyPlanRuntimeContext,
	nowMs: number,
): BatteryDeviceIntent {
	const revision = ctx.dailyPlanRevision ?? 0;
	if (!ctx.chargingAllowed || (ctx.effectiveChargePowerW ?? 0) <= 0) {
		return {
			requestId: `daily-plan-${revision}`,
			action: "self_consumption",
			targetSocPct: ctx.targetSocPct,
			maxChargeW: 0,
			maxDischargeW: null,
			energySource: "any",
			validFrom: ctx.slotStartIso,
			validUntil: ctx.slotEndIso,
			issuedAt: new Date(nowMs).toISOString(),
			reason: ctx.allocationReasonDe,
			source: "daily_plan",
		};
	}

	let action: BatteryDeviceIntent["action"] = "charge";
	if (ctx.energySource === "grid" || (ctx.energySource === "mixed" && (ctx.gridPowerW ?? 0) > 0)) {
		action = "grid_charge";
	}

	return {
		requestId: `daily-plan-${revision}`,
		action,
		targetSocPct: ctx.targetSocPct,
		maxChargeW: ctx.effectiveChargePowerW,
		maxDischargeW: null,
		energySource: mapEnergySource(ctx.energySource),
		validFrom: ctx.slotStartIso,
		validUntil: ctx.slotEndIso,
		issuedAt: new Date(nowMs).toISOString(),
		reason: ctx.allocationReasonDe,
		source: "daily_plan",
	};
}

async function loadPlanData(host: DailyPlanReadHost): Promise<{
	meta: DailyPlanMeta;
	entries: DailyAllocationEntry[];
	dischargePresent: boolean;
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
		const { entries, dischargePresent } = batteryChargeEntriesFromSources(planCache.entries, planCache.fullPlan);
		return { meta, entries, dischargePresent, parseError: false };
	}

	const allocationRaw = parseJson(await readStr(host, ALLOCATION_ADDON_STATE_IDS.battery.planJson));
	const allocationEntries = parseDailyAllocationEntries(allocationRaw);
	const fullPlanRaw = parseJson(await readStr(host, DAILY_PLAN_STATE_IDS.planJson));
	const fullPlan = parseFullDailyPlan(fullPlanRaw);
	const parseError = allocationRaw === undefined || (allocationEntries === null && allocationRaw !== null);

	if (parseError) {
		planCache = { revision, entries: [], fullPlan: null, parseError: true };
		return { meta, entries: [], dischargePresent: false, parseError: true };
	}

	const merged = batteryChargeEntriesFromSources(allocationEntries, fullPlan);
	planCache = { revision, entries: merged.entries, fullPlan, parseError: false };
	return { meta, entries: merged.entries, dischargePresent: merged.dischargePresent, parseError: false };
}

export async function resolveBatteryDailyPlanAllocation(
	host: DailyPlanReadHost,
	profile: BatteryProfile,
	limits: BatteryHardwareLimits,
	opts: {
		now: Date;
		socPct: number | null;
		topOffActive: boolean;
		targetSocFromIntent: number | null;
		governanceEnabled: boolean;
	},
): Promise<BatteryDailyPlanRuntimeContext> {
	const { meta, entries, dischargePresent, parseError } = await loadPlanData(host);

	if (parseError) {
		return resolveBatteryDailyPlanFromData({
			now: opts.now,
			timezone: meta.timezone,
			meta: { ...meta, status: "error" },
			entries: [],
			dischargePresent: false,
			profile,
			limits,
			socPct: opts.socPct,
			topOffActive: opts.topOffActive,
			targetSocFromIntent: opts.targetSocFromIntent,
			governanceEnabled: opts.governanceEnabled,
		});
	}

	return resolveBatteryDailyPlanFromData({
		now: opts.now,
		timezone: meta.timezone,
		meta,
		entries,
		dischargePresent,
		profile,
		limits,
		socPct: opts.socPct,
		topOffActive: opts.topOffActive,
		targetSocFromIntent: opts.targetSocFromIntent,
		governanceEnabled: opts.governanceEnabled,
	});
}

export function dailyPlanWantsCharge(ctx: BatteryDailyPlanRuntimeContext): boolean {
	return ctx.chargingAllowed && (ctx.effectiveChargePowerW ?? 0) > 0;
}

export function isChargingDeviceIntent(intent: BatteryDeviceIntent): boolean {
	return isChargingAction(intent.action);
}
