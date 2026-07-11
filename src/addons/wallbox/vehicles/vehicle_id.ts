import { createHash } from "node:crypto";

const VIN_PATTERN = /^[A-HJ-NPR-Z0-9]{17}$/i;
const SAFE_ID_PATTERN = /^[a-z0-9_]{1,64}$/;

export interface VehicleIdResult {
	valid: boolean;
	id: string | null;
	reason: string | null;
}

function looksLikeVin(raw: string): boolean {
	const compact = raw.replace(/[\s-]/g, "");
	return compact.length === 17 && VIN_PATTERN.test(compact);
}

function slugify(raw: string): string {
	return raw
		.trim()
		.toLowerCase()
		.replace(/[^a-z0-9_]+/g, "_")
		.replace(/_+/g, "_")
		.replace(/^_|_$/g, "");
}

/** Normalize admin / config vehicle_id to a safe ioBroker object segment. */
export function sanitizeVehicleId(raw: unknown): VehicleIdResult {
	if (raw === null || raw === undefined) {
		return { valid: false, id: null, reason: "vehicle_id_empty" };
	}
	const s = String(raw).trim();
	if (!s) {
		return { valid: false, id: null, reason: "vehicle_id_empty" };
	}
	if (looksLikeVin(s)) {
		return { valid: false, id: null, reason: "vehicle_id_vin_rejected" };
	}
	if (s.includes("@")) {
		return { valid: false, id: null, reason: "vehicle_id_personal_data_rejected" };
	}
	const id = slugify(s);
	if (!id) {
		return { valid: false, id: null, reason: "vehicle_id_invalid" };
	}
	if (!SAFE_ID_PATTERN.test(id)) {
		return { valid: false, id: null, reason: "vehicle_id_invalid" };
	}
	return { valid: true, id, reason: null };
}

/** Stable anonymized id from a technical EVCC vehicle id (never exposes raw id in paths). */
export function vehicleIdFromEvccTechnicalId(technicalId: string): string {
	const trimmed = technicalId.trim();
	const digest = createHash("sha256").update(trimmed, "utf8").digest("hex").slice(0, 12);
	return `evcc_${digest}`;
}

export function normalizeEvccMatchToken(raw: unknown): string | null {
	if (raw === null || raw === undefined) return null;
	const s = String(raw).trim().toLowerCase();
	return s || null;
}

export function evccTokensMatch(profileToken: string | null, detected: string | null): boolean {
	if (!profileToken || !detected) return false;
	return profileToken === detected.trim().toLowerCase();
}
