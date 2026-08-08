/**
 * Beta Notification Surface — Candidates sichtbar machen, kein Push-Provider.
 */

import type { NotificationCandidate } from "../learning/day_evaluation/notify";

export type ProductNotificationSurface = {
	schemaVersion: 1;
	updatedAtIso: string;
	count: number;
	/** Höchste Severity zuletzt (info < warn < alert). */
	lastSeverity: "info" | "warn" | "alert" | null;
	lastKind: string | null;
	lastReasonDe: string | null;
	lastDedupKey: string | null;
	lastCreatedAtIso: string | null;
	/** Kompakte Liste für UI (max 8). */
	items: Array<{
		kind: string;
		severity: "info" | "warn" | "alert";
		dedupKey: string;
		reasonDe: string;
		createdAtIso: string;
	}>;
};

function severityFor(kind: NotificationCandidate["kind"]): "info" | "warn" | "alert" {
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

const SEV_RANK = { info: 1, warn: 2, alert: 3 } as const;

export function buildProductNotificationSurface(
	candidates: NotificationCandidate[],
	nowIso: string,
): ProductNotificationSurface {
	const items = candidates.slice(0, 8).map((c) => ({
		kind: c.kind,
		severity: severityFor(c.kind),
		dedupKey: c.dedupKey,
		reasonDe: c.reasonDe.slice(0, 240),
		createdAtIso: c.createdAtIso,
	}));
	let best: (typeof items)[0] | null = null;
	for (const it of items) {
		if (!best || SEV_RANK[it.severity] >= SEV_RANK[best.severity]) best = it;
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
