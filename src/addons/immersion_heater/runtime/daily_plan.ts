import { intentAdminConfigFromAdapter } from "../../../intent/config";
import { CONTRIBUTION_IDS } from "../../../operator/contribution_ids";
import {
	ALLOCATION_ADDON_STATE_IDS,
	DAILY_PLAN_STATE_IDS,
} from "../../../operator/daily_plan/states";
import { slotStartIsoFloored, slotKey, DAILY_PLAN_SLOT_MS } from "../../../operator/daily_plan/slots";
import { isoFromMs, isValidIsoTimestamp, localDateKeyInTimezone } from "../../../operator/time";
import type { DailyAllocationEntry, DailyPlan, DailyPlanStatus, AllocationStatus } from "../../../operator/daily_plan/types";
import type { ImmersionDeviceConfig } from "./types";

const ACTIVE_ALLOCATION_STATUSES = new Set<AllocationStatus>(["allocated", "partially_allocated"]);

const IMMERSION_CONTRIBUTION_IDS = new Set<string>([
	CONTRIBUTION_IDS.IMMERSION_MANDATORY,
	CONTRIBUTION_IDS.IMMERSION_FLEXIBLE,
]);

const USABLE_DAILY_PLAN_STATUSES = new Set<DailyPlanStatus>(["ready", "degraded"]);

export type ImmersionDailyPlanStatus =
	| "daily_plan_valid"
	| "daily_plan_zero_allocation"
	| "daily_plan_missing"
	| "daily_plan_invalid"
	| "daily_plan_expired"
	| "daily_plan_wrong_date"
	| "daily_plan_slot_missing"
	| "daily_plan_allocation_invalid"
	| "fallback_active";

export type ImmersionDecisionSource =
	| "manual_off"
	| "manual_force"
	| "daily_plan"
	| "thermal_fallback"
	| "safety"
	| "fault"
	| "lockout"
	| "safe_default";

export interface ImmersionDailyPlanRuntimeContext {
	dailyPlanStatus: ImmersionDailyPlanStatus;
	decisionSource: ImmersionDecisionSource;
	dailyPlanRevision: number | null;
	slotStartIso: string | null;
	slotEndIso: string | null;
	allocatedPowerW: number | null;
	mandatoryAllocatedPowerW: number | null;
	flexibleAllocatedPowerW: number | null;
	allocationStatus: string;
	allocationReasonDe: string;
	commandedStage: number;
	useDailyPlan: boolean;
}

export interface ImmersionDailyPlanResolution extends ImmersionDailyPlanRuntimeContext {}

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

