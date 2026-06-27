import type { IntentAdminConfig } from "../config";
import {
	buildManualOverrideFromRequest,
	fieldFromUser,
	finalizeRequestResult,
	gateIobrokerRequest,
	type BaseIobrokerRequest,
} from "../core/iobroker_request_shared";
import type { IobrokerRequestResult, ManualOverrideState } from "../core/types";
import {
	normalizeOperatingRequest,
	normalizeTargetTemperature,
	normalizeThermalPriority,
	normalizeThermalReadyAt,
} from "../thermal/normalize";
import type { IobrokerThermalSnapshot } from "../thermal/types";
import { applyThermalClearFields } from "../thermal/resolve";

export interface IobrokerThermalRequest extends BaseIobrokerRequest {
	values?: {
		operating_request?: string;
		target_temperature_c?: number;
		ready_at?: {
			at?: string;
			timezone?: string;
		};
		priority?: string;
	};
}

export interface ProcessThermalRequestInput {
	raw: unknown;
	ack: boolean | undefined;
	now: Date;
	admin: IntentAdminConfig;
	lastRequestId: string | null;
	currentRevision: number;
	existingSnapshot: IobrokerThermalSnapshot | null;
}

export interface ProcessThermalRequestOutput {
	result: IobrokerRequestResult;
	snapshot: IobrokerThermalSnapshot | null;
	accepted: boolean;
}

function emptySnapshot(now: Date): IobrokerThermalSnapshot {
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

export function processIobrokerThermalRequest(input: ProcessThermalRequestInput): ProcessThermalRequestOutput {
	const { raw, ack, now, admin, lastRequestId, currentRevision, existingSnapshot } = input;
	const gate = gateIobrokerRequest({ raw, ack, now, lastRequestId, currentRevision });
	if (!gate.proceed) {
		return { result: gate.result, snapshot: existingSnapshot, accepted: false };
	}

	const req = gate.req as IobrokerThermalRequest;
	const ownerType = req.owner.type;
	const ownerId = req.owner.id;
	const tz = req.values?.ready_at?.timezone ?? admin.timezone;

	let snapshot = existingSnapshot ? { ...existingSnapshot } : emptySnapshot(now);
	snapshot.observed_at = gate.processedAt;
	snapshot.request_id = req.request_id;

	const valueErrors: string[] = [];
	let partial = false;

	if (req.values?.operating_request !== undefined) {
		const norm = normalizeOperatingRequest(req.values.operating_request);
		if (norm.status === "valid" && norm.value !== "unknown") {
			snapshot.operating_request = fieldFromUser(norm.value, "valid", req.issued_at, ownerType, ownerId, req.values.operating_request);
		} else {
			valueErrors.push("invalid_operating_request");
			partial = true;
		}
	}

	if (req.values?.target_temperature_c !== undefined) {
		const norm = normalizeTargetTemperature(req.values.target_temperature_c);
		if (norm.status === "valid") {
			snapshot.target_temperature_c = fieldFromUser(norm.value, "valid", req.issued_at, ownerType, ownerId, req.values.target_temperature_c);
		} else {
			valueErrors.push("invalid_target_temperature_c");
			partial = true;
		}
	}

	if (req.values?.ready_at !== undefined) {
		const ra = req.values.ready_at;
		const norm = normalizeThermalReadyAt(ra.at, tz, now, "ready_by");
		if (norm.status === "valid" && norm.value) {
			snapshot.ready_at = fieldFromUser(norm.value, "valid", req.issued_at, ownerType, ownerId, ra);
		} else if (norm.status === "expired") {
			valueErrors.push("ready_at_expired");
			partial = true;
		} else {
			valueErrors.push("invalid_ready_at");
			partial = true;
		}
	}

	if (req.values?.priority !== undefined) {
		const norm = normalizeThermalPriority(req.values.priority);
		if (norm.status === "valid" && norm.value !== "unknown") {
			snapshot.priority = fieldFromUser(norm.value, "valid", req.issued_at, ownerType, ownerId, req.values.priority);
		} else {
			valueErrors.push("invalid_priority");
			partial = true;
		}
	}

	const override = buildManualOverrideFromRequest(req, admin);
	if (override) {
		snapshot.manual_override = override;
	}

	if (req.clear_fields && req.clear_fields.length > 0) {
		snapshot = applyThermalClearFields(snapshot, req.clear_fields);
	}

	if (valueErrors.length > 0 && !req.values) {
		return {
			result: finalizeRequestResult(req, "rejected_invalid", gate.processedAt, currentRevision, valueErrors),
			snapshot: existingSnapshot,
			accepted: false,
		};
	}

	return {
		result: finalizeRequestResult(req, partial ? "accepted_partial" : "accepted", gate.processedAt, currentRevision, valueErrors),
		snapshot,
		accepted: true,
	};
}

export function snapshotToThermalManualOverride(snapshot: IobrokerThermalSnapshot | null): ManualOverrideState | null {
	if (!snapshot?.manual_override?.active) return null;
	return snapshot.manual_override;
}
