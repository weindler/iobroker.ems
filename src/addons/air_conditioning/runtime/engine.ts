import { touchEmsActivity } from "../../../ems_activity";
import { isAddonExecutionOff, isLiveWriteAllowed } from "../../../execution_mode";
import { asNum } from "../../../ems_light/state_util";
import { setStateIfChanged } from "../../../policy/core/state_write";
import { addonEnabled, addonAvailable, addonMode } from "../../../tree_paths";
import {
	tickConsumerStats,
	initConsumerStatsForKey,
	flushConsumerStatsPersist,
	resetConsumerStatsCache,
	peekConsumerStatsEntry,
} from "../../../learning/consumer_stats";
import { isAddonGovernanceEnabledFromState, addonGovernanceEnabledState } from "../../../addons/governance";
import {
	plannerStatusFromDailyPlan,
	publishAddonRuntimeSurface,
	type ExecutionStatus,
	type IntentStatus,
} from "../../../addons/runtime_surface";
import { DAILY_PLAN_STATE_IDS, ALLOCATION_ADDON_STATE_IDS } from "../../../operator/daily_plan/states";
import type { DeviceWriteHost } from "../../../device_write";
import {
	acUnitConsumerKey,
	AC_ADDON_ID,
	AC_CLEANING_MIN_COOL_RUNTIME_MS,
	AC_CLEANING_REFRESH_MS,
	AC_FEEDBACK_POLL_ATTEMPTS,
	AC_FEEDBACK_POLL_MS,
	AC_START_RETRY_MS,
	AC_STOP_RETRY_MS,
	AC_TICK_MS,
	AC_WATCH_MAPPING_ROLES,
} from "../constants";
import { configuredAcUnitIndexes } from "../configured";
import { acCleaningAfterPurpose, acEstimatedPowerForPurpose, acGlobalConfigFromAdapter, acModeCommandEnabled } from "../config";
import type { AcUnitConfig } from "../types";
import { getAcProfile, isLocalthingsHassProfile } from "../profiles/registry";
import { buildLocalthingsPrefillPatch, scheduleLocalthingsPrefillPersist, clearLocalthingsPrefillPersistTimer } from "../profiles/localthings_prefill";
import { resolveLocalthingsMeasuredPowerW } from "../profiles/localthings_power";
import { modeStringsForPurpose, optionalStep } from "../profiles/types";
import type { AcUnitModePurpose } from "../types";
import { acUnitRuntimeStates, AC_RUNTIME_BASE, AC_RUNTIME_SUMMARY_STATES, ensureAcRuntimeStates } from "./ensure_states";
import {
	resolveAcUnitDailyPlanAllocation,
	resetAcDailyPlanCache,
	type AcUnitDailyPlanResolution,
} from "./daily_plan";
import { evaluateAcUnitFsm } from "./fsm";
import { emptyUnitPersist, type AcRuntimePersist, type AcUnitPersist } from "./persist";
import { readAcRuntimePersist, writeAcRuntimePersist } from "./persist_io";
import {
	advanceCoolingDesired,
	clearStopIntentAfterStart,
	decideStopWrite,
	ensureStopIntentFields,
	type AcCoolingDesired,
} from "./stop_intent";
import { computeAcCoolingDesired, controlToPermission } from "./compute_desired";
import { logAcCoolingDiag, type AcCoolingDiagTag } from "./diag_trace";
import {
	buildAcMappingTableFromConfig,
	executeAcWriteSteps,
	resolveAcMappingTarget,
	writeAcUnitSwitchOff,
	type AcMappingTable,
} from "./sequences";
import { resolveAcPowerDisplay, resolveAcFilterVis } from "./vis_telemetry";
import { resolveAcDevicePowered, resolveAcFeedbackModeTarget } from "./feedback_on";
import { acStatsDeviceActive, closeAcUnitStatsSession } from "./stats_active";
import {
	isCleaningFinishedByFeedback,
	isCleaningFinishedByProgress,
	isCleaningStuckNeverEngaged,
	shouldMarkCleaningOperatingActive,
	shouldMarkCleaningProgressActive,
} from "./cleaning";
import { switchIsOn } from "./time";
import {
	flushQueuedAcPowerConfigReconcile,
	queueAcPowerConfigReconcile,
} from "./power_reconcile";

export type AcRuntimeHost = DeviceWriteHost & {
	config?: unknown;
	namespace?: string;
	getAbsolutePath?: (category?: string) => string;
	/** Persistierte Admin-Native (Learning→Config); optional — ohne Write kein Restart. */
	updateConfig?: (newConfig: Record<string, unknown>) => Promise<unknown>;
	log: { info: (m: string) => void; warn: (m: string) => void; debug?: (m: string) => void; error?: (m: string) => void };
	setObjectNotExistsAsync: (id: string, obj: ioBroker.Object) => Promise<unknown>;
	extendObjectAsync?: (id: string, obj: Partial<ioBroker.Object>) => Promise<unknown>;
	getStateAsync: (id: string) => Promise<ioBroker.State | null | undefined>;
	getForeignStateAsync?: (id: string) => Promise<ioBroker.State | null | undefined>;
	setStateAsync: (id: string, state: ioBroker.SettableState) => Promise<unknown>;
	subscribeStatesAsync?: (pattern: string) => Promise<void>;
	subscribeForeignStatesAsync?: (pattern: string) => Promise<void>;
	unsubscribeForeignStatesAsync?: (pattern: string) => Promise<void>;
};

let engineActive = false;
let hostRef: AcRuntimeHost | null = null;
let persist: AcRuntimePersist = { version: 1, units: {} };
let tickTimer: ReturnType<typeof setTimeout> | null = null;
let tickRunning = false;
const subscribedIds: string[] = [];

function clearTick(): void {
	if (tickTimer) {
		clearTimeout(tickTimer);
		tickTimer = null;
	}
}

function scheduleTick(delayMs: number = AC_TICK_MS): void {
	clearTick();
	if (!engineActive) return;
	tickTimer = setTimeout(() => {
		tickTimer = null;
		if (!engineActive || !hostRef) return;
		void runAcRuntimeTick(hostRef).catch((e) => hostRef?.log.warn(`ac runtime tick: ${e}`));
	}, delayMs);
}

/** Nach Hardware-Aktion: neuer Reconcile mit frischen Inputs, kein Weiterrechnen mit Pre-await-Snapshot. */
function scheduleImmediateReconcile(): void {
	scheduleTick(50);
}

