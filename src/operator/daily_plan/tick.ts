import { globalPolicyConfigFromAdapter } from "../../policy/global/config";
import type { PolicySnapshot } from "../../policy/core/types";
import { intentAdminConfigFromAdapter } from "../../intent/config";
import { plannerModePolicyFromGlobalMode } from "../../planner/mode_policy";
import { setOptionalNumberIfChanged, setStateIfChanged } from "../../policy/core/state_write";
import type { ForecastPlan } from "../forecast/types";
import { buildDailyPlanFromForecast, dailyPlanRevisionPayload } from "./build";
import { buildOperatorBriefingDe } from "./briefing";
import { buildOperatorLiveSurplus } from "./live_surplus";
import { addonAllocationPublishView } from "./addon_plan_publish";
import { ALLOCATION_ADDON_STATE_IDS, DAILY_PLAN_STATE_IDS } from "./states";
import type { DailyPlan } from "./types";
import type { ContributionsReadHost } from "../contributions/read";
import {
	batteryConsumersConfigFromAdapter,
	batteryConsumerConstraintStateWrites,
	immersionCriticalNow,
	resolveAllBatteryConsumerAccess,
} from "../../policy/battery_consumers";
import {
	resolveBatteryDischargeAuthorization,
	DEFAULT_OPPORTUNITY_MARGIN_CT_PER_KWH,
} from "./battery_discharge_authority";
import { evaluateBatteryOpportunityCost } from "./battery_opportunity_cost";
import { listActiveOverrides } from "../../ai/override_ledger";
import {
	mergeOpportunityMarginWithOverride,
	AI_OVERRIDE_PARAM_BATTERY_OPPORTUNITY_MARGIN_CT,
} from "../../ai/override/allowlist";
import { resolveActiveOverrideValue } from "../../ai/override/validate";
import {
	calibrateBatteryOpportunityMargin,
	toBatteryReserveLearningExplanation,
} from "./battery_reserve_learning";
import { resolveCentralBatteryReserveTarget } from "./battery_reserve_target";
import { buildReserveFloorSlotsFromForecastPlan } from "./forecast_reserve_slots";
import {
	immersionDeviceConfigFromAdapter,
} from "../../addons/immersion_heater/device_config";
import { IMMERSION_RUNTIME_STATES } from "../../addons/immersion_heater/runtime/types";
import { asNum } from "../../ems_light/state_util";
import { AI_STATES } from "../../ai/ensure_states";
import { buildPlannerConstraints } from "../planning/battery";
import { WALLBOX_EVCC_STATES } from "../../addons/wallbox/ensure_evcc_states";
import { WALLBOX_RUNTIME_STATES } from "../../addons/wallbox/runtime/states";
import {
	wallboxHoldSignalConfigFromAdapter,
} from "../../addons/wallbox/evcc_config";
import { resolveWallboxBatteryHold } from "../../addons/wallbox/charge_hold";
import { normalizeOptionalBool } from "../../addons/wallbox/normalize";
import { CONTRIBUTION_IDS } from "../contribution_ids";
import { BAT } from "../../addons/battery/ensure_states";
import { acUnitRuntimeStates } from "../../addons/air_conditioning/runtime/ensure_states";
import { AC_UNIT_COUNT } from "../../addons/air_conditioning/constants";
import { allocateUnifiedDayPlan } from "./unified/allocate";
import { applyUnifiedDayAuthority } from "./unified/authority";
import { buildUnifiedDispatchPublish } from "./unified/dispatch_bridge";
import { publishEvPlannerDiagnosis } from "./unified/ev_planner_publish";
import {
	buildUnifiedInputFromForecastContext,
	normalizeFeedInCtPerKwh,
	summarizeUnifiedDayPlanForReason,
} from "./unified/from_forecast_context";
import { unifiedPlanCadenceDigest } from "./unified/cadence";
import {
	evaluateMaterialReplan,
	type PlanBaseline,
	type PlanActualSample,
} from "./unified/materiality";
import { REASON } from "./unified/reason_codes";
import {
	assessUnifiedReplanFailure,
	applyReplanFailureAuthority,
} from "./unified/replan_failure";
import type { UnifiedDayPlan } from "./unified/types";
import {
	medianGridPriceCtPerKwh,
	priceStructureDigestFromPlan,
} from "../../ai/trigger_digest";
import { resetImmersionDailyPlanCache } from "../../addons/immersion_heater/runtime/daily_plan";
import { resetAcDailyPlanCache } from "../../addons/air_conditioning/runtime/daily_plan";
import { resetBatteryDailyPlanCache } from "../../addons/battery/runtime/daily_plan";
import { resetWallboxDailyPlanCache } from "../../addons/wallbox/runtime/daily_plan";
import { hardwareLimitsFromConfig } from "../../addons/battery/core/limits";
import {
	loadOrEmptyVehiclePresenceStore,
	observeConnected,
	writeVehiclePresencePersist,
} from "../../learning/vehicle_presence";
import { presenceDigest } from "./unified/vehicle_availability";
import { wallboxVehicleMapFromAdapter } from "../../addons/wallbox/vehicle_map/config";
import { lookupVehicleMapEntry } from "../../addons/wallbox/vehicle_map/lookup";
import {
	closeSessionIfNeeded,
	getDayPlanSession,
	noteUnifiedPlanPublished,
	resetDayPlanSessionForTest,
} from "../../learning/day_evaluation/session";
import type { DayEvalActuals } from "../../learning/day_evaluation/build";
import { buildDeterministicDayExplanation } from "../../learning/day_evaluation/explain";
import { buildNotificationCandidates, mergeNotificationCandidates } from "../../learning/day_evaluation/notify";
import { buildAiExplanationContext } from "../../ai/explanation/context";
import { buildProductSummaryDe } from "../../beta/product_summary";
import { buildProductNotificationSurface } from "../../beta/notification_surface";
import { buildEffectiveExecutionSnapshot } from "../../beta/execution_effective";
import { addonOffSummaryDe, buildAgendaExecutionHints } from "../../beta/execution_display";
import { buildAddonStrategicPlanSnapshot } from "../../beta/strategic_status";
import { recomputeDailyPlanSlotRemainings } from "./recompute_remainings";
import { GLOBAL, addonMode } from "../../tree_paths";
import { atomicWriteFile } from "../../persistence/atomic_write";
import * as path from "node:path";
import type { ExecutionModeAddonId } from "../../execution_mode";
import { stripAddonFromDailyPlan, stripAddonFromUnifiedPlan } from "./invalidate_addon_off";
import { batteryConfigFromAdapter } from "../../addons/battery/config";
import { resolvePassiveBatteryEnergyAvailable } from "./unified/passive_battery_energy";
import { loadBlockALearningSnapshot } from "./block_a_learning_bridge";

let lastRevisionPayload = "";
let revision = 0;
/** Material-Cadence: ohne relevanten Grund kein neuer Unified-/Tagesplan-Publish. */
let lastCadenceDigest = "";
let unifiedGeneration = 0;
let lastUnifiedPlanId = "";
let lastUnifiedPlan: UnifiedDayPlan | null = null;
let lastBaseline: PlanBaseline | null = null;
let lastReplanAtMs: number | null = null;
let replanCountToday = 0;
let replanCountDate = "";
/** Befund 005: Mode-Wechsel erzwingt frischen Replan (keine stale Allocation). */
let forcedReplanReasons: string[] = [];
/** One-Plan: Live-Surplus nur als Allocator-Hinweis (NOW-Slot), kein Runtime-Seitenkanal. */
function preferImmersionLiveSurplusNowFrom(input: {
	livePvPowerW: number | null;
	liveHouseLoadW: number | null;
	/** Laufende IH-Leistung (gemessen/befohlen) — sonst wirkt Surplus künstlich zu klein. */
	immersionOnPowerW?: number | null;
	thermalHeadroomKwh: number | null;
	minPowerW: number | null;
	socPct: number | null;
}): boolean {
	const minW = input.minPowerW != null && input.minPowerW > 0 ? input.minPowerW : 1700;
	const ih = Math.max(0, input.immersionOnPowerW ?? 0);
	const surplus = (input.livePvPowerW ?? 0) - (input.liveHouseLoadW ?? 0) + ih;
	const head = input.thermalHeadroomKwh ?? 0;
	const soc = input.socPct ?? 0;
	return head > 0.25 && surplus + 1 >= minW * 0.95 && soc >= 90;
}

function immersionSoftActiveInCurrentSlot(
	plan: UnifiedDayPlan | null,
	nowMs: number,
): boolean {
	if (!plan) return false;
	for (const a of plan.allocations) {
		if (a.kind !== "immersion_heater") continue;
		if (!(a.allocatedPowerW >= 50)) continue;
		const s = Date.parse(a.slot.startIso);
		const e = Date.parse(a.slot.endIso);
		if (!Number.isFinite(s) || !Number.isFinite(e)) continue;
		if (s < nowMs && e > nowMs) return true;
	}
	return false;
}

