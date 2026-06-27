"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.snapshotToManualOverride = exports.processIobrokerWallboxRequest = exports.parseIobrokerRequest = void 0;
const constants_1 = require("../core/constants");
const validation_1 = require("../core/validation");
const normalize_1 = require("../wallbox/normalize");
const resolve_1 = require("../wallbox/resolve");
function emptySnapshot(now) {
    return {
        observed_at: now.toISOString(),
        charge_strategy: null,
        target_soc_pct: null,
        deadline: null,
        manual_override: null,
        request_id: null,
    };
}
function fieldFromUser(value, status, issuedAt, owner, ownerId, raw) {
    return {
        value,
        status,
        origin: {
            source: "iobroker",
            owner,
            owner_id: ownerId,
            change_kind: "manual_explicit",
        },
        observed_at: issuedAt,
        changed_at: issuedAt,
        raw_value: raw,
    };
}
function parseIobrokerRequest(raw) {
    const errors = [];
    if (raw === null || raw === undefined || raw === "") {
        return { ok: false, errors: ["empty_request"] };
    }
    let parsed;
    if (typeof raw === "string") {
        try {
            parsed = JSON.parse(raw);
        }
        catch {
            return { ok: false, errors: ["invalid_json"] };
        }
    }
    else if (typeof raw === "object") {
        parsed = raw;
    }
    else {
        return { ok: false, errors: ["invalid_json"] };
    }
    const obj = parsed;
    if (obj.schema_version !== constants_1.INTENT_SCHEMA_VERSION) {
        errors.push("unsupported_schema_version");
    }
    if (typeof obj.request_id !== "string" || !obj.request_id.trim()) {
        errors.push("missing_request_id");
    }
    if (typeof obj.issued_at !== "string" || !obj.issued_at.trim()) {
        errors.push("missing_issued_at");
    }
    const owner = obj.owner;
    if (!owner || typeof owner.type !== "string") {
        errors.push("missing_owner");
    }
    if (errors.length > 0) {
        return { ok: false, errors };
    }
    return { ok: true, req: obj };
}
exports.parseIobrokerRequest = parseIobrokerRequest;
function capOverrideValidUntil(validUntil, issuedAt, maxMinutes) {
    if (!maxMinutes || !validUntil) {
        return { validUntil, capped: false };
    }
    const issued = Date.parse(issuedAt);
    const until = Date.parse(validUntil);
    if (!Number.isFinite(issued) || !Number.isFinite(until)) {
        return { validUntil, capped: false };
    }
    const maxMs = maxMinutes * 60 * 1000;
    if (until - issued > maxMs) {
        return { validUntil: new Date(issued + maxMs).toISOString(), capped: true };
    }
    return { validUntil, capped: false };
}
function processIobrokerWallboxRequest(input) {
    const { raw, ack, now, admin, lastRequestId, currentRevision, existingSnapshot } = input;
    const processedAt = now.toISOString();
    if (ack === true) {
        return {
            result: {
                request_id: "",
                status: "rejected_invalid",
                processed_at: processedAt,
                revision: currentRevision,
                errors: ["ack_true_ignored"],
            },
            snapshot: existingSnapshot,
            accepted: false,
        };
    }
    const parsed = parseIobrokerRequest(raw);
    if (!parsed.ok) {
        return {
            result: {
                request_id: "",
                status: "rejected_invalid",
                processed_at: processedAt,
                revision: currentRevision,
                errors: parsed.errors,
            },
            snapshot: existingSnapshot,
            accepted: false,
        };
    }
    const req = parsed.req;
    if (lastRequestId === req.request_id) {
        return {
            result: {
                request_id: req.request_id,
                status: "duplicate",
                processed_at: processedAt,
                revision: currentRevision,
                errors: [],
            },
            snapshot: existingSnapshot,
            accepted: false,
        };
    }
    if ((0, validation_1.isExpiredAt)(req.issued_at, now)) {
        return {
            result: {
                request_id: req.request_id,
                status: "rejected_expired",
                processed_at: processedAt,
                revision: currentRevision,
                errors: ["issued_at_expired"],
            },
            snapshot: existingSnapshot,
            accepted: false,
        };
    }
    const ownerType = req.owner.type;
    const ownerId = req.owner.id;
    const tz = req.values?.deadline?.timezone ?? admin.timezone;
    let snapshot = existingSnapshot ? { ...existingSnapshot } : emptySnapshot(now);
    snapshot.observed_at = processedAt;
    snapshot.request_id = req.request_id;
    const valueErrors = [];
    let partial = false;
    if (req.values?.charge_strategy !== undefined) {
        const norm = (0, normalize_1.normalizeChargeStrategyFromString)(req.values.charge_strategy);
        if (norm.status === "valid" && norm.strategy !== "unknown") {
            snapshot.charge_strategy = fieldFromUser(norm.strategy, "valid", req.issued_at, ownerType, ownerId, req.values.charge_strategy);
        }
        else {
            valueErrors.push("invalid_charge_strategy");
            partial = true;
        }
    }
    if (req.values?.target_soc_pct !== undefined) {
        const norm = (0, normalize_1.normalizeTargetSoc)(req.values.target_soc_pct);
        if (norm.status === "valid") {
            snapshot.target_soc_pct = fieldFromUser(norm.value, "valid", req.issued_at, ownerType, ownerId, req.values.target_soc_pct);
        }
        else {
            valueErrors.push("invalid_target_soc_pct");
            partial = true;
        }
    }
    if (req.values?.deadline !== undefined) {
        const dl = req.values.deadline;
        const norm = (0, normalize_1.normalizeDeadline)(dl.at, tz, now, dl.type ?? "departure");
        if (norm.status === "valid") {
            snapshot.deadline = fieldFromUser(norm.value, "valid", req.issued_at, ownerType, ownerId, dl);
        }
        else if (norm.status === "expired") {
            valueErrors.push("deadline_expired");
            partial = true;
        }
        else {
            valueErrors.push("invalid_deadline");
            partial = true;
        }
    }
    if (req.manual_override !== undefined) {
        const mo = req.manual_override;
        const { validUntil, capped } = capOverrideValidUntil(mo.valid_until, req.issued_at, admin.manualOverrideMaxMinutes);
        const override = {
            active: mo.active === true,
            scope: mo.scope ?? [],
            source: "iobroker",
            owner: ownerType,
            owner_id: ownerId,
            started_at: req.issued_at,
            valid_until: validUntil,
            reason: capped ? `${mo.reason ?? ""} (capped_to_max_duration)`.trim() : mo.reason,
        };
        snapshot.manual_override = override;
    }
    if (req.clear_fields && req.clear_fields.length > 0) {
        snapshot = (0, resolve_1.applyClearFields)(snapshot, req.clear_fields);
    }
    let status;
    if (valueErrors.length > 0 && !req.values) {
        status = "rejected_invalid";
    }
    else if (valueErrors.length > 0) {
        status = "accepted_partial";
    }
    else {
        status = "accepted";
    }
    if (status === "rejected_invalid") {
        return {
            result: {
                request_id: req.request_id,
                status,
                processed_at: processedAt,
                revision: currentRevision,
                errors: valueErrors,
            },
            snapshot: existingSnapshot,
            accepted: false,
        };
    }
    return {
        result: {
            request_id: req.request_id,
            status: partial ? "accepted_partial" : status,
            processed_at: processedAt,
            revision: currentRevision,
            errors: valueErrors,
        },
        snapshot,
        accepted: true,
    };
}
exports.processIobrokerWallboxRequest = processIobrokerWallboxRequest;
function snapshotToManualOverride(snapshot) {
    if (!snapshot?.manual_override?.active) {
        return null;
    }
    return snapshot.manual_override;
}
exports.snapshotToManualOverride = snapshotToManualOverride;
