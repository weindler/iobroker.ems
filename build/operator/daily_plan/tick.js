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
exports.runDailyPlanTick = exports.lastUnifiedPlanIdForTest = exports.unifiedPlanGenerationForTest = exports.dailyPlanRevisionForTest = exports.resetDailyPlanRevisionForTest = void 0;
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
const from_forecast_context_1 = require("./unified/from_forecast_context");
const cadence_1 = require("./unified/cadence");
const materiality_1 = require("./unified/materiality");
const replan_failure_1 = require("./unified/replan_failure");
const trigger_digest_1 = require("../../ai/trigger_digest");
const daily_plan_1 = require("../../addons/immersion_heater/runtime/daily_plan");
const daily_plan_2 = require("../../addons/air_conditioning/runtime/daily_plan");
const limits_1 = require("../../addons/battery/core/limits");
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
}
exports.resetDailyPlanRevisionForTest = resetDailyPlanRevisionForTest;
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
        batteryBoost,
        loadpointMode,
        externalVehicleChargeRaw,
        tibberGridRewardsActive,
    });
    try {
        await (0, state_write_1.setStateIfChanged)(host, states_2.WALLBOX_RUNTIME_STATES.batteryHoldForEvCharge, wallboxHold.hold);
        await (0, state_write_1.setStateIfChanged)(host, states_2.WALLBOX_RUNTIME_STATES.batteryHoldReasonDe, wallboxHold.reasonDe);
        await (0, state_write_1.setStateIfChanged)(host, states_2.WALLBOX_RUNTIME_STATES.chargeBoostActive, wallboxHold.boostActive);
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
    try {
        await (0, state_write_1.setStateIfChanged)(host, "planner.constraints.evcc_battery_hold", hold.evcc_battery_hold);
        await (0, state_write_1.setStateIfChanged)(host, "planner.constraints.battery_hold_active", hold.battery_hold_active);
    }
    catch {
        // constraint publish best-effort
    }
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
    const pvFromPvEarly = (0, state_util_1.asNum)((await host.getStateAsync("live.pv.power_w"))?.val);
    const pvFromBatteryEarly = (0, state_util_1.asNum)((await host.getStateAsync("live.battery.pv_ac_power_w"))?.val);
    const liveSurplusEarly = (0, live_surplus_1.buildOperatorLiveSurplus)({
        pvPowerW: pvFromPvEarly ?? pvFromBatteryEarly,
        houseLoadW: (0, state_util_1.asNum)((await host.getStateAsync("live.battery.house_load_w"))?.val),
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
        livePvSurplusW: liveSurplusEarly.surplusW,
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
        observedPvPowerW: (0, state_util_1.asNum)((await host.getStateAsync("live.battery.pv_ac_power_w"))?.val),
        observedHouseLoadPowerW: (0, state_util_1.asNum)((await host.getStateAsync("live.battery.house_load_w"))?.val),
        contributionRevision: plan.revision,
        previousExpectedDayEnergyKwh: lastBaseline?.expectedPvDayKwh ?? null,
        realizedPvKwhToday: realizedPv,
    });
    if (wbConnected !== null && probeInput.wallbox) {
        probeInput.wallbox = {
            ...probeInput.wallbox,
            connectedNow: wbConnected,
            // Live-Disconnect: geplante Fenster entfallen (kein Future-Presence-Hardcode).
            ...(wbConnected === false ? { presenceWindows: [] } : {}),
        };
    }
    const actualSample = {
        date: plan.date,
        nowMs: now.getTime(),
        forecastPvDayKwh: probeInput.pv.expectedDayEnergyKwh,
        realizedPvKwh: realizedPv,
        forecastHouseLoadDayKwh: probeInput.houseLoad.expectedDayEnergyKwh,
        batterySocPct: probeInput.battery.socPct,
        thermalHeadroomKwh: probeInput.thermal?.headroomEnergyKwh ?? null,
        bufferTempC: probeInput.thermal?.bufferTempC ?? null,
        acMandatoryAny: probeInput.climate?.units.some((u) => u.mandatoryComfort) === true,
        vehicleConnected: probeInput.wallbox?.connectedNow ?? wbConnected,
        vehicleRequiredEnergyKwh: probeInput.wallbox?.requiredEnergyKwh ?? null,
        vehicleDeadlineIso: probeInput.wallbox?.deadlineIso ?? null,
        vehicleTargetSocPct: probeInput.wallbox?.targetSocPct ?? null,
        priceMedianCt: (0, trigger_digest_1.medianGridPriceCtPerKwh)(plan),
        priceStructureDigest: (0, trigger_digest_1.priceStructureDigestFromPlan)(plan),
        thermalBlocked: probeInput.thermal?.uncertainty.status === "blocked",
        cadenceDigest,
    };
    const decision = (0, materiality_1.evaluateMaterialReplan)(lastBaseline, actualSample, {
        lastReplanAtMs,
    });
    if (!decision.shouldReplan) {
        return plan;
    }
    // Roadmap Block 6: vorhandene KI-Präferenzen → Plan B auf Allocation, wenn messbar besser.
    try {
        const { maybeApplyAiWritebackOnDailyPlan } = await Promise.resolve().then(() => __importStar(require("../../ai/writeback/index.js")));
        plan = await maybeApplyAiWritebackOnDailyPlan(host, plan);
    }
    catch (e) {
        host.log?.warn?.(`ai_writeback: ${String(e)}`);
    }
    try {
        /*
         * IH/AC Authority: Unified zuerst in Memory mergen, dann einmal publizieren.
         * Kein klassischer IH/AC-Live-Publish vor Unified (Race vermeiden).
         * Battery/Wallbox bleiben klassisch im Plan.
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
                observedPvPowerW: (0, state_util_1.asNum)((await host.getStateAsync("live.battery.pv_ac_power_w"))?.val),
                observedHouseLoadPowerW: (0, state_util_1.asNum)((await host.getStateAsync("live.battery.house_load_w"))?.val),
                contributionRevision: plan.revision,
                previousExpectedDayEnergyKwh: lastBaseline?.expectedPvDayKwh ?? null,
                realizedPvKwhToday: realizedPv,
            });
            if (wbConnected !== null && unifiedInputFinal.wallbox) {
                unifiedInputFinal.wallbox = {
                    ...unifiedInputFinal.wallbox,
                    connectedNow: wbConnected,
                    ...(wbConnected === false
                        ? { presenceWindows: [] }
                        : {}),
                };
            }
            const nextGen = (lastUnifiedPlan?.generation ?? 0) + 1;
            const unifiedPlan = (0, allocate_1.allocateUnifiedDayPlan)(unifiedInputFinal, {
                generation: nextGen,
                extraReasonCodes: decision.reasons,
                previousPlan: lastUnifiedPlan,
            });
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
                acMandatoryAny: unifiedInputFinal.climate?.units.some((u) => u.mandatoryComfort) === true,
                vehicleConnected: unifiedInputFinal.wallbox?.connectedNow ?? null,
                vehicleRequiredEnergyKwh: unifiedInputFinal.wallbox?.requiredEnergyKwh ?? null,
                vehicleDeadlineIso: unifiedInputFinal.wallbox?.deadlineIso ?? null,
                vehicleTargetSocPct: unifiedInputFinal.wallbox?.targetSocPct ?? null,
                priceMedianCt: (0, trigger_digest_1.medianGridPriceCtPerKwh)(plan),
                priceStructureDigest: (0, trigger_digest_1.priceStructureDigestFromPlan)(plan),
                cadenceDigest,
            };
            const pub = (0, dispatch_bridge_1.buildUnifiedIhAcDispatchPublish)(unifiedPlan);
            plan = (0, authority_1.applyUnifiedIhAcAuthority)(plan, pub.immersionEntries, pub.climateEntries, {
                dailyPlanRevision: plan.revision,
                unifiedPlanId: unifiedPlan.planId,
            });
            ihAcReasonSuffix =
                ` ${(0, from_forecast_context_1.summarizeUnifiedDayPlanForReason)(unifiedPlan)} IH/AC autoritativ` +
                    (decision.reasons.length ? ` [${decision.reasons.join(",")}]` : "") +
                    ` replansToday=${replanCountToday}.`;
        }
        catch (e) {
            /*
             * Replan fehlgeschlagen: keine neue Unified-Generation.
             * IH: im Zweifel idle (kein veralteter energetischer Slice).
             * AC: planbasierten Flex leeren bei Komfortbedarf → lokaler Runtime-Komfort-Pfad.
             * Wenn Restplan noch sicher: nichts publishen (letzter Publish bleibt).
             */
            host.log?.warn?.(`unified ih/ac replan failed — assess rest safety: ${String(e)}`);
            const disposition = (0, replan_failure_1.assessUnifiedReplanFailure)({
                nowMs: now.getTime(),
                lastUnifiedPlan,
                actual: actualSample,
                thermal: probeInput.thermal,
                climate: probeInput.climate,
                replanReasons: decision.reasons,
            });
            ihAcReasonSuffix = ` ${disposition.reasonDe}`;
            if (!disposition.clearImmersion && !disposition.clearClimate) {
                // FAIL-003: Restplan weiter gültig — kein Authority-Publish, keine neue Generation.
                return plan;
            }
            plan = (0, replan_failure_1.applyReplanFailureAuthority)(plan, lastUnifiedPlan, disposition);
            if (disposition.clearImmersion && lastUnifiedPlan) {
                const nowMs = now.getTime();
                lastUnifiedPlan = {
                    ...lastUnifiedPlan,
                    allocations: lastUnifiedPlan.allocations.filter((a) => a.kind !== "immersion_heater" ||
                        !(Number.isFinite(Date.parse(a.slot.endIso)) && Date.parse(a.slot.endIso) > nowMs)),
                };
            }
            if (disposition.clearClimate && lastUnifiedPlan) {
                const nowMs = now.getTime();
                lastUnifiedPlan = {
                    ...lastUnifiedPlan,
                    allocations: lastUnifiedPlan.allocations.filter((a) => a.kind !== "climate" ||
                        !(Number.isFinite(Date.parse(a.slot.endIso)) && Date.parse(a.slot.endIso) > nowMs)),
                };
            }
        }
        const publishReasonDe = `${plan.reasonDe}${ihAcReasonSuffix}`.slice(0, 480);
        await (0, state_write_1.setStateIfChanged)(host, states_1.DAILY_PLAN_STATE_IDS.status, plan.status);
        await (0, state_write_1.setStateIfChanged)(host, states_1.DAILY_PLAN_STATE_IDS.generatedAt, plan.generatedAt);
        await (0, state_write_1.setStateIfChanged)(host, states_1.DAILY_PLAN_STATE_IDS.validUntil, plan.validUntil ?? "");
        await (0, state_write_1.setStateIfChanged)(host, states_1.DAILY_PLAN_STATE_IDS.date, plan.date);
        await (0, state_write_1.setStateIfChanged)(host, states_1.DAILY_PLAN_STATE_IDS.globalMode, plan.globalMode);
        await (0, state_write_1.setOptionalNumberIfChanged)(host, states_1.DAILY_PLAN_STATE_IDS.slotMinutes, plan.slotMinutes);
        await (0, state_write_1.setStateIfChanged)(host, states_1.DAILY_PLAN_STATE_IDS.activeContributionsJson, JSON.stringify(plan.activeContributionIds));
        await (0, state_write_1.setStateIfChanged)(host, states_1.DAILY_PLAN_STATE_IDS.excludedContributionsJson, JSON.stringify(plan.excludedContributions));
        await (0, state_write_1.setStateIfChanged)(host, states_1.DAILY_PLAN_STATE_IDS.slotsJson, JSON.stringify(plan.slots));
        await (0, state_write_1.setStateIfChanged)(host, states_1.DAILY_PLAN_STATE_IDS.allocationsJson, JSON.stringify(plan.allocations));
        await (0, state_write_1.setStateIfChanged)(host, states_1.DAILY_PLAN_STATE_IDS.totalsJson, JSON.stringify(plan.totals));
        await (0, state_write_1.setStateIfChanged)(host, states_1.DAILY_PLAN_STATE_IDS.unallocatedJson, JSON.stringify(plan.unallocated));
        await (0, state_write_1.setStateIfChanged)(host, states_1.DAILY_PLAN_STATE_IDS.policySnapshotJson, JSON.stringify(plan.policySnapshot));
        await (0, state_write_1.setStateIfChanged)(host, states_1.DAILY_PLAN_STATE_IDS.constraintSnapshotJson, JSON.stringify(plan.constraintSnapshot));
        await (0, state_write_1.setStateIfChanged)(host, states_1.DAILY_PLAN_STATE_IDS.planJson, JSON.stringify(plan));
        await (0, state_write_1.setStateIfChanged)(host, states_1.DAILY_PLAN_STATE_IDS.reasonDe, publishReasonDe);
        await (0, state_write_1.setOptionalNumberIfChanged)(host, states_1.DAILY_PLAN_STATE_IDS.revision, revision);
        const aiThinkingRaw = await host.getStateAsync(ensure_states_1.AI_STATES.lastThinkingDe);
        const aiThinkingDe = typeof aiThinkingRaw?.val === "string" && aiThinkingRaw.val.trim() ? aiThinkingRaw.val.trim() : null;
        await (0, state_write_1.setStateIfChanged)(host, "operator.briefing_de", (0, briefing_1.buildOperatorBriefingDe)(plan, now, timezone, {
            contributions: forecastPlan.contributions,
            aiThinkingDe,
        }));
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
            if (key === "immersion_heater" || key === "air_conditioning") {
                reasonDe = ihAcReasonSuffix.trim()
                    ? `${view.reasonDe} ${ihAcReasonSuffix.trim()}`
                    : view.reasonDe;
            }
            await (0, state_write_1.setStateIfChanged)(host, ids.status, view.status);
            await (0, state_write_1.setStateIfChanged)(host, ids.planJson, JSON.stringify(view.runnable));
            await (0, state_write_1.setStateIfChanged)(host, ids.reasonDe, reasonDe.slice(0, 480));
        }
        (0, daily_plan_1.resetImmersionDailyPlanCache)();
        (0, daily_plan_2.resetAcDailyPlanCache)();
        // Heizstab-Tagesziel aus Contribution-Details (gleiche Forecast-Logik wie Allocation).
        const ihFlex = forecastPlan.contributions.find((c) => c.contributionId === contribution_ids_1.CONTRIBUTION_IDS.IMMERSION_FLEXIBLE);
        const ihMand = forecastPlan.contributions.find((c) => c.contributionId === contribution_ids_1.CONTRIBUTION_IDS.IMMERSION_MANDATORY);
        const ihDetails = ihFlex?.details ?? ihMand?.details ?? null;
        const targetTemp = ihDetails && typeof ihDetails.targetTempC === "number" && Number.isFinite(ihDetails.targetTempC)
            ? ihDetails.targetTempC
            : null;
        if (targetTemp !== null) {
            await (0, state_write_1.setOptionalNumberIfChanged)(host, types_1.IMMERSION_RUNTIME_STATES.planTargetTempC, targetTemp);
            const reasonFromDetails = ihDetails && typeof ihDetails.targetReasonDe === "string" ? ihDetails.targetReasonDe : "";
            const reason = reasonFromDetails.trim() ||
                (typeof ihFlex?.reasonDe === "string" && ihFlex.reasonDe.trim() ? ihFlex.reasonDe : "") ||
                `Plan-Tagesziel ${targetTemp} °C.`;
            await (0, state_write_1.setStateIfChanged)(host, types_1.IMMERSION_RUNTIME_STATES.planTargetReasonDe, reason);
        }
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