/**
 * Nach OFF↔DRYRUN/LIVE: Baseline/Cache verwerfen und nächsten Tick material replanen.
 */
export function requestForcedUnifiedReplan(reason: string): void {
	const r = reason.trim() || "replan_forced";
	forcedReplanReasons.push(r);
	lastBaseline = null;
	lastUnifiedPlan = null;
	lastCadenceDigest = "";
	lastRevisionPayload = "";
}

export type PlanInvalidateHost = {
	getStateAsync: (id: string) => Promise<ioBroker.State | null | undefined>;
	setStateAsync: (id: string, state: ioBroker.SettableState) => Promise<unknown>;
	config?: unknown;
	log?: { warn?: (msg: string) => void; info?: (msg: string) => void; debug?: (msg: string) => void };
};

/**
 * Sofortige Invalidierung der aktiven Plan-Darstellung für ein Add-on auf OFF.
 * Historische Compare-Dateien bleiben; publizierte Allocation/Agenda werden geleert.
 */
async function setPlanState(host: PlanInvalidateHost, id: string, val: ioBroker.StateValue): Promise<void> {
	const cur = await host.getStateAsync(id);
	if (cur?.val === val) return;
	await host.setStateAsync(id, { val, ack: true });
}

export async function invalidatePublishedPlanForAddonOff(
	host: PlanInvalidateHost,
	addonId: ExecutionModeAddonId,
): Promise<void> {
	const offReason = addonOffSummaryDe(addonId);

	if (lastUnifiedPlan) {
		lastUnifiedPlan = stripAddonFromUnifiedPlan(lastUnifiedPlan, addonId);
	}

	try {
		const planRaw = await host.getStateAsync(DAILY_PLAN_STATE_IDS.planJson);
		const planStr = typeof planRaw?.val === "string" ? planRaw.val : "";
		if (planStr.trim() && planStr.trim() !== "{}") {
			const parsed = JSON.parse(planStr) as DailyPlan;
			if (parsed && Array.isArray(parsed.allocations)) {
				const stripped = stripAddonFromDailyPlan(parsed, addonId);
				await setPlanState(host, DAILY_PLAN_STATE_IDS.planJson, JSON.stringify(stripped));
			}
		}
	} catch (e) {
		host.log?.warn?.(`invalidate addon off (daily plan_json): ${String(e)}`);
	}

	const allocIds = ALLOCATION_ADDON_STATE_IDS[addonId];
	if (allocIds) {
		await setPlanState(host, allocIds.planJson, "[]");
		await setPlanState(host, allocIds.status, "idle");
		await setPlanState(host, allocIds.reasonDe, offReason);
	}

	// Runtime-Allocation-Anzeige sofort neutralisieren (Steuerung ohnehin OFF-gegated).
	try {
		if (addonId === "immersion_heater") {
			await setPlanState(host, IMMERSION_RUNTIME_STATES.allocatedPowerW, null);
		} else if (addonId === "battery") {
			await setPlanState(host, BAT.runtime.allocatedChargePowerW, null);
		} else if (addonId === "wallbox") {
			await setPlanState(host, WALLBOX_RUNTIME_STATES.allocatedPowerW, null);
		} else if (addonId === "air_conditioning") {
			for (let u = 1; u <= AC_UNIT_COUNT; u++) {
				await setPlanState(host, acUnitRuntimeStates(u).allocatedPowerW, null);
			}
		}
	} catch (e) {
		host.log?.warn?.(`invalidate addon off (runtime alloc): ${String(e)}`);
	}

	try {
		const globalMode = (await host.getStateAsync(GLOBAL.executionMode))?.val;
		const modes = {
			wallbox: (await host.getStateAsync(addonMode("wallbox")))?.val,
			battery: (await host.getStateAsync(addonMode("battery")))?.val,
			immersion_heater: (await host.getStateAsync(addonMode("immersion_heater")))?.val,
			air_conditioning: (await host.getStateAsync(addonMode("air_conditioning")))?.val,
		};
		modes[addonId] = "off";
		const agendaExecution = buildAgendaExecutionHints({
			globalMode,
			addonModes: modes,
			hardware: {},
			nowMs: Date.now(),
		});
		if (lastUnifiedPlan) {
			const productSummary = buildProductSummaryDe(lastUnifiedPlan, {
				batteryStartSocPct: null,
				execution: agendaExecution,
			});
			await setPlanState(host, "operator.product_summary_de", productSummary);
		} else {
			await setPlanState(host, "operator.product_summary_de", `Plan: ${offReason}.`);
		}
		host.log?.info?.(`Add-on ${addonId} Aus — aktive Plan-Darstellung sofort invalidiert`);
	} catch (e) {
		host.log?.warn?.(`invalidate addon off (product summary): ${String(e)}`);
	}
}

export function resetDailyPlanRevisionForTest(): void {
	lastRevisionPayload = "";
	revision = 0;
	lastCadenceDigest = "";
	unifiedGeneration = 0;
	lastUnifiedPlanId = "";
	lastUnifiedPlan = null;
	lastBaseline = null;
	lastReplanAtMs = null;
	replanCountToday = 0;
	replanCountDate = "";
	forcedReplanReasons = [];
	resetDayPlanSessionForTest();
	lastNotifyCandidates = [];
}

/** Test-Hook: Startup-One-Shot noch verfügbar? */
export function startupLiveSurplusPreferAvailableForTest(): boolean {
	return false;
}

/**
 * Test-Hook: spiegelt Tick-Verbrauch — Flag nur bei erfolgreichem Startup-Bypass.
 * Production: identisch zu `if (surplusReplan.startupStabilityBypassApplied)`.
 */
export function noteStartupLiveSurplusPreferResultForTest(startupStabilityBypassApplied: boolean): void {
	void startupStabilityBypassApplied;
}

/** Deduplizierte Notification-Candidates des laufenden Tages (kein Push). */
let lastNotifyCandidates: ReturnType<typeof buildNotificationCandidates> = [];

export function dailyPlanRevisionForTest(): number {
	return revision;
}

/** Test-Hook: wie oft Unified allocate+publish seit Reset gelaufen ist. */
export function unifiedPlanGenerationForTest(): number {
	return unifiedGeneration;
}

export function lastUnifiedPlanIdForTest(): string {
	return lastUnifiedPlanId;
}

async function readStr(host: ContributionsReadHost, relId: string): Promise<string | null> {
	try {
		const st = await host.getStateAsync(relId);
		if (st?.val == null || st.val === "") return null;
		return String(st.val);
	} catch {
		return null;
	}
}

async function readEffectivePolicy(host: ContributionsReadHost): Promise<PolicySnapshot | null> {
	const raw = await readStr(host, "policy.global.effective_json");
	if (!raw) return null;
	try {
		return JSON.parse(raw) as PolicySnapshot;
	} catch {
		return null;
	}
}

function policyBool(snapshot: PolicySnapshot | null, key: string): boolean | null {
	const entry = snapshot?.economics?.[key];
	if (!entry || entry.value === null || typeof entry.value !== "boolean") return null;
	return entry.value;
}

function policyNumber(snapshot: PolicySnapshot | null, key: string): number | null {
	const entry = snapshot?.limits?.[key];
	if (!entry || entry.value === null) return null;
	const n = typeof entry.value === "number" ? entry.value : parseFloat(String(entry.value));
	return Number.isFinite(n) ? n : null;
}

function policyStringArray(snapshot: PolicySnapshot | null, key: string): string[] | null {
	const entry = snapshot?.preferences?.[key];
	if (!entry || !Array.isArray(entry.value)) return null;
	return entry.value.filter((v): v is string => typeof v === "string");
}