export function resetImmersionDailyPlanCache(): void {
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

function immersionEntriesFromSources(
	allocationEntries: DailyAllocationEntry[] | null,
	fullPlan: DailyPlan | null,
): DailyAllocationEntry[] {
	const seen = new Set<string>();
	const out: DailyAllocationEntry[] = [];

	const add = (entries: DailyAllocationEntry[]): void => {
		for (const e of entries) {
			if (!IMMERSION_CONTRIBUTION_IDS.has(e.contributionId)) continue;
			const key = `${e.contributionId}|${slotKey(e.slot.startIso, e.slot.endIso)}`;
			if (seen.has(key)) continue;
			seen.add(key);
			out.push(e);
		}
	};

	if (allocationEntries) add(allocationEntries);
	if (fullPlan) {
		add(fullPlan.allocations.filter((a) => IMMERSION_CONTRIBUTION_IDS.has(a.contributionId)));
	}
	return out;
}

function maxTechnicalPowerW(config: ImmersionDeviceConfig): number {
	let max = 0;
	for (const s of config.stages) {
		if (s.enabled && s.nominalPowerW > 0 && s.setStateId) {
			max = Math.max(max, s.nominalPowerW);
		}
	}
	return max;
}

export function stageIndexForMaxPowerW(
	config: ImmersionDeviceConfig,
	maxPowerW: number,
): { stageIndex: number; reasonDe: string } {
	if (maxPowerW <= 0) {
		return { stageIndex: 0, reasonDe: "Keine Daily-Plan-Allocation-Leistung für den aktuellen Slot." };
	}

	const enabled = config.stages.filter((s) => s.enabled && s.nominalPowerW > 0 && s.setStateId);
	if (enabled.length === 0) {
		return { stageIndex: 0, reasonDe: "Keine technisch verfügbare Heizstabstufe konfiguriert." };
	}

	const sortedDesc = [...enabled].sort((a, b) => b.nominalPowerW - a.nominalPowerW);
	for (const stage of sortedDesc) {
		if (stage.nominalPowerW <= maxPowerW) {
			return {
				stageIndex: stage.index,
				reasonDe: `Stufe ${stage.index} (${stage.nominalPowerW} W) innerhalb Daily-Plan-Obergrenze ${maxPowerW} W.`,
			};
		}
	}

	const minStage = [...enabled].sort((a, b) => a.nominalPowerW - b.nominalPowerW)[0];
	return {
		stageIndex: 0,
		reasonDe: `Daily-Plan-Allocation ${maxPowerW} W kleiner als kleinste Stufe (${minStage.nominalPowerW} W).`,
	};
}

export interface SlotAllocationMerge {
	mandatoryPowerW: number;
	flexiblePowerW: number;
	totalPowerW: number;
	allocationStatus: string;
	reasonDe: string;
	valid: boolean;
}

export function mergeSlotAllocations(
	entries: DailyAllocationEntry[],
	slotStartIso: string,
	slotEndIso: string,
): SlotAllocationMerge {
	const key = slotKey(slotStartIso, slotEndIso);
	const seen = new Set<string>();
	let mandatoryPowerW = 0;
	let flexiblePowerW = 0;
	const statuses: string[] = [];

	for (const entry of entries) {
		if (slotKey(entry.slot.startIso, entry.slot.endIso) !== key) continue;
		if (!IMMERSION_CONTRIBUTION_IDS.has(entry.contributionId)) continue;

		const dedupeKey = `${entry.contributionId}|${key}`;
		if (seen.has(dedupeKey)) {
			return {
				mandatoryPowerW: 0,
				flexiblePowerW: 0,
				totalPowerW: 0,
				allocationStatus: "duplicate",
				reasonDe: "Doppelte Daily-Plan-Allocation im selben Slot.",
				valid: false,
			};
		}
		seen.add(dedupeKey);

		if (!ACTIVE_ALLOCATION_STATUSES.has(entry.status)) continue;

		if (entry.allocatedPowerW === null || !Number.isFinite(entry.allocatedPowerW) || entry.allocatedPowerW < 0) {
			return {
				mandatoryPowerW: 0,
				flexiblePowerW: 0,
				totalPowerW: 0,
				allocationStatus: "invalid_power",
				reasonDe: "Ungültige Daily-Plan-Allocation-Leistung.",
				valid: false,
			};
		}

		statuses.push(entry.status);
		if (entry.contributionId === CONTRIBUTION_IDS.IMMERSION_MANDATORY) {
			mandatoryPowerW += entry.allocatedPowerW;
		} else if (entry.contributionId === CONTRIBUTION_IDS.IMMERSION_FLEXIBLE) {
			flexiblePowerW += entry.allocatedPowerW;
		}
	}

	const totalPowerW = mandatoryPowerW + flexiblePowerW;
	const allocationStatus =
		statuses.length === 0
			? "none"
			: statuses.includes("partially_allocated")
				? "partially_allocated"
				: "allocated";

	const parts: string[] = [];
	if (mandatoryPowerW > 0) parts.push(`Pflicht ${mandatoryPowerW} W`);
	if (flexiblePowerW > 0) parts.push(`flexibel ${flexiblePowerW} W`);
	const reasonDe =
		totalPowerW > 0
			? `Daily Plan: ${parts.join(", ")} (Summe ${totalPowerW} W).`
			: "Daily Plan: keine aktive Heizstab-Allocation im aktuellen Slot (0 W).";

	return {
		mandatoryPowerW,
		flexiblePowerW,
		totalPowerW,
		allocationStatus,
		reasonDe,
		valid: true,
	};
}

export interface ResolveDailyPlanInput {
	now: Date;
	timezone: string;
	meta: DailyPlanMeta;
	entries: DailyAllocationEntry[];
	config: ImmersionDeviceConfig;
}

export function resolveImmersionDailyPlanFromData(input: ResolveDailyPlanInput): ImmersionDailyPlanResolution {
	const { now, timezone, meta, entries, config } = input;
	const nowMs = now.getTime();

	const base: ImmersionDailyPlanResolution = {
		dailyPlanStatus: "daily_plan_missing",
		decisionSource: "thermal_fallback",
		dailyPlanRevision: meta.revision,
		slotStartIso: null,
		slotEndIso: null,
		allocatedPowerW: null,
		mandatoryAllocatedPowerW: null,
		flexibleAllocatedPowerW: null,
		allocationStatus: "unknown",
		allocationReasonDe: "",
		commandedStage: 0,
		useDailyPlan: false,
	};

	if (!USABLE_DAILY_PLAN_STATUSES.has(meta.status as DailyPlanStatus)) {
		return {
			...base,
			dailyPlanStatus: "daily_plan_invalid",
			allocationReasonDe: `Daily Plan Status „${meta.status}“ ist nicht verwendbar – Thermal-Fallback aktiv.`,
		};
	}

	if (!isValidTimezone(timezone)) {
		return {
			...base,
			dailyPlanStatus: "daily_plan_invalid",
			allocationReasonDe: "Zeitzone ungültig – Thermal-Fallback aktiv.",
		};
	}

	const localDate = localDateKeyInTimezone(now, timezone);
	if (meta.date !== localDate) {
		return {
			...base,
			dailyPlanStatus: "daily_plan_wrong_date",
			allocationReasonDe: `Daily Plan Datum (${meta.date}) entspricht nicht dem lokalen Tag (${localDate}) – Thermal-Fallback aktiv.`,
		};
	}

	if (meta.validUntil) {
		const validUntilMs = Date.parse(meta.validUntil);
		if (!Number.isFinite(validUntilMs) || nowMs > validUntilMs) {
			return {
				...base,
				dailyPlanStatus: "daily_plan_expired",
				allocationReasonDe: "Daily Plan ist abgelaufen – Thermal-Fallback aktiv.",
			};
		}
	}

	const slotStartIso = slotStartIsoFloored(now, timezone);
	if (!isValidIsoTimestamp(slotStartIso)) {
		return {
			...base,
			dailyPlanStatus: "daily_plan_slot_missing",
			allocationReasonDe: "Aktueller Daily-Plan-Slot konnte nicht bestimmt werden – Thermal-Fallback aktiv.",
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
			allocationReasonDe: "Aktueller Zeitpunkt liegt nicht im Daily-Plan-Slot – Thermal-Fallback aktiv.",
		};
	}

	const merge = mergeSlotAllocations(entries, slotStartIso, slotEndIso);
	if (!merge.valid) {
		return {
			...base,
			dailyPlanStatus: "daily_plan_allocation_invalid",
			slotStartIso,
			slotEndIso,
			allocationStatus: merge.allocationStatus,
			allocationReasonDe: `${merge.reasonDe} Thermal-Fallback aktiv.`,
		};
	}

	const techMax = maxTechnicalPowerW(config);
	const cappedPowerW = techMax > 0 ? Math.min(merge.totalPowerW, techMax) : merge.totalPowerW;
	const stagePick = stageIndexForMaxPowerW(config, cappedPowerW);
	const executableStage = stagePick.stageIndex > 0;

	// Nutzbarer Daily Plan + aufgelöster Slot: Plan besitzt die Steuerung.
	// 0 W oder Leistung unter der kleinsten Stufe = absichtlich aus — kein Thermal-Fallback.
	const dailyPlanStatus: ImmersionDailyPlanStatus = executableStage
		? "daily_plan_valid"
		: "daily_plan_zero_allocation";

	let allocationReasonDe: string;
	if (executableStage) {
		allocationReasonDe = stagePick.reasonDe;
	} else if (cappedPowerW <= 0) {
		allocationReasonDe = `${merge.reasonDe} Daily Plan aktiv — Slot ohne Heizstab-Leistung (aus).`;
	} else {
		allocationReasonDe = `${stagePick.reasonDe} Daily Plan aktiv — keine fahrbare Stufe (aus).`;
	}

	return {
		dailyPlanStatus,
		decisionSource: "daily_plan",
		dailyPlanRevision: meta.revision,
		slotStartIso,
		slotEndIso,
		allocatedPowerW: cappedPowerW,
		mandatoryAllocatedPowerW: merge.mandatoryPowerW,
		flexibleAllocatedPowerW: merge.flexiblePowerW,
		allocationStatus: merge.allocationStatus,
		allocationReasonDe,
		commandedStage: stagePick.stageIndex,
		useDailyPlan: true,
	};
}

async function loadPlanData(host: DailyPlanReadHost): Promise<{
	meta: DailyPlanMeta;
	entries: DailyAllocationEntry[];
	fullPlan: DailyPlan | null;
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
		return { meta, entries: planCache.entries, fullPlan: planCache.fullPlan };
	}

	const allocationStatus = (await readStr(host, ALLOCATION_ADDON_STATE_IDS.immersion_heater.status)) ?? "";
	const allocationRaw = parseJson(await readStr(host, ALLOCATION_ADDON_STATE_IDS.immersion_heater.planJson));
	const allocationEntries = parseDailyAllocationEntries(allocationRaw);

	const fullPlanRaw = parseJson(await readStr(host, DAILY_PLAN_STATE_IDS.planJson));
	const fullPlan = parseFullDailyPlan(fullPlanRaw);

	// ready/idle = Addon-Slice besitzt die Steuerung (auch bei [] = bewusst aus).
	// Sonst Fallback auf fullPlan-Merge (Legacy / fehlende Slice-Publish).
	const allocationOwns = allocationStatus === "ready" || allocationStatus === "idle";
	const entries = immersionEntriesFromSources(allocationEntries, allocationOwns ? null : fullPlan);
	planCache = { revision, entries, fullPlan };
	return { meta, entries, fullPlan };
}

