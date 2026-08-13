import { normalizeOptionalBool, normalizeOptionalSoc } from "../../normalize";
import type { EvExternalControlType } from "../types";
import type { ExternalSourceQuality } from "./types";

export const DEFAULT_EXTERNAL_STALE_AFTER_MIN = 30;

export function resolveExternalSourceQuality(input: {
	configured: boolean;
	anyMappedReadable: boolean;
	anyMappedMissing: boolean;
	controlInvalid: boolean;
	planInvalid: boolean;
	planDegraded: boolean;
	stale: boolean;
}): ExternalSourceQuality {
	if (!input.configured) return "unconfigured";
	if (input.stale) return "stale";
	if (input.planInvalid && !input.anyMappedReadable) return "invalid";
	if (input.planInvalid && input.anyMappedReadable) return "degraded";
	if (input.controlInvalid) return "invalid";
	if (input.anyMappedMissing && !input.anyMappedReadable) return "unknown";
	if (input.planDegraded) return "degraded";
	if (input.anyMappedReadable) return "ok";
	return "unknown";
}

export function sourceIsHealthy(quality: ExternalSourceQuality): boolean {
	return quality === "ok" || quality === "degraded" || quality === "unconfigured";
}

export function externalControlEnabledFromConfig(input: {
	externalControlType: EvExternalControlType;
	tibberGridRewardsViaVehicleEnabled: boolean;
	tibberGridRewardsViaWallboxEnabled: boolean;
}): boolean {
	if (input.tibberGridRewardsViaVehicleEnabled || input.tibberGridRewardsViaWallboxEnabled) {
		return true;
	}
	return input.externalControlType !== "none";
}

/** Smart-charging status → boolean without inventing false for unknown strings. */
export function normalizeSmartChargingActive(raw: unknown): boolean | null {
	const asBool = normalizeOptionalBool(raw);
	if (asBool.status === "valid") return asBool.value;
	if (asBool.status === "missing") return null;
	const s = String(raw ?? "")
		.trim()
		.toLowerCase();
	if (!s) return null;
	if (["charging", "active", "smart", "smart_charging", "in_progress", "in-progress"].includes(s)) {
		return true;
	}
	if (["idle", "inactive", "disabled", "complete", "completed", "paused", "pause"].includes(s)) {
		return false;
	}
	return null;
}

export function normalizeOptionalBoolOrNull(raw: unknown): boolean | null {
	const f = normalizeOptionalBool(raw);
	return f.status === "valid" ? f.value : null;
}

export function normalizeOptionalSocOrNull(raw: unknown): number | null {
	const f = normalizeOptionalSoc(raw);
	return f.status === "valid" ? f.value : null;
}

export function isStale(updatedAtMs: number | null, nowMs: number, staleAfterMin: number): boolean {
	if (updatedAtMs === null || staleAfterMin <= 0) return false;
	return nowMs - updatedAtMs > staleAfterMin * 60_000;
}