/** LocalThings: On/Off aus feedback_switch und ggf. climate.state (state_boolean oft falsch). */
async function readUnitDevicePowered(
	host: AcRuntimeHost,
	unit: AcUnitConfig,
	table: AcMappingTable,
): Promise<{ on: boolean; value: unknown; switchRaw: unknown; modeRaw: unknown; via: "switch" | "mode" | "none" }> {
	const fbId = resolveAcMappingTarget(table, unit.index, "feedback_switch");
	const modeId = resolveAcFeedbackModeTarget(table, unit, fbId);
	const sw = await readForeign(host, fbId);
	const mode = modeId ? await readForeign(host, modeId) : { value: null as unknown, num: null };
	const r = resolveAcDevicePowered({
		switchRaw: sw.value,
		modeRaw: mode.value,
		useModeFallback: Boolean(modeId),
	});
	return {
		on: r.on,
		value: r.effectiveRaw,
		switchRaw: sw.value,
		modeRaw: mode.value,
		via: r.via,
	};
}

async function readForeign(host: AcRuntimeHost, id: string): Promise<{ value: unknown; num: number | null }> {
	if (!id) return { value: null, num: null };
	try {
		const reader = host.getForeignStateAsync ?? host.getStateAsync;
		const st = await reader(id);
		return { value: st?.val ?? null, num: asNum(st?.val) };
	} catch {
		return { value: null, num: null };
	}
}

function unitPersist(index: number): AcUnitPersist {
	if (!persist.units[index]) {
		persist.units[index] = emptyUnitPersist(index);
	}
	const up = persist.units[index];
	if (up.lastModePurpose === undefined) {
		up.lastModePurpose = null;
	}
	ensureStopIntentFields(up);
	return up;
}

function allocatedPowerW(runningCount: number, outdoorMax: number, unitEstimated: number): number {
	if (runningCount <= 0) return 0;
	if (runningCount === 1) return unitEstimated;
	return Math.min(unitEstimated, Math.round(outdoorMax / runningCount));
}

function stopRetryReady(up: AcUnitPersist, nowMs: number): boolean {
	return !up.lastStopAtMs || nowMs - up.lastStopAtMs >= AC_STOP_RETRY_MS;
}

function scheduleCleaningAfterStop(
	host: AcRuntimeHost,
	unit: AcUnitConfig,
	up: AcUnitPersist,
	nowMs: number,
	purpose: AcUnitModePurpose | null,
): void {
	if (!acCleaningAfterPurpose(unit, purpose) || up.cleaningActive) {
		return;
	}
	if (up.cleaningPendingUntilMs && up.cleaningPendingUntilMs > nowMs) {
		return;
	}
	// Abort/short cool runs must not trigger auto-clean (would loop with immediate re-stop).
	if (up.lastStartAtMs != null) {
		const coolRuntimeMs = nowMs - up.lastStartAtMs;
		if (coolRuntimeMs < AC_CLEANING_MIN_COOL_RUNTIME_MS) {
			host.log.info(
				`ac unit ${unit.index}: cleaning skipped — cool run too short (${Math.round(coolRuntimeMs / 1000)}s < ${Math.round(AC_CLEANING_MIN_COOL_RUNTIME_MS / 1000)}s)`,
			);
			return;
		}
	}
	up.cleaningPendingUntilMs = nowMs + unit.cleaningDelayMin * 60_000;
	const at = new Date(up.cleaningPendingUntilMs).toLocaleTimeString("de-AT", { hour: "2-digit", minute: "2-digit" });
	const why = purpose ?? "unknown";
	host.log.info(
		`ac unit ${unit.index}: cleaning scheduled in ${unit.cleaningDelayMin} min (at ~${at}, after ${why})`,
	);
}

async function waitForFeedbackOff(
	host: AcRuntimeHost,
	unit: AcUnitConfig,
	table: AcMappingTable,
): Promise<{ off: boolean; value: unknown }> {
	const fbId = resolveAcMappingTarget(table, unit.index, "feedback_switch");
	if (!fbId && !resolveAcFeedbackModeTarget(table, unit, fbId)) {
		return { off: false, value: null };
	}
	for (let attempt = 0; attempt < AC_FEEDBACK_POLL_ATTEMPTS; attempt++) {
		await new Promise((resolve) => setTimeout(resolve, AC_FEEDBACK_POLL_MS));
		const powered = await readUnitDevicePowered(host, unit, table);
		if (!powered.on) {
			return { off: true, value: powered.value };
		}
	}
	const powered = await readUnitDevicePowered(host, unit, table);
	return { off: !powered.on, value: powered.value };
}

async function waitForFeedbackOn(
	host: AcRuntimeHost,
	unit: AcUnitConfig,
	table: AcMappingTable,
): Promise<{ on: boolean; value: unknown; via: "switch" | "mode" | "none" }> {
	const fbId = resolveAcMappingTarget(table, unit.index, "feedback_switch");
	if (!fbId && !resolveAcFeedbackModeTarget(table, unit, fbId)) {
		return { on: false, value: null, via: "none" };
	}
	for (let attempt = 0; attempt < AC_FEEDBACK_POLL_ATTEMPTS; attempt++) {
		await new Promise((resolve) => setTimeout(resolve, AC_FEEDBACK_POLL_MS));
		const powered = await readUnitDevicePowered(host, unit, table);
		if (powered.on) {
			return { on: true, value: powered.value, via: powered.via };
		}
	}
	const powered = await readUnitDevicePowered(host, unit, table);
	return { on: powered.on, value: powered.value, via: powered.via };
}

/** LocalThings: gemessene Leistung nur wenn plausibel; sonst null → Learned/Config-Fallback. */
async function resolveAcMeasuredPowerForStats(
	host: AcRuntimeHost,
	unit: AcUnitConfig,
	table: AcMappingTable,
	acConfirmedOn: boolean,
): Promise<number | null> {
	const powerId = resolveAcMappingTarget(table, unit.index, "power_w");
	if (!powerId) return null;
	const raw = await readForeign(host, powerId);
	if (!isLocalthingsHassProfile(unit.profileId)) {
		return raw.num != null && Number.isFinite(raw.num) && raw.num > 0 ? Math.round(raw.num) : null;
	}
	const decision = resolveLocalthingsMeasuredPowerW({
		rawPowerW: raw.num,
		acConfirmedOn,
	});
	return decision.useMeasured ? decision.powerW : null;
}

