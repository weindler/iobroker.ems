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
async function writeAddonStates(host, addonKey, contributions, writeOpts, revisionValue) {
    const ids = states_1.FLEXIBLE_ADDON_STATE_IDS[addonKey];
    const rows = addonContributions(contributions, addonKey === "air_conditioning" ? "air_conditioning" : addonKey);
    const status = addonStatus(rows);
    const reason = rows.find((c) => c.enabled)?.reasonDe ??
        rows[0]?.reasonDe ??
        `Keine ${addonKey}-Contributions.`;
    await (0, state_write_1.setStateIfChanged)(host, ids.status, status, writeOpts);
    await (0, state_write_1.setStateIfChanged)(host, ids.contributionsJson, JSON.stringify(rows), writeOpts);
    await (0, state_write_1.setStateIfChanged)(host, ids.reasonDe, reason, writeOpts);
    await (0, state_write_1.setStateIfChanged)(host, ids.revision, revisionValue, writeOpts);
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
    const revisionChanged = payload !== lastRevisionPayload;
    const nextRevision = revisionChanged ? revision + 1 : revision;
    const writeOpts = revisionChanged ? { skipRead: true } : undefined;
    const { active, excluded } = partitionFlexible(contributions);
    const overallStatus = active.length > 0 ? "ready" : excluded.length > 0 ? "degraded" : "missing";
    try {
        await (0, state_write_1.setStateIfChanged)(host, states_1.FLEXIBLE_CONTRIBUTIONS_STATE_IDS.status, overallStatus, writeOpts);
        await (0, state_write_1.setStateIfChanged)(host, states_1.FLEXIBLE_CONTRIBUTIONS_STATE_IDS.generatedAt, now.toISOString(), writeOpts);
        await (0, state_write_1.setStateIfChanged)(host, states_1.FLEXIBLE_CONTRIBUTIONS_STATE_IDS.contributionsJson, JSON.stringify(contributions), writeOpts);
        await (0, state_write_1.setStateIfChanged)(host, states_1.FLEXIBLE_CONTRIBUTIONS_STATE_IDS.activeJson, JSON.stringify(active.map((c) => c.contributionId)), writeOpts);
        await (0, state_write_1.setStateIfChanged)(host, states_1.FLEXIBLE_CONTRIBUTIONS_STATE_IDS.excludedJson, JSON.stringify(excluded), writeOpts);
        await (0, state_write_1.setStateIfChanged)(host, states_1.FLEXIBLE_CONTRIBUTIONS_STATE_IDS.reasonDe, `${active.length} aktiv, ${excluded.length} ausgeschlossen.`, writeOpts);
        await (0, state_write_1.setStateIfChanged)(host, states_1.FLEXIBLE_CONTRIBUTIONS_STATE_IDS.revision, nextRevision, writeOpts);
        await writeAddonStates(host, "battery", contributions, writeOpts, nextRevision);
        await writeAddonStates(host, "wallbox", contributions, writeOpts, nextRevision);
        await writeAddonStates(host, "immersion_heater", contributions, writeOpts, nextRevision);
        await writeAddonStates(host, "air_conditioning", contributions, writeOpts, nextRevision);
        if (revisionChanged) {
            revision = nextRevision;
            lastRevisionPayload = payload;
        }
    }
    catch (e) {
        host.log?.warn?.(`flexible contributions state write: ${String(e)}`);
    }
    return contributions;
}
exports.runFlexibleContributionsTick = runFlexibleContributionsTick;
