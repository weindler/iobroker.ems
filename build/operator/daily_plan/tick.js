"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.runDailyPlanTick = exports.dailyPlanRevisionForTest = exports.resetDailyPlanRevisionForTest = void 0;
const config_1 = require("../../policy/global/config");
const config_2 = require("../../intent/config");
const mode_policy_1 = require("../../planner/mode_policy");
const state_write_1 = require("../../policy/core/state_write");
const build_1 = require("./build");
const revision_1 = require("./revision");
const states_1 = require("./states");
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
async function readNum(host, relId) {
    const raw = await readStr(host, relId);
    if (raw === null)
        return null;
    const n = parseFloat(raw);
    return Number.isFinite(n) ? n : null;
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
async function storedDailyPlanSemanticallyMatches(host, plan, semanticHash) {
    const storedHash = await readStr(host, states_1.DAILY_PLAN_STATE_IDS.semanticRevisionHash);
    if (storedHash === semanticHash)
        return true;
    const raw = await readStr(host, states_1.DAILY_PLAN_STATE_IDS.planJson);
    const stored = (0, revision_1.parseDailyPlanFromJson)(raw);
    if (!stored)
        return false;
    return (0, revision_1.dailyPlanSemanticRevisionHash)(stored) === semanticHash;
}
async function persistDailyPlan(host, plan, semanticHash, nextRevision) {
    const planJson = JSON.stringify(plan);
    if ((await readStr(host, states_1.DAILY_PLAN_STATE_IDS.planJson)) === planJson) {
        await (0, state_write_1.setStateIfChanged)(host, states_1.DAILY_PLAN_STATE_IDS.generatedAt, plan.generatedAt);
        if ((await readStr(host, states_1.DAILY_PLAN_STATE_IDS.semanticRevisionHash)) !== semanticHash) {
            await (0, state_write_1.setStateIfChanged)(host, states_1.DAILY_PLAN_STATE_IDS.semanticRevisionHash, semanticHash);
        }
        lastRevisionPayload = (0, revision_1.dailyPlanRevisionPayload)(plan);
        return;
    }
    await (0, state_write_1.setStateIfChanged)(host, states_1.DAILY_PLAN_STATE_IDS.status, plan.status);
    await (0, state_write_1.setStateIfChanged)(host, states_1.DAILY_PLAN_STATE_IDS.generatedAt, plan.generatedAt);
    await (0, state_write_1.setStateIfChanged)(host, states_1.DAILY_PLAN_STATE_IDS.validUntil, plan.validUntil ?? "");
    await (0, state_write_1.setStateIfChanged)(host, states_1.DAILY_PLAN_STATE_IDS.date, plan.date);
    await (0, state_write_1.setStateIfChanged)(host, states_1.DAILY_PLAN_STATE_IDS.globalMode, plan.globalMode);
    await (0, state_write_1.setStateIfChanged)(host, states_1.DAILY_PLAN_STATE_IDS.slotMinutes, plan.slotMinutes);
    await (0, state_write_1.setStateIfChanged)(host, states_1.DAILY_PLAN_STATE_IDS.planJson, planJson);
    await (0, state_write_1.setStateIfChanged)(host, states_1.DAILY_PLAN_STATE_IDS.reasonDe, plan.reasonDe);
    await (0, state_write_1.setStateIfChanged)(host, states_1.DAILY_PLAN_STATE_IDS.revision, nextRevision);
    await (0, state_write_1.setStateIfChanged)(host, states_1.DAILY_PLAN_STATE_IDS.semanticRevisionHash, semanticHash);
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
    revision = nextRevision;
    lastRevisionPayload = (0, revision_1.dailyPlanRevisionPayload)(plan);
    plan.revision = nextRevision;
}
async function runDailyPlanTick(host, forecastPlan, options = {}) {
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
    const plan = (0, build_1.buildDailyPlanFromForecast)(now, timezone, modePolicy.mode, forecastPlan, {
        policySnapshot: effectivePolicy,
        energyPriority,
        mutualExclusions,
        gridImportAllowedPolicy: policyBool(effectivePolicy, "gridImportAllowed") ?? adminPolicy.gridImportAllowed,
        effectiveMaxGridImportW: policyNumber(effectivePolicy, "maxGridImportW") ?? adminPolicy.maxGridImportW,
        configuredHouseFuseLimitW: policyNumber(effectivePolicy, "houseFuseLimitW") ?? adminPolicy.houseFuseLimitW,
        modePolicy,
    });
    const semanticPayload = (0, revision_1.dailyPlanRevisionPayload)(plan);
    const semanticHash = (0, revision_1.dailyPlanSemanticRevisionHash)(plan);
    let revisionChanged = semanticPayload !== lastRevisionPayload;
    if (!revisionChanged && lastRevisionPayload !== "") {
        plan.revision = revision;
        return plan;
    }
    const storedRevision = await readNum(host, states_1.DAILY_PLAN_STATE_IDS.revision);
    if (storedRevision !== null && storedRevision >= 0 && revision === 0) {
        revision = storedRevision;
    }
    if (options.persistToDb === false) {
        const nextRevision = revisionChanged ? revision + 1 : revision;
        plan.revision = nextRevision;
        if (revisionChanged) {
            revision = nextRevision;
            lastRevisionPayload = semanticPayload;
        }
        return plan;
    }
    if (await storedDailyPlanSemanticallyMatches(host, plan, semanticHash)) {
        plan.revision = revision;
        lastRevisionPayload = semanticPayload;
        await (0, state_write_1.setStateIfChanged)(host, states_1.DAILY_PLAN_STATE_IDS.generatedAt, plan.generatedAt);
        return plan;
    }
    const nextRevision = revisionChanged ? revision + 1 : revision;
    plan.revision = nextRevision;
    host.log?.info?.([
        "daily plan write decision:",
        `revisionChanged=${revisionChanged}`,
        `storedHash=${((await readStr(host, states_1.DAILY_PLAN_STATE_IDS.semanticRevisionHash)) ?? "none").slice(0, 12)}`,
        `computedHash=${semanticHash.slice(0, 12)}`,
    ].join(" "));
    try {
        await persistDailyPlan(host, plan, semanticHash, nextRevision);
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
