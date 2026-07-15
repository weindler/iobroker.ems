import { createHash } from "node:crypto";
import { sortKeysDeep } from "../planner_preparation/canonical";
import type { PlannerShadowGridProjection } from "./types";

export function canonicalShadowProjectionJson(projection: PlannerShadowGridProjection): string {
	return JSON.stringify(sortKeysDeep(projection));
}

export function computeShadowProjectionRevision(projection: PlannerShadowGridProjection): string {
	return createHash("sha256").update(canonicalShadowProjectionJson(projection), "utf8").digest("hex");
}

export function shortenRevision(revision: string | undefined, length = 12): string {
	if (!revision) return "";
	return revision.length <= length ? revision : revision.slice(0, length);
}
