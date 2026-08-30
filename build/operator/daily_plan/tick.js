"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || function (mod) {
    if (mod && mod.__esModule) return mod;
    var result = {};
    if (mod != null) for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
    __setModuleDefault(result, mod);
    return result;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.runDailyPlanTick = exports.lastUnifiedPlanIdForTest = exports.unifiedPlanGenerationForTest = exports.dailyPlanRevisionForTest = exports.noteStartupLiveSurplusPreferResultForTest = exports.startupLiveSurplusPreferAvailableForTest = exports.resetDailyPlanRevisionForTest = exports.invalidatePublishedPlanForAddonOff = exports.requestForcedUnifiedReplan = void 0;
const config_1 = require("../../policy/global/config");
const config_2 = require("../../intent/config");
const mode_policy_1 = require("../../planner/mode_policy");
const state_write_1 = require("../../policy/core/state_write");
const build_1 = require("./build");
const briefing_1 = require("./briefing");
const live_surplus_1 = require("./live_surplus");
const addon_plan_publish_1 = require("./addon_plan_publish");
const states_1 = require("./states");
const battery_consumers_1 = require("../../policy/battery_consumers");
const battery_discharge_authority_1 = require("./battery_discharge_authority");
const battery_opportunity_cost_1 = require("./battery_opportunity_cost");
const block_a_learning_bridge_1 = require("./block_a_learning_bridge");
const battery_reserve_learning_1 = require("./battery_reserve_learning");
const battery_reserve_target_1 = require("./battery_reserve_target");
const forecast_reserve_slots_1 = require("./forecast_reserve_slots");
const device_config_1 = require("../../addons/immersion_heater/device_config");
const types_1 = require("../../addons/immersion_heater/runtime/types");
const state_util_1 = require("../../ems_light/state_util");
const ensure_states_1 = require("../../ai/ensure_states");
const battery_1 = require("../planning/battery");
const ensure_evcc_states_1 = require("../../addons/wallbox/ensure_evcc_states");
const states_2 = require("../../addons/wallbox/runtime/states");
const evcc_config_1 = require("../../addons/wallbox/evcc_config");
const charge_hold_1 = require("../../addons/wallbox/charge_hold");
const normalize_1 = require("../../addons/wallbox/normalize");
const contribution_ids_1 = require("../contribution_ids");
const ensure_states_2 = require("../../addons/battery/ensure_states");
const ensure_states_3 = require("../../addons/air_conditioning/runtime/ensure_states");
const constants_1 = require("../../addons/air_conditioning/constants");
const allocate_1 = require("./unified/allocate");
const authority_1 = require("./unified/authority");
const dispatch_bridge_1 = require("./unified/dispatch_bridge");
const ev_planner_publish_1 = require("./unified/ev_planner_publish");
const from_forecast_context_1 = require("./unified/from_forecast_context");
const cadence_1 = require("./unified/cadence");
const materiality_1 = require("./unified/materiality");
const reason_codes_1 = require("./unified/reason_codes");
const replan_failure_1 = require("./unified/replan_failure");
const trigger_digest_1 = require("../../ai/trigger_digest");
const daily_plan_1 = require("../../addons/immersion_heater/runtime/daily_plan");
const daily_plan_2 = require("../../addons/air_conditioning/runtime/daily_plan");
const daily_plan_3 = require("../../addons/battery/runtime/daily_plan");
const daily_plan_4 = require("../../addons/wallbox/runtime/daily_plan");
const limits_1 = require("../../addons/battery/core/limits");
const vehicle_presence_1 = require("../../learning/vehicle_presence");
const vehicle_availability_1 = require("./unified/vehicle_availability");
const config_3 = require("../../addons/wallbox/vehicle_map/config");
const lookup_1 = require("../../addons/wallbox/vehicle_map/lookup");
const session_1 = require("../../learning/day_evaluation/session");
const explain_1 = require("../../learning/day_evaluation/explain");
const notify_1 = require("../../learning/day_evaluation/notify");
const context_1 = require("../../ai/explanation/context");
const product_summary_1 = require("../../beta/product_summary");
const notification_surface_1 = require("../../beta/notification_surface");
const execution_effective_1 = require("../../beta/execution_effective");
const execution_display_1 = require("../../beta/execution_display");
const strategic_status_1 = require("../../beta/strategic_status");
const recompute_remainings_1 = require("./recompute_remainings");
const tree_paths_1 = require("../../tree_paths");
const atomic_write_1 = require("../../persistence/atomic_write");
const path = __importStar(require("node:path"));
const invalidate_addon_off_1 = require("./invalidate_addon_off");
const config_4 = require("../../addons/battery/config");
const passive_battery_energy_1 = require("./unified/passive_battery_energy");
let lastRevisionPayload = "";
let revision = 0;
/** Material-Cadence: ohne relevanten Grund kein neuer Unified-/Tagesplan-Publish. */
let lastCadenceDigest = "";
let unifiedGeneration = 0;
let lastUnifiedPlanId = "";
let lastUnifiedPlan = null;
let lastBaseline = null;
let lastReplanAtMs = null;
let replanCountToday = 0;
let replanCountDate = "";
/** Befund 005: Mode-Wechsel erzwingt frischen Replan (keine stale Allocation). */
let forcedReplanReasons = [];
/** One-Plan: Live-Surplus nur als Allocator-Hinweis (NOW-Slot), kein Runtime-Seitenkanal. */
function preferImmersionLiveSurplusNowFrom(input) {
    const minW = input.minPowerW != null && input.minPowerW > 0 ? input.minPowerW : 1700;
    const ih = Math.max(0, input.immersionOnPowerW ?? 0);
    const surplus = (input.livePvPowerW ?? 0) - (input.liveHouseLoadW ?? 0) + ih;
    const head = input.thermalHeadroomKwh ?? 0;
    const soc = input.socPct ?? 0;
    return head > 0.25 && surplus + 1 >= minW * 0.95 && soc >= 90;
}
function immersionSoftActiveInCurrentSlot(plan, nowMs) {
    if (!plan)
        return false;
    for (const a of plan.allocations) {
        if (a.kind !== "immersion_heater")
            continue;
        if (!(a.allocatedPowerW >= 50))
            continue;
        const s = Date.parse(a.slot.startIso);
        const e = Date.parse(a.slot.endIso);
        if (!Number.isFinite(s) || !Number.isFinite(e))
            continue;
        if (s < nowMs && e > nowMs)
            return true;
    }
    return false;
}
/**
 * Nach OFF↔DRYRUN/LIVE: Baseline/Cache verwerfen und nächsten Tick material replanen.
 */
function requestForcedUnifiedReplan(reason) {
    const r = reason.trim() || "replan_forced";
    forcedReplanReasons.push(r);
    lastBaseline = null;
    lastUnifiedPlan = null;
    lastCadenceDigest = "";
    lastRevisionPayload = "";
}
exports.requestForcedUnifiedReplan = requestForcedUnifiedReplan;
/**
 * Sofortige Invalidierung der aktiven Plan-Darstellung für ein Add-on auf OFF.
 * Historische Compare-Dateien bleiben; publizierte Allocation/Agenda werden geleert.
 */
