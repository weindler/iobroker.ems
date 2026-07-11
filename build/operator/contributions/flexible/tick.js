"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.runFlexibleContributionsTick = exports.flexibleContributionsRevisionForTest = exports.resetFlexibleContributionsRevisionForTest = void 0;
const state_write_1 = require("../../../policy/core/state_write");
const types_1 = require("./types");
const read_1 = require("./read");
const states_1 = require("./states");
let lastRevisionPayload = "";
let revision = 0;
function resetFlexibleContributionsRevisionForTest() {
    lastRevisionPayload = "";
    revision = 0;
}
exports.resetFlexibleContributionsRevisionForTest = resetFlexibleContributionsRevisionForTest;
function flexibleContributionsRevisionForTest() {
    return revision;
}
exports.flexibleContributionsRevisionForTest = flexibleContributionsRevisionForTest;
function partitionFlexible(contributions) {
    const active = [];
    const excluded = [];
    for (const c of contributions) {
        if (c.enabled && c.quality.status !== "missing" && c.quality.status !== "invalid") {
            active.push(c);
        }
        else {
            excluded.push({ contributionId: c.contributionId, reasonDe: c.reasonDe || c.quality.reasonDe });
        }
    }
    return { active, excluded };
}
function addonContributions(contributions, addonId) {
    return contributions.filter((c) => c.contributor.addonId === addonId || c.contributor.id === addonId);
}
function addonStatus(contributions) {
    if (contributions.length === 0)
        return "missing";
    if (contributions.some((c) => c.enabled && c.quality.status === "valid"))
        return "ready";
    if (contributions.some((c) => c.enabled))
        return "degraded";
    if (contributions.some((c) => c.quality.status === "unsupported"))
        return "unsupported";
    return "disabled";
}
async function writeAddonStates(host, addonKey, contributions) {
    const ids = states_1.FLEXIBLE_ADDON_STATE_IDS[addonKey];
    const rows = addonContributions(contributions, addonKey === "air_conditioning" ? "air_conditioning" : addonKey);
    const status = addonStatus(rows);
    const reason = rows.find((c) => c.enabled)?.reasonDe ??
        rows[0]?.reasonDe ??
        `Keine ${addonKey}-Contributions.`;
    await (0, state_write_1.setStateIfChanged)(host, ids.status, status);
    await (0, state_write_1.setStateIfChanged)(host, ids.contributionsJson, JSON.stringify(rows));
    await (0, state_write_1.setStateIfChanged)(host, ids.reasonDe, reason);
    await (0, state_write_1.setStateIfChanged)(host, ids.revision, revision);
}
async function runFlexibleContributionsTick(host, gridForecast) {
    const now = new Date();
    let contributions = [];
    try {
        const collected = await (0, read_1.collectFlexibleContributions)(host, now, gridForecast ?? null);
        contributions = collected.contributions;
    }
    catch (e) {
        host.log?.warn?.(`flexible contributions read: ${String(e)}`);
        try {
            await (0, state_write_1.setStateIfChanged)(host, states_1.FLEXIBLE_CONTRIBUTIONS_STATE_IDS.status, "error");
            await (0, state_write_1.setStateIfChanged)(host, states_1.FLEXIBLE_CONTRIBUTIONS_STATE_IDS.reasonDe, `Flexible Contributions Fehler: ${String(e)}`.slice(0, 480));
        }
        catch {
            // ignore
        }
        return [];
    }
    const payload = (0, types_1.flexibleContributionsRevisionPayload)(contributions);
    if (payload !== lastRevisionPayload) {
        revision += 1;
        lastRevisionPayload = payload;
    }
    const { active, excluded } = partitionFlexible(contributions);
    const overallStatus = active.length > 0 ? "ready" : excluded.length > 0 ? "degraded" : "missing";
    try {
        await (0, state_write_1.setStateIfChanged)(host, states_1.FLEXIBLE_CONTRIBUTIONS_STATE_IDS.status, overallStatus);
        await (0, state_write_1.setStateIfChanged)(host, states_1.FLEXIBLE_CONTRIBUTIONS_STATE_IDS.generatedAt, now.toISOString());
        await (0, state_write_1.setStateIfChanged)(host, states_1.FLEXIBLE_CONTRIBUTIONS_STATE_IDS.contributionsJson, JSON.stringify(contributions));
        await (0, state_write_1.setStateIfChanged)(host, states_1.FLEXIBLE_CONTRIBUTIONS_STATE_IDS.activeJson, JSON.stringify(active.map((c) => c.contributionId)));
        await (0, state_write_1.setStateIfChanged)(host, states_1.FLEXIBLE_CONTRIBUTIONS_STATE_IDS.excludedJson, JSON.stringify(excluded));
        await (0, state_write_1.setStateIfChanged)(host, states_1.FLEXIBLE_CONTRIBUTIONS_STATE_IDS.reasonDe, `${active.length} aktiv, ${excluded.length} ausgeschlossen.`);
        await (0, state_write_1.setStateIfChanged)(host, states_1.FLEXIBLE_CONTRIBUTIONS_STATE_IDS.revision, revision);
        await writeAddonStates(host, "battery", contributions);
        await writeAddonStates(host, "wallbox", contributions);
        await writeAddonStates(host, "immersion_heater", contributions);
        await writeAddonStates(host, "air_conditioning", contributions);
    }
    catch (e) {
        host.log?.warn?.(`flexible contributions state write: ${String(e)}`);
    }
    return contributions;
}
exports.runFlexibleContributionsTick = runFlexibleContributionsTick;
