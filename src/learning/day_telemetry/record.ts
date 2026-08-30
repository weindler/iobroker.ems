/**
 * Tages-Telemetrie Recorder — Tick + Replan-Hook.
 * Beeinflusst Steuerung nicht; Fehler werden isoliert.
 */

import { asNum } from "../../ems_light/state_util";
import { intentAdminConfigFromAdapter } from "../../intent/config";
import { localDateKeyInTimezone, addDaysToDateKey, isoFromMs } from "../../operator/time";
import type { UnifiedAllocationCell, UnifiedDayPlan, UnifiedDayPlannerInput } from "../../operator/daily_plan/unified/types";
import { IMMERSION_RUNTIME_STATES } from "../../addons/immersion_heater/runtime/types";
import {
	DAY_TELEMETRY_CATEGORY,
	DAY_TELEMETRY_MAX_GAP_MS,
	DAY_TELEMETRY_RETENTION_DAYS,
	DAY_TELEMETRY_STATES,
} from "./constants";
import {
	applySharesToBucket,
	decideIntegrationGap,
	energyCounterDeltaPreciseKwh,
	integratePowerAcrossSlots,
	roundTelemetryKwh,
	splitAmountAcrossSlots,
} from "./energy_integrate";
import {
	buildPlannerKnowledgeSnapshot,
	upsertForecastSnapshot,
	withSnapshotId,
	type BatteryDecisionSnapshotInput,
} from "./knowledge_snapshot";
import {
	advanceClimateSegment,
	type OpenClimateSegment,
} from "./climate_segments";
import {
	advanceImmersionSegment,
	type OpenImmersionSegment,
} from "./immersion_segments";
import {
	dedupePlannedConsumers,
	freezePlannedConsumersForSlot,
	sharedGroupMapFromClimateUnits,
	type SharedGroupMap,
} from "./planned_freeze";
import {
	loadOrEmptyDayTelemetryStore,
	pruneDayTelemetryFiles,
	pruneDayTelemetryStore,
	writeDayTelemetryDay,
} from "./persist";
import {
	DOMAIN_QUALITY,
	TELEMETRY_DOMAIN,
	TELEMETRY_DOMAIN_COUNT,
	encodeDomainQuality,
	decodeDomainQuality,
	type TelemetryDomain,
} from "./quality_mask";
import { buildDaySlotLayout, slotIndexForMs, type DaySlotLayout } from "./slots";
import {
	activeUnitCombinationKey,
	immersionOnFromPowers,
	readLiveTelemetrySample,
	resolveActiveSharedPowerGroupId,
	type TelemetrySampleHost,
} from "./sources";
import {
	emptyDayRecord,
	noteSampleTimestamps,
	refreshDayCoverage,
	type DayTelemetryDayRecord,
	type DayTelemetryStore,
} from "./types";

export type DayTelemetryHost = TelemetrySampleHost & {
	getAbsolutePath?: (category?: string) => string;
	log?: { warn?: (m: string) => void; debug?: (m: string) => void; error?: (m: string) => void };
	setStateAsync: (id: string, state: ioBroker.SettableState) => Promise<unknown>;
};

type CounterBaselines = {
	gridImport: number | null;
	gridExport: number | null;
};

type RuntimeMem = {
	lastSampleTs: number | null;
	baselines: CounterBaselines;
	openClimate: OpenClimateSegment | null;
	openImmersion: OpenImmersionSegment | null;
	currentPlan: UnifiedDayPlan | null;
	currentInput: UnifiedDayPlannerInput | null;
	sharedGroupMap: SharedGroupMap | null;
	lastSnapshotId: string | null;
	lastEvConnected: boolean | null;
	dirty: boolean;
};

let mem: RuntimeMem = emptyMem();
let storeCache: DayTelemetryStore | null = null;
let storeDir: string | null = null;

