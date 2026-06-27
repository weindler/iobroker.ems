"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.snapshotToBatteryManualOverride = exports.processIobrokerBatteryRequest = void 0;
const iobroker_request_shared_1 = require("../core/iobroker_request_shared");
const normalize_1 = require("../battery/normalize");
const resolve_1 = require("../battery/resolve");
function emptySnapshot(now) {
    return {
        observed_at: now.toISOString(),
        operating_request: null,
        target_soc_pct: null,
        grid_charge_request: null,
        ev_discharge_allowed: null,
        top_off_requested: null,
        manual_override: null,
        request_id: null,
    };
}
function processIobrokerBatteryRequest(input) {
    const { raw, ack, now, admin, lastRequestId, currentRevision, existingSnapshot } = input;
    const gate = (0, iobroker_request_shared_1.gateIobrokerRequest)({ raw, ack, now, lastRequestId, currentRevision });
    if (!gate.proceed) {
        return { result: gate.result, snapshot: existingSnapshot, accepted: false };
    }
    const req = gate.req;
    const ownerType = req.owner.type;
    const ownerId = req.owner.id;
    let snapshot = existingSnapshot ? { ...existingSnapshot } : emptySnapshot(now);
    snapshot.observed_at = gate.processedAt;
    snapshot.request_id = req.request_id;
    const valueErrors = [];
    let partial = false;
    if (req.values?.operating_request !== undefined) {
        const norm = (0, normalize_1.normalizeBatteryOperatingRequest)(req.values.operating_request);
        if (norm.status === "valid" && norm.value !== "unknown") {
            snapshot.operating_request = (0, iobroker_request_shared_1.fieldFromUser)(norm.value, "valid", req.issued_at, ownerType, ownerId, req.values.operating_request);
        }
        else {
            valueErrors.push("invalid_operating_request");
            partial = true;
        }
    }
    if (req.values?.target_soc_pct !== undefined) {
        const norm = (0, normalize_1.normalizeBatteryTargetSoc)(req.values.target_soc_pct);
        if (norm.status === "valid") {
            snapshot.target_soc_pct = (0, iobroker_request_shared_1.fieldFromUser)(norm.value, "valid", req.issued_at, ownerType, ownerId, req.values.target_soc_pct);
        }
        else {
            valueErrors.push("invalid_target_soc_pct");
            partial = true;
        }
    }
    if (req.values?.grid_charge_request !== undefined) {
        const norm = (0, normalize_1.normalizeGridChargeRequest)(req.values.grid_charge_request);
        if (norm.status === "valid" && norm.value !== "unknown") {
            snapshot.grid_charge_request = (0, iobroker_request_shared_1.fieldFromUser)(norm.value, "valid", req.issued_at, ownerType, ownerId, req.values.grid_charge_request);
        }
        else {
            valueErrors.push("invalid_grid_charge_request");
            partial = true;
        }
    }
    if (req.values?.ev_discharge_allowed !== undefined) {
        const norm = (0, normalize_1.normalizeBooleanIntent)(req.values.ev_discharge_allowed);
        if (norm.status === "valid") {
            snapshot.ev_discharge_allowed = (0, iobroker_request_shared_1.fieldFromUser)(norm.value, "valid", req.issued_at, ownerType, ownerId, req.values.ev_discharge_allowed);
        }
        else {
            valueErrors.push("invalid_ev_discharge_allowed");
            partial = true;
        }
    }
    if (req.values?.top_off_requested !== undefined) {
        const norm = (0, normalize_1.normalizeBooleanIntent)(req.values.top_off_requested);
        if (norm.status === "valid") {
            snapshot.top_off_requested = (0, iobroker_request_shared_1.fieldFromUser)(norm.value, "valid", req.issued_at, ownerType, ownerId, req.values.top_off_requested);
        }
        else {
            valueErrors.push("invalid_top_off_requested");
            partial = true;
        }
    }
    const override = (0, iobroker_request_shared_1.buildManualOverrideFromRequest)(req, admin);
    if (override) {
        snapshot.manual_override = override;
    }
    if (req.clear_fields && req.clear_fields.length > 0) {
        snapshot = (0, resolve_1.applyBatteryClearFields)(snapshot, req.clear_fields);
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
exports.processIobrokerBatteryRequest = processIobrokerBatteryRequest;
function snapshotToBatteryManualOverride(snapshot) {
    if (!snapshot?.manual_override?.active)
        return null;
    return snapshot.manual_override;
}
exports.snapshotToBatteryManualOverride = snapshotToBatteryManualOverride;
