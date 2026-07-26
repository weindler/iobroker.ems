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
exports.runDailyPlanTick = exports.dailyPlanRevisionForTest = exports.resetDailyPlanRevisionForTest = void 0;
const config_1 = require("../../policy/global/config");
const config_2 = require("../../intent/config");
const mode_policy_1 = require("../../planner/mode_policy");
const state_write_1 = require("../../policy/core/state_write");
const build_1 = require("./build");
const briefing_1 = require("./briefing");
const live_surplus_1 = require("./live_surplus");
const states_1 = require("./states");
const battery_consumers_1 = require("../../policy/battery_consumers");
const device_config_1 = require("../../addons/immersion_heater/device_config");
const state_util_1 = require("../../ems_light/state_util");
const battery_1 = require("../planning/battery");
const ensure_evcc_states_1 = require("../../addons/wallbox/ensure_evcc_states");
let lastRevisionPayload = "";
let revision = 0;
function resetDailyPlanRevisionForTest() {
    lastRevisionPayload = "";
    revision = 0;
}
exports.resetDailyPlanRevisionForTest = resetDailyPlanRevisionForTest;
function dailyPlanRevisionForTest() {
    return revision;
}
exports.dailyPlanRevisionForTest = dailyPlanRevisionForTest;
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
function addonAllocationSummary(plan, addonPrefix) {
    const allocations = plan.allocations.filter((a) => a.contributionId === addonPrefix ||
        a.contributionId.startsWith(`${addonPrefix}.`) ||
        (a.contributor.id === addonPrefix && addonPrefix !== "air_conditioning"));
    if (addonPrefix === "air_conditioning") {
        return plan.allocations.filter((a) => a.contributionId.startsWith("air_conditioning."));
    }
    return allocations;
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
    });
    const payload = (0, build_1.dailyPlanRevisionPayload)(plan);
    if (payload !== lastRevisionPayload) {
        revision += 1;
        lastRevisionPayload = payload;
    }
    plan.revision = revision;
    // Roadmap Block 6: vorhandene KI-Präferenzen → Plan B auf Allocation, wenn messbar besser.
    try {
        const { maybeApplyAiWritebackOnDailyPlan } = await Promise.resolve().then(() => __importStar(require("../../ai/writeback/index.js")));
        plan = await maybeApplyAiWritebackOnDailyPlan(host, plan);
    }
    catch (e) {
        host.log?.warn?.(`ai_writeback: ${String(e)}`);
    }
    try {
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
        await (0, state_write_1.setStateIfChanged)(host, states_1.DAILY_PLAN_STATE_IDS.reasonDe, plan.reasonDe);
        await (0, state_write_1.setOptionalNumberIfChanged)(host, states_1.DAILY_PLAN_STATE_IDS.revision, revision);
        // Roadmap Block 3.3: Briefing + Live-Überschuss/-Defizit aus Daily Plan + Live-Cache —
        // kein Rückgriff mehr auf `formatBriefing()`/`planner.surplus_w` des alten Realtime-Planners.
        const pvFromPv = (0, state_util_1.asNum)((await host.getStateAsync("live.pv.power_w"))?.val);
        const pvFromBattery = (0, state_util_1.asNum)((await host.getStateAsync("live.battery.pv_ac_power_w"))?.val);
        const liveSurplus = (0, live_surplus_1.buildOperatorLiveSurplus)({
            pvPowerW: pvFromPv ?? pvFromBattery,
            houseLoadW: (0, state_util_1.asNum)((await host.getStateAsync("live.battery.house_load_w"))?.val),
            now,
            timezone,
        });
        await (0, state_write_1.setOptionalNumberIfChanged)(host, "operator.diagnostics.surplus_w", liveSurplus.surplusW);
        await (0, state_write_1.setOptionalNumberIfChanged)(host, "operator.diagnostics.deficit_w", liveSurplus.deficitW);
        await (0, state_write_1.setStateIfChanged)(host, "operator.diagnostics.slot_start_iso", liveSurplus.slotStartIso ?? "");
        await (0, state_write_1.setStateIfChanged)(host, "operator.briefing_de", (0, briefing_1.buildOperatorBriefingDe)(plan, now, timezone));
        const addonSummaries = [
            { key: "battery", prefix: "battery" },
            { key: "wallbox", prefix: "wallbox" },
            { key: "immersion_heater", prefix: "immersion_heater" },
            { key: "air_conditioning", prefix: "air_conditioning" },
        ];
        for (const { key, prefix } of addonSummaries) {
            const ids = states_1.ALLOCATION_ADDON_STATE_IDS[key];
            const summary = addonAllocationSummary(plan, prefix);
            const status = summary.length > 0 ? "ready" : "idle";
            await (0, state_write_1.setStateIfChanged)(host, ids.status, status);
            await (0, state_write_1.setStateIfChanged)(host, ids.planJson, JSON.stringify(summary));
            await (0, state_write_1.setStateIfChanged)(host, ids.reasonDe, summary.length > 0
                ? `${summary.length} Allocation-Einträge für ${prefix}.`
                : `Keine Allocation für ${prefix}.`);
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