function emptyMem(): RuntimeMem {
	return {
		lastSampleTs: null,
		baselines: { gridImport: null, gridExport: null },
		openClimate: null,
		openImmersion: null,
		currentPlan: null,
		currentInput: null,
		sharedGroupMap: null,
		lastSnapshotId: null,
		lastEvConnected: null,
		dirty: false,
	};
}

/** Nur Tests. */
export function __resetDayTelemetryRuntimeForTest(): void {
	mem = emptyMem();
	storeCache = null;
	storeDir = null;
}

async function publishStatus(
	host: DayTelemetryHost,
	id: string,
	val: ioBroker.StateValue,
): Promise<void> {
	try {
		const cur = await host.getStateAsync(id);
		if (cur?.val === val) return;
		await host.setStateAsync(id, { val, ack: true });
	} catch {
		/* Status-States sind best-effort */
	}
}

function baseDir(host: DayTelemetryHost): string | null {
	if (typeof host.getAbsolutePath !== "function") return null;
	return host.getAbsolutePath(DAY_TELEMETRY_CATEGORY);
}

async function loadStore(host: DayTelemetryHost): Promise<DayTelemetryStore> {
	const dir = baseDir(host);
	if (storeCache && storeDir === dir) return storeCache;
	storeDir = dir;
	storeCache = await loadOrEmptyDayTelemetryStore(dir);
	return storeCache;
}

async function persistDayAndMaybeYesterday(
	host: DayTelemetryHost,
	store: DayTelemetryStore,
	dateKey: string,
	yesterdayKey: string | null,
	yesterdayJustCompleted: boolean,
): Promise<void> {
	const dir = baseDir(host);
	if (!dir) return;
	const pruned = pruneDayTelemetryStore(store, DAY_TELEMETRY_RETENTION_DAYS, dateKey);
	pruned.updatedAtIso = new Date().toISOString();
	const day = pruned.days[dateKey];
	if (day) {
		refreshDayCoverage(day);
		await writeDayTelemetryDay(dir, day);
	}
	if (yesterdayJustCompleted && yesterdayKey && pruned.days[yesterdayKey]) {
		refreshDayCoverage(pruned.days[yesterdayKey]);
		await writeDayTelemetryDay(dir, pruned.days[yesterdayKey]);
	}
	await pruneDayTelemetryFiles(dir, DAY_TELEMETRY_RETENTION_DAYS, dateKey);
	storeCache = pruned;
	mem.dirty = false;
}

function ensureDay(
	store: DayTelemetryStore,
	dateKey: string,
	timezone: string,
): { store: DayTelemetryStore; day: DayTelemetryDayRecord; layout: DaySlotLayout } {
	const layout = buildDaySlotLayout(dateKey, timezone);
	let day = store.days[dateKey];
	if (!day || day.slotCount !== layout.slotCount || day.startMs !== layout.startMs) {
		day = emptyDayRecord(dateKey, timezone, layout.startMs, layout.endMs, layout.slotCount);
		store = {
			...store,
			days: { ...store.days, [dateKey]: day },
		};
	}
	return { store, day, layout };
}

/** Alle Domänen = n/a — Ausgangsmaske für neu beobachtete Slots (nicht ok=0). */
function blankObservedMask(): number {
	let m = 0;
	for (let d = 0; d < TELEMETRY_DOMAIN_COUNT; d++) {
		m = encodeDomainQuality(m, d as TelemetryDomain, DOMAIN_QUALITY.na);
	}
	return m;
}

function markDomain(
	day: DayTelemetryDayRecord,
	slotIndex: number,
	domain: TelemetryDomain,
	quality: 0 | 1 | 2 | 3,
): void {
	const prev = day.buckets.qualityMask[slotIndex];
	const base = prev == null ? blankObservedMask() : prev;
	day.buckets.qualityMask[slotIndex] = encodeDomainQuality(base, domain, quality);
}

function setLastValue(arr: Array<number | null>, index: number, v: number | null): void {
	if (index < 0 || index >= arr.length) return;
	if (v === null || !Number.isFinite(v)) return;
	arr[index] = v;
}

