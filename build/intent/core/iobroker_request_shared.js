"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.finalizeRequestResult = exports.gateIobrokerRequest = exports.buildManualOverrideFromRequest = exports.capOverrideValidUntil = exports.fieldFromUser = exports.parseBaseIobrokerRequest = void 0;
const constants_1 = require("./constants");
function parseBaseIobrokerRequest(raw) {
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
exports.parseBaseIobrokerRequest = parseBaseIobrokerRequest;
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
exports.fieldFromUser = fieldFromUser;
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
exports.capOverrideValidUntil = capOverrideValidUntil;
function buildManualOverrideFromRequest(req, admin) {
    if (req.manual_override === undefined) {
        return null;
    }
    const mo = req.manual_override;
    const { validUntil, capped } = capOverrideValidUntil(mo.valid_until, req.issued_at, admin.manualOverrideMaxMinutes);
    return {
        active: mo.active === true,
        scope: mo.scope ?? [],
        source: "iobroker",
        owner: req.owner.type,
        owner_id: req.owner.id,
        started_at: req.issued_at,
        valid_until: validUntil,
        reason: capped ? `${mo.reason ?? ""} (capped_to_max_duration)`.trim() : mo.reason,
    };
}
exports.buildManualOverrideFromRequest = buildManualOverrideFromRequest;
function gateIobrokerRequest(input) {
    const { raw, ack, now, lastRequestId, currentRevision } = input;
    const processedAt = now.toISOString();
    if (ack === true) {
        return {
            proceed: false,
            result: {
                request_id: "",
                status: "rejected_invalid",
                processed_at: processedAt,
                revision: currentRevision,
                errors: ["ack_true_ignored"],
            },
            accepted: false,
        };
    }
    const parsed = parseBaseIobrokerRequest(raw);
    if (!parsed.ok) {
        return {
            proceed: false,
            result: {
                request_id: "",
                status: "rejected_invalid",
                processed_at: processedAt,
                revision: currentRevision,
                errors: parsed.errors,
            },
            accepted: false,
        };
    }
    const req = parsed.req;
    if (lastRequestId === req.request_id) {
        return {
            proceed: false,
            result: {
                request_id: req.request_id,
                status: "duplicate",
                processed_at: processedAt,
                revision: currentRevision,
                errors: [],
            },
            accepted: false,
        };
    }
    // `issued_at` ist die Erstellungszeit (Provenance), KEIN Ablaufdatum: Es liegt per
    // Definition in der Vergangenheit, daher darf es nicht zu `rejected_expired` führen
    // (sonst Sub-Millisekunden-Race bei jeder realen Anfrage). Echte Befristung läuft über
    // `manual_override.valid_until` (capOverrideValidUntil + candidateUsable).
    return { proceed: true, req, processedAt };
}
exports.gateIobrokerRequest = gateIobrokerRequest;
function finalizeRequestResult(req, status, processedAt, currentRevision, errors) {
    return {
        request_id: req.request_id,
        status,
        processed_at: processedAt,
        revision: currentRevision,
        errors,
    };
}
exports.finalizeRequestResult = finalizeRequestResult;