async function stopUnit(
	host: AcRuntimeHost,
	unit: AcUnitConfig,
	table: AcMappingTable,
	live: boolean,
	up: AcUnitPersist,
): Promise<void> {
	const profile = getAcProfile(unit.profileId);
	const steps = profile.coolingStopSequence?.() ?? [{ kind: "switch_off" as const }];
	host.log.info(`ac unit ${unit.index}: stop sequence starting (${live ? "live" : "dryrun"})`);
	await executeAcWriteSteps(host, unit.index, table, steps, live, host.log);
	up.lastStopAtMs = Date.now();
	if (!live) {
		up.running = false;
		const purpose = up.lastModePurpose;
		scheduleCleaningAfterStop(host, unit, up, up.lastStopAtMs, purpose);
		up.lastModePurpose = null;
		return;
	}
	// Sofort prüfen, dann kurze Poll-Schleife; bei Bedarf zweite Off-Welle.
	let powered = await readUnitDevicePowered(host, unit, table);
	let fbValue: unknown = powered.value;
	if (powered.on) {
		const waited = await waitForFeedbackOff(host, unit, table);
		fbValue = waited.value;
		powered = { ...powered, on: !waited.off, value: waited.value };
	}
	if (powered.on) {
		host.log.warn(`ac unit ${unit.index}: still on after first stop — retry switch_off`);
		await writeAcUnitSwitchOff(host, unit.index, table, true, host.log);
		const refreshId = resolveAcMappingTarget(table, unit.index, "cmd_refresh");
		if (refreshId) {
			await executeAcWriteSteps(host, unit.index, table, [{ kind: "toggle", role: "cmd_refresh" }], true, host.log);
		}
		const waited = await waitForFeedbackOff(host, unit, table);
		fbValue = waited.value;
		powered = { ...powered, on: !waited.off, value: waited.value };
	}
	if (!powered.on) {
		up.running = false;
		host.log.info(
			`ac unit ${unit.index}: stop (live) — feedback off (${String(fbValue ?? "")})`,
		);
		const purpose = up.lastModePurpose;
		scheduleCleaningAfterStop(host, unit, up, up.lastStopAtMs, purpose);
		up.lastModePurpose = null;
	} else {
		up.running = true;
		host.log.warn(
			`ac unit ${unit.index}: stop sent but feedback still on (last=${String(fbValue ?? "")}) — check mapping cmd_switch_off/on; cleaning not scheduled`,
		);
	}
}

async function applyModePurposeWhileRunning(
	host: AcRuntimeHost,
	unit: AcUnitConfig,
	table: AcMappingTable,
	live: boolean,
	up: AcUnitPersist,
	modePurpose: AcUnitModePurpose,
): Promise<void> {
	if (up.lastModePurpose === modePurpose) {
		return;
	}
	const { mode, fanMode, fanSpeed } = modeStringsForPurpose(unit, modePurpose);
	if (!acModeCommandEnabled(mode)) {
		return;
	}
	const steps = [
		{ kind: "set" as const, role: "cmd_set_mode" as const, value: mode },
		{ kind: "set" as const, role: "cmd_set_fan_mode" as const, value: fanMode },
		...optionalStep("cmd_set_fan_speed", fanSpeed),
	];
	await executeAcWriteSteps(host, unit.index, table, steps, live, host.log);
	up.lastModePurpose = modePurpose;
	if (live) {
		host.log.info(`ac unit ${unit.index}: mode → ${modePurpose} (${mode})`);
	}
}

function plannerOffFromDailyPlan(dailyPlan: AcUnitDailyPlanResolution): boolean {
	return (
		dailyPlan.useDailyPlan &&
		dailyPlan.allocatedPowerW !== null &&
		dailyPlan.allocatedPowerW <= 0
	);
}

function emitAcCoolingDiag(
	host: AcRuntimeHost,
	tag: AcCoolingDiagTag,
	unitIndex: number,
	nowMs: number,
	up: AcUnitPersist,
	dailyPlan: AcUnitDailyPlanResolution,
	desired: AcCoolingDesired,
	permission: {
		decisionSource: string;
		reasonDe: string;
		allowStart: boolean;
		allowStop: boolean;
	},
	feedback: "on" | "off" | "unknown",
	demandStop: boolean,
): void {
	ensureStopIntentFields(up);
	logAcCoolingDiag(host.log, {
		tag,
		unitIndex,
		nowMs,
		slotStartIso: dailyPlan.slotStartIso,
		slotEndIso: dailyPlan.slotEndIso,
		allocatedPowerW: dailyPlan.allocatedPowerW,
		dailyPlanRevision: dailyPlan.dailyPlanRevision,
		dailyPlanStatus: dailyPlan.dailyPlanStatus,
		desired,
		lastDesired: up.lastDesired,
		commandGeneration: up.commandGeneration,
		stopArmedGeneration: up.stopArmedGeneration,
		feedback,
		decisionSource: permission.decisionSource,
		allowStart: permission.allowStart,
		allowStop: permission.allowStop,
		demandStop,
		plannerOff: plannerOffFromDailyPlan(dailyPlan),
		reasonDe: permission.reasonDe,
	});
}

async function startUnit(
	host: AcRuntimeHost,
	unit: AcUnitConfig,
	table: AcMappingTable,
	live: boolean,
	up: AcUnitPersist,
	modePurpose: AcUnitModePurpose,
): Promise<"feedback_on" | "feedback_off" | "dryrun"> {
	const profile = getAcProfile(unit.profileId);
	const steps = profile.coolingStartSequence(unit, modePurpose);
	await executeAcWriteSteps(host, unit.index, table, steps, live, host.log);
	up.lastStartAtMs = Date.now();
	up.lastModePurpose = modePurpose;
	clearStopIntentAfterStart(up);
	if (!live) {
		up.running = true;
		return "dryrun";
	}
	const fb = await waitForFeedbackOn(host, unit, table);
	if (fb.on) {
		up.running = true;
		host.log.info(
			`ac unit ${unit.index}: started — feedback on (${String(fb.value ?? "")}${fb.via === "mode" ? ", via climate.state" : ""})`,
		);
		return "feedback_on";
	}
	up.running = false;
	host.log.warn(
		`ac unit ${unit.index}: start sequence sent but feedback still off after ${Math.round((AC_FEEDBACK_POLL_MS * AC_FEEDBACK_POLL_ATTEMPTS) / 1000)}s (last=${String(fb.value ?? "")})`,
	);
	return "feedback_off";
}

