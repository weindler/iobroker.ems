"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.snapshotToManualOverride = exports.processIobrokerWallboxRequest = exports.parseIobrokerRequest = void 0;
const iobroker_request_shared_1 = require("../core/iobroker_request_shared");
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
function parseIobrokerRequest(raw) {
    const gate = (0, iobroker_request_shared_1.gateIobrokerRequest)({
        raw,
        ack: false,
        now: new Date(),
        lastRequestId: null,
        currentRevision: 0,
    });
    if (gate.proceed) {
        return { ok: true, req: gate.req };
    }
    return { ok: false, errors: gate.result.errors };
}
exports.parseIobrokerRequest = parseIobrokerRequest;
function processIobrokerWallboxRequest(input) {
    const { raw, ack, now, admin, lastRequestId, currentRevision, existingSnapshot } = input;
    const gate = (0, iobroker_request_shared_1.gateIobrokerRequest)({ raw, ack, now, lastRequestId, currentRevision });
    if (!gate.proceed) {
        return { result: gate.result, snapshot: existingSnapshot, accepted: false };
    }
    const req = gate.req;
    const ownerType = req.owner.type;
    const ownerId = req.owner.id;
    const tz = req.values?.deadline?.timezone ?? admin.timezone;
    let snapshot = existingSnapshot ? { ...existingSnapshot } : emptySnapshot(now);
    snapshot.observed_at = gate.processedAt;
    snapshot.request_id = req.request_id;
    const valueErrors = [];
    let partial = false;
    if (req.values?.charge_strategy !== undefined) {
        const norm = (0, normalize_1.normalizeChargeStrategyFromString)(req.values.charge_strategy);
        if (norm.status === "valid" && norm.strategy !== "unknown") {
            snapshot.charge_strategy = (0, iobroker_request_shared_1.fieldFromUser)(norm.strategy, "valid", req.issued_at, ownerType, ownerId, req.values.charge_strategy);
        }
        else {
            valueErrors.push("invalid_charge_strategy");
            partial = true;
        }
    }
    if (req.values?.target_soc_pct !== undefined) {
        const norm = (0, normalize_1.normalizeTargetSoc)(req.values.target_soc_pct);
        if (norm.status === "valid") {
            snapshot.target_soc_pct = (0, iobroker_request_shared_1.fieldFromUser)(norm.value, "valid", req.issued_at, ownerType, ownerId, req.values.target_soc_pct);
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
            snapshot.deadline = (0, iobroker_request_shared_1.fieldFromUser)(norm.value, "valid", req.issued_at, ownerType, ownerId, dl);
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
    const override = (0, iobroker_request_shared_1.buildManualOverrideFromRequest)(req, admin);
    if (override) {
        snapshot.manual_override = override;
    }
    if (req.clear_fields && req.clear_fields.length > 0) {
        snapshot = (0, resolve_1.applyClearFields)(snapshot, req.clear_fields);
    }
    if (valueErrors.length > 0 && !req.values) {
        return {
            result: (0, iobroker_request_shared_1.finalizeRequestResult)(req, "rejected_invalid", gate.processedAt, currentRevision, valueErrors),
            snapshot: existingSnapshot,
            accepted: false,
        };
    }
    return {
        result: (0, iobroker_request_shared_1.finalizeRequestResult)(req, partial ? "accepted_partial" : "accepted", gate.processedAt, currentRevision, valueErrors),
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
