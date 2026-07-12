"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.forecastPlanSemanticRevisionHash = exports.forecastPlanRevisionPayload = void 0;
const node_crypto_1 = require("node:crypto");
/** Contribution fields excluded from semantic revision (volatile / runtime). */
const REVISION_OMIT_CONTRIBUTION_KEYS = new Set([
    "generatedAt",
    "validUntil",
    "revision",
]);
/** Detail keys that must not bump revision when alone changed. */
const REVISION_OMIT_DETAIL_KEYS = new Set([
    "lastUpdate",
    "lastUpdateTs",
    "calculated_at",
    "calculatedAt",
    "runtimeId",
    "runtime_id",
]);
function stripVolatileDetails(details) {
    const out = {};
    for (const [key, value] of Object.entries(details)) {
        if (REVISION_OMIT_DETAIL_KEYS.has(key))
            continue;
        out[key] = value;
    }
    return out;
}
function contributionForRevision(c) {
    return {
        contributionId: c.contributionId,
        flow: c.flow,
        contributor: c.contributor,
        roles: c.roles,
        enabled: c.enabled,
        quality: c.quality,
        details: stripVolatileDetails(c.details),
        slots: c.slots,
    };
}
/** Semantic revision payload — excludes generatedAt, horizonStart and other volatile fields. */
function forecastPlanRevisionPayload(plan) {
    const payload = {
        status: plan.status,
        timezone: plan.timezone,
        horizonEnd: plan.horizonEnd,
        slotMinutes: plan.slotMinutes,
        activeContributors: plan.activeContributors,
        excludedContributors: plan.excludedContributors,
        days: plan.days,
        slots: plan.slots,
        contributions: plan.contributions.map(contributionForRevision),
        quality: plan.quality,
        reasonDe: plan.reasonDe,
    };
    return JSON.stringify(payload);
}
exports.forecastPlanRevisionPayload = forecastPlanRevisionPayload;
function forecastPlanSemanticRevisionHash(plan) {
    return (0, node_crypto_1.createHash)("sha256").update(forecastPlanRevisionPayload(plan)).digest("hex");
}
exports.forecastPlanSemanticRevisionHash = forecastPlanSemanticRevisionHash;