async function finishCleaning(
	host: AcRuntimeHost,
	unit: AcUnitConfig,
	table: AcMappingTable,
	live: boolean,
	up: AcUnitPersist,
	reason: string,
	sendStop: boolean,
	allowWrite: boolean,
): Promise<void> {
	if (sendStop && live && allowWrite) {
		const profile = getAcProfile(unit.profileId);
		await executeAcWriteSteps(host, unit.index, table, profile.cleaningStopSequence(), true, host.log);
	}
	up.cleaningActive = false;
	up.cleaningStartedAtMs = null;
	up.cleaningSawOperatingActive = false;
	up.cleaningSawProgressActive = false;
	up.cleaningStartProgressPct = null;
	up.cleaningLastRefreshAtMs = null;
	host.log.info(`ac unit ${unit.index}: cleaning finished — ${reason}`);
}

async function tickCleaning(
	host: AcRuntimeHost,
	unit: AcUnitConfig,
	table: AcMappingTable,
	live: boolean,
	up: AcUnitPersist,
	nowMs: number,
	cleaningStateRaw: unknown,
	cleaningModeRaw: unknown,
	cleaningProgressPct: number | null,
	allowNewCleaning: boolean,
	unitFeedbackOn: boolean,
): Promise<void> {
	const pending = up.cleaningPendingUntilMs;
	if (pending && nowMs >= pending && !up.cleaningActive) {
		if (!allowNewCleaning) {
			up.cleaningPendingUntilMs = null;
			host.log.debug?.(`ac unit ${unit.index}: cleaning skipped — governance/add-on block`);
			return;
		}
		// Gerät muss aus sein — sonst startet Samsung oft keine echte Reinigung, EMS-Flag hängt.
		if (unitFeedbackOn) {
			host.log.info(`ac unit ${unit.index}: cleaning waiting — unit still on`);
			return;
		}
		up.cleaningPendingUntilMs = null;
		const profile = getAcProfile(unit.profileId);
		if (live) {
			await executeAcWriteSteps(host, unit.index, table, profile.cleaningStartSequence(), true, host.log);
			const refreshId = resolveAcMappingTarget(table, unit.index, "cmd_refresh");
			if (refreshId) {
				await executeAcWriteSteps(host, unit.index, table, [{ kind: "toggle", role: "cmd_refresh" }], true, host.log);
			}
			host.log.info(`ac unit ${unit.index}: cleaning started (live)`);
		} else {
			host.log.info(`ac unit ${unit.index}: cleaning started (dryrun)`);
		}
		up.cleaningActive = true;
		up.cleaningStartedAtMs = nowMs;
		up.cleaningSawOperatingActive = false;
		up.cleaningSawProgressActive = false;
		up.cleaningStartProgressPct = null;
		up.cleaningLastRefreshAtMs = nowMs;
	}

	if (!up.cleaningActive || !up.cleaningStartedAtMs) {
		return;
	}

	const cleaningWritesAllowed = live && (allowNewCleaning || up.cleaningActive);
	const stateFbId = resolveAcMappingTarget(table, unit.index, "feedback_cleaning_state");
	const modeFbId = resolveAcMappingTarget(table, unit.index, "feedback_cleaning_mode");
	const progressFbId = resolveAcMappingTarget(table, unit.index, "feedback_cleaning_progress");
	const hasCleaningFeedback = Boolean(stateFbId || modeFbId || progressFbId);
	const refreshId = resolveAcMappingTarget(table, unit.index, "cmd_refresh");
	const lastRefresh = up.cleaningLastRefreshAtMs ?? up.cleaningStartedAtMs;
	if (cleaningWritesAllowed && refreshId && nowMs - lastRefresh >= AC_CLEANING_REFRESH_MS) {
		await executeAcWriteSteps(host, unit.index, table, [{ kind: "toggle", role: "cmd_refresh" }], true, host.log);
		up.cleaningLastRefreshAtMs = nowMs;
	}

	const elapsedSec = Math.round((nowMs - up.cleaningStartedAtMs) / 1000);

	if (hasCleaningFeedback) {
		if (up.cleaningStartProgressPct == null && cleaningProgressPct != null) {
			up.cleaningStartProgressPct = cleaningProgressPct;
		}
		if (shouldMarkCleaningOperatingActive(cleaningStateRaw, elapsedSec)) {
			up.cleaningSawOperatingActive = true;
		}
		if (shouldMarkCleaningProgressActive(cleaningProgressPct)) {
			up.cleaningSawProgressActive = true;
		}

		if (
			isCleaningStuckNeverEngaged({
				operatingStateRaw: cleaningStateRaw,
				sawOperatingActive: up.cleaningSawOperatingActive,
				sawProgressActive: up.cleaningSawProgressActive,
				elapsedSec,
			})
		) {
			await finishCleaning(
				host,
				unit,
				table,
				live,
				up,
				`abort — never engaged (operatingState=${String(cleaningStateRaw ?? "?")}, unit=${unitFeedbackOn ? "on" : "off"}, ${elapsedSec}s)`,
				true,
				cleaningWritesAllowed,
			);
			return;
		}

		if (
			progressFbId &&
			isCleaningFinishedByProgress({
				progressPct: cleaningProgressPct,
				sawProgressActive: up.cleaningSawProgressActive,
				sawOperatingActive: up.cleaningSawOperatingActive,
				startProgressPct: up.cleaningStartProgressPct,
				elapsedSec,
			})
		) {
			await finishCleaning(
				host,
				unit,
				table,
				live,
				up,
				`feedback (progress=${cleaningProgressPct ?? "?"}%, ${elapsedSec}s)`,
				true,
				cleaningWritesAllowed,
			);
			return;
		}

		if (
			isCleaningFinishedByFeedback({
				operatingStateRaw: cleaningStateRaw,
				modeRaw: cleaningModeRaw,
				sawOperatingActive: up.cleaningSawOperatingActive,
				elapsedSec,
			})
		) {
			const op = String(cleaningStateRaw ?? "");
			const mode = String(cleaningModeRaw ?? "");
			await finishCleaning(
				host,
				unit,
				table,
				live,
				up,
				`feedback (operatingState=${op || "?"}, mode=${mode || "?"}, ${elapsedSec}s)`,
				true,
				cleaningWritesAllowed,
			);
			return;
		}
	} else if (
		isCleaningStuckNeverEngaged({
			operatingStateRaw: cleaningStateRaw,
			sawOperatingActive: false,
			sawProgressActive: false,
			elapsedSec,
		})
	) {
		// Kein Cleaning-Feedback gemappt — nach Stuck-Zeit Flag trotzdem freigeben.
		await finishCleaning(
			host,
			unit,
			table,
			live,
			up,
			`abort — no cleaning feedback mapped (${elapsedSec}s)`,
			false,
			cleaningWritesAllowed,
		);
		return;
	}

	const timeoutMs = unit.cleaningDurationMin * 60_000;
	if (unit.cleaningDurationMin > 0 && nowMs >= up.cleaningStartedAtMs + timeoutMs) {
		await finishCleaning(
			host,
			unit,
			table,
			live,
			up,
			`timeout (${unit.cleaningDurationMin} min)`,
			true,
			cleaningWritesAllowed,
		);
	}
}

