"use strict";
/**
 * Beta Notification Surface — Candidates sichtbar machen, kein Push-Provider.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildProductNotificationSurface = void 0;
function severityFor(kind) {
    switch (kind) {
        case "goal_missed":
        case "vehicle_goal_at_risk":
        case "forecast_collapse":
            return "alert";
        case "vehicle_grid_charge_recommended":
        case "planning_data_missing":
            return "warn";
        default:
            return "info";
    }
}
const SEV_RANK = { info: 1, warn: 2, alert: 3 };
function buildProductNotificationSurface(candidates, nowIso) {
    const items = candidates.slice(0, 8).map((c) => ({
        kind: c.kind,
        severity: severityFor(c.kind),
        dedupKey: c.dedupKey,
        reasonDe: c.reasonDe.slice(0, 240),
        createdAtIso: c.createdAtIso,
    }));
    let best = null;
    for (const it of items) {
        if (!best || SEV_RANK[it.severity] >= SEV_RANK[best.severity])
            best = it;
    }
    return {
        schemaVersion: 1,
        updatedAtIso: nowIso,
        count: candidates.length,
        lastSeverity: best?.severity ?? null,
        lastKind: best?.kind ?? null,
        lastReasonDe: best?.reasonDe ?? null,
        lastDedupKey: best?.dedupKey ?? null,
        lastCreatedAtIso: best?.createdAtIso ?? null,
        items,
    };
}
exports.buildProductNotificationSurface = buildProductNotificationSurface;