async function setPlanState(host, id, val) {
    const cur = await host.getStateAsync(id);
    if (cur?.val === val)
        return;
    await host.setStateAsync(id, { val, ack: true });
}
async function invalidatePublishedPlanForAddonOff(host, addonId) {
    const offReason = (0, execution_display_1.addonOffSummaryDe)(addonId);
    if (lastUnifiedPlan) {
        lastUnifiedPlan = (0, invalidate_addon_off_1.stripAddonFromUnifiedPlan)(lastUnifiedPlan, addonId);
    }
    try {
        const planRaw = await host.getStateAsync(states_1.DAILY_PLAN_STATE_IDS.planJson);
        const planStr = typeof planRaw?.val === "string" ? planRaw.val : "";
        if (planStr.trim() && planStr.trim() !== "{}") {
            const parsed = JSON.parse(planStr);
            if (parsed && Array.isArray(parsed.allocations)) {
                const stripped = (0, invalidate_addon_off_1.stripAddonFromDailyPlan)(parsed, addonId);
                await setPlanState(host, states_1.DAILY_PLAN_STATE_IDS.planJson, JSON.stringify(stripped));
            }
        }
    }
    catch (e) {
        host.log?.warn?.(`invalidate addon off (daily plan_json): ${String(e)}`);
    }
    const allocIds = states_1.ALLOCATION_ADDON_STATE_IDS[addonId];
    if (allocIds) {
        await setPlanState(host, allocIds.planJson, "[]");
        await setPlanState(host, allocIds.status, "idle");
        await setPlanState(host, allocIds.reasonDe, offReason);
    }
    // Runtime-Allocation-Anzeige sofort neutralisieren (Steuerung ohnehin OFF-gegated).
    try {
        if (addonId === "immersion_heater") {
            await setPlanState(host, types_1.IMMERSION_RUNTIME_STATES.allocatedPowerW, null);
        }
        else if (addonId === "battery") {
            await setPlanState(host, ensure_states_2.BAT.runtime.allocatedChargePowerW, null);
        }
        else if (addonId === "wallbox") {
            await setPlanState(host, states_2.WALLBOX_RUNTIME_STATES.allocatedPowerW, null);
        }
        else if (addonId === "air_conditioning") {
            for (let u = 1; u <= constants_1.AC_UNIT_COUNT; u++) {
                await setPlanState(host, (0, ensure_states_3.acUnitRuntimeStates)(u).allocatedPowerW, null);
            }
        }
    }
    catch (e) {
        host.log?.warn?.(`invalidate addon off (runtime alloc): ${String(e)}`);
    }
    try {
        const globalMode = (await host.getStateAsync(tree_paths_1.GLOBAL.executionMode))?.val;
        const modes = {
            wallbox: (await host.getStateAsync((0, tree_paths_1.addonMode)("wallbox")))?.val,
            battery: (await host.getStateAsync((0, tree_paths_1.addonMode)("battery")))?.val,
            immersion_heater: (await host.getStateAsync((0, tree_paths_1.addonMode)("immersion_heater")))?.val,
            air_conditioning: (await host.getStateAsync((0, tree_paths_1.addonMode)("air_conditioning")))?.val,
        };
        modes[addonId] = "off";
        const agendaExecution = (0, execution_display_1.buildAgendaExecutionHints)({
            globalMode,
            addonModes: modes,
            hardware: {},
            nowMs: Date.now(),
        });
        if (lastUnifiedPlan) {
            const productSummary = (0, product_summary_1.buildProductSummaryDe)(lastUnifiedPlan, {
                batteryStartSocPct: null,
                execution: agendaExecution,
            });
            await setPlanState(host, "operator.product_summary_de", productSummary);
        }
        else {
            await setPlanState(host, "operator.product_summary_de", `Plan: ${offReason}.`);
        }
        host.log?.info?.(`Add-on ${addonId} Aus — aktive Plan-Darstellung sofort invalidiert`);
    }
    catch (e) {
        host.log?.warn?.(`invalidate addon off (product summary): ${String(e)}`);
    }
}
exports.invalidatePublishedPlanForAddonOff = invalidatePublishedPlanForAddonOff;
function resetDailyPlanRevisionForTest() {
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
    (0, session_1.resetDayPlanSessionForTest)();
    lastNotifyCandidates = [];
}
exports.resetDailyPlanRevisionForTest = resetDailyPlanRevisionForTest;
/** Test-Hook: Startup-One-Shot noch verfügbar? */
function startupLiveSurplusPreferAvailableForTest() {
    return false;
}
exports.startupLiveSurplusPreferAvailableForTest = startupLiveSurplusPreferAvailableForTest;
/**
 * Test-Hook: spiegelt Tick-Verbrauch — Flag nur bei erfolgreichem Startup-Bypass.
 * Production: identisch zu `if (surplusReplan.startupStabilityBypassApplied)`.
 */