export async function runAcRuntimeTick(host: AcRuntimeHost): Promise<void> {
	if (tickRunning) return;
	tickRunning = true;
	try {
		await runAcRuntimeTickBody(host);
	} finally {
		tickRunning = false;
	}
}

/**
 * Vorherige effektive Write-Authority (global∧addon live).
 * Edge false→true gibt Start-Retry frei, wenn Hardware noch aus ist.
 */
let prevAcLiveWriteAllowed = false;

async function runAcRuntimeTickBody(host: AcRuntimeHost): Promise<void> {
	touchEmsActivity();
	const now = new Date();
	const nowMs = now.getTime();
	const config = acGlobalConfigFromAdapter(host.config);
	const configRecord = host.config && typeof host.config === "object" ? (host.config as Record<string, unknown>) : {};
	const mappingTable = buildAcMappingTableFromConfig(configRecord);
	const addonOn = await host.getStateAsync(addonEnabled(AC_ADDON_ID));
	const addonEnabledVal = addonOn?.val !== false;
	const governanceEnabled = await isAddonGovernanceEnabledFromState(
		(id) => host.getStateAsync(id),
		"climate",
	);
	const live = await isLiveWriteAllowed((id) => host.getStateAsync(id), AC_ADDON_ID);
	const executionOff = isAddonExecutionOff((await host.getStateAsync(addonMode(AC_ADDON_ID)))?.val);
	/** Off: keine EMS-Start/Stop-Writes; Telemetrie bleibt. */
	const writeLive = live && !executionOff;
	const liveEdge = writeLive && !prevAcLiveWriteAllowed;
	prevAcLiveWriteAllowed = writeLive;
	const allowNewCleaning = governanceEnabled && addonEnabledVal && !executionOff;

	// Disabled units that still have objects (e.g. just turned off): close sticky stats / optional stop.
	// Unconfigured placeholders are not ensured and are removed by surface cleanup.
	for (const unit of config.units.filter((u) => !u.enabled)) {
		const ids = acUnitRuntimeStates(unit.index);
		const exists = await host.getStateAsync(ids.state);
		if (!exists) {
			continue;
		}
		const up = unitPersist(unit.index);
		const powered = await readUnitDevicePowered(host, unit, mappingTable);
		if (closeAcUnitStatsSession(up, nowMs)) {
			host.log.debug?.(`ac unit ${unit.index}: stats session closed (unit disabled in config)`);
		}
		if (powered.on && stopRetryReady(up, nowMs)) {
			await stopUnit(host, unit, mappingTable, live, up);
		}
		await tickConsumerStats(host, {
			consumerKey: acUnitConsumerKey(unit.index),
			nowMs,
			deviceActive: false,
			countable: false,
			measuredPowerW: null,
			commandedPowerW: 0,
		});
	}

	const activeUnits = config.units.filter((u) => u.enabled);
	let runningCount = 0;
	let anyDailyPlanActive = false;
	let maxDailyPlanRevision = 0;
	/** true → kein updateConfig (js-controller-Neustart) in diesem Tick. */
	let acDeviceBusy = false;
	const summaryReasons: string[] = [];
	let primaryDecisionDetail = "safe_default";
	let anyTelemetryReady = false;
	let anyFault = false;
	let anyLockout = false;

	for (const unit of activeUnits) {
		const tempId = resolveAcMappingTarget(mappingTable, unit.index, "room_temp");
		const humId = resolveAcMappingTarget(mappingTable, unit.index, "room_humidity");
		const cleaningStateId = resolveAcMappingTarget(mappingTable, unit.index, "feedback_cleaning_state");
		const cleaningModeId = resolveAcMappingTarget(mappingTable, unit.index, "feedback_cleaning_mode");
		const cleaningProgressId = resolveAcMappingTarget(mappingTable, unit.index, "feedback_cleaning_progress");
		const temp = await readForeign(host, tempId);
		const hum = await readForeign(host, humId);
		let powered = await readUnitDevicePowered(host, unit, mappingTable);
		let fb = { value: powered.value, num: null as number | null };
		let feedbackOn = powered.on;
		const cleaningState = await readForeign(host, cleaningStateId);
		const cleaningMode = await readForeign(host, cleaningModeId);
		const cleaningProgress = await readForeign(host, cleaningProgressId);
		const up = unitPersist(unit.index);
		if (feedbackOn) runningCount += 1;

		// Dryrun darf lastStartAtMs/running setzen ohne Hardware —
		// effective live false→true gibt Start sofort frei (kein 120s-Retry-Stau).
		if (liveEdge && !feedbackOn && (up.running || up.lastStartAtMs != null)) {
			up.lastStartAtMs = null;
			host.log.info?.(
				`ac unit ${unit.index}: effective live authority gained — allow immediate start (hardware still off)`,
			);
		}

		await tickCleaning(
			host,
			unit,
			mappingTable,
			live,
			up,
			nowMs,
			cleaningState.value,
			cleaningMode.value,
			cleaningProgress.num,
			allowNewCleaning,
			feedbackOn,
		);

		// Cleaning-Flag sperrt FSM-Stop — Gerät trotzdem ausschalten, sonst Deadlock.
		if (
			up.cleaningActive &&
			feedbackOn &&
			stopRetryReady(up, nowMs) &&
			writeLive &&
			governanceEnabled &&
			addonEnabledVal
		) {
			host.log.info(`ac unit ${unit.index}: stop while cleaning flag set (device still on)`);
			await stopUnit(host, unit, mappingTable, true, up);
		}

		if (!addonEnabledVal && feedbackOn && stopRetryReady(up, nowMs)) {
			await stopUnit(host, unit, mappingTable, writeLive, up);
		}

		const fsm = evaluateAcUnitFsm({
			now,
			addonEnabled: addonEnabledVal && governanceEnabled && !executionOff,
			unit,
			roomTempC: temp.num,
			roomHumidityPct: hum.num,
			feedbackSwitchRaw: fb.value,
			cleaningActive: up.cleaningActive,
		});

		const consumerStats = await peekConsumerStatsEntry(host, acUnitConsumerKey(unit.index));
		let dailyPlan: AcUnitDailyPlanResolution = await resolveAcUnitDailyPlanAllocation(
			host,
			unit,
			consumerStats,
			now,
		);
		if (dailyPlan.useDailyPlan) {
			anyDailyPlanActive = true;
			if (dailyPlan.dailyPlanRevision !== null) {
				maxDailyPlanRevision = Math.max(maxDailyPlanRevision, dailyPlan.dailyPlanRevision);
			}
		}

		const startRetryReady = !up.lastStartAtMs || nowMs - up.lastStartAtMs >= AC_START_RETRY_MS;
		let control = computeAcCoolingDesired({
			unitEnabled: unit.enabled,
			governanceEnabled,
			addonEnabled: addonEnabledVal,
			cleaningActive: up.cleaningActive,
			fsm,
			dailyPlan,
			feedbackOn,
			startRetryReady,
		});
		let permission = controlToPermission(control);
		let desired = control.desired;
		const desiredAdv = advanceCoolingDesired(up, desired);
		if (desiredAdv.stopCleared) {
			host.log.info(
				`ac unit ${unit.index}: stop retry cancelled — current planner intent is ON`,
			);
		}

		/** Nach await start/stop: keine weitere Aktion mit Pre-await-Inputs. */
		let hardwareActionTaken = false;

		const stopDecision = decideStopWrite({
			up,
			desired,
			feedbackOn,
			stopRetryReady: stopRetryReady(up, nowMs),
			lastStopAtMs: up.lastStopAtMs,
			nowMs,
		});
		if (stopDecision.action === "cancel_stale") {
			host.log.info(`ac unit ${unit.index}: ${stopDecision.reasonDe}`);
		} else if (stopDecision.action === "execute_stop") {
			if (stopDecision.isRetry && up.lastStopAtMs) {
				host.log.info(
					`ac unit ${unit.index}: retry stop (${Math.round((nowMs - up.lastStopAtMs) / 1000)}s since last attempt) — ${stopDecision.reasonDe}`,
				);
			}
			emitAcCoolingDiag(
				host,
				"stop",
				unit.index,
				Date.now(),
				up,
				dailyPlan,
				desired,
				permission,
				feedbackOn ? "on" : "off",
				fsm.demandStop,
			);
			emitAcCoolingDiag(
				host,
				"switch_off",
				unit.index,
				Date.now(),
				up,
				dailyPlan,
				desired,
				permission,
				feedbackOn ? "on" : "off",
				fsm.demandStop,
			);
			await stopUnit(host, unit, mappingTable, writeLive && permission.deviceWritesAllowed, up);
			hardwareActionTaken = true;
			powered = await readUnitDevicePowered(host, unit, mappingTable);
			fb = { value: powered.value, num: null };
			feedbackOn = powered.on;
			up.running = feedbackOn;
		} else if (!feedbackOn && permission.allowStop) {
			up.running = false;
		} else if (permission.allowStart && !feedbackOn) {
			if (writeLive) {
				if (startRetryReady) {
					if (up.lastStartAtMs) {
						host.log.info(
							`ac unit ${unit.index}: retry start (${Math.round((nowMs - up.lastStartAtMs) / 1000)}s since last attempt)`,
						);
					}
					emitAcCoolingDiag(
						host,
						"start",
						unit.index,
						Date.now(),
						up,
						dailyPlan,
						desired,
						permission,
						"off",
						fsm.demandStop,
					);
					const startOutcome = await startUnit(
						host,
						unit,
						mappingTable,
						writeLive && permission.deviceWritesAllowed,
						up,
						fsm.modePurpose,
					);
					hardwareActionTaken = true;
					/*
					 * Frische States nach await — Pre-START-Snapshot verwerfen (I3).
					 * Kein running=false aus altem fb=OFF.
					 */
					powered = await readUnitDevicePowered(host, unit, mappingTable);
					fb = { value: powered.value, num: null };
					feedbackOn = powered.on;
					up.running = feedbackOn || startOutcome === "feedback_on" || startOutcome === "dryrun";

					const planAfter = await resolveAcUnitDailyPlanAllocation(
						host,
						unit,
						consumerStats,
						new Date(),
					);
					const fsmAfter = evaluateAcUnitFsm({
						now: new Date(),
						addonEnabled: addonEnabledVal && governanceEnabled && !executionOff,
						unit,
						roomTempC: temp.num,
						roomHumidityPct: hum.num,
						feedbackSwitchRaw: fb.value,
						cleaningActive: up.cleaningActive,
					});
					control = computeAcCoolingDesired({
						unitEnabled: unit.enabled,
						governanceEnabled,
						addonEnabled: addonEnabledVal,
						cleaningActive: up.cleaningActive,
						fsm: fsmAfter,
						dailyPlan: planAfter,
						feedbackOn,
						startRetryReady: false,
					});
					permission = controlToPermission(control);
					desired = control.desired;
					advanceCoolingDesired(up, desired);
					if (startOutcome === "feedback_on") {
						emitAcCoolingDiag(
							host,
							"feedback_on",
							unit.index,
							Date.now(),
							up,
							planAfter,
							desired,
							permission,
							"on",
							fsmAfter.demandStop,
						);
					}
					/*
					 * Echter Replan-OFF während START: nächsten Reconcile entscheiden lassen
					 * (eine Aktion pro Reconcile — kein Stop im selben Tick nach Start).
					 */
					dailyPlan = planAfter;
				}
			} else if (!executionOff && !up.running) {
				await startUnit(host, unit, mappingTable, false, up, fsm.modePurpose);
				hardwareActionTaken = true;
				up.running = true;
				feedbackOn = true;
			}
		} else if (
			feedbackOn &&
			!fsm.demandStop &&
			!up.cleaningActive &&
			permission.deviceWritesAllowed &&
			!executionOff &&
			!hardwareActionTaken
		) {
			await applyModePurposeWhileRunning(
				host,
				unit,
				mappingTable,
				writeLive,
				up,
				fsm.modePurpose,
			);
		}

		if (hardwareActionTaken) {
			scheduleImmediateReconcile();
		}

		summaryReasons.push(`U${unit.index}: ${permission.reasonDe}`);
		if (primaryDecisionDetail === "safe_default") {
			primaryDecisionDetail = permission.decisionSource;
		}
		if (temp.num != null) {
			anyTelemetryReady = true;
		}
		if (permission.decisionSource === "fault") {
			anyFault = true;
		}
		if (permission.decisionSource === "lockout") {
			anyLockout = true;
		}

		/*
		 * running nur aus aktuellem (ggf. nach await frisch gelesenem) Feedback.
		 * Nie Pre-await-Snapshot nach START/STOP persistieren.
		 */
		if (feedbackOn) {
			up.running = true;
		} else if (live && !hardwareActionTaken) {
			up.running = false;
		} else if (live && hardwareActionTaken) {
			up.running = feedbackOn;
		}

		const ids = acUnitRuntimeStates(unit.index);
		const fbOn = feedbackOn;
		const deviceActive = acStatsDeviceActive(up, fbOn, up.running, nowMs);
		// Live + feedback off: do not keep a forever-open stats session after the start grace.
		if (!fbOn && !deviceActive && up.lastStartAtMs && (up.lastStopAtMs == null || up.lastStopAtMs < up.lastStartAtMs)) {
			closeAcUnitStatsSession(up, nowMs);
		}
		const estPower = deviceActive
			? allocatedPowerW(
					runningCount || 1,
					config.outdoorMaxPowerW,
					acEstimatedPowerForPurpose(unit, fsm.modePurpose),
				)
			: 0;
		await setStateIfChanged(host, ids.name, unit.name);
		await setStateIfChanged(host, ids.state, fsm.state);
		await setStateIfChanged(host, ids.reasonDe, permission.reasonDe);
		await setStateIfChanged(host, ids.roomTempC, temp.num ?? null);
		await setStateIfChanged(host, ids.roomHumidityPct, hum.num ?? null);
		await setStateIfChanged(host, ids.feedbackSwitch, fb.value == null ? "" : String(fb.value));
		await setStateIfChanged(host, ids.running, fbOn);
		await setStateIfChanged(host, ids.cleaningActive, up.cleaningActive);
		await setStateIfChanged(host, ids.feedbackCleaningState, cleaningState.value == null ? "" : String(cleaningState.value));
		await setStateIfChanged(host, ids.feedbackCleaningMode, cleaningMode.value == null ? "" : String(cleaningMode.value));
		await setStateIfChanged(host, ids.feedbackCleaningProgressPct, cleaningProgress.num ?? null);
		await setStateIfChanged(host, ids.modePurpose, fsm.modePurpose);
		await setStateIfChanged(host, ids.estimatedPowerW, estPower);
		const measuredPowerW = await resolveAcMeasuredPowerForStats(host, unit, mappingTable, deviceActive);
		const powerDisp = resolveAcPowerDisplay({
			measuredPowerW,
			estimatedPowerW: estPower > 0 ? estPower : unit.estimatedPowerW,
			running: fbOn || deviceActive,
		});
		await setStateIfChanged(host, ids.measuredPowerW, powerDisp.measuredPowerW);
		await setStateIfChanged(host, ids.powerDisplayKind, powerDisp.kind);

		const setpointRead = await readForeign(
			host,
			resolveAcMappingTarget(mappingTable, unit.index, "feedback_setpoint"),
		);
		await setStateIfChanged(host, ids.setpointTempC, setpointRead.num ?? null);

		const filterStatusRaw = await readForeign(
			host,
			resolveAcMappingTarget(mappingTable, unit.index, "filter_status"),
		);
		const filterPctRead = await readForeign(
			host,
			resolveAcMappingTarget(mappingTable, unit.index, "filter_usage_pct"),
		);
		const filterHoursRead = await readForeign(
			host,
			resolveAcMappingTarget(mappingTable, unit.index, "filter_usage_hours"),
		);
		const filterVis = resolveAcFilterVis({
			statusRaw: filterStatusRaw.value,
			usagePct: filterPctRead.num,
			usageHours: filterHoursRead.num,
		});
		await setStateIfChanged(host, ids.filterStatus, filterVis.status);
		await setStateIfChanged(host, ids.filterStatusLabelDe, filterVis.labelDe);
		await setStateIfChanged(host, ids.filterUsagePct, filterVis.usagePct);
		await setStateIfChanged(host, ids.filterUsageHours, filterVis.usageHours);

		await setStateIfChanged(host, ids.decisionSource, permission.decisionSource);
		await setStateIfChanged(host, ids.dailyPlanStatus, dailyPlan.dailyPlanStatus);
		await setStateIfChanged(host, ids.dailyPlanRevision, dailyPlan.dailyPlanRevision ?? 0);
		await setStateIfChanged(host, ids.dailyPlanSlotStart, dailyPlan.slotStartIso ?? "");
		await setStateIfChanged(host, ids.dailyPlanSlotEnd, dailyPlan.slotEndIso ?? "");
		await setStateIfChanged(host, ids.allocatedPowerW, dailyPlan.allocatedPowerW ?? null);
		await setStateIfChanged(host, ids.expectedPowerW, dailyPlan.expectedPowerW ?? null);
		await setStateIfChanged(host, ids.powerModelSource, dailyPlan.powerModelSource);
		await setStateIfChanged(host, ids.allocationStatus, dailyPlan.allocationStatus);
		await setStateIfChanged(host, ids.allocationReasonDe, dailyPlan.allocationReasonDe);
		await setStateIfChanged(host, ids.governanceAllowed, governanceEnabled);

		await tickConsumerStats(host, {
			consumerKey: acUnitConsumerKey(unit.index),
			nowMs,
			deviceActive,
			countable: deviceActive,
			measuredPowerW,
			commandedPowerW: estPower,
		});

		if (deviceActive || up.cleaningActive || up.running || feedbackOn) {
			acDeviceBusy = true;
		}

		/*
		 * Learning → Config nur vormerken. updateConfig löst Instanz-Neustart aus —
		 * Flush erst am Tick-Ende im Idle (siehe flushQueuedAcPowerConfigReconcile).
		 */
		const statsEntry = await peekConsumerStatsEntry(host, acUnitConsumerKey(unit.index));
		queueAcPowerConfigReconcile({
			unitIndex: unit.index,
			configPowerW: unit.estimatedPowerW,
			consumerStats: statsEntry,
			nowMs,
		});
	}

	/*
	 * updateConfig → js-controller Instanz-Neustart.
	 * Flush-Gate: Global != live, kein Restore; devicesBusy kann zusätzlich blocken.
	 */
	await flushQueuedAcPowerConfigReconcile({
		host,
		nowMs,
		devicesBusy: acDeviceBusy,
	});

	await setStateIfChanged(host, `${AC_RUNTIME_BASE}.outdoor_allocated_power_w`, config.outdoorMaxPowerW);
	await setStateIfChanged(host, AC_RUNTIME_SUMMARY_STATES.governanceAllowed, governanceEnabled);
	await setStateIfChanged(host, AC_RUNTIME_SUMMARY_STATES.dailyPlanActive, anyDailyPlanActive);
	await setStateIfChanged(host, AC_RUNTIME_SUMMARY_STATES.dailyPlanRevision, maxDailyPlanRevision);
	const summaryReason = !governanceEnabled
		? "Klima-Governance deaktiviert — keine EMS-Steueraktion."
		: summaryReasons.slice(0, 3).join(" | ") || "Klima Runtime aktiv.";
	await setStateIfChanged(host, AC_RUNTIME_SUMMARY_STATES.reasonDe, summaryReason);

	const decisionDetail = !governanceEnabled
		? "governance_disabled"
		: !addonEnabledVal
			? "unit_disabled"
			: primaryDecisionDetail;
	let intentStatus: IntentStatus = "idle";
	if (!governanceEnabled || !addonEnabledVal) {
		intentStatus = "none";
	} else if (anyFault || anyLockout) {
		intentStatus = "blocked";
	} else if (runningCount > 0 || anyDailyPlanActive) {
		intentStatus = "active";
	}
	let executionStatus: ExecutionStatus = live ? "live" : "dryrun";
	if (anyFault) {
		executionStatus = "fault";
	} else if (anyLockout) {
		executionStatus = "lockout";
	}
	await publishAddonRuntimeSurface(host, AC_ADDON_ID, {
		decisionDetail,
		decisionReason: summaryReason,
		nowIso: new Date(nowMs).toISOString(),
		plannerStatus: plannerStatusFromDailyPlan({
			governanceEnabled: governanceEnabled && addonEnabledVal,
			useDailyPlan: anyDailyPlanActive,
			dailyPlanValid: anyDailyPlanActive,
			dailyPlanStatus: anyDailyPlanActive ? "valid" : "missing",
		}),
		intentStatus,
		executionStatus,
		profileReady: configuredAcUnitIndexes(host.config).length > 0,
		telemetryReady: anyTelemetryReady || activeUnits.length === 0,
		fault: anyFault,
		lockout: anyLockout,
	});

	const dataDir = host.getAbsolutePath?.("air_conditioning");
	if (dataDir) {
		await writeAcRuntimePersist(dataDir, persist);
	}
	scheduleTick();
}

