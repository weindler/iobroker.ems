"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.snapshotToThermalManualOverride = exports.processIobrokerThermalRequest = void 0;
const iobroker_request_shared_1 = require("../core/iobroker_request_shared");
const normalize_1 = require("../thermal/normalize");
const resolve_1 = require("../thermal/resolve");
function emptySnapshot(now) {
    return {
        observed_at: now.toISOString(),
        operating_request: null,
        target_temperature_c: null,
        ready_at: null,
        priority: null,
        manual_override: null,
        request_id: null,
    };
}
function processIobrokerThermalRequest(input) {
    const { raw, ack, now, admin, lastRequestId, currentRevision, existingSnapshot } = input;
    const gate = (0, iobroker_request_shared_1.gateIobrokerRequest)({ raw, ack, now, lastRequestId, currentRevision });
    if (!gate.proceed) {
        return { result: gate.result, snapshot: existingSnapshot, accepted: false };
    }
    const req = gate.req;
    const ownerType = req.owner.type;
    const ownerId = req.owner.id;
    const tz = req.values?.ready_at?.timezone ?? admin.timezone;
    let snapshot = existingSnapshot ? { ...existingSnapshot } : emptySnapshot(now);
    snapshot.observed_at = gate.processedAt;
    snapshot.request_id = req.request_id;
    const valueErrors = [];
    let partial = false;
    if (req.values?.operating_request !== undefined) {
        const norm = (0, normalize_1.normalizeOperatingRequest)(req.values.operating_request);
        if (norm.status === "valid" && norm.value !== "unknown") {
            snapshot.operating_request = (0, iobroker_request_shared_1.fieldFromUser)(norm.value, "valid", req.issued_at, ownerType, ownerId, req.values.operating_request);
        }
        else {
            valueErrors.push("invalid_operating_request");
            partial = true;
        }
    }
    if (req.values?.target_temperature_c !== undefined) {
        const norm = (0, normalize_1.normalizeTargetTemperature)(req.values.target_temperature_c);
        if (norm.status === "valid") {
            snapshot.target_temperature_c = (0, iobroker_request_shared_1.fieldFromUser)(norm.value, "valid", req.issued_at, ownerType, ownerId, req.values.target_temperature_c);
        }
        else {
            valueErrors.push("invalid_target_temperature_c");
            partial = true;
        }
    }
    if (req.values?.ready_at !== undefined) {
        const ra = req.values.ready_at;
        const norm = (0, normalize_1.normalizeThermalReadyAt)(ra.at, tz, now, "ready_by");
        if (norm.status === "valid" && norm.value) {
            snapshot.ready_at = (0, iobroker_request_shared_1.fieldFromUser)(norm.value, "valid", req.issued_at, ownerType, ownerId, ra);
        }
        else if (norm.status === "expired") {
            valueErrors.push("ready_at_expired");
            partial = true;
        }
        else {
            valueErrors.push("invalid_ready_at");
            partial = true;
        }
    }
    if (req.values?.priority !== undefined) {
        const norm = (0, normalize_1.normalizeThermalPriority)(req.values.priority);
        if (norm.status === "valid" && norm.value !== "unknown") {
            snapshot.priority = (0, iobroker_request_shared_1.fieldFromUser)(norm.value, "valid", req.issued_at, ownerType, ownerId, req.values.priority);
        }
        else {
            valueErrors.push("invalid_priority");
            partial = true;
        }
    }
    const override = (0, iobroker_request_shared_1.buildManualOverrideFromRequest)(req, admin);
    if (override) {
        snapshot.manual_override = override;
    }
    if (req.clear_fields && req.clear_fields.length > 0) {
        snapshot = (0, resolve_1.applyThermalClearFields)(snapshot, req.clear_fields);
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
exports.processIobrokerThermalRequest = processIobrokerThermalRequest;
function snapshotToThermalManualOverride(snapshot) {
    if (!snapshot?.manual_override?.active)
        return null;
    return snapshot.manual_override;
}
exports.snapshotToThermalManualOverride = snapshotToThermalManualOverride;