function addRuntimeSec(arr: Array<number | null>, index: number, sec: number): void {
	if (index < 0 || index >= arr.length || !(sec > 0)) return;
	const prev = arr[index];
	arr[index] = (prev ?? 0) + sec;
}

function freezeSlotIfNeeded(
	day: DayTelemetryDayRecord,
	layout: DaySlotLayout,
	slotIndex: number,
): void {
	if (day.buckets.plannedConsumersRef[slotIndex] != null) return;
	const plan = mem.currentPlan;
	if (!plan) {
		markDomain(day, slotIndex, TELEMETRY_DOMAIN.PLANNER, DOMAIN_QUALITY.missing);
		return;
	}
	const slot = layout.slots[slotIndex];
	if (!slot) return;
	const startIso = isoFromMs(slot.startMs);
	const frozen = freezePlannedConsumersForSlot(
		plan.allocations as UnifiedAllocationCell[],
		startIso,
		mem.sharedGroupMap,
	);
	const dedup = dedupePlannedConsumers(day.plannedConsumers, frozen);
	day.plannedConsumers = dedup.table;
	day.buckets.plannedConsumersRef[slotIndex] = dedup.index;
	day.buckets.snapshotIdRef[slotIndex] = mem.lastSnapshotId;
	markDomain(day, slotIndex, TELEMETRY_DOMAIN.PLANNER, DOMAIN_QUALITY.ok);
}

function integratePowerDomain(
	day: DayTelemetryDayRecord,
	layout: DaySlotLayout,
	fromMs: number,
	toMs: number,
	powerW: number | null,
	bucket: Array<number | null>,
	domain: TelemetryDomain,
): void {
	if (powerW === null || !Number.isFinite(powerW)) {
		const idxs = overlappingSlotIndicesSafe(layout, fromMs, toMs);
		for (const i of idxs) {
			const mask = day.buckets.qualityMask[i];
			const q =
				mask == null ? DOMAIN_QUALITY.na : decodeDomainQuality(mask, domain);
			if (q === DOMAIN_QUALITY.ok) continue;
			markDomain(day, i, domain, DOMAIN_QUALITY.missing);
		}
		return;
	}
	/* 0 W ist gültig → ok + Integration (Energieanteil 0). */
	const shares = integratePowerAcrossSlots(layout, fromMs, toMs, powerW);
	applySharesToBucket(bucket, shares);
	for (const s of shares) {
		markDomain(day, s.slotIndex, domain, DOMAIN_QUALITY.ok);
	}
}

function overlappingSlotIndicesSafe(layout: DaySlotLayout, fromMs: number, toMs: number): number[] {
	const out: number[] = [];
	for (const s of layout.slots) {
		if (s.endMs <= fromMs || s.startMs >= toMs) continue;
		out.push(s.index);
	}
	return out;
}

function markGapMissing(day: DayTelemetryDayRecord, layout: DaySlotLayout, fromMs: number, toMs: number): void {
	for (const i of overlappingSlotIndicesSafe(layout, fromMs, toMs)) {
		for (const d of Object.values(TELEMETRY_DOMAIN)) {
			if (d === TELEMETRY_DOMAIN.PLANNER || d === TELEMETRY_DOMAIN.PRICE) continue;
			const mask = day.buckets.qualityMask[i];
			const q = mask == null ? DOMAIN_QUALITY.missing : decodeDomainQuality(mask, d);
			if (q === DOMAIN_QUALITY.ok) continue;
			markDomain(day, i, d, DOMAIN_QUALITY.missing);
		}
	}
}

/**
 * Haupt-Tick: Sample lesen, integrieren, Slot einfrieren, persistieren.
 * Fehler werden geloggt, nicht geworfen.
 */