export async function runDailyPlanTick(
	host: ContributionsReadHost,
	forecastPlan: ForecastPlan,
): Promise<DailyPlan> {
	const now = new Date();
	/*
	 * BLOCK B — Learned Planner: Read-Only-Bridge zum eingefrorenen Block-A-Learning-State
	 * (`learning/daily_evaluator/learning_state_v1.json`). Wird NIE geschrieben/verändert.
	 * Fehlt/kaputt/Host ohne Pfad-Unterstützung → leerer Snapshot (usable=false in jedem
	 * nachgelagerten Learning Gate, exakt bisheriges Planner-Verhalten).
	 */
	const blockALearning = await loadBlockALearningSnapshot(
		host as unknown as { getAbsolutePath?: (c?: string) => string },
	);
	const adminCfg = intentAdminConfigFromAdapter(host.config);
	const timezone = adminCfg.timezone || "Europe/Berlin";
	const globalModeRaw = (await readStr(host, "global_modes.active")) ?? "balanced";
	const modePolicy = plannerModePolicyFromGlobalMode(globalModeRaw);
	const adminPolicy = globalPolicyConfigFromAdapter(host.config);
	const effectivePolicy = await readEffectivePolicy(host);

	const energyPriority =
		policyStringArray(effectivePolicy, "energyPriority") ?? adminPolicy.energyPriority ?? [];
	const mutualRaw = effectivePolicy?.protection?.mutualExclusions?.value;
	const mutualExclusions = Array.isArray(mutualRaw)
		? (mutualRaw as Array<{ id: string; addonA: string; addonB: string; reason?: string }>)
		: adminPolicy.mutualExclusions ?? [];

	const batConsumers = batteryConsumersConfigFromAdapter(host.config);
	const immersionCfg = immersionDeviceConfigFromAdapter(host.config);
	const socPct = asNum((await host.getStateAsync("live.battery.soc_pct"))?.val);
	const bufferTempC = asNum((await host.getStateAsync("live.thermal.buffer_temp_c"))?.val);
	const evccMode = await readStr(host, WALLBOX_EVCC_STATES.batteryMode);
	const evccDischargeRaw = await host.getStateAsync(WALLBOX_EVCC_STATES.batteryDischargeControl);
	const evccDischarge = evccDischargeRaw?.val === true;
	const batteryBoostRaw = await host.getStateAsync(WALLBOX_EVCC_STATES.batteryBoost);
	const batteryBoost =
		batteryBoostRaw?.val === true ? true : batteryBoostRaw?.val === false ? false : null;
	const loadpointMode = await readStr(host, WALLBOX_EVCC_STATES.loadpointMode);
	const evccConnectedRaw = await host.getStateAsync(WALLBOX_EVCC_STATES.connected);
	const evccConnectedNow =
		evccConnectedRaw?.val === true ? true : evccConnectedRaw?.val === false ? false : null;
	const evccChargingRaw = await host.getStateAsync(WALLBOX_EVCC_STATES.charging);
	const evccChargingNow =
		evccChargingRaw?.val === true ? true : evccChargingRaw?.val === false ? false : null;
	const evccChargePowerNow = asNum((await host.getStateAsync(WALLBOX_EVCC_STATES.chargePowerW))?.val);
	const holdSignals = wallboxHoldSignalConfigFromAdapter(host.config);
	let externalVehicleChargeRaw: string | boolean | null = null;
	if (holdSignals.externalVehicleChargeStateId) {
		try {
			const st = await host.getForeignStateAsync?.(holdSignals.externalVehicleChargeStateId);
			if (st?.val !== undefined && st.val !== null) {
				externalVehicleChargeRaw =
					typeof st.val === "boolean" ? st.val : String(st.val);
			}
		} catch {
			externalVehicleChargeRaw = null;
		}
	}
	let tibberGridRewardsActive: boolean | null = null;
	if (holdSignals.tibberGridRewardsActiveStateId) {
		try {
			const st = await host.getForeignStateAsync?.(holdSignals.tibberGridRewardsActiveStateId);
			const n = normalizeOptionalBool(st?.val);
			tibberGridRewardsActive = n.status === "valid" ? n.value : null;
		} catch {
			tibberGridRewardsActive = null;
		}
	}
	const wallboxHold = resolveWallboxBatteryHold({
		vehicleConnected: evccConnectedNow,
		charging: evccChargingNow,
		chargePowerW: evccChargePowerNow,
		batteryBoost,
		loadpointMode,
		externalVehicleChargeRaw,
		tibberGridRewardsActive,
	});
	try {
		await setStateIfChanged(host, WALLBOX_RUNTIME_STATES.batteryHoldForEvCharge, wallboxHold.hold);
		await setStateIfChanged(host, WALLBOX_RUNTIME_STATES.batteryHoldReasonDe, wallboxHold.reasonDe);
		await setStateIfChanged(
			host,
			WALLBOX_RUNTIME_STATES.externalVehicleChargeActive,
			wallboxHold.externalActive,
		);
		await setStateIfChanged(
			host,
			WALLBOX_RUNTIME_STATES.tibberGridRewardsActive,
			wallboxHold.tibberRewardsActive,
		);
	} catch {
		// hold publish best-effort
	}
	const batteryIntentRaw = await readStr(host, "user_intent.battery.resolved_json");
	let userHold = false;
	if (batteryIntentRaw) {
		try {
			const parsed = JSON.parse(batteryIntentRaw) as { operating_request?: { value?: string } };
			userHold = parsed.operating_request?.value === "hold";
		} catch {
			userHold = false;
		}
	}
	const hold = buildPlannerConstraints({
		evccBatteryMode: evccMode,
		evccBatteryDischargeControl: evccDischarge,
		userIntentBatteryHold: userHold,
		wallboxChargeHold: wallboxHold.hold,
		wallboxChargeHoldReasonDe: wallboxHold.reasonDe,
	});
	const batCfgModes = batteryConfigFromAdapter(host.config);
	const batOperatingMode = asNum((await host.getStateAsync(BAT.telemetry.operatingMode))?.val);
	const batOwnershipActive = (await host.getStateAsync(BAT.runtime.ownershipActive))?.val === true;
	const passiveBatteryEnergy = resolvePassiveBatteryEnergyAvailable({
		operatingMode: batOperatingMode,
		selfConsumptionModeValue: batCfgModes.sonnenModeValues.selfConsumption,
		manualModeValue: batCfgModes.sonnenModeValues.manual,
		ownershipActive: batOwnershipActive,
		batteryHoldActive: hold.battery_hold_active,
	});

	const consumerAccess = resolveAllBatteryConsumerAccess({
		config: batConsumers,
		batteryHoldActive: hold.battery_hold_active,
		socPct,
		criticalByConsumer: {
			immersion_heater: immersionCriticalNow(
				bufferTempC,
				immersionCfg.planningMinTempC,
				batConsumers.immersion_heater.criticalMarginK,
			),
			air_conditioning: null,
			wallbox: false,
		},
	});

	/*
	 * Zentrale Batterie-Reserve (führt bestehende Wege zusammen, siehe battery_reserve_target.ts):
	 * learning/battery_runtime liefert die reale Verbrauchsbasis, next_reliable_pv.ts (unverändert)
	 * den Forecast-Zeitpunkt/Bedarf, die battery.charge-Contribution (unverändert) ihr bereits
	 * kombiniertes Lade-/Reserveziel. Ergebnis ist EIN requiredSocAtPvEndPct für Lade- UND
	 * Entladeplanung — kein zweiter, unabhängig gepflegter Zielwert mehr.
	 */
	const priceNowCt = asNum((await host.getStateAsync("live.price.now_ct_per_kwh"))?.val);
	const reserveCapacityKwh = asNum((await host.getStateAsync(BAT.telemetry.capacityEffectiveKwh))?.val);
	const pvConfidencePct = asNum((await host.getStateAsync("learning.pv_bias.confidence_pct"))?.val);
	const pvConfidence01 = pvConfidencePct === null ? null : Math.max(0.2, Math.min(1, pvConfidencePct / 100));
	const predictedNightConsumptionKwh = asNum(
		(await host.getStateAsync("learning.battery_runtime.predicted_night_consumption_kwh"))?.val,
	);
	const avgChargePowerW = asNum(
		(await host.getStateAsync("learning.battery_runtime.avg_charge_power_w"))?.val,
	);
	const batteryChargeContribution = forecastPlan.contributions.find(
		(c) => c.contributionId === CONTRIBUTION_IDS.BATTERY_CHARGE,
	);
	const contributionTargetSocPct = (() => {
		const d = (batteryChargeContribution?.details ?? null) as Record<string, unknown> | null;
		const v = d ? d["targetSocPct"] : null;
		return typeof v === "number" && Number.isFinite(v) ? v : null;
	})();
	const reserveSlots = buildReserveFloorSlotsFromForecastPlan(forecastPlan);
	const centralReserve = resolveCentralBatteryReserveTarget({
		nowMs: now.getTime(),
		slots: reserveSlots,
		pvConfidence01,
		socPct,
		usableCapacityKwh: reserveCapacityKwh,
		predictedNightConsumptionKwh,
		avgChargePowerW,
		contributionTargetSocPct,
	});

	/*
	 * BLOCK B — Battery Opportunity Cost (additiv, optional). Nutzt ausschließlich bereits
	 * berechnete Werte (reserveSlots, centralReserve, socPct, reserveCapacityKwh) und die
	 * ebenfalls bereits im Forecast Plan vorhandenen Flex-Contributions — keine neuen IO-Reads,
	 * kein zweites Preismodell. Bei fehlenden Eingaben liefert die Funktion selbst den
	 * konservativen Fallback (usable=false, Cost=0) — kein zusätzlicher Sonderpfad hier nötig.
	 */
	const headroomAboveReserveKwh =
		socPct !== null &&
		Number.isFinite(socPct) &&
		centralReserve.requiredSocAtPvEndPct !== null &&
		reserveCapacityKwh !== null &&
		Number.isFinite(reserveCapacityKwh)
			? ((socPct - centralReserve.requiredSocAtPvEndPct) / 100) * reserveCapacityKwh
			: null;
	const pvRemainingTodayKwh = reserveSlots
		.filter((s) => s.startMs > now.getTime())
		.reduce((sum, s) => sum + s.pvKwh, 0);
	const immersionFlexContribution = forecastPlan.contributions.find(
		(c) => c.contributionId === CONTRIBUTION_IDS.IMMERSION_FLEXIBLE,
	);
	const wallboxContribution = forecastPlan.contributions.find(
		(c) => c.contributionId === CONTRIBUTION_IDS.WALLBOX_EV_SESSION,
	);
	const laterDemandFromContribution = (contribution: typeof immersionFlexContribution): number => {
		const d = (contribution?.details ?? null) as Record<string, unknown> | null;
		const v = d ? d["requiredEnergyKwh"] : null;
		return typeof v === "number" && Number.isFinite(v) ? Math.max(0, v) : 0;
	};
	const plannedLaterDemandKwh =
		laterDemandFromContribution(immersionFlexContribution) + laterDemandFromContribution(wallboxContribution);
	const batteryOpportunity = evaluateBatteryOpportunityCost({
		nowMs: now.getTime(),
		priceSlots: reserveSlots.map((s) => ({ startMs: s.startMs, importCtPerKwh: s.importCt })),
		headroomAboveReserveKwh,
		pvRemainingTodayKwh,
		plannedLaterDemandKwh,
	});

	/*
	 * BLOCK B — Battery Learned Opportunity (additiv). Nutzt die tatsächliche
	 * Block-A-Metrik `batteryReserveAccuracyPct` über das zentrale Learning Gate, um die
	 * Opportunity-Margen-Schwelle AUSSCHLIESSLICH zu erhöhen (nie zu senken) — siehe
	 * `battery_reserve_learning.ts`. `baselineAuthorization` (feste Basis-Marge) wird nur für
	 * Explainability berechnet, nie für eine echte Steuerentscheidung verwendet.
	 */
	const batteryReserveLearning = calibrateBatteryOpportunityMargin(blockALearning.batteryReserveAccuracyPct);
	const batteryDischargeAuthorizationInputBase = {
		priceNowCt,
		minPriceCtPerKwh: batCfgModes.gridBalance.minPriceCtPerKwh,
		socPct,
		requiredSocAtPvEndPct: centralReserve.requiredSocAtPvEndPct,
		configuredMaxDischargeW: batCfgModes.gridBalance.maxTargetW,
		opportunityCostCtPerKwh: batteryOpportunity.usable ? batteryOpportunity.opportunityCostCtPerKwh : null,
	};
	const baselineBatteryDischargeAuthorization = resolveBatteryDischargeAuthorization(
		batteryDischargeAuthorizationInputBase,
	);
	const learnedOpportunityMarginCt =
		DEFAULT_OPPORTUNITY_MARGIN_CT_PER_KWH + batteryReserveLearning.extraMarginCtPerKwh;
	let opportunityMarginOverride: number | null = null;
	try {
		const activeOverrides = await listActiveOverrides(
			host as unknown as { getAbsolutePath?: (c?: string) => string },
		);
		opportunityMarginOverride = resolveActiveOverrideValue(
			activeOverrides,
			AI_OVERRIDE_PARAM_BATTERY_OPPORTUNITY_MARGIN_CT,
			now,
		);
	} catch {
		opportunityMarginOverride = null;
	}
	const opportunityMarginCtPerKwh = mergeOpportunityMarginWithOverride(
		learnedOpportunityMarginCt,
		opportunityMarginOverride,
	);
	const batteryDischargeAuthorization = resolveBatteryDischargeAuthorization({
		...batteryDischargeAuthorizationInputBase,
		opportunityMarginCtPerKwh,
	});
	const batteryLearningExplanation = toBatteryReserveLearningExplanation(
		batteryReserveLearning,
		baselineBatteryDischargeAuthorization.opportunityAllowed,
		batteryDischargeAuthorization.opportunityAllowed,
	);
	try {
		/*
		 * Always write so `ts` stays current. setStateIfChanged would keep months-old
		 * values when the computed flag did not flip — Admin-Häkchen und Diagnose
		 * wären dann unsichtbar. Gleiches Muster wie Batterie-Hold.
		 */
		await host.setStateAsync("planner.constraints.evcc_battery_hold", {
			val: hold.evcc_battery_hold,
			ack: true,
		});
		await host.setStateAsync("planner.constraints.battery_hold_active", {
			val: hold.battery_hold_active,
			ack: true,
		});
		for (const w of batteryConsumerConstraintStateWrites(consumerAccess)) {
			await host.setStateAsync(w.id, { val: w.val, ack: true });
		}
		await host.setStateAsync("planner.battery_discharge.allowed", {
			val: batteryDischargeAuthorization.allowed,
			ack: true,
		});
		await host.setStateAsync("planner.battery_discharge.max_discharge_w", {
			val: batteryDischargeAuthorization.maxDischargeW,
			ack: true,
		});
		await host.setStateAsync("planner.battery_discharge.reason_de", {
			val: batteryDischargeAuthorization.reasonDe,
			ack: true,
		});
		await host.setStateAsync("planner.battery_discharge.opportunity_cost_ct_per_kwh", {
			val: batteryOpportunity.usable ? batteryOpportunity.opportunityCostCtPerKwh : null,
			ack: true,
		});
		await host.setStateAsync("planner.battery_discharge.opportunity_allowed", {
			val: batteryDischargeAuthorization.opportunityAllowed,
			ack: true,
		});
		await host.setStateAsync("planner.learning.battery_explanation", {
			val: JSON.stringify(batteryLearningExplanation),
			ack: true,
		});
		await host.setStateAsync("planner.battery_reserve.required_soc_at_pv_end_pct", {
			val: centralReserve.requiredSocAtPvEndPct,
			ack: true,
		});
		await host.setStateAsync("planner.battery_reserve.predicted_consumption_until_next_pv_kwh", {
			val: centralReserve.predictedConsumptionUntilNextPvKwh,
			ack: true,
		});
		await host.setStateAsync("planner.battery_reserve.next_reliable_pv_iso", {
			val: centralReserve.nextReliablePvIso ?? "",
			ack: true,
		});
		await host.setStateAsync("planner.battery_reserve.estimated_battery_empty_at_iso", {
			val: centralReserve.estimatedBatteryEmptyAtIso ?? "",
			ack: true,
		});
		await host.setStateAsync("planner.battery_reserve.energy_to_target_kwh", {
			val: centralReserve.energyToTargetKwh,
			ack: true,
		});
		await host.setStateAsync("planner.battery_reserve.estimated_charge_time_to_target_hours", {
			val: centralReserve.estimatedChargeTimeToTargetHours,
			ack: true,
		});
		await host.setStateAsync("planner.battery_reserve.reason_de", {
			val: centralReserve.reasonDe,
			ack: true,
		});
		await host.setStateAsync("planner.global_mode.active", {
			val: modePolicy.mode,
			ack: true,
		});
		await host.setStateAsync("planner.last_run_at", {
			val: now.toISOString(),
			ack: true,
		});
		await host.setStateAsync("planner.status", {
			val: "running",
			ack: true,
		});
	} catch {
		// constraint publish best-effort
	}

	const pvStateEarly = await host.getStateAsync("live.pv.power_w");
	const pvBatStateEarly = await host.getStateAsync("live.battery.pv_ac_power_w");
	const houseStateEarly = await host.getStateAsync("live.battery.house_load_w");
	const pvFromPvEarly = asNum(pvStateEarly?.val);
	const pvFromBatteryEarly = asNum(pvBatStateEarly?.val);
	const livePvPowerW = pvFromPvEarly ?? pvFromBatteryEarly;
	const liveHouseLoadW = asNum(houseStateEarly?.val);
	const nowMsEarly = now.getTime();
	const ageSec = (st: ioBroker.State | null | undefined): number | null => {
		const ts = typeof st?.ts === "number" ? st.ts : null;
		if (ts === null || !Number.isFinite(ts)) return null;
		return Math.max(0, Math.round((nowMsEarly - ts) / 1000));
	};
	const liveSurplusEarly = buildOperatorLiveSurplus({
		pvPowerW: livePvPowerW,
		houseLoadW: liveHouseLoadW,
		now,
		timezone,
	});

	let plan = buildDailyPlanFromForecast(now, timezone, modePolicy.mode, forecastPlan, {
		policySnapshot: effectivePolicy as unknown as Record<string, unknown> | null,
		energyPriority,
		mutualExclusions,
		gridImportAllowedPolicy:
			policyBool(effectivePolicy, "gridImportAllowed") ?? adminPolicy.gridImportAllowed,
		effectiveMaxGridImportW: policyNumber(effectivePolicy, "maxGridImportW") ?? adminPolicy.maxGridImportW,
		configuredHouseFuseLimitW:
			policyNumber(effectivePolicy, "houseFuseLimitW") ?? adminPolicy.houseFuseLimitW,
		modePolicy,
		batteryConsumerAccess: consumerAccess,
		batteryDischargeBudgetW: batConsumers.maxDischargePowerW,
		liveNow: {
			pvPowerW: livePvPowerW,
			houseLoadW: liveHouseLoadW,
			pvAgeSec: ageSec(pvFromPvEarly != null ? pvStateEarly : pvBatStateEarly),
			houseAgeSec: ageSec(houseStateEarly),
		},
	});

	const payload = dailyPlanRevisionPayload(plan);
	if (payload !== lastRevisionPayload) {
		revision += 1;
		lastRevisionPayload = payload;
	}
	plan.revision = revision;

	const cadenceDigest = unifiedPlanCadenceDigest(plan);

	// Live-Diagnose darf jeden Tick — Tagesplan/Unified nur bei Material-Replan.
	try {
		await setOptionalNumberIfChanged(host, "operator.diagnostics.surplus_w", liveSurplusEarly.surplusW);
		await setOptionalNumberIfChanged(host, "operator.diagnostics.deficit_w", liveSurplusEarly.deficitW);
		await setStateIfChanged(host, "operator.diagnostics.slot_start_iso", liveSurplusEarly.slotStartIso ?? "");
	} catch {
		// best-effort
	}

	const bufferSt = await host.getStateAsync(IMMERSION_RUNTIME_STATES.bufferTemperatureC);
	const batSocSt = await host.getStateAsync(BAT.telemetry.socPct);
	const batCap = asNum((await host.getStateAsync(BAT.telemetry.capacityEffectiveKwh))?.val);
	const hw = hardwareLimitsFromConfig(host.config);
	const roomTemps: Partial<Record<number, number | null>> = {};
	for (let u = 1; u <= AC_UNIT_COUNT; u++) {
		roomTemps[u] = asNum((await host.getStateAsync(acUnitRuntimeStates(u).roomTempC))?.val);
	}
	const realizedPv = asNum((await host.getStateAsync("learning.energy_daily.pv_kwh"))?.val);
	const wbConnectedRaw = await host.getStateAsync(WALLBOX_EVCC_STATES.connected);
	const wbConnected =
		wbConnectedRaw?.val === true ? true : wbConnectedRaw?.val === false ? false : null;

	const absPath = (host as { getAbsolutePath?: (c?: string) => string }).getAbsolutePath;
	const presenceDir = typeof absPath === "function" ? absPath("learning/vehicle_presence") : null;
	let presenceStore = await loadOrEmptyVehiclePresenceStore(presenceDir);
	const vehicleName = await readStr(host, WALLBOX_EVCC_STATES.vehicleName);
	const vehicleTitle = await readStr(host, WALLBOX_EVCC_STATES.vehicleTitle);
	const mapEntry = lookupVehicleMapEntry(
		wallboxVehicleMapFromAdapter(host.config).entries,
		vehicleName,
		vehicleTitle,
	);
	// Ohne Map-Treffer: keine erfundene ID — Learning/Prediction aussetzen.
	const presenceVehicleKey = mapEntry?.evccVehicleId ?? null;
	if (wbConnected !== null && presenceVehicleKey) {
		const nextStore = observeConnected(
			presenceStore,
			now.getTime(),
			timezone,
			wbConnected,
			presenceVehicleKey,
		);
		if (nextStore !== presenceStore && presenceDir) {
			try {
				await writeVehiclePresencePersist(presenceDir, nextStore);
			} catch (e) {
				host.log?.warn?.(`vehicle_presence persist: ${String(e)}`);
			}
		}
		presenceStore = nextStore;
	}

	const acRuntime: Array<{
		unitIndex: number;
		running: boolean;
		decisionSource?: string | null;
		allocatedPowerW?: number | null;
		estimatedPowerW?: number | null;
	}> = [];
	for (let u = 1; u <= AC_UNIT_COUNT; u++) {
		const ids = acUnitRuntimeStates(u);
		acRuntime.push({
			unitIndex: u,
			running: (await host.getStateAsync(ids.running))?.val === true,
			decisionSource: String((await host.getStateAsync(ids.decisionSource))?.val ?? "") || null,
			allocatedPowerW: asNum((await host.getStateAsync(ids.allocatedPowerW))?.val),
			estimatedPowerW: asNum((await host.getStateAsync(ids.estimatedPowerW))?.val),
		});
	}

	const feedInCtPerKwh = normalizeFeedInCtPerKwh(
		asNum((await host.getStateAsync("economics.config.feed_in_ct_per_kwh"))?.val),
	);
	const learningEmptyAtRaw = await host.getStateAsync("learning.thermal_boiler.estimated_empty_at");
	const learningEmptyAtIso =
		typeof learningEmptyAtRaw?.val === "string" && learningEmptyAtRaw.val.trim()
			? learningEmptyAtRaw.val.trim()
			: null;
	const ihCfg = immersionDeviceConfigFromAdapter(host.config);
	const probeInput = buildUnifiedInputFromForecastContext({
		now,
		timezone,
		globalMode: plan.globalMode,
		forecastPlan,
		bufferTempC: asNum(bufferSt?.val),
		batterySocPct: asNum(batSocSt?.val),
		batteryCapacityKwh: batCap,
		batteryMaxChargePowerW: hw.maxChargeW,
		batteryMaxDischargePowerW: hw.maxDischargeW,
		batteryMinSocPct: hw.minSocPct,
		batteryMaxSocPct: hw.maxSocPct,
		roomTemps,
		observedPvPowerW: livePvPowerW,
		observedHouseLoadPowerW: liveHouseLoadW,
		observedPvAgeSec: ageSec(pvFromPvEarly != null ? pvStateEarly : pvBatStateEarly),
		observedHouseAgeSec: ageSec(houseStateEarly),
		acRuntime,
		contributionRevision: plan.revision,
		previousExpectedDayEnergyKwh: lastBaseline?.expectedPvDayKwh ?? null,
		realizedPvKwhToday: realizedPv,
		vehiclePresenceLearning: presenceStore,
		vehiclePresenceVehicleKey: presenceVehicleKey,
		connectedNowOverride: wbConnected,
		passiveBatteryEnergyAvailable: passiveBatteryEnergy.available,
		feedInCtPerKwh,
		boilerEstimatedEmptyAtOverride: learningEmptyAtIso,
		preferImmersionLiveSurplusNow: false,
		thermalLearnedPriceTimingScore: blockALearning.thermalPriceTimingScore,
	});
	const ihMeasuredW = asNum((await host.getStateAsync("addons.immersion_heater.runtime.measured_power_w"))?.val);
	const ihCommandedW = asNum((await host.getStateAsync("addons.immersion_heater.runtime.commanded_power_w"))?.val);
	const ihOnPowerW =
		ihMeasuredW != null && ihMeasuredW > 50
			? ihMeasuredW
			: ihCommandedW != null && ihCommandedW > 50
				? ihCommandedW
				: 0;
	const continueSoftIh = immersionSoftActiveInCurrentSlot(lastUnifiedPlan, now.getTime());
	const preferLiveIh = preferImmersionLiveSurplusNowFrom({
		livePvPowerW: livePvPowerW,
		liveHouseLoadW: liveHouseLoadW,
		immersionOnPowerW: ihOnPowerW,
		thermalHeadroomKwh: probeInput.thermal?.headroomEnergyKwh ?? null,
		minPowerW: probeInput.thermal?.minPowerW ?? ihCfg.stages[0]?.nominalPowerW ?? 1700,
		socPct: probeInput.battery.socPct,
	});

	const immersionNearMs = (() => {
		if (!lastUnifiedPlan) return null;
		const nowMs = now.getTime();
		const horizon = nowMs + 45 * 60_000;
		let best: number | null = null;
		for (const a of lastUnifiedPlan.allocations) {
			if (a.kind !== "immersion_heater") continue;
			if (!(a.allocatedPowerW >= 50)) continue;
			const s = Date.parse(a.slot.startIso);
			const e = Date.parse(a.slot.endIso);
			if (!Number.isFinite(s) || !Number.isFinite(e)) continue;
			if (e <= nowMs) continue;
			if (s > horizon) continue;
			if (best === null || s < best) best = s;
		}
		return best;
	})();

	/*
	 * BLOCK B — User-Override-Digest (Intent Engine, additiv). Nur die drei bereits
	 * bestehenden Manual-Override-Flags — keine neue Override-Logik, keine Bewertung, reine
	 * Zustands-Zusammenfassung als Replan-Trigger (siehe materiality.ts).
	 */
	const userOverrideDigest = [
		"b:" + ((await host.getStateAsync("user_intent.battery.manual_override_active"))?.val === true ? "1" : "0"),
		"t:" + ((await host.getStateAsync("user_intent.thermal.manual_override_active"))?.val === true ? "1" : "0"),
		"w:" + ((await host.getStateAsync("user_intent.wallbox.manual_override_active"))?.val === true ? "1" : "0"),
	].join("|");

	const actualSample: PlanActualSample = {
		date: plan.date,
		nowMs: now.getTime(),
		forecastPvDayKwh: probeInput.pv.expectedDayEnergyKwh,
		realizedPvKwh: realizedPv,
		forecastHouseLoadDayKwh: probeInput.houseLoad.expectedDayEnergyKwh,
		batterySocPct: probeInput.battery.socPct,
		thermalHeadroomKwh: probeInput.thermal?.headroomEnergyKwh ?? null,
		bufferTempC: probeInput.thermal?.bufferTempC ?? null,
		thermalEmptyAtIso: probeInput.thermal?.estimatedEmptyAtIso ?? learningEmptyAtIso,
		acMandatoryAny: probeInput.climate?.units.some((u) => u.mandatoryComfort) === true,
		vehicleConnected: probeInput.wallbox?.connectedNow ?? wbConnected,
		vehicleRequiredEnergyKwh: probeInput.wallbox?.requiredEnergyKwh ?? null,
		vehicleDeadlineIso: probeInput.wallbox?.deadlineIso ?? null,
		vehicleTargetSocPct: probeInput.wallbox?.targetSocPct ?? null,
		priceMedianCt: medianGridPriceCtPerKwh(plan),
		priceStructureDigest: priceStructureDigestFromPlan(plan),
		presenceDigest: presenceDigest(probeInput.wallbox?.presenceWindows ?? []),
		thermalBlocked: probeInput.thermal?.uncertainty.status === "blocked",
		cadenceDigest,
		userOverrideDigest,
	};

	const immersionFirstFutureStartMs = (() => {
		if (!lastUnifiedPlan) return null;
		const nowMs = now.getTime();
		let best: number | null = null;
		for (const a of lastUnifiedPlan.allocations) {
			if (a.kind !== "immersion_heater") continue;
			const t = Date.parse(a.slot.startIso);
			if (!Number.isFinite(t) || t + 15 * 60_000 <= nowMs) continue;
			if (best === null || t < best) best = t;
		}
		return best;
	})();

	/*
	 * Timezone-Offset für tageszeitabhängigen Cooldown: tagsüber (06–21 Uhr) 1 Min,
	 * nachts 5 Min. Näherung: UTC-Offset aus now vs. lokalem Datum (kein DST-Problem,
	 * da nur für Cooldown-Schwelle verwendet).
	 */
	const localOffsetMinutes = -now.getTimezoneOffset();
	let decision = evaluateMaterialReplan(lastBaseline, actualSample, {
		lastReplanAtMs,
		timezoneOffsetMinutes: localOffsetMinutes,
		immersionFirstFutureStartMs,
	});
	if (forcedReplanReasons.length > 0) {
		const forced = forcedReplanReasons.slice();
		forcedReplanReasons = [];
		decision = {
			shouldReplan: true,
			hard: true,
			reasons: [REASON.REPLAN_ADDON_EXECUTION_MODE, ...forced, ...decision.reasons],
		};
	}
	/*
	 * Live-Surplus + Soft-Bedarf, aber kein Heizstab-Fenster in ~45 Min (z. B. nur Sa):
	 * hart replanen, damit preferLive den NOW-Slot neu bewerten kann.
	 */
	if (preferLiveIh && immersionNearMs === null) {
		decision = {
			shouldReplan: true,
			hard: true,
			reasons: [REASON.REPLAN_IMMERSION_LIVE_SURPLUS, ...decision.reasons],
		};
	}
	if (!decision.shouldReplan) {
		return plan;
	}

	// Beta: Plan-B-Compare advisory only — keine Allocation-Mutation vor Unified Authority.
	try {
		const { maybeApplyAiWritebackOnDailyPlan } = await import("../../ai/writeback/index.js");
		plan = await maybeApplyAiWritebackOnDailyPlan(
			host as Parameters<typeof maybeApplyAiWritebackOnDailyPlan>[0],
			plan,
		);
	} catch (e) {
		host.log?.warn?.(`ai_writeback: ${String(e)}`);
	}

	try {
		/*
		 * Unified Authority: IH/AC/Battery/Wallbox in Memory mergen, dann einmal publizieren.
		 * Kein klassischer Add-on-Live-Publish vor Unified (Race vermeiden).
		 */
		let ihAcReasonSuffix = "";
		try {
			const bufferTs =
				typeof bufferSt?.ts === "number" && Number.isFinite(bufferSt.ts)
					? new Date(bufferSt.ts).toISOString()
					: null;
			const batSocTs =
				typeof batSocSt?.ts === "number" && Number.isFinite(batSocSt.ts)
					? new Date(batSocSt.ts).toISOString()
					: null;
			const unifiedInputFinal = buildUnifiedInputFromForecastContext({
				now,
				timezone,
				globalMode: plan.globalMode,
				forecastPlan,
				bufferTempC: asNum(bufferSt?.val),
				bufferTempObservedAtIso: bufferTs,
				batterySocPct: asNum(batSocSt?.val),
				batteryCapacityKwh: batCap,
				batterySocObservedAtIso: batSocTs,
				batteryMaxChargePowerW: hw.maxChargeW,
				batteryMaxDischargePowerW: hw.maxDischargeW,
				batteryMinSocPct: hw.minSocPct,
				batteryMaxSocPct: hw.maxSocPct,
				roomTemps,
				observedPvPowerW: livePvPowerW,
				observedHouseLoadPowerW: liveHouseLoadW,
				observedPvAgeSec: ageSec(pvFromPvEarly != null ? pvStateEarly : pvBatStateEarly),
				observedHouseAgeSec: ageSec(houseStateEarly),
				acRuntime,
				contributionRevision: plan.revision,
				previousExpectedDayEnergyKwh: lastBaseline?.expectedPvDayKwh ?? null,
				realizedPvKwhToday: realizedPv,
				vehiclePresenceLearning: presenceStore,
				vehiclePresenceVehicleKey: presenceVehicleKey,
				connectedNowOverride: wbConnected,
				passiveBatteryEnergyAvailable: passiveBatteryEnergy.available,
				preferImmersionLiveSurplusNow: preferLiveIh,
				continueImmersionSoftCurrentSlot: continueSoftIh,
				boilerEstimatedEmptyAtOverride: learningEmptyAtIso,
				feedInCtPerKwh,
				thermalLearnedPriceTimingScore: blockALearning.thermalPriceTimingScore,
			});

			const nextGen = (lastUnifiedPlan?.generation ?? 0) + 1;
			const unifiedPlan = allocateUnifiedDayPlan(unifiedInputFinal, {
				generation: nextGen,
				extraReasonCodes: decision.reasons,
				previousPlan: lastUnifiedPlan,
			});
			try {
				await publishEvPlannerDiagnosis(host, unifiedPlan.evPlanner);
			} catch (e) {
				host.log?.warn?.(`ev planner diagnosis publish: ${String(e)}`);
			}
			try {
				await host.setStateAsync("planner.learning.thermal_explanation", {
					val: JSON.stringify(unifiedPlan.thermalLearningExplanation ?? null),
					ack: true,
				});
			} catch (e) {
				host.log?.warn?.(`thermal learning explanation publish: ${String(e)}`);
			}
			unifiedGeneration += 1;
			lastUnifiedPlanId = unifiedPlan.planId;
			lastUnifiedPlan = unifiedPlan;
			lastReplanAtMs = now.getTime();
			lastCadenceDigest = cadenceDigest;
			if (replanCountDate !== plan.date) {
				replanCountDate = plan.date;
				replanCountToday = 0;
			}
			replanCountToday += 1;
			lastBaseline = {
				date: plan.date,
				planId: unifiedPlan.planId,
				generation: unifiedPlan.generation,
				createdAtMs: now.getTime(),
				expectedPvDayKwh: unifiedInputFinal.pv.expectedDayEnergyKwh,
				realizedPvKwhAtPlan: realizedPv,
				expectedHouseLoadDayKwh: unifiedInputFinal.houseLoad.expectedDayEnergyKwh,
				batterySocPct: unifiedInputFinal.battery.socPct,
				thermalHeadroomKwh: unifiedInputFinal.thermal?.headroomEnergyKwh ?? null,
				bufferTempC: unifiedInputFinal.thermal?.bufferTempC ?? null,
				thermalEmptyAtIso: unifiedInputFinal.thermal?.estimatedEmptyAtIso ?? learningEmptyAtIso,
				acMandatoryAny: unifiedInputFinal.climate?.units.some((u) => u.mandatoryComfort) === true,
				vehicleConnected: unifiedInputFinal.wallbox?.connectedNow ?? null,
				vehicleRequiredEnergyKwh: unifiedInputFinal.wallbox?.requiredEnergyKwh ?? null,
				vehicleDeadlineIso: unifiedInputFinal.wallbox?.deadlineIso ?? null,
				vehicleTargetSocPct: unifiedInputFinal.wallbox?.targetSocPct ?? null,
				priceMedianCt: medianGridPriceCtPerKwh(plan),
				priceStructureDigest: priceStructureDigestFromPlan(plan),
				presenceDigest: presenceDigest(unifiedInputFinal.wallbox?.presenceWindows ?? []),
				cadenceDigest,
				userOverrideDigest,
			};

			/* Schritt 7: Day-Session + optionaler Tagesabschluss (Fehler isoliert). */
			try {
				const { rolloverFrom } = noteUnifiedPlanPublished({
					date: plan.date,
					timezone,
					plan: unifiedPlan,
					expectedPvKwh: unifiedInputFinal.pv.expectedDayEnergyKwh,
					batteryStartSocPct: unifiedInputFinal.battery.socPct,
					immersionTargetTempC: unifiedInputFinal.thermal?.dayTargetTempC ?? null,
					replanReasons: decision.reasons,
				});
				try {
					const { noteDayTelemetryPlanPublished } = await import(
						"../../learning/day_telemetry/record.js"
					);
					await noteDayTelemetryPlanPublished({
						host: host as unknown as Parameters<typeof noteDayTelemetryPlanPublished>[0]["host"],
						now,
						timezone,
						plan: unifiedPlan,
						plannerInput: unifiedInputFinal,
						replanReasons: decision.reasons,
						/*
						 * Additiv (Block A): 1:1 aus dem bereits berechneten Decision-Pfad dieses Ticks
						 * (Zeilen oben) — keine neue Berechnung, kein Control-Effekt.
						 */
						batteryDecision: {
							dischargeAllowed: batteryDischargeAuthorization.allowed,
							priceAllowed: batteryDischargeAuthorization.priceAllowed,
							socAllowed: batteryDischargeAuthorization.socAllowed,
							requiredSocAtPvEndPct: centralReserve.requiredSocAtPvEndPct,
							holdActive: hold.battery_hold_active,
						},
					});
				} catch (te) {
					host.log?.warn?.(`day_telemetry plan note: ${String(te)}`);
				}
				const dayEvalDir =
					typeof absPath === "function" ? absPath("learning/day_evaluation") : null;
				const pvBiasDir = typeof absPath === "function" ? absPath("learning/pv_bias") : null;
				const thermalDir =
					typeof absPath === "function" ? absPath("learning/thermal_runtime") : null;
				if (rolloverFrom && dayEvalDir && pvBiasDir && thermalDir) {
					const actuals: DayEvalActuals = {
						actualPvKwh: realizedPv,
						actualHouseLoadKwh: null,
						actualGridImportKwh: null,
						actualGridExportKwh: null,
						actualGridCostCt: null,
						actualBatteryEndSocPct: unifiedInputFinal.battery.socPct,
						actualBatteryChargedKwh: null,
						actualImmersionKwh: null,
						actualImmersionEndTempC: unifiedInputFinal.thermal?.bufferTempC ?? null,
						actualClimateKwh: null,
						climateComfortViolations: null,
						actualVehicleChargeKwh: null,
						actualVehicleGridCostCt: null,
						actualVehicleSocPct: unifiedInputFinal.wallbox?.vehicleSocPct ?? null,
					};
					await closeSessionIfNeeded({
						sessionToClose: rolloverFrom,
						actuals,
						now,
						dayEvalDir,
						pvBiasDir,
						thermalDir,
						log: host.log,
					});
					lastNotifyCandidates = [];
				}
				const prevPv = rolloverFrom?.initialExpectedPvKwh ?? lastBaseline?.expectedPvDayKwh ?? null;
				const candidates = buildNotificationCandidates({
					plan: unifiedPlan,
					date: plan.date,
					nowIso: now.toISOString(),
					previousExpectedPvKwh:
						decision.reasons.includes("replan_pv_forecast_changed") ||
						decision.reasons.includes("replan_pv_actual_deviation")
							? prevPv
							: unifiedInputFinal.pv.previousExpectedDayEnergyKwh,
				});
				lastNotifyCandidates = mergeNotificationCandidates(lastNotifyCandidates, candidates);
				const explain = buildDeterministicDayExplanation(unifiedPlan, {
					batteryStartSocPct: unifiedInputFinal.battery.socPct,
				});
				const sess = getDayPlanSession();
				const aiCtx = buildAiExplanationContext({
					plan: unifiedPlan,
					batteryStartSocPct: unifiedInputFinal.battery.socPct,
					notificationCandidates: lastNotifyCandidates,
					replanCount: Math.max(0, (sess?.publishCount ?? 1) - 1),
					replanReasons: sess?.replanReasons ?? decision.reasons,
					initialPlanId: sess?.initialPlanId ?? null,
				});
				const globalMode = (await host.getStateAsync(GLOBAL.executionMode))?.val;
				const ihAllocated = asNum((await host.getStateAsync(IMMERSION_RUNTIME_STATES.allocatedPowerW))?.val);
				const batAllocated = asNum((await host.getStateAsync(BAT.runtime.allocatedChargePowerW))?.val);
				const wbAllocated = asNum((await host.getStateAsync(WALLBOX_RUNTIME_STATES.allocatedPowerW))?.val);
				let acAllocatedSum = 0;
				let acAllocatedAny = false;
				const acRunning: boolean[] = [];
				for (let u = 1; u <= AC_UNIT_COUNT; u++) {
					const ids = acUnitRuntimeStates(u);
					const aw = asNum((await host.getStateAsync(ids.allocatedPowerW))?.val);
					if (aw != null) {
						acAllocatedSum += aw;
						acAllocatedAny = true;
					}
					acRunning.push((await host.getStateAsync(ids.running))?.val === true);
				}
				const agendaExecution = buildAgendaExecutionHints({
					globalMode,
					addonModes: {
						wallbox: (await host.getStateAsync(addonMode("wallbox")))?.val,
						battery: (await host.getStateAsync(addonMode("battery")))?.val,
						immersion_heater: (await host.getStateAsync(addonMode("immersion_heater")))?.val,
						air_conditioning: (await host.getStateAsync(addonMode("air_conditioning")))?.val,
					},
					hardware: {
						immersion: {
							feedbackStage: asNum((await host.getStateAsync(IMMERSION_RUNTIME_STATES.feedbackStage))?.val),
							measuredPowerW: asNum((await host.getStateAsync(IMMERSION_RUNTIME_STATES.measuredPowerW))?.val),
							commandedPowerW: asNum((await host.getStateAsync(IMMERSION_RUNTIME_STATES.commandedPowerW))?.val),
							allocatedPowerW: ihAllocated,
						},
						battery: {
							chargingPowerW: asNum((await host.getStateAsync(BAT.telemetry.chargingPowerW))?.val),
							allocatedChargePowerW: batAllocated,
						},
						wallbox: {
							charging: (await host.getStateAsync(WALLBOX_EVCC_STATES.charging))?.val === true,
							chargePowerW: asNum((await host.getStateAsync(WALLBOX_EVCC_STATES.chargePowerW))?.val),
							allocatedPowerW: wbAllocated,
						},
						climate: {
							unitRunning: acRunning,
							allocatedPowerW: acAllocatedAny ? acAllocatedSum : null,
						},
					},
					nowMs: now.getTime(),
				});
				const strategy = buildAddonStrategicPlanSnapshot({
					plan: unifiedPlan,
					plannerInput: unifiedInputFinal,
					nowMs: now.getTime(),
					generatedAtIso: now.toISOString(),
				});
				const productSummary = buildProductSummaryDe(unifiedPlan, {
					batteryStartSocPct: unifiedInputFinal.battery.socPct,
					execution: agendaExecution,
					strategy,
				});
				await setStateIfChanged(host, "operator.product_summary_de", productSummary);
				await setStateIfChanged(
					host,
					"operator.plan.battery_strategy_de",
					`${strategy.battery.summaryDe}. ${strategy.battery.reasonDe}`,
				);
				await setStateIfChanged(
					host,
					"operator.plan.wallbox_strategy_de",
					`${strategy.wallbox.summaryDe}. ${strategy.wallbox.reasonDe}`,
				);
				const notifySurface = buildProductNotificationSurface(
					lastNotifyCandidates,
					now.toISOString(),
				);
				await setStateIfChanged(
					host,
					"operator.notification.last_reason_de",
					notifySurface.lastReasonDe ?? "",
				);
				await setStateIfChanged(
					host,
					"operator.notification.last_severity",
					notifySurface.lastSeverity ?? "",
				);
				await setStateIfChanged(
					host,
					"operator.notification.last_at",
					notifySurface.lastCreatedAtIso ?? "",
				);
				if (dayEvalDir) {
					await atomicWriteFile(
						path.join(dayEvalDir, "latest_explain_v1.json"),
						`${JSON.stringify({ explain, aiContext: aiCtx, notifications: lastNotifyCandidates, productSummary }, null, 2)}\n`,
					);
				}
			} catch (e) {
				host.log?.warn?.(`day_evaluation/explain/notify: ${String(e)}`);
			}

			const pub = buildUnifiedDispatchPublish(unifiedPlan);
			plan = recomputeDailyPlanSlotRemainings(
				applyUnifiedDayAuthority(
					plan,
					{
						immersionEntries: pub.immersionEntries,
						climateEntries: pub.climateEntries,
						batteryEntries: pub.batteryEntries,
						wallboxEntries: pub.wallboxEntries,
					},
					{
						dailyPlanRevision: plan.revision,
						unifiedPlanId: unifiedPlan.planId,
					},
				),
			);
			ihAcReasonSuffix =
				` ${summarizeUnifiedDayPlanForReason(unifiedPlan)} IH/AC/Battery/Wallbox autoritativ` +
				(decision.reasons.length ? ` [${decision.reasons.join(",")}]` : "") +
				` replansToday=${replanCountToday}.`;
		} catch (e) {
			/*
			 * Replan fehlgeschlagen: keine neue Unified-Generation.
			 * IH/Battery/Wallbox: im Zweifel idle (kein veralteter energetischer Slice).
			 * AC: planbasierten Flex leeren bei Komfortbedarf → lokaler Runtime-Komfort-Pfad.
			 * Wallbox: EMS-Intent idle — EVCC bleibt manuell bedienbar.
			 * Wenn Restplan noch sicher: nichts publishen (letzter Publish bleibt).
			 */
			host.log?.warn?.(`unified day replan failed — assess rest safety: ${String(e)}`);
			const disposition = assessUnifiedReplanFailure({
				nowMs: now.getTime(),
				lastUnifiedPlan,
				actual: actualSample,
				thermal: probeInput.thermal,
				climate: probeInput.climate,
				battery: probeInput.battery,
				wallbox: probeInput.wallbox,
				replanReasons: decision.reasons,
			});
			ihAcReasonSuffix = ` ${disposition.reasonDe}`;
			if (
				!disposition.clearImmersion &&
				!disposition.clearClimate &&
				!disposition.clearBattery &&
				!disposition.clearWallbox
			) {
				// FAIL-003: Restplan weiter gültig — kein Authority-Publish, keine neue Generation.
				return plan;
			}
			plan = recomputeDailyPlanSlotRemainings(
				applyReplanFailureAuthority(plan, lastUnifiedPlan, disposition),
			);
			const trimFuture = (kind: string) => {
				if (!lastUnifiedPlan) return;
				const nowMs = now.getTime();
				lastUnifiedPlan = {
					...lastUnifiedPlan,
					allocations: lastUnifiedPlan.allocations.filter(
						(a) =>
							a.kind !== kind ||
							!(Number.isFinite(Date.parse(a.slot.endIso)) && Date.parse(a.slot.endIso) > nowMs),
					),
				};
			};
			if (disposition.clearImmersion) trimFuture("immersion_heater");
			if (disposition.clearClimate) {
				trimFuture("climate");
				trimFuture("air_conditioning");
			}
			if (disposition.clearBattery) trimFuture("battery_charge");
			if (disposition.clearWallbox) trimFuture("wallbox");
		}

		const publishReasonDe = `${plan.reasonDe}${ihAcReasonSuffix}`.slice(0, 480);

		await setStateIfChanged(host, DAILY_PLAN_STATE_IDS.status, plan.status);
		await setStateIfChanged(host, DAILY_PLAN_STATE_IDS.generatedAt, plan.generatedAt);
		await setStateIfChanged(host, DAILY_PLAN_STATE_IDS.validUntil, plan.validUntil ?? "");
		await setStateIfChanged(host, DAILY_PLAN_STATE_IDS.date, plan.date);
		await setStateIfChanged(host, DAILY_PLAN_STATE_IDS.planJson, JSON.stringify(plan));
		await setStateIfChanged(host, DAILY_PLAN_STATE_IDS.reasonDe, publishReasonDe);
		await setOptionalNumberIfChanged(host, DAILY_PLAN_STATE_IDS.revision, revision);

		const aiThinkingRaw = await host.getStateAsync(AI_STATES.lastThinkingDe);
		const aiThinkingDe =
			typeof aiThinkingRaw?.val === "string" && aiThinkingRaw.val.trim() ? aiThinkingRaw.val.trim() : null;
		await setStateIfChanged(
			host,
			"operator.briefing_de",
			buildOperatorBriefingDe(plan, now, timezone, {
				contributions: forecastPlan.contributions,
				aiThinkingDe,
			}),
		);

		try {
			const globalMode = (await host.getStateAsync(GLOBAL.executionMode))?.val;
			const eff = buildEffectiveExecutionSnapshot({
				globalMode,
				addonModes: {
					wallbox: (await host.getStateAsync(addonMode("wallbox")))?.val,
					battery: (await host.getStateAsync(addonMode("battery")))?.val,
					immersion_heater: (await host.getStateAsync(addonMode("immersion_heater")))?.val,
					air_conditioning: (await host.getStateAsync(addonMode("air_conditioning")))?.val,
				},
			});
			await setStateIfChanged(host, "operator.execution.effective_json", JSON.stringify(eff));
			await setStateIfChanged(host, "operator.execution.summary_de", eff.summaryDe);
		} catch (e) {
			host.log?.warn?.(`operator.execution effective: ${String(e)}`);
		}

		// Finale Addon-Slices aus dem (bereits gemergten) Plan — eine Wahrheit.
		const addonSummaries: Array<{ key: keyof typeof ALLOCATION_ADDON_STATE_IDS; prefix: string }> = [
			{ key: "battery", prefix: "battery" },
			{ key: "wallbox", prefix: "wallbox" },
			{ key: "immersion_heater", prefix: "immersion_heater" },
			{ key: "air_conditioning", prefix: "air_conditioning" },
		];

		for (const { key, prefix } of addonSummaries) {
			const ids = ALLOCATION_ADDON_STATE_IDS[key];
			const view = addonAllocationPublishView(plan, prefix);
			let reasonDe = view.reasonDe;
			if (
				key === "immersion_heater" ||
				key === "air_conditioning" ||
				key === "battery" ||
				key === "wallbox"
			) {
				reasonDe = ihAcReasonSuffix.trim()
					? `${view.reasonDe} ${ihAcReasonSuffix.trim()}`
					: view.reasonDe;
			}
			await setStateIfChanged(host, ids.status, view.status);
			await setStateIfChanged(host, ids.planJson, JSON.stringify(view.runnable));
			await setStateIfChanged(host, ids.reasonDe, reasonDe.slice(0, 480));
		}

		/*
		 * Heizstab-Zielautorität (Befund 004): Effective-/Forecast-Ziel an Allocation-States
		 * derselben Daily-Plan-Revision. Runtime/FSM ist alleiniger Writer von
		 * runtime.plan_target_temp_c — kein zweiter Writer mehr.
		 */
		const ihFlex = forecastPlan.contributions.find(
			(c) => c.contributionId === CONTRIBUTION_IDS.IMMERSION_FLEXIBLE,
		);
		const ihMand = forecastPlan.contributions.find(
			(c) => c.contributionId === CONTRIBUTION_IDS.IMMERSION_MANDATORY,
		);
		const ihDetails = ihFlex?.details ?? ihMand?.details ?? null;
		const ihAlloc = ALLOCATION_ADDON_STATE_IDS.immersion_heater;
		const effectiveTarget =
			ihDetails && typeof ihDetails.targetTempC === "number" && Number.isFinite(ihDetails.targetTempC)
				? ihDetails.targetTempC
				: null;
		const forecastTarget =
			ihDetails &&
			typeof ihDetails.forecastTargetTempC === "number" &&
			Number.isFinite(ihDetails.forecastTargetTempC)
				? ihDetails.forecastTargetTempC
				: null;
		const targetReason =
			ihDetails && typeof ihDetails.targetReasonDe === "string" && ihDetails.targetReasonDe.trim()
				? ihDetails.targetReasonDe.trim()
				: typeof ihFlex?.reasonDe === "string" && ihFlex.reasonDe.trim()
					? ihFlex.reasonDe.trim()
					: effectiveTarget !== null
						? `Unified-Plan-Ziel ${effectiveTarget} °C.`
						: "";
		await setOptionalNumberIfChanged(host, ihAlloc.effectiveTargetTempC, effectiveTarget);
		await setOptionalNumberIfChanged(host, ihAlloc.forecastTargetTempC, forecastTarget);
		await setStateIfChanged(host, ihAlloc.targetReasonDe, targetReason.slice(0, 480));
		await setOptionalNumberIfChanged(host, ihAlloc.targetRevision, plan.revision);

		resetImmersionDailyPlanCache();
		resetAcDailyPlanCache();
		resetBatteryDailyPlanCache();
		resetWallboxDailyPlanCache();
	} catch (e) {
		host.log?.warn?.(`daily plan state write: ${String(e)}`);
		try {
			await setStateIfChanged(host, DAILY_PLAN_STATE_IDS.status, "error");
			await setStateIfChanged(
				host,
				DAILY_PLAN_STATE_IDS.reasonDe,
				`Daily Plan Fehler: ${String(e)}`.slice(0, 480),
			);
		} catch {
			// ignore
		}
	}

	return plan;
}
