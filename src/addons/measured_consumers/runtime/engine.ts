/**
 * Runtime-Tick für den rein messenden Verbraucherblock.
 *
 * WICHTIG: Dieses Modul schreibt NIEMALS auf Fremd-/Gerätegeräte. Es liest nur
 * Leistungs-/Energie-Datenpunkte und veröffentlicht Anzeige-/Statistik-States.
 * Keine Planner-/Dispatch-Integration, keine Governance/Execution-Mode nötig.
 */
import { setStateIfChanged, setOptionalNumberIfChanged } from "../../../policy/core/state_write";
import type { StateHost } from "../../../ems_light/state_util";
import { localDateKeyInTimezone, addDaysToDateKey } from "../../../operator/time";
import {
	MEASURED_CONSUMERS_HOUSE_LOAD_STATE_ID,
	MEASURED_CONSUMERS_MAX_POWER_INTEGRATION_DT_SEC,
	MEASURED_CONSUMERS_DAY_RETENTION_DAYS,
	MEASURED_CONSUMERS_TICK_MS,
} from "../constants";
import { configuredMeasuredConsumerSlots, measuredConsumerOverflowCount } from "../config";
import type { MeasuredConsumerSlotConfig, MeasuredConsumerSourceMode } from "../types";
import {
	applyEnergyStateSample,
	applyPowerIntegrationSample,
	skipPowerIntegrationGap,
	computeUnknownHouseLoadW,
	resolveSlotPeriods,
	pruneOldDays,
	round1,
} from "../math";
import { emptyMeasuredConsumerSlotPersist, emptyMeasuredConsumersPersist, type MeasuredConsumersPersist } from "../persist";
import { readMeasuredConsumersPersist, writeMeasuredConsumersPersist } from "../persist_io";
import { ensureMeasuredConsumersStates } from "./ensure_states";
import { MEASURED_CONSUMERS_AGGREGATE_STATES, measuredConsumerSlotStateIds } from "./state_ids";

export type MeasuredConsumersRuntimeHost = StateHost & {
	config?: unknown;
	getAbsolutePath?: (category?: string) => string;
	getForeignStateAsync?: (id: string) => Promise<ioBroker.State | null | undefined>;
	log: { info: (m: string) => void; warn: (m: string) => void; debug?: (m: string) => void; error?: (m: string) => void };
};

let engineActive = false;
let hostRef: MeasuredConsumersRuntimeHost | null = null;
let persist: MeasuredConsumersPersist = emptyMeasuredConsumersPersist();
let persistHydrated = false;
let tickTimer: ReturnType<typeof setTimeout> | null = null;
let overflowWarned = false;

function clearTick(): void {
	if (tickTimer) {
		clearTimeout(tickTimer);
		tickTimer = null;
	}
}

function scheduleTick(delayMs: number = MEASURED_CONSUMERS_TICK_MS): void {
	clearTick();
	if (!engineActive) return;
	tickTimer = setTimeout(() => {
		tickTimer = null;
		if (!engineActive || !hostRef) return;
		void runMeasuredConsumersTick(hostRef)
			.catch((e) => hostRef?.log.warn(`measured_consumers tick: ${e}`))
			.finally(() => scheduleTick());
	}, delayMs);
}

function resolveTimezone(config: unknown): string {
	const raw = config && typeof config === "object" ? (config as Record<string, unknown>) : {};
	const tz = typeof raw.timezone === "string" ? raw.timezone.trim() : "";
	return tz || "Europe/Berlin";
}

async function readForeignNum(
	host: MeasuredConsumersRuntimeHost,
	id: string | null,
): Promise<number | null> {
	if (!id) return null;
	const reader = host.getForeignStateAsync ?? host.getStateAsync;
	try {
		const st = await reader(id);
		if (!st || st.val === null || st.val === undefined) return null;
		if (typeof st.val === "number") return Number.isFinite(st.val) ? st.val : null;
		// Komma-Dezimal (DE) und Einheiten-Suffixe robust parsen
		const n = parseFloat(String(st.val).trim().replace(",", "."));
		return Number.isFinite(n) ? n : null;
	} catch {
		return null;
	}
}

type SlotTickResult = {
	powerW: number | null;
	enabled: boolean;
	valid: boolean;
	sourceMode: MeasuredConsumerSourceMode;
	totals: { totalKwh: number; todayKwh: number; yesterdayKwh: number; monthKwh: number; yearKwh: number };
};