export async function resolveImmersionDailyPlanAllocation(
	host: DailyPlanReadHost,
	config: ImmersionDeviceConfig,
	now: Date,
): Promise<ImmersionDailyPlanResolution> {
	const { meta, entries } = await loadPlanData(host);

	if (!meta.status || meta.status === "not_initialized") {
		return {
			dailyPlanStatus: "daily_plan_missing",
			decisionSource: "thermal_fallback",
			dailyPlanRevision: meta.revision,
			slotStartIso: null,
			slotEndIso: null,
			allocatedPowerW: null,
			mandatoryAllocatedPowerW: null,
			flexibleAllocatedPowerW: null,
			allocationStatus: "missing",
			allocationReasonDe: "Daily Plan fehlt – lokaler Sicherheits-Default aktiv.",
			commandedStage: 0,
			useDailyPlan: false,
		};
	}

	return resolveImmersionDailyPlanFromData({
		now,
		timezone: meta.timezone,
		meta,
		entries,
		config,
	});
}

export function resolveImmersionDecisionSource(
	resolvedMode: "off" | "auto" | "force",
	failsafeActive: boolean,
	faultLockout: boolean,
	fsmState: string,
	autoSource: ImmersionDecisionSource,
): ImmersionDecisionSource {
	if (faultLockout) {
		return fsmState === "fault_lockout" ? "lockout" : "fault";
	}
	if (failsafeActive) return "safety";
	if (resolvedMode === "off") return "manual_off";
	if (resolvedMode === "force") return "manual_force";
	if (resolvedMode === "auto") return autoSource;
	return "safe_default";
}