let acPersistHydrated = false;

/** Phase D — Klima-Runtime-Persistenz von Disk laden (ohne Subscriptions/Ticks). */
export async function hydrateAcRuntimePersist(host: AcRuntimeHost): Promise<void> {
	if (acPersistHydrated) {
		return;
	}
	const dataDir = host.getAbsolutePath?.("air_conditioning");
	if (dataDir) {
		persist = await readAcRuntimePersist(dataDir);
	}
	acPersistHydrated = true;
}

export async function initAcRuntimeEngine(host: AcRuntimeHost): Promise<void> {
	if (engineActive && hostRef === host) return;
	engineActive = true;
	hostRef = host;

	const configRecord =
		host.config && typeof host.config === "object" ? (host.config as Record<string, unknown>) : {};
	const prefill = buildLocalthingsPrefillPatch(configRecord);
	if (prefill) {
		const merged = { ...configRecord, ...prefill };
		const nTargets = Object.keys(prefill).filter((k) => k.endsWith("_target")).length;
		host.config = merged;
		host.log.info(
			`air_conditioning: LocalThings Prefill (Speicher) — ${nTargets} Mapping-Felder; Persist nach Bootstrap`,
		);
		scheduleLocalthingsPrefillPersist(host, merged);
	}

	await ensureAcRuntimeStates(host);
	for (const i of configuredAcUnitIndexes(host.config)) {
		await initConsumerStatsForKey(host, acUnitConsumerKey(i));
	}
	await hydrateAcRuntimePersist(host);
	const cfg = acGlobalConfigFromAdapter(host.config);
	const configRecordAfter =
		host.config && typeof host.config === "object" ? (host.config as Record<string, unknown>) : {};
	const mappingTable = buildAcMappingTableFromConfig(configRecordAfter);
	const subs = new Set<string>([
		addonEnabled(AC_ADDON_ID),
		addonAvailable(AC_ADDON_ID),
		addonGovernanceEnabledState("climate"),
		DAILY_PLAN_STATE_IDS.revision,
		DAILY_PLAN_STATE_IDS.status,
		ALLOCATION_ADDON_STATE_IDS.air_conditioning.planJson,
	]);
	if (host.subscribeStatesAsync) {
		for (const id of subs) {
			if (subscribedIds.includes(id)) continue;
			await host.subscribeStatesAsync(id);
			subscribedIds.push(id);
		}
	}
	for (const unit of cfg.units.filter((u) => u.enabled)) {
		for (const role of AC_WATCH_MAPPING_ROLES) {
			const id = resolveAcMappingTarget(mappingTable, unit.index, role);
			if (id) subs.add(id);
		}
	}
	if (host.subscribeForeignStatesAsync) {
		for (const id of subs) {
			if (id.startsWith("addons.")) continue;
			if (subscribedIds.includes(id)) continue;
			await host.subscribeForeignStatesAsync(id);
			subscribedIds.push(id);
		}
	}
	await runAcRuntimeTick(host);
	host.log.info("air_conditioning: runtime engine initialized");
}