async function processSlot(
	host: MeasuredConsumersRuntimeHost,
	slot: MeasuredConsumerSlotConfig,
	nowMs: number,
	todayKey: string,
	yesterdayKey: string,
): Promise<SlotTickResult> {
	const ids = measuredConsumerSlotStateIds(slot.index);
	await setStateIfChanged(host, ids.name, slot.name);
	await setStateIfChanged(host, ids.enabled, slot.enabled);

	const zeroTotals = { totalKwh: 0, todayKwh: 0, yesterdayKwh: 0, monthKwh: 0, yearKwh: 0 };

	if (!slot.enabled) {
		await setOptionalNumberIfChanged(host, ids.powerW, null);
		await setStateIfChanged(host, ids.sourceMode, "none");
		await setStateIfChanged(host, ids.valid, false);
		await setStateIfChanged(host, ids.reasonDe, "Deaktiviert");
		return { powerW: null, enabled: false, valid: false, sourceMode: "none", totals: zeroTotals };
	}

	if (!slot.powerStateId) {
		await setOptionalNumberIfChanged(host, ids.powerW, null);
		await setStateIfChanged(host, ids.sourceMode, "none");
		await setStateIfChanged(host, ids.valid, false);
		await setStateIfChanged(host, ids.reasonDe, "Kein Leistungs-Datenpunkt konfiguriert");
		return { powerW: null, enabled: true, valid: false, sourceMode: "none", totals: zeroTotals };
	}

	const key = slot.powerStateId;
	let sp = persist.slots[key];
	if (!sp) {
		sp = emptyMeasuredConsumerSlotPersist();
		persist.slots[key] = sp;
	}

	const powerRaw = await readForeignNum(host, slot.powerStateId);
	let powerW: number | null = null;
	let valid = true;
	let reasonDe = "";

	if (powerRaw === null) {
		valid = false;
		reasonDe = "Leistungs-Datenpunkt nicht verfügbar";
	} else if (powerRaw < 0) {
		valid = false;
		powerW = 0;
		reasonDe = "Negative Leistung ignoriert (auf 0 gesetzt)";
	} else {
		powerW = round1(powerRaw);
	}

	let sourceMode: MeasuredConsumerSourceMode;
	if (slot.energyStateId) {
		sourceMode = "energy_state";
		const rawKwh = await readForeignNum(host, slot.energyStateId);
		if (rawKwh !== null && rawKwh >= 0) {
			applyEnergyStateSample(sp, rawKwh, slot.initialEnergyKwh, todayKey);
		} else {
			valid = false;
			reasonDe = reasonDe || "Energie-Datenpunkt nicht verfügbar — Zähler pausiert";
		}
	} else if (powerW !== null && valid) {
		sourceMode = "power_integration";
		applyPowerIntegrationSample(
			sp,
			powerW,
			nowMs,
			slot.initialEnergyKwh,
			todayKey,
			MEASURED_CONSUMERS_MAX_POWER_INTEGRATION_DT_SEC,
		);
	} else {
		sourceMode = "power_integration";
		skipPowerIntegrationGap(sp, nowMs);
	}

	sp.days = pruneOldDays(sp.days, todayKey, MEASURED_CONSUMERS_DAY_RETENTION_DAYS);
	const totals = resolveSlotPeriods(sp, todayKey, yesterdayKey);

	await setOptionalNumberIfChanged(host, ids.powerW, powerW);
	await setOptionalNumberIfChanged(host, ids.energyTotalKwh, totals.totalKwh);
	await setOptionalNumberIfChanged(host, ids.energyTodayKwh, totals.todayKwh);
	await setOptionalNumberIfChanged(host, ids.energyYesterdayKwh, totals.yesterdayKwh);
	await setOptionalNumberIfChanged(host, ids.energyMonthKwh, totals.monthKwh);
	await setOptionalNumberIfChanged(host, ids.energyYearKwh, totals.yearKwh);
	await setStateIfChanged(host, ids.sourceMode, sourceMode);
	await setStateIfChanged(host, ids.valid, valid);
	await setStateIfChanged(host, ids.reasonDe, reasonDe);

	return { powerW, enabled: true, valid, sourceMode, totals };
}