export async function tickDayTelemetry(host: DayTelemetryHost, now: Date = new Date()): Promise<void> {
	try {
		await tickDayTelemetryInner(host, now);
	} catch (e) {
		host.log?.warn?.(`day_telemetry tick: ${e instanceof Error ? e.message : String(e)}`);
		await publishStatus(host, DAY_TELEMETRY_STATES.status, "error");
	}
}

async function tickDayTelemetryInner(host: DayTelemetryHost, now: Date): Promise<void> {
	const timezone = intentAdminConfigFromAdapter(host.config).timezone || "Europe/Berlin";
	const nowMs = now.getTime();
	const dateKey = localDateKeyInTimezone(now, timezone);
	let store = await loadStore(host);

	/* Gestern als complete markieren wenn über Mitternacht (Kalender, nicht Coverage) */
	const yesterday = addDaysToDateKey(dateKey, -1);
	let yesterdayJustCompleted = false;
	if (store.days[yesterday] && !store.days[yesterday].complete) {
		store.days[yesterday] = { ...store.days[yesterday], complete: true };
		mem.dirty = true;
		yesterdayJustCompleted = true;
	}

	const ensured = ensureDay(store, dateKey, timezone);
	store = ensured.store;
	const day = ensured.day;
	const layout = ensured.layout;

	const sample = await readLiveTelemetrySample(host, nowMs);
	const immersionCmd = asNum((await host.getStateAsync(IMMERSION_RUNTIME_STATES.commandedPowerW))?.val);
	sample.immersionRuntimeOn = immersionOnFromPowers(sample.immersionPowerW, immersionCmd);

	noteSampleTimestamps(day, nowMs);

	const curSlot = slotIndexForMs(layout, nowMs);
	if (curSlot != null) {
		freezeSlotIfNeeded(day, layout, curSlot);
		if (sample.priceCtPerKwh != null) {
			day.buckets.priceCtPerKwh[curSlot] = sample.priceCtPerKwh;
			markDomain(day, curSlot, TELEMETRY_DOMAIN.PRICE, DOMAIN_QUALITY.ok);
		} else {
			markDomain(day, curSlot, TELEMETRY_DOMAIN.PRICE, DOMAIN_QUALITY.missing);
		}
		setLastValue(day.buckets.batterySocEndPct, curSlot, sample.batterySocPct);
		setLastValue(day.buckets.evSocEndPct, curSlot, sample.evSocPct);
		setLastValue(day.buckets.boilerTempEndC, curSlot, sample.boilerTempC);
		if (sample.batterySocPct != null) markDomain(day, curSlot, TELEMETRY_DOMAIN.BATTERY, DOMAIN_QUALITY.ok);
		if (sample.boilerTempC != null) markDomain(day, curSlot, TELEMETRY_DOMAIN.THERMAL, DOMAIN_QUALITY.ok);
	}

	const gap = decideIntegrationGap(mem.lastSampleTs, nowMs, DAY_TELEMETRY_MAX_GAP_MS);

	if (gap.kind === "gap_too_long" && mem.lastSampleTs != null) {
		markGapMissing(day, layout, mem.lastSampleTs, nowMs);
		/* Baselines neu setzen ohne Energie zu erfinden */
		if (sample.gridImportEnergyKwh != null) mem.baselines.gridImport = sample.gridImportEnergyKwh;
		if (sample.gridExportEnergyKwh != null) mem.baselines.gridExport = sample.gridExportEnergyKwh;
	} else if (gap.kind === "ok") {
		const { fromMs, toMs } = gap;
		const dtSec = (toMs - fromMs) / 1000;

		integratePowerDomain(day, layout, fromMs, toMs, sample.pvPowerW, day.buckets.pvKwh, TELEMETRY_DOMAIN.PV);
		integratePowerDomain(
			day,
			layout,
			fromMs,
			toMs,
			sample.houseTotalPowerW,
			day.buckets.houseTotalKwh,
			TELEMETRY_DOMAIN.HOUSE,
		);
		integratePowerDomain(
			day,
			layout,
			fromMs,
			toMs,
			sample.batteryChargePowerW,
			day.buckets.batteryChargedKwh,
			TELEMETRY_DOMAIN.BATTERY,
		);
		integratePowerDomain(
			day,
			layout,
			fromMs,
			toMs,
			sample.batteryDischargePowerW,
			day.buckets.batteryDischargedKwh,
			TELEMETRY_DOMAIN.BATTERY,
		);
		integratePowerDomain(
			day,
			layout,
			fromMs,
			toMs,
			sample.evChargePowerW,
			day.buckets.evChargedKwh,
			TELEMETRY_DOMAIN.EV,
		);
		integratePowerDomain(
			day,
			layout,
			fromMs,
			toMs,
			sample.immersionPowerW,
			day.buckets.immersionKwh,
			TELEMETRY_DOMAIN.THERMAL,
		);
		if (sample.immersionRuntimeOn === true) {
			for (const i of overlappingSlotIndicesSafe(layout, fromMs, toMs)) {
				const slot = layout.slots[i];
				const overlap = Math.min(slot.endMs, toMs) - Math.max(slot.startMs, fromMs);
				if (overlap > 0) addRuntimeSec(day.buckets.immersionRuntimeSec, i, overlap / 1000);
			}
		}
		const immersionSegDeltaKwh =
			sample.immersionPowerW != null && Number.isFinite(sample.immersionPowerW)
				? (sample.immersionPowerW * (dtSec / 3600)) / 1000
				: 0;
		const immersionSeg = advanceImmersionSegment(
			mem.openImmersion,
			nowMs,
			sample.immersionRuntimeOn === true,
			immersionSegDeltaKwh,
			sample.immersionRuntimeOn === true ? dtSec : 0,
			{
				decisionSource: sample.immersionDecisionSource,
				forcedMode: sample.immersionResolvedMode === null ? null : sample.immersionResolvedMode === "force",
				hygieneStatusDe: sample.immersionHygieneStatusDe,
				ownershipOwner: sample.immersionOwnershipOwner,
			},
			day.immersionRunSegments,
		);
		mem.openImmersion = immersionSeg.open;
		day.immersionRunSegments = immersionSeg.list;
		integratePowerDomain(
			day,
			layout,
			fromMs,
			toMs,
			sample.climateSystemPowerW,
			day.buckets.climateKwh,
			TELEMETRY_DOMAIN.CLIMATE,
		);
		if (sample.climateSharedPowerUsed === true || sample.climateSystemPowerW != null) {
			integratePowerDomain(
				day,
				layout,
				fromMs,
				toMs,
				sample.climateSystemPowerW,
				day.buckets.climateElecSharedKwh,
				TELEMETRY_DOMAIN.CLIMATE,
			);
		}
		integratePowerDomain(
			day,
			layout,
			fromMs,
			toMs,
			sample.otherMeasuredConsumersPowerW,
			day.buckets.otherMeasuredConsumersKwh,
			TELEMETRY_DOMAIN.MEASURED_CONSUMERS,
		);

		const imp = energyCounterDeltaPreciseKwh(mem.baselines.gridImport, sample.gridImportEnergyKwh);
		mem.baselines.gridImport = imp.newBaseline;
		if (imp.deltaKwh != null && imp.deltaKwh > 0 && !imp.reset) {
			applySharesToBucket(day.buckets.gridImportKwh, splitAmountAcrossSlots(layout, fromMs, toMs, imp.deltaKwh));
			for (const s of splitAmountAcrossSlots(layout, fromMs, toMs, imp.deltaKwh)) {
				markDomain(day, s.slotIndex, TELEMETRY_DOMAIN.GRID, DOMAIN_QUALITY.ok);
			}
		} else if (sample.gridImportEnergyKwh == null && sample.gridImportPowerW != null) {
			integratePowerDomain(
				day,
				layout,
				fromMs,
				toMs,
				sample.gridImportPowerW,
				day.buckets.gridImportKwh,
				TELEMETRY_DOMAIN.GRID,
			);
		}

		const exp = energyCounterDeltaPreciseKwh(mem.baselines.gridExport, sample.gridExportEnergyKwh);
		mem.baselines.gridExport = exp.newBaseline;
		if (exp.deltaKwh != null && exp.deltaKwh > 0 && !exp.reset) {
			applySharesToBucket(day.buckets.gridExportKwh, splitAmountAcrossSlots(layout, fromMs, toMs, exp.deltaKwh));
			for (const s of splitAmountAcrossSlots(layout, fromMs, toMs, exp.deltaKwh)) {
				markDomain(day, s.slotIndex, TELEMETRY_DOMAIN.GRID, DOMAIN_QUALITY.ok);
			}
		}

		const fromSample = resolveActiveSharedPowerGroupId(
			sample.climateUnitActive,
			host.config,
			mem.sharedGroupMap,
		);
		const sharedGroup = fromSample.groupId;
		const combo = activeUnitCombinationKey(sample.climateUnitActive);
		const climateDelta =
			sample.climateSystemPowerW != null && Number.isFinite(sample.climateSystemPowerW)
				? (sample.climateSystemPowerW * (dtSec / 3600)) / 1000
				: 0;
		const powerOk =
			sample.climateSystemPowerW != null &&
			Number.isFinite(sample.climateSystemPowerW) &&
			sample.climateSystemPowerW >= 0;
		const groupOk = sharedGroup != null;
		const climateValid = powerOk && groupOk && combo !== "none";
		const rejectReason = !groupOk
			? fromSample.rejectReason ?? "shared_power_group_unknown"
			: !powerOk
				? "invalid_power"
				: null;
		const seg = advanceClimateSegment(
			mem.openClimate,
			nowMs,
			{
				sharedPowerGroupId: sharedGroup,
				mode: sample.climateMode ?? "unknown",
				activeUnitCombination: combo,
				valid: climateValid,
			},
			climateDelta,
			combo !== "none" ? dtSec : 0,
			rejectReason,
			day.climateRunSegments,
		);
		mem.openClimate = seg.open;
		day.climateRunSegments = seg.list;
	} else if (gap.kind === "first_sample") {
		if (sample.gridImportEnergyKwh != null) mem.baselines.gridImport = sample.gridImportEnergyKwh;
		if (sample.gridExportEnergyKwh != null) mem.baselines.gridExport = sample.gridExportEnergyKwh;
	}

	if (sample.evConnected != null && mem.lastEvConnected != null && sample.evConnected !== mem.lastEvConnected) {
		day.statusEvents.push({
			tsIso: now.toISOString(),
			kind: sample.evConnected ? "ev_connected" : "ev_disconnected",
			detail: "",
		});
	}
	if (sample.evConnected != null) mem.lastEvConnected = sample.evConnected;

	mem.lastSampleTs = nowMs;
	mem.dirty = true;

	roundDayBuckets(day);
	refreshDayCoverage(day);

	store = {
		...store,
		days: { ...store.days, [dateKey]: day },
		updatedAtIso: now.toISOString(),
	};
	await persistDayAndMaybeYesterday(host, store, dateKey, yesterday, yesterdayJustCompleted);

	await publishStatus(host, DAY_TELEMETRY_STATES.status, "ok");
	if (curSlot != null) {
		const slot = layout.slots[curSlot];
		await publishStatus(
			host,
			DAY_TELEMETRY_STATES.lastSlotWrittenAt,
			new Date(slot.startMs).toISOString(),
		);
	}
	await publishStatus(host, DAY_TELEMETRY_STATES.recoveryPending, false);
}

