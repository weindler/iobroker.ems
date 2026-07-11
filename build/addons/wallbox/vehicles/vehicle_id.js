"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.evccTokensMatch = exports.normalizeEvccMatchToken = exports.vehicleIdFromEvccTechnicalId = exports.sanitizeVehicleId = void 0;
const node_crypto_1 = require("node:crypto");
const VIN_PATTERN = /^[A-HJ-NPR-Z0-9]{17}$/i;
const SAFE_ID_PATTERN = /^[a-z0-9_]{1,64}$/;
function looksLikeVin(raw) {
    const compact = raw.replace(/[\s-]/g, "");
    return compact.length === 17 && VIN_PATTERN.test(compact);
}
function slugify(raw) {
    return raw
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9_]+/g, "_")
        .replace(/_+/g, "_")
        .replace(/^_|_$/g, "");
}
/** Normalize admin / config vehicle_id to a safe ioBroker object segment. */
function sanitizeVehicleId(raw) {
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
exports.sanitizeVehicleId = sanitizeVehicleId;
/** Stable anonymized id from a technical EVCC vehicle id (never exposes raw id in paths). */
function vehicleIdFromEvccTechnicalId(technicalId) {
    const trimmed = technicalId.trim();
    const digest = (0, node_crypto_1.createHash)("sha256").update(trimmed, "utf8").digest("hex").slice(0, 12);
    return `evcc_${digest}`;
}
exports.vehicleIdFromEvccTechnicalId = vehicleIdFromEvccTechnicalId;
function normalizeEvccMatchToken(raw) {
    if (raw === null || raw === undefined)
        return null;
    const s = String(raw).trim().toLowerCase();
    return s || null;
}
exports.normalizeEvccMatchToken = normalizeEvccMatchToken;
function evccTokensMatch(profileToken, detected) {
    if (!profileToken || !detected)
        return false;
    return profileToken === detected.trim().toLowerCase();
}
exports.evccTokensMatch = evccTokensMatch;