export function stopAcRuntimeEngine(): void {
	clearLocalthingsPrefillPersistTimer();
	const host = hostRef;
	clearTick();
	if (host) {
		void flushConsumerStatsPersist(host).catch((e) => host.log.debug?.(`ac stats flush: ${e}`));
	}
	resetConsumerStatsCache();
	if (host?.unsubscribeForeignStatesAsync) {
		for (const id of subscribedIds) {
			if (!id.startsWith("addons.")) {
				void host.unsubscribeForeignStatesAsync(id).catch(() => undefined);
			}
		}
	}
	engineActive = false;
	hostRef = null;
	persist = { version: 1, units: {} };
	acPersistHydrated = false;
	prevAcLiveWriteAllowed = false;
	subscribedIds.length = 0;
	resetAcDailyPlanCache();
}

export function acRuntimeWatchedForeignIds(config: unknown): string[] {
	const configRecord = config && typeof config === "object" ? (config as Record<string, unknown>) : {};
	const mappingTable = buildAcMappingTableFromConfig(configRecord);
	const cfg = acGlobalConfigFromAdapter(config);
	const ids: string[] = [];
	for (const unit of cfg.units.filter((u) => u.enabled)) {
		for (const role of AC_WATCH_MAPPING_ROLES) {
			const id = resolveAcMappingTarget(mappingTable, unit.index, role);
			if (id) ids.push(id);
		}
	}
	return ids;
}