export async function runMeasuredConsumersTick(host: MeasuredConsumersRuntimeHost): Promise<void> {
	await hydrateMeasuredConsumersPersist(host);
	const slots = configuredMeasuredConsumerSlots(host.config);
	await ensureMeasuredConsumersStates(host, slots);
	if (slots.length === 0) {
		// Keine Zeilen konfiguriert — bewusst kein State-Baum (hält die Oberfläche minimal).
		return;
	}

	const overflow = measuredConsumerOverflowCount(host.config);
	if (overflow > 0 && !overflowWarned) {
		host.log.warn(
			`measured_consumers: ${overflow} Zeile(n) über der Admin-Kapazität (${slots.length}/20) werden ignoriert`,
		);
		overflowWarned = true;
	} else if (overflow === 0) {
		overflowWarned = false;
	}

	const timezone = resolveTimezone(host.config);
	const now = new Date();
	const nowMs = now.getTime();
	const todayKey = localDateKeyInTimezone(now, timezone);
	const yesterdayKey = addDaysToDateKey(todayKey, -1);

	let totalPowerW = 0;
	let totalTodayKwh = 0;
	let totalYesterdayKwh = 0;
	let totalMonthKwh = 0;
	let totalYearKwh = 0;
	let totalTotalKwh = 0;
	let activeCount = 0;
	const consumersSummary: Array<Record<string, unknown>> = [];

	for (const slot of slots) {
		const result = await processSlot(host, slot, nowMs, todayKey, yesterdayKey);
		consumersSummary.push({
			index: slot.index,
			name: slot.name,
			enabled: result.enabled,
			valid: result.valid,
			sourceMode: result.sourceMode,
			powerW: result.powerW,
			energyTotalKwh: result.totals.totalKwh,
			energyTodayKwh: result.totals.todayKwh,
			energyYesterdayKwh: result.totals.yesterdayKwh,
			energyMonthKwh: result.totals.monthKwh,
			energyYearKwh: result.totals.yearKwh,
		});
		if (result.enabled && result.valid) {
			activeCount++;
			totalPowerW += result.powerW ?? 0;
			totalTodayKwh += result.totals.todayKwh;
			totalYesterdayKwh += result.totals.yesterdayKwh;
			totalMonthKwh += result.totals.monthKwh;
			totalYearKwh += result.totals.yearKwh;
			totalTotalKwh += result.totals.totalKwh;
		}
	}

	const houseLoadW = await readForeignNum(host, MEASURED_CONSUMERS_HOUSE_LOAD_STATE_ID);
	const unknownHouseLoadW = computeUnknownHouseLoadW(houseLoadW, totalPowerW);

	const s = MEASURED_CONSUMERS_AGGREGATE_STATES;
	await setOptionalNumberIfChanged(host, s.totalPowerW, round1(totalPowerW));
	await setOptionalNumberIfChanged(host, s.totalEnergyTodayKwh, totalTodayKwh);
	await setOptionalNumberIfChanged(host, s.totalEnergyYesterdayKwh, totalYesterdayKwh);
	await setOptionalNumberIfChanged(host, s.totalEnergyMonthKwh, totalMonthKwh);
	await setOptionalNumberIfChanged(host, s.totalEnergyYearKwh, totalYearKwh);
	await setOptionalNumberIfChanged(host, s.totalEnergyTotalKwh, totalTotalKwh);
	await setOptionalNumberIfChanged(host, s.unknownHouseLoadW, unknownHouseLoadW);
	await setOptionalNumberIfChanged(host, s.houseLoadW, houseLoadW);
	await setStateIfChanged(host, s.houseLoadAvailable, houseLoadW !== null);
	await setStateIfChanged(host, s.activeSlotCount, activeCount);
	await setStateIfChanged(host, s.consumersJson, JSON.stringify(consumersSummary));
	await setStateIfChanged(host, s.lastTickIso, now.toISOString());
	await setStateIfChanged(
		host,
		s.reasonDe,
		slots.length === 0 ? "Keine gemessenen Verbraucher konfiguriert" : "",
	);

	const baseDir = host.getAbsolutePath?.("measured_consumers");
	if (baseDir) {
		await writeMeasuredConsumersPersist(baseDir, persist).catch((e) =>
			host.log.debug?.(`measured_consumers persist write: ${e}`),
		);
	}
}

export async function hydrateMeasuredConsumersPersist(host: MeasuredConsumersRuntimeHost): Promise<void> {
	if (persistHydrated) return;
	const dataDir = host.getAbsolutePath?.("measured_consumers");
	if (dataDir) {
		persist = await readMeasuredConsumersPersist(dataDir);
	}
	persistHydrated = true;
}

export async function initMeasuredConsumersRuntimeEngine(host: MeasuredConsumersRuntimeHost): Promise<void> {
	if (engineActive && hostRef === host) return;
	engineActive = true;
	hostRef = host;
	await hydrateMeasuredConsumersPersist(host);
	const slots = configuredMeasuredConsumerSlots(host.config);
	await ensureMeasuredConsumersStates(host, slots);
	scheduleTick(1000);
}

export function stopMeasuredConsumersRuntimeEngine(): void {
	engineActive = false;
	clearTick();
	const host = hostRef;
	if (host) {
		const baseDir = host.getAbsolutePath?.("measured_consumers");
		if (baseDir) {
			void writeMeasuredConsumersPersist(baseDir, persist).catch(() => undefined);
		}
	}
	hostRef = null;
}

/** Für Tests: Engine-Zustand zurücksetzen. */
export function resetMeasuredConsumersEngineForTest(): void {
	engineActive = false;
	clearTick();
	hostRef = null;
	persist = emptyMeasuredConsumersPersist();
	persistHydrated = false;
	overflowWarned = false;
}