function roundDayBuckets(day: DayTelemetryDayRecord): void {
	const keys: Array<keyof typeof day.buckets> = [
		"pvKwh",
		"houseTotalKwh",
		"gridImportKwh",
		"gridExportKwh",
		"batteryChargedKwh",
		"batteryDischargedKwh",
		"evChargedKwh",
		"immersionKwh",
		"climateKwh",
		"climateElecSharedKwh",
		"otherMeasuredConsumersKwh",
	];
	for (const k of keys) {
		const arr = day.buckets[k] as Array<number | null>;
		for (let i = 0; i < arr.length; i++) {
			const v = arr[i];
			if (v != null && Number.isFinite(v)) arr[i] = roundTelemetryKwh(v);
		}
	}
}

/**
 * Wird bei materiellem Plan-Publish aufgerufen (bestehendes REPLAN-Gate).
 */
export async function noteDayTelemetryPlanPublished(input: {
	host: DayTelemetryHost;
	now: Date;
	timezone: string;
	plan: UnifiedDayPlan;
	plannerInput: UnifiedDayPlannerInput;
	replanReasons: string[];
	/**
	 * Additiv (Block A): tatsächlich verwendeter Battery-Discharge-/Reserve-Kontext aus dem
	 * bestehenden Decision-Pfad im Tick — optional, `undefined`/`null` bleibt exakt heutiges
	 * Verhalten (batteryDecision = null im Snapshot).
	 */
	batteryDecision?: BatteryDecisionSnapshotInput | null;
}): Promise<void> {
	try {
		await notePlanInner(input);
	} catch (e) {
		input.host.log?.warn?.(
			`day_telemetry note plan: ${e instanceof Error ? e.message : String(e)}`,
		);
	}
}

