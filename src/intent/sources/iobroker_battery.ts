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
	normalizeBatteryOperatingRequest,
	normalizeBatteryTargetSoc,
	normalizeBooleanIntent,
	normalizeGridChargeRequest,
} from "../battery/normalize";
import type { IobrokerBatterySnapshot } from "../battery/types";
import { applyBatteryClearFields } from "../battery/resolve";

export interface IobrokerBatteryRequest extends BaseIobrokerRequest {
	values?: {
		operating_request?: string;
		target_soc_pct?: number;
		grid_charge_request?: string;
		ev_discharge_allowed?: boolean;
		top_off_requested?: boolean;
	};
}

export interface ProcessBatteryRequestInput {
	raw: unknown;
	ack: boolean | undefined;
	now: Date;
	admin: IntentAdminConfig;
	lastRequestId: string | null;
	currentRevision: number;
	existingSnapshot: IobrokerBatterySnapshot | null;
}

export interface ProcessBatteryRequestOutput {
	result: IobrokerRequestResult;
	snapshot: IobrokerBatterySnapshot | null;
	accepted: boolean;
}

function emptySnapshot(now: Date): IobrokerBatterySnapshot {
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

export function processIobrokerBatteryRequest(input: ProcessBatteryRequestInput): ProcessBatteryRequestOutput {
	const { raw, ack, now, admin, lastRequestId, currentRevision, existingSnapshot } = input;
	const gate = gateIobrokerRequest({ raw, ack, now, lastRequestId, currentRevision });
	if (!gate.proceed) {
		return { result: gate.result, snapshot: existingSnapshot, accepted: false };
	}

	const req = gate.req as IobrokerBatteryRequest;
	const ownerType = req.owner.type;
	const ownerId = req.owner.id;

	let snapshot = existingSnapshot ? { ...existingSnapshot } : emptySnapshot(now);
	snapshot.observed_at = gate.processedAt;
	snapshot.request_id = req.request_id;

	const valueErrors: string[] = [];
	let partial = false;

	if (req.values?.operating_request !== undefined) {
		const norm = normalizeBatteryOperatingRequest(req.values.operating_request);
		if (norm.status === "valid" && norm.value !== "unknown") {
			snapshot.operating_request = fieldFromUser(norm.value, "valid", req.issued_at, ownerType, ownerId, req.values.operating_request);
		} else {
			valueErrors.push("invalid_operating_request");
			partial = true;
		}
	}

	if (req.values?.target_soc_pct !== undefined) {
		const norm = normalizeBatteryTargetSoc(req.values.target_soc_pct);
		if (norm.status === "valid") {
			snapshot.target_soc_pct = fieldFromUser(norm.value, "valid", req.issued_at, ownerType, ownerId, req.values.target_soc_pct);
		} else {
			valueErrors.push("invalid_target_soc_pct");
			partial = true;
		}
	}

	if (req.values?.grid_charge_request !== undefined) {
		const norm = normalizeGridChargeRequest(req.values.grid_charge_request);
		if (norm.status === "valid" && norm.value !== "unknown") {
			snapshot.grid_charge_request = fieldFromUser(norm.value, "valid", req.issued_at, ownerType, ownerId, req.values.grid_charge_request);
		} else {
			valueErrors.push("invalid_grid_charge_request");
			partial = true;
		}
	}

	if (req.values?.ev_discharge_allowed !== undefined) {
		const norm = normalizeBooleanIntent(req.values.ev_discharge_allowed);
		if (norm.status === "valid") {
			snapshot.ev_discharge_allowed = fieldFromUser(norm.value, "valid", req.issued_at, ownerType, ownerId, req.values.ev_discharge_allowed);
		} else {
			valueErrors.push("invalid_ev_discharge_allowed");
			partial = true;
		}
	}

	if (req.values?.top_off_requested !== undefined) {
		const norm = normalizeBooleanIntent(req.values.top_off_requested);
		if (norm.status === "valid") {
			snapshot.top_off_requested = fieldFromUser(norm.value, "valid", req.issued_at, ownerType, ownerId, req.values.top_off_requested);
		} else {
			valueErrors.push("invalid_top_off_requested");
			partial = true;
		}
	}

	const override = buildManualOverrideFromRequest(req, admin);
	if (override) {
		snapshot.manual_override = override;
	}

	if (req.clear_fields && req.clear_fields.length > 0) {
		snapshot = applyBatteryClearFields(snapshot, req.clear_fields);
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

export function snapshotToBatteryManualOverride(snapshot: IobrokerBatterySnapshot | null): ManualOverrideState | null {
	if (!snapshot?.manual_override?.active) return null;
	return snapshot.manual_override;
}