function noteStartupLiveSurplusPreferResultForTest(startupStabilityBypassApplied) {
    void startupStabilityBypassApplied;
}
exports.noteStartupLiveSurplusPreferResultForTest = noteStartupLiveSurplusPreferResultForTest;
/** Deduplizierte Notification-Candidates des laufenden Tages (kein Push). */
let lastNotifyCandidates = [];
function dailyPlanRevisionForTest() {
    return revision;
}
exports.dailyPlanRevisionForTest = dailyPlanRevisionForTest;
/** Test-Hook: wie oft Unified allocate+publish seit Reset gelaufen ist. */
function unifiedPlanGenerationForTest() {
    return unifiedGeneration;
}
exports.unifiedPlanGenerationForTest = unifiedPlanGenerationForTest;
function lastUnifiedPlanIdForTest() {
    return lastUnifiedPlanId;
}
exports.lastUnifiedPlanIdForTest = lastUnifiedPlanIdForTest;
async function readStr(host, relId) {
    try {
        const st = await host.getStateAsync(relId);
        if (st?.val == null || st.val === "")
            return null;
        return String(st.val);
    }
    catch {
        return null;
    }
}
async function readEffectivePolicy(host) {
    const raw = await readStr(host, "policy.global.effective_json");
    if (!raw)
        return null;
    try {
        return JSON.parse(raw);
    }
    catch {
        return null;
    }
}
function policyBool(snapshot, key) {
    const entry = snapshot?.economics?.[key];
    if (!entry || entry.value === null || typeof entry.value !== "boolean")
        return null;
    return entry.value;
}
function policyNumber(snapshot, key) {
    const entry = snapshot?.limits?.[key];
    if (!entry || entry.value === null)
        return null;
    const n = typeof entry.value === "number" ? entry.value : parseFloat(String(entry.value));
    return Number.isFinite(n) ? n : null;
}
function policyStringArray(snapshot, key) {
    const entry = snapshot?.preferences?.[key];
    if (!entry || !Array.isArray(entry.value))
        return null;
    return entry.value.filter((v) => typeof v === "string");
}
async function runDailyPlanTick(host, forecastPlan) {
    const now = new Date();
    /*
     * BLOCK B — Learned Planner: Read-Only-Bridge zum eingefrorenen Block-A-Learning-State
     * (`learning/daily_evaluator/learning_state_v1.json`). Wird NIE geschrieben/verändert.
     * Fehlt/kaputt/Host ohne Pfad-Unterstützung → leerer Snapshot (usable=false in jedem
     * nachgelagerten Learning Gate, exakt bisheriges Planner-Verhalten).
     */
    const blockALearning = await (0, block_a_learning_bridge_1.loadBlockALearningSnapshot)(host);
    const adminCfg = (0, config_2.intentAdminConfigFromAdapter)(host.config);
    const timezone = adminCfg.timezone || "Europe/Berlin";
    const globalModeRaw = (await readStr(host, "global_modes.active")) ?? "balanced";
    const modePolicy = (0, mode_policy_1.plannerModePolicyFromGlobalMode)(globalModeRaw);
    const adminPolicy = (0, config_1.globalPolicyConfigFromAdapter)(host.config);
    const effectivePolicy = await readEffectivePolicy(host);
    const energyPriority = policyStringArray(effectivePolicy, "energyPriority") ?? adminPolicy.energyPriority ?? [];
    const mutualRaw = effectivePolicy?.protection?.mutualExclusions?.value;
    const mutualExclusions = Array.isArray(mutualRaw)
        ? mutualRaw
        : adminPolicy.mutualExclusions ?? [];
    const batConsumers = (0, battery_consumers_1.batteryConsumersConfigFromAdapter)(host.config);
    const immersionCfg = (0, device_config_1.immersionDeviceConfigFromAdapter)(host.config);
    const socPct = (0, state_util_1.asNum)((await host.getStateAsync("live.battery.soc_pct"))?.val);
    const bufferTempC = (0, state_util_1.asNum)((await host.getStateAsync("live.thermal.buffer_temp_c"))?.val);
    const evccMode = await readStr(host, ensure_evcc_states_1.WALLBOX_EVCC_STATES.batteryMode);
    const evccDischargeRaw = await host.getStateAsync(ensure_evcc_states_1.WALLBOX_EVCC_STATES.batteryDischargeControl);
    const evccDischarge = evccDischargeRaw?.val === true;
    const batteryBoostRaw = await host.getStateAsync(ensure_evcc_states_1.WALLBOX_EVCC_STATES.batteryBoost);
    const batteryBoost = batteryBoostRaw?.val === true ? true : batteryBoostRaw?.val === false ? false : null;
    const loadpointMode = await readStr(host, ensure_evcc_states_1.WALLBOX_EVCC_STATES.loadpointMode);
    const evccConnectedRaw = await host.getStateAsync(ensure_evcc_states_1.WALLBOX_EVCC_STATES.connected);
    const evccConnectedNow = evccConnectedRaw?.val === true ? true : evccConnectedRaw?.val === false ? false : null;
    const evccChargingRaw = await host.getStateAsync(ensure_evcc_states_1.WALLBOX_EVCC_STATES.charging);
    const evccChargingNow = evccChargingRaw?.val === true ? true : evccChargingRaw?.val === false ? false : null;
    const evccChargePowerNow = (0, state_util_1.asNum)((await host.getStateAsync(ensure_evcc_states_1.WALLBOX_EVCC_STATES.chargePowerW))?.val);
    const holdSignals = (0, evcc_config_1.wallboxHoldSignalConfigFromAdapter)(host.config);
    let externalVehicleChargeRaw = null;
    if (holdSignals.externalVehicleChargeStateId) {
        try {
            const st = await host.getForeignStateAsync?.(holdSignals.externalVehicleChargeStateId);
            if (st?.val !== undefined && st.val !== null) {
                externalVehicleChargeRaw =
                    typeof st.val === "boolean" ? st.val : String(st.val);
            }
        }
        catch {
            externalVehicleChargeRaw = null;
        }
    }
    let tibberGridRewardsActive = null;
    if (holdSignals.tibberGridRewardsActiveStateId) {
        try {
            const st = await host.getForeignStateAsync?.(holdSignals.tibberGridRewardsActiveStateId);
            const n = (0, normalize_1.normalizeOptionalBool)(st?.val);
            tibberGridRewardsActive = n.status === "valid" ? n.value : null;
        }
        catch {
            tibberGridRewardsActive = null;
        }
    }
    const wallboxHold = (0, charge_hold_1.resolveWallboxBatteryHold)({
        vehicleConnected: evccConnectedNow,
        charging: evccChargingNow,
        chargePowerW: evccChargePowerNow,
        batteryBoost,
        loadpointMode,
        externalVehicleChargeRaw,
        tibberGridRewardsActive,
    });
    try {
        await (0, state_write_1.setStateIfChanged)(host, states_2.WALLBOX_RUNTIME_STATES.batteryHoldForEvCharge, wallboxHold.hold);
        await (0, state_write_1.setStateIfChanged)(host, states_2.WALLBOX_RUNTIME_STATES.batteryHoldReasonDe, wallboxHold.reasonDe);
        await (0, state_write_1.setStateIfChanged)(host, states_2.WALLBOX_RUNTIME_STATES.externalVehicleChargeActive, wallboxHold.externalActive);
        await (0, state_write_1.setStateIfChanged)(host, states_2.WALLBOX_RUNTIME_STATES.tibberGridRewardsActive, wallboxHold.tibberRewardsActive);
    }
    catch {
        // hold publish best-effort
    }
    const batteryIntentRaw = await readStr(host, "user_intent.battery.resolved_json");
    let userHold = false;
    if (batteryIntentRaw) {
        try {
            const parsed = JSON.parse(batteryIntentRaw);
            userHold = parsed.operating_request?.value === "hold";
        }
        catch {
            userHold = false;
        }
    }
    const hold = (0, battery_1.buildPlannerConstraints)({
        evccBatteryMode: evccMode,
        evccBatteryDischargeControl: evccDischarge,
        userIntentBatteryHold: userHold,
        wallboxChargeHold: wallboxHold.hold,
        wallboxChargeHoldReasonDe: wallboxHold.reasonDe,
    });
    const batCfgModes = (0, config_4.batteryConfigFromAdapter)(host.config);
    const batOperatingMode = (0, state_util_1.asNum)((await host.getStateAsync(ensure_states_2.BAT.telemetry.operatingMode))?.val);
    const batOwnershipActive = (await host.getStateAsync(ensure_states_2.BAT.runtime.ownershipActive))?.val === true;
    const passiveBatteryEnergy = (0, passive_battery_energy_1.resolvePassiveBatteryEnergyAvailable)({
        operatingMode: batOperatingMode,
        selfConsumptionModeValue: batCfgModes.sonnenModeValues.selfConsumption,
        manualModeValue: batCfgModes.sonnenModeValues.manual,
        ownershipActive: batOwnershipActive,
        batteryHoldActive: hold.battery_hold_active,
    });
    const consumerAccess = (0, battery_consumers_1.resolveAllBatteryConsumerAccess)({
        config: batConsumers,
        batteryHoldActive: hold.battery_hold_active,
        socPct,
        criticalByConsumer: {
            immersion_heater: (0, battery_consumers_1.immersionCriticalNow)(bufferTempC, immersionCfg.planningMinTempC, batConsumers.immersion_heater.criticalMarginK),
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
    const priceNowCt = (0, state_util_1.asNum)((await host.getStateAsync("live.price.now_ct_per_kwh"))?.val);
    const reserveCapacityKwh = (0, state_util_1.asNum)((await host.getStateAsync(ensure_states_2.BAT.telemetry.capacityEffectiveKwh))?.val);
    const pvConfidencePct = (0, state_util_1.asNum)((await host.getStateAsync("learning.pv_bias.confidence_pct"))?.val);
    const pvConfidence01 = pvConfidencePct === null ? null : Math.max(0.2, Math.min(1, pvConfidencePct / 100));
    const predictedNightConsumptionKwh = (0, state_util_1.asNum)((await host.getStateAsync("learning.battery_runtime.predicted_night_consumption_kwh"))?.val);
    const avgChargePowerW = (0, state_util_1.asNum)((await host.getStateAsync("learning.battery_runtime.avg_charge_power_w"))?.val);
    const batteryChargeContribution = forecastPlan.contributions.find((c) => c.contributionId === contribution_ids_1.CONTRIBUTION_IDS.BATTERY_CHARGE);
    const contributionTargetSocPct = (() => {
        const d = (batteryChargeContribution?.details ?? null);
        const v = d ? d["targetSocPct"] : null;
        return typeof v === "number" && Number.isFinite(v) ? v : null;
    })();
    const reserveSlots = (0, forecast_reserve_slots_1.buildReserveFloorSlotsFromForecastPlan)(forecastPlan);
    const centralReserve = (0, battery_reserve_target_1.resolveCentralBatteryReserveTarget)({
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
    const headroomAboveReserveKwh = socPct !== null &&
        Number.isFinite(socPct) &&
        centralReserve.requiredSocAtPvEndPct !== null &&
        reserveCapacityKwh !== null &&
        Number.isFinite(reserveCapacityKwh)
        ? ((socPct - centralReserve.requiredSocAtPvEndPct) / 100) * reserveCapacityKwh
        : null;
    const pvRemainingTodayKwh = reserveSlots
        .filter((s) => s.startMs > now.getTime())
        .reduce((sum, s) => sum + s.pvKwh, 0);
    const immersionFlexContribution = forecastPlan.contributions.find((c) => c.contributionId === contribution_ids_1.CONTRIBUTION_IDS.IMMERSION_FLEXIBLE);
    const wallboxContribution = forecastPlan.contributions.find((c) => c.contributionId === contribution_ids_1.CONTRIBUTION_IDS.WALLBOX_EV_SESSION);
    const laterDemandFromContribution = (contribution) => {
        const d = (contribution?.details ?? null);
        const v = d ? d["requiredEnergyKwh"] : null;
        return typeof v === "number" && Number.isFinite(v) ? Math.max(0, v) : 0;
    };
    const plannedLaterDemandKwh = laterDemandFromContribution(immersionFlexContribution) + laterDemandFromContribution(wallboxContribution);
    const batteryOpportunity = (0, battery_opportunity_cost_1.evaluateBatteryOpportunityCost)({
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
    const batteryReserveLearning = (0, battery_reserve_learning_1.calibrateBatteryOpportunityMargin)(blockALearning.batteryReserveAccuracyPct);
    const batteryDischargeAuthorizationInputBase = {
        priceNowCt,
        minPriceCtPerKwh: batCfgModes.gridBalance.minPriceCtPerKwh,
        socPct,
        requiredSocAtPvEndPct: centralReserve.requiredSocAtPvEndPct,
        configuredMaxDischargeW: batCfgModes.gridBalance.maxTargetW,
        opportunityCostCtPerKwh: batteryOpportunity.usable ? batteryOpportunity.opportunityCostCtPerKwh : null,
    };
    const baselineBatteryDischargeAuthorization = (0, battery_discharge_authority_1.resolveBatteryDischargeAuthorization)(batteryDischargeAuthorizationInputBase);
    const batteryDischargeAuthorization = (0, battery_discharge_authority_1.resolveBatteryDischargeAuthorization)({
        ...batteryDischargeAuthorizationInputBase,
        opportunityMarginCtPerKwh: battery_discharge_authority_1.DEFAULT_OPPORTUNITY_MARGIN_CT_PER_KWH + batteryReserveLearning.extraMarginCtPerKwh,
    });
    const batteryLearningExplanation = (0, battery_reserve_learning_1.toBatteryReserveLearningExplanation)(batteryReserveLearning, baselineBatteryDischargeAuthorization.opportunityAllowed, batteryDischargeAuthorization.opportunityAllowed);
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
        for (const w of (0, battery_consumers_1.batteryConsumerConstraintStateWrites)(consumerAccess)) {
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
    }
    catch {
        // constraint publish best-effort
    }
    const pvStateEarly = await host.getStateAsync("live.pv.power_w");
    const pvBatStateEarly = await host.getStateAsync("live.battery.pv_ac_power_w");
    const houseStateEarly = await host.getStateAsync("live.battery.house_load_w");
    const pvFromPvEarly = (0, state_util_1.asNum)(pvStateEarly?.val);
    const pvFromBatteryEarly = (0, state_util_1.asNum)(pvBatStateEarly?.val);
    const livePvPowerW = pvFromPvEarly ?? pvFromBatteryEarly;
    const liveHouseLoadW = (0, state_util_1.asNum)(houseStateEarly?.val);
    const nowMsEarly = now.getTime();
    const ageSec = (st) => {
        const ts = typeof st?.ts === "number" ? st.ts : null;
        if (ts === null || !Number.isFinite(ts))
            return null;
        return Math.max(0, Math.round((nowMsEarly - ts) / 1000));
    };
    const liveSurplusEarly = (0, live_surplus_1.buildOperatorLiveSurplus)({
        pvPowerW: livePvPowerW,
        houseLoadW: liveHouseLoadW,
        now,
        timezone,
    });
    let plan = (0, build_1.buildDailyPlanFromForecast)(now, timezone, modePolicy.mode, forecastPlan, {
        policySnapshot: effectivePolicy,
        energyPriority,
        mutualExclusions,
        gridImportAllowedPolicy: policyBool(effectivePolicy, "gridImportAllowed") ?? adminPolicy.gridImportAllowed,
        effectiveMaxGridImportW: policyNumber(effectivePolicy, "maxGridImportW") ?? adminPolicy.maxGridImportW,
        configuredHouseFuseLimitW: policyNumber(effectivePolicy, "houseFuseLimitW") ?? adminPolicy.houseFuseLimitW,
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
    const payload = (0, build_1.dailyPlanRevisionPayload)(plan);
    if (payload !== lastRevisionPayload) {
        revision += 1;
        lastRevisionPayload = payload;
    }
    plan.revision = revision;
    const cadenceDigest = (0, cadence_1.unifiedPlanCadenceDigest)(plan);
    // Live-Diagnose darf jeden Tick — Tagesplan/Unified nur bei Material-Replan.
    try {
        await (0, state_write_1.setOptionalNumberIfChanged)(host, "operator.diagnostics.surplus_w", liveSurplusEarly.surplusW);
        await (0, state_write_1.setOptionalNumberIfChanged)(host, "operator.diagnostics.deficit_w", liveSurplusEarly.deficitW);
        await (0, state_write_1.setStateIfChanged)(host, "operator.diagnostics.slot_start_iso", liveSurplusEarly.slotStartIso ?? "");
    }
    catch {
        // best-effort
    }
    const bufferSt = await host.getStateAsync(types_1.IMMERSION_RUNTIME_STATES.bufferTemperatureC);
    const batSocSt = await host.getStateAsync(ensure_states_2.BAT.telemetry.socPct);
    const batCap = (0, state_util_1.asNum)((await host.getStateAsync(ensure_states_2.BAT.telemetry.capacityEffectiveKwh))?.val);
    const hw = (0, limits_1.hardwareLimitsFromConfig)(host.config);
    const roomTemps = {};
    for (let u = 1; u <= constants_1.AC_UNIT_COUNT; u++) {
        roomTemps[u] = (0, state_util_1.asNum)((await host.getStateAsync((0, ensure_states_3.acUnitRuntimeStates)(u).roomTempC))?.val);
    }
    const realizedPv = (0, state_util_1.asNum)((await host.getStateAsync("learning.energy_daily.pv_kwh"))?.val);
    const wbConnectedRaw = await host.getStateAsync(ensure_evcc_states_1.WALLBOX_EVCC_STATES.connected);
    const wbConnected = wbConnectedRaw?.val === true ? true : wbConnectedRaw?.val === false ? false : null;
    const absPath = host.getAbsolutePath;
    const presenceDir = typeof absPath === "function" ? absPath("learning/vehicle_presence") : null;
    let presenceStore = await (0, vehicle_presence_1.loadOrEmptyVehiclePresenceStore)(presenceDir);
    const vehicleName = await readStr(host, ensure_evcc_states_1.WALLBOX_EVCC_STATES.vehicleName);
    const vehicleTitle = await readStr(host, ensure_evcc_states_1.WALLBOX_EVCC_STATES.vehicleTitle);
    const mapEntry = (0, lookup_1.lookupVehicleMapEntry)((0, config_3.wallboxVehicleMapFromAdapter)(host.config).entries, vehicleName, vehicleTitle);
    // Ohne Map-Treffer: keine erfundene ID — Learning/Prediction aussetzen.
    const presenceVehicleKey = mapEntry?.evccVehicleId ?? null;
    if (wbConnected !== null && presenceVehicleKey) {
        const nextStore = (0, vehicle_presence_1.observeConnected)(presenceStore, now.getTime(), timezone, wbConnected, presenceVehicleKey);
        if (nextStore !== presenceStore && presenceDir) {
            try {
                await (0, vehicle_presence_1.writeVehiclePresencePersist)(presenceDir, nextStore);
            }
            catch (e) {
                host.log?.warn?.(`vehicle_presence persist: ${String(e)}`);
            }
        }
        presenceStore = nextStore;
    }
    const acRuntime = [];
    for (let u = 1; u <= constants_1.AC_UNIT_COUNT; u++) {
        const ids = (0, ensure_states_3.acUnitRuntimeStates)(u);
        acRuntime.push({
            unitIndex: u,
            running: (await host.getStateAsync(ids.running))?.val === true,
            decisionSource: String((await host.getStateAsync(ids.decisionSource))?.val ?? "") || null,
            allocatedPowerW: (0, state_util_1.asNum)((await host.getStateAsync(ids.allocatedPowerW))?.val),
            estimatedPowerW: (0, state_util_1.asNum)((await host.getStateAsync(ids.estimatedPowerW))?.val),
        });
    }
    const feedInCtPerKwh = (0, from_forecast_context_1.normalizeFeedInCtPerKwh)((0, state_util_1.asNum)((await host.getStateAsync("economics.config.feed_in_ct_per_kwh"))?.val));
    const learningEmptyAtRaw = await host.getStateAsync("learning.thermal_boiler.estimated_empty_at");
    const learningEmptyAtIso = typeof learningEmptyAtRaw?.val === "string" && learningEmptyAtRaw.val.trim()
        ? learningEmptyAtRaw.val.trim()
        : null;
    const ihCfg = (0, device_config_1.immersionDeviceConfigFromAdapter)(host.config);
    const probeInput = (0, from_forecast_context_1.buildUnifiedInputFromForecastContext)({
        now,
        timezone,
        globalMode: plan.globalMode,
        forecastPlan,
        bufferTempC: (0, state_util_1.asNum)(bufferSt?.val),
        batterySocPct: (0, state_util_1.asNum)(batSocSt?.val),
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
    const ihMeasuredW = (0, state_util_1.asNum)((await host.getStateAsync("addons.immersion_heater.runtime.measured_power_w"))?.val);
    const ihCommandedW = (0, state_util_1.asNum)((await host.getStateAsync("addons.immersion_heater.runtime.commanded_power_w"))?.val);
    const ihOnPowerW = ihMeasuredW != null && ihMeasuredW > 50
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
        if (!lastUnifiedPlan)
            return null;
        const nowMs = now.getTime();
        const horizon = nowMs + 45 * 60_000;
        let best = null;
        for (const a of lastUnifiedPlan.allocations) {
            if (a.kind !== "immersion_heater")
                continue;
            if (!(a.allocatedPowerW >= 50))
                continue;
            const s = Date.parse(a.slot.startIso);
            const e = Date.parse(a.slot.endIso);
            if (!Number.isFinite(s) || !Number.isFinite(e))
                continue;
            if (e <= nowMs)
                continue;
            if (s > horizon)
                continue;
            if (best === null || s < best)
                best = s;
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
    const actualSample = {
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
        priceMedianCt: (0, trigger_digest_1.medianGridPriceCtPerKwh)(plan),
        priceStructureDigest: (0, trigger_digest_1.priceStructureDigestFromPlan)(plan),
        presenceDigest: (0, vehicle_availability_1.presenceDigest)(probeInput.wallbox?.presenceWindows ?? []),
        thermalBlocked: probeInput.thermal?.uncertainty.status === "blocked",
        cadenceDigest,
        userOverrideDigest,
    };
    const immersionFirstFutureStartMs = (() => {
        if (!lastUnifiedPlan)
            return null;
        const nowMs = now.getTime();
        let best = null;
        for (const a of lastUnifiedPlan.allocations) {
            if (a.kind !== "immersion_heater")
                continue;
            const t = Date.parse(a.slot.startIso);
            if (!Number.isFinite(t) || t + 15 * 60_000 <= nowMs)
                continue;
            if (best === null || t < best)
                best = t;
        }
        return best;
    })();
    /*
     * Timezone-Offset für tageszeitabhängigen Cooldown: tagsüber (06–21 Uhr) 1 Min,
     * nachts 5 Min. Näherung: UTC-Offset aus now vs. lokalem Datum (kein DST-Problem,
     * da nur für Cooldown-Schwelle verwendet).
     */
    const localOffsetMinutes = -now.getTimezoneOffset();
    let decision = (0, materiality_1.evaluateMaterialReplan)(lastBaseline, actualSample, {
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
            reasons: [reason_codes_1.REASON.REPLAN_ADDON_EXECUTION_MODE, ...forced, ...decision.reasons],
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
            reasons: [reason_codes_1.REASON.REPLAN_IMMERSION_LIVE_SURPLUS, ...decision.reasons],
        };
    }
    if (!decision.shouldReplan) {
        return plan;
    }
    // Beta: Plan-B-Compare advisory only — keine Allocation-Mutation vor Unified Authority.
    try {
        const { maybeApplyAiWritebackOnDailyPlan } = await import("../../ai/writeback/index.js");
        plan = await maybeApplyAiWritebackOnDailyPlan(host, plan);
    }
    catch (e) {
        host.log?.warn?.(`ai_writeback: ${String(e)}`);
    }
    try {
        /*
         * Unified Authority: IH/AC/Battery/Wallbox in Memory mergen, dann einmal publizieren.
         * Kein klassischer Add-on-Live-Publish vor Unified (Race vermeiden).
         */
        let ihAcReasonSuffix = "";
        try {
            const bufferTs = typeof bufferSt?.ts === "number" && Number.isFinite(bufferSt.ts)
                ? new Date(bufferSt.ts).toISOString()
                : null;
            const batSocTs = typeof batSocSt?.ts === "number" && Number.isFinite(batSocSt.ts)
                ? new Date(batSocSt.ts).toISOString()
                : null;
            const unifiedInputFinal = (0, from_forecast_context_1.buildUnifiedInputFromForecastContext)({
                now,
                timezone,
                globalMode: plan.globalMode,
                forecastPlan,
                bufferTempC: (0, state_util_1.asNum)(bufferSt?.val),
                bufferTempObservedAtIso: bufferTs,
                batterySocPct: (0, state_util_1.asNum)(batSocSt?.val),
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
            const unifiedPlan = (0, allocate_1.allocateUnifiedDayPlan)(unifiedInputFinal, {
                generation: nextGen,
                extraReasonCodes: decision.reasons,
                previousPlan: lastUnifiedPlan,
            });
            try {
                await (0, ev_planner_publish_1.publishEvPlannerDiagnosis)(host, unifiedPlan.evPlanner);
            }
            catch (e) {
                host.log?.warn?.(`ev planner diagnosis publish: ${String(e)}`);
            }
            try {
                await host.setStateAsync("planner.learning.thermal_explanation", {
                    val: JSON.stringify(unifiedPlan.thermalLearningExplanation ?? null),
                    ack: true,
                });
            }
            catch (e) {
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
                priceMedianCt: (0, trigger_digest_1.medianGridPriceCtPerKwh)(plan),
                priceStructureDigest: (0, trigger_digest_1.priceStructureDigestFromPlan)(plan),
                presenceDigest: (0, vehicle_availability_1.presenceDigest)(unifiedInputFinal.wallbox?.presenceWindows ?? []),
                cadenceDigest,
                userOverrideDigest,
            };
            /* Schritt 7: Day-Session + optionaler Tagesabschluss (Fehler isoliert). */
            try {
                const { rolloverFrom } = (0, session_1.noteUnifiedPlanPublished)({
                    date: plan.date,
                    timezone,
                    plan: unifiedPlan,
                    expectedPvKwh: unifiedInputFinal.pv.expectedDayEnergyKwh,
                    batteryStartSocPct: unifiedInputFinal.battery.socPct,
                    immersionTargetTempC: unifiedInputFinal.thermal?.dayTargetTempC ?? null,
                    replanReasons: decision.reasons,
                });
                try {
                    const { noteDayTelemetryPlanPublished } = await import("../../learning/day_telemetry/record.js");
                    await noteDayTelemetryPlanPublished({
                        host: host,
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
                }
                catch (te) {
                    host.log?.warn?.(`day_telemetry plan note: ${String(te)}`);
                }
                const dayEvalDir = typeof absPath === "function" ? absPath("learning/day_evaluation") : null;
                const pvBiasDir = typeof absPath === "function" ? absPath("learning/pv_bias") : null;
                const thermalDir = typeof absPath === "function" ? absPath("learning/thermal_runtime") : null;
                if (rolloverFrom && dayEvalDir && pvBiasDir && thermalDir) {
                    const actuals = {
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
                    await (0, session_1.closeSessionIfNeeded)({
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
                const candidates = (0, notify_1.buildNotificationCandidates)({
                    plan: unifiedPlan,
                    date: plan.date,
                    nowIso: now.toISOString(),
                    previousExpectedPvKwh: decision.reasons.includes("replan_pv_forecast_changed") ||
                        decision.reasons.includes("replan_pv_actual_deviation")
                        ? prevPv
                        : unifiedInputFinal.pv.previousExpectedDayEnergyKwh,
                });
                lastNotifyCandidates = (0, notify_1.mergeNotificationCandidates)(lastNotifyCandidates, candidates);
                const explain = (0, explain_1.buildDeterministicDayExplanation)(unifiedPlan, {
                    batteryStartSocPct: unifiedInputFinal.battery.socPct,
                });
                const sess = (0, session_1.getDayPlanSession)();
                const aiCtx = (0, context_1.buildAiExplanationContext)({
                    plan: unifiedPlan,
                    batteryStartSocPct: unifiedInputFinal.battery.socPct,
                    notificationCandidates: lastNotifyCandidates,
                    replanCount: Math.max(0, (sess?.publishCount ?? 1) - 1),
                    replanReasons: sess?.replanReasons ?? decision.reasons,
                    initialPlanId: sess?.initialPlanId ?? null,
                });
                const globalMode = (await host.getStateAsync(tree_paths_1.GLOBAL.executionMode))?.val;
                const ihAllocated = (0, state_util_1.asNum)((await host.getStateAsync(types_1.IMMERSION_RUNTIME_STATES.allocatedPowerW))?.val);
                const batAllocated = (0, state_util_1.asNum)((await host.getStateAsync(ensure_states_2.BAT.runtime.allocatedChargePowerW))?.val);
                const wbAllocated = (0, state_util_1.asNum)((await host.getStateAsync(states_2.WALLBOX_RUNTIME_STATES.allocatedPowerW))?.val);
                let acAllocatedSum = 0;
                let acAllocatedAny = false;
                const acRunning = [];
                for (let u = 1; u <= constants_1.AC_UNIT_COUNT; u++) {
                    const ids = (0, ensure_states_3.acUnitRuntimeStates)(u);
                    const aw = (0, state_util_1.asNum)((await host.getStateAsync(ids.allocatedPowerW))?.val);
                    if (aw != null) {
                        acAllocatedSum += aw;
                        acAllocatedAny = true;
                    }
                    acRunning.push((await host.getStateAsync(ids.running))?.val === true);
                }
                const agendaExecution = (0, execution_display_1.buildAgendaExecutionHints)({
                    globalMode,
                    addonModes: {
                        wallbox: (await host.getStateAsync((0, tree_paths_1.addonMode)("wallbox")))?.val,
                        battery: (await host.getStateAsync((0, tree_paths_1.addonMode)("battery")))?.val,
                        immersion_heater: (await host.getStateAsync((0, tree_paths_1.addonMode)("immersion_heater")))?.val,
                        air_conditioning: (await host.getStateAsync((0, tree_paths_1.addonMode)("air_conditioning")))?.val,
                    },
                    hardware: {
                        immersion: {
                            feedbackStage: (0, state_util_1.asNum)((await host.getStateAsync(types_1.IMMERSION_RUNTIME_STATES.feedbackStage))?.val),
                            measuredPowerW: (0, state_util_1.asNum)((await host.getStateAsync(types_1.IMMERSION_RUNTIME_STATES.measuredPowerW))?.val),
                            commandedPowerW: (0, state_util_1.asNum)((await host.getStateAsync(types_1.IMMERSION_RUNTIME_STATES.commandedPowerW))?.val),
                            allocatedPowerW: ihAllocated,
                        },
                        battery: {
                            chargingPowerW: (0, state_util_1.asNum)((await host.getStateAsync(ensure_states_2.BAT.telemetry.chargingPowerW))?.val),
                            allocatedChargePowerW: batAllocated,
                        },
                        wallbox: {
                            charging: (await host.getStateAsync(ensure_evcc_states_1.WALLBOX_EVCC_STATES.charging))?.val === true,
                            chargePowerW: (0, state_util_1.asNum)((await host.getStateAsync(ensure_evcc_states_1.WALLBOX_EVCC_STATES.chargePowerW))?.val),
                            allocatedPowerW: wbAllocated,
                        },
                        climate: {
                            unitRunning: acRunning,
                            allocatedPowerW: acAllocatedAny ? acAllocatedSum : null,
                        },
                    },
                    nowMs: now.getTime(),
                });
                const strategy = (0, strategic_status_1.buildAddonStrategicPlanSnapshot)({
                    plan: unifiedPlan,
                    plannerInput: unifiedInputFinal,
                    nowMs: now.getTime(),
                    generatedAtIso: now.toISOString(),
                });
                const productSummary = (0, product_summary_1.buildProductSummaryDe)(unifiedPlan, {
                    batteryStartSocPct: unifiedInputFinal.battery.socPct,
                    execution: agendaExecution,
                    strategy,
                });
                await (0, state_write_1.setStateIfChanged)(host, "operator.product_summary_de", productSummary);
                await (0, state_write_1.setStateIfChanged)(host, "operator.plan.battery_strategy_de", `${strategy.battery.summaryDe}. ${strategy.battery.reasonDe}`);
                await (0, state_write_1.setStateIfChanged)(host, "operator.plan.wallbox_strategy_de", `${strategy.wallbox.summaryDe}. ${strategy.wallbox.reasonDe}`);
                const notifySurface = (0, notification_surface_1.buildProductNotificationSurface)(lastNotifyCandidates, now.toISOString());
                await (0, state_write_1.setStateIfChanged)(host, "operator.notification.last_reason_de", notifySurface.lastReasonDe ?? "");
                await (0, state_write_1.setStateIfChanged)(host, "operator.notification.last_severity", notifySurface.lastSeverity ?? "");
                await (0, state_write_1.setStateIfChanged)(host, "operator.notification.last_at", notifySurface.lastCreatedAtIso ?? "");
                if (dayEvalDir) {
                    await (0, atomic_write_1.atomicWriteFile)(path.join(dayEvalDir, "latest_explain_v1.json"), `${JSON.stringify({ explain, aiContext: aiCtx, notifications: lastNotifyCandidates, productSummary }, null, 2)}\n`);
                }
            }
            catch (e) {
                host.log?.warn?.(`day_evaluation/explain/notify: ${String(e)}`);
            }
            const pub = (0, dispatch_bridge_1.buildUnifiedDispatchPublish)(unifiedPlan);
            plan = (0, recompute_remainings_1.recomputeDailyPlanSlotRemainings)((0, authority_1.applyUnifiedDayAuthority)(plan, {
                immersionEntries: pub.immersionEntries,
                climateEntries: pub.climateEntries,
                batteryEntries: pub.batteryEntries,
                wallboxEntries: pub.wallboxEntries,
            }, {
                dailyPlanRevision: plan.revision,
                unifiedPlanId: unifiedPlan.planId,
            }));
            ihAcReasonSuffix =
                ` ${(0, from_forecast_context_1.summarizeUnifiedDayPlanForReason)(unifiedPlan)} IH/AC/Battery/Wallbox autoritativ` +
                    (decision.reasons.length ? ` [${decision.reasons.join(",")}]` : "") +
                    ` replansToday=${replanCountToday}.`;
        }
        catch (e) {
            /*
             * Replan fehlgeschlagen: keine neue Unified-Generation.
             * IH/Battery/Wallbox: im Zweifel idle (kein veralteter energetischer Slice).
             * AC: planbasierten Flex leeren bei Komfortbedarf → lokaler Runtime-Komfort-Pfad.
             * Wallbox: EMS-Intent idle — EVCC bleibt manuell bedienbar.
             * Wenn Restplan noch sicher: nichts publishen (letzter Publish bleibt).
             */
            host.log?.warn?.(`unified day replan failed — assess rest safety: ${String(e)}`);
            const disposition = (0, replan_failure_1.assessUnifiedReplanFailure)({
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
            if (!disposition.clearImmersion &&
                !disposition.clearClimate &&
                !disposition.clearBattery &&
                !disposition.clearWallbox) {
                // FAIL-003: Restplan weiter gültig — kein Authority-Publish, keine neue Generation.
                return plan;
            }
            plan = (0, recompute_remainings_1.recomputeDailyPlanSlotRemainings)((0, replan_failure_1.applyReplanFailureAuthority)(plan, lastUnifiedPlan, disposition));
            const trimFuture = (kind) => {
                if (!lastUnifiedPlan)
                    return;
                const nowMs = now.getTime();
                lastUnifiedPlan = {
                    ...lastUnifiedPlan,
                    allocations: lastUnifiedPlan.allocations.filter((a) => a.kind !== kind ||
                        !(Number.isFinite(Date.parse(a.slot.endIso)) && Date.parse(a.slot.endIso) > nowMs)),
                };
            };
            if (disposition.clearImmersion)
                trimFuture("immersion_heater");
            if (disposition.clearClimate) {
                trimFuture("climate");
                trimFuture("air_conditioning");
            }
            if (disposition.clearBattery)
                trimFuture("battery_charge");
            if (disposition.clearWallbox)
                trimFuture("wallbox");
        }
        const publishReasonDe = `${plan.reasonDe}${ihAcReasonSuffix}`.slice(0, 480);
        await (0, state_write_1.setStateIfChanged)(host, states_1.DAILY_PLAN_STATE_IDS.status, plan.status);
        await (0, state_write_1.setStateIfChanged)(host, states_1.DAILY_PLAN_STATE_IDS.generatedAt, plan.generatedAt);
        await (0, state_write_1.setStateIfChanged)(host, states_1.DAILY_PLAN_STATE_IDS.validUntil, plan.validUntil ?? "");
        await (0, state_write_1.setStateIfChanged)(host, states_1.DAILY_PLAN_STATE_IDS.date, plan.date);
        await (0, state_write_1.setStateIfChanged)(host, states_1.DAILY_PLAN_STATE_IDS.planJson, JSON.stringify(plan));
        await (0, state_write_1.setStateIfChanged)(host, states_1.DAILY_PLAN_STATE_IDS.reasonDe, publishReasonDe);
        await (0, state_write_1.setOptionalNumberIfChanged)(host, states_1.DAILY_PLAN_STATE_IDS.revision, revision);
        const aiThinkingRaw = await host.getStateAsync(ensure_states_1.AI_STATES.lastThinkingDe);
        const aiThinkingDe = typeof aiThinkingRaw?.val === "string" && aiThinkingRaw.val.trim() ? aiThinkingRaw.val.trim() : null;
        await (0, state_write_1.setStateIfChanged)(host, "operator.briefing_de", (0, briefing_1.buildOperatorBriefingDe)(plan, now, timezone, {
            contributions: forecastPlan.contributions,
            aiThinkingDe,
        }));
        try {
            const globalMode = (await host.getStateAsync(tree_paths_1.GLOBAL.executionMode))?.val;
            const eff = (0, execution_effective_1.buildEffectiveExecutionSnapshot)({
                globalMode,
                addonModes: {
                    wallbox: (await host.getStateAsync((0, tree_paths_1.addonMode)("wallbox")))?.val,
                    battery: (await host.getStateAsync((0, tree_paths_1.addonMode)("battery")))?.val,
                    immersion_heater: (await host.getStateAsync((0, tree_paths_1.addonMode)("immersion_heater")))?.val,
                    air_conditioning: (await host.getStateAsync((0, tree_paths_1.addonMode)("air_conditioning")))?.val,
                },
            });
            await (0, state_write_1.setStateIfChanged)(host, "operator.execution.effective_json", JSON.stringify(eff));
            await (0, state_write_1.setStateIfChanged)(host, "operator.execution.summary_de", eff.summaryDe);
        }
        catch (e) {
            host.log?.warn?.(`operator.execution effective: ${String(e)}`);
        }
        // Finale Addon-Slices aus dem (bereits gemergten) Plan — eine Wahrheit.
        const addonSummaries = [
            { key: "battery", prefix: "battery" },
            { key: "wallbox", prefix: "wallbox" },
            { key: "immersion_heater", prefix: "immersion_heater" },
            { key: "air_conditioning", prefix: "air_conditioning" },
        ];
        for (const { key, prefix } of addonSummaries) {
            const ids = states_1.ALLOCATION_ADDON_STATE_IDS[key];
            const view = (0, addon_plan_publish_1.addonAllocationPublishView)(plan, prefix);
            let reasonDe = view.reasonDe;
            if (key === "immersion_heater" ||
                key === "air_conditioning" ||
                key === "battery" ||
                key === "wallbox") {
                reasonDe = ihAcReasonSuffix.trim()
                    ? `${view.reasonDe} ${ihAcReasonSuffix.trim()}`
                    : view.reasonDe;
            }
            await (0, state_write_1.setStateIfChanged)(host, ids.status, view.status);
            await (0, state_write_1.setStateIfChanged)(host, ids.planJson, JSON.stringify(view.runnable));
            await (0, state_write_1.setStateIfChanged)(host, ids.reasonDe, reasonDe.slice(0, 480));
        }
        /*
         * Heizstab-Zielautorität (Befund 004): Effective-/Forecast-Ziel an Allocation-States
         * derselben Daily-Plan-Revision. Runtime/FSM ist alleiniger Writer von
         * runtime.plan_target_temp_c — kein zweiter Writer mehr.
         */
        const ihFlex = forecastPlan.contributions.find((c) => c.contributionId === contribution_ids_1.CONTRIBUTION_IDS.IMMERSION_FLEXIBLE);
        const ihMand = forecastPlan.contributions.find((c) => c.contributionId === contribution_ids_1.CONTRIBUTION_IDS.IMMERSION_MANDATORY);
        const ihDetails = ihFlex?.details ?? ihMand?.details ?? null;
        const ihAlloc = states_1.ALLOCATION_ADDON_STATE_IDS.immersion_heater;
        const effectiveTarget = ihDetails && typeof ihDetails.targetTempC === "number" && Number.isFinite(ihDetails.targetTempC)
            ? ihDetails.targetTempC
            : null;
        const forecastTarget = ihDetails &&
            typeof ihDetails.forecastTargetTempC === "number" &&
            Number.isFinite(ihDetails.forecastTargetTempC)
            ? ihDetails.forecastTargetTempC
            : null;
        const targetReason = ihDetails && typeof ihDetails.targetReasonDe === "string" && ihDetails.targetReasonDe.trim()
            ? ihDetails.targetReasonDe.trim()
            : typeof ihFlex?.reasonDe === "string" && ihFlex.reasonDe.trim()
                ? ihFlex.reasonDe.trim()
                : effectiveTarget !== null
                    ? `Unified-Plan-Ziel ${effectiveTarget} °C.`
                    : "";
        await (0, state_write_1.setOptionalNumberIfChanged)(host, ihAlloc.effectiveTargetTempC, effectiveTarget);
        await (0, state_write_1.setOptionalNumberIfChanged)(host, ihAlloc.forecastTargetTempC, forecastTarget);
        await (0, state_write_1.setStateIfChanged)(host, ihAlloc.targetReasonDe, targetReason.slice(0, 480));
        await (0, state_write_1.setOptionalNumberIfChanged)(host, ihAlloc.targetRevision, plan.revision);
        (0, daily_plan_1.resetImmersionDailyPlanCache)();
        (0, daily_plan_2.resetAcDailyPlanCache)();
        (0, daily_plan_3.resetBatteryDailyPlanCache)();
        (0, daily_plan_4.resetWallboxDailyPlanCache)();
    }
    catch (e) {
        host.log?.warn?.(`daily plan state write: ${String(e)}`);
        try {
            await (0, state_write_1.setStateIfChanged)(host, states_1.DAILY_PLAN_STATE_IDS.status, "error");
            await (0, state_write_1.setStateIfChanged)(host, states_1.DAILY_PLAN_STATE_IDS.reasonDe, `Daily Plan Fehler: ${String(e)}`.slice(0, 480));
        }
        catch {
            // ignore
        }
    }
    return plan;
}
exports.runDailyPlanTick = runDailyPlanTick;