async function notePlanInner(input: {
	host: DayTelemetryHost;
	now: Date;
	timezone: string;
	plan: UnifiedDayPlan;
	plannerInput: UnifiedDayPlannerInput;
	replanReasons: string[];
	batteryDecision?: BatteryDecisionSnapshotInput | null;
}): Promise<void> {
	const { host, now, timezone, plan, plannerInput, replanReasons, batteryDecision } = input;
	const dateKey = localDateKeyInTimezone(now, timezone);
	let store = await loadStore(host);
	const ensured = ensureDay(store, dateKey, timezone);
	store = ensured.store;
	const day = ensured.day;
	const layout = ensured.layout;

	mem.currentPlan = plan;
	mem.currentInput = plannerInput;
	mem.sharedGroupMap = sharedGroupMapFromClimateUnits(plannerInput.climate?.units ?? []);

	const snapBody = buildPlannerKnowledgeSnapshot(plannerInput, now.toISOString(), {
		batteryDecision,
	});
	const snap = withSnapshotId(snapBody);
	const up = upsertForecastSnapshot(day.forecastSnapshots, snap);
	day.forecastSnapshots = up.list;
	mem.lastSnapshotId = up.snapshotId;

	/* Affected slot range: from current slot to end of day */
	const nowMs = now.getTime();
	const fromIdx = slotIndexForMs(layout, nowMs) ?? 0;
	const toIdx = Math.max(0, layout.slotCount - 1);

	day.replanEvents.push({
		tsIso: now.toISOString(),
		generation: plan.generation,
		planId: plan.planId,
		reasonCodes: [...replanReasons],
		affectedSlotFrom: fromIdx,
		affectedSlotTo: toIdx,
		snapshotId: up.snapshotId,
	});

	/* Aktuellen Slot einfrieren falls noch nicht (beim Publish zur Slot-Zeit) */
	if (fromIdx != null && day.buckets.plannedConsumersRef[fromIdx] == null) {
		freezeSlotIfNeeded(day, layout, fromIdx);
	}

	store = {
		...store,
		days: { ...store.days, [dateKey]: day },
		updatedAtIso: now.toISOString(),
	};
	await persistDayAndMaybeYesterday(host, store, dateKey, null, false);
}

export { DAY_TELEMETRY_CATEGORY as DAY_TELEMETRY_PERSIST_CATEGORY };
