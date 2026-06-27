import type { IobrokerRequestResult, ManualOverrideState } from "../core/types";
import {
	buildManualOverrideFromRequest,
	fieldFromUser,
	finalizeRequestResult,
	gateIobrokerRequest,
	type BaseIobrokerRequest,
} from "../core/iobroker_request_shared";
import {
	normalizeChargeStrategyFromString,
	normalizeDeadline,
	normalizeTargetSoc,
} from "../wallbox/normalize";
import type { IobrokerIntentSnapshot } from "../wallbox/types";
import type { IntentAdminConfig } from "../config";
import { applyClearFields } from "../wallbox/resolve";

export interface IobrokerWallboxRequest extends BaseIobrokerRequest {
	values?: {
		charge_strategy?: string;
		target_soc_pct?: number;
		deadline?: {
			type?: "ready_by" | "departure";
			at?: string;
			timezone?: string;
		};
	};
}

export interface ProcessRequestInput {
	raw: unknown;
	ack: boolean | undefined;
	now: Date;
	admin: IntentAdminConfig;
	lastRequestId: string | null;
	currentRevision: number;
	existingSnapshot: IobrokerIntentSnapshot | null;
}

export interface ProcessRequestOutput {
	result: IobrokerRequestResult;
	snapshot: IobrokerIntentSnapshot | null;
	accepted: boolean;
}

function emptySnapshot(now: Date): IobrokerIntentSnapshot {
	return {
		observed_at: now.toISOString(),
		charge_strategy: null,
		target_soc_pct: null,
		deadline: null,
		manual_override: null,
		request_id: null,
	};
}

export function parseIobrokerRequest(raw: unknown): { ok: true; req: IobrokerWallboxRequest } | { ok: false; errors: string[] } {
	const gate = gateIobrokerRequest({
		raw,
		ack: false,
		now: new Date(),
		lastRequestId: null,
		currentRevision: 0,
	});
	if (gate.proceed) {
		return { ok: true, req: gate.req as IobrokerWallboxRequest };
	}
	return { ok: false, errors: gate.result.errors };
}

export function processIobrokerWallboxRequest(input: ProcessRequestInput): ProcessRequestOutput {
	const { raw, ack, now, admin, lastRequestId, currentRevision, existingSnapshot } = input;
	const gate = gateIobrokerRequest({ raw, ack, now, lastRequestId, currentRevision });
	if (!gate.proceed) {
		return { result: gate.result, snapshot: existingSnapshot, accepted: false };
	}

	const req = gate.req as IobrokerWallboxRequest;
	const ownerType = req.owner.type;
	const ownerId = req.owner.id;
	const tz = req.values?.deadline?.timezone ?? admin.timezone;

	let snapshot = existingSnapshot ? { ...existingSnapshot } : emptySnapshot(now);
	snapshot.observed_at = gate.processedAt;
	snapshot.request_id = req.request_id;

	const valueErrors: string[] = [];
	let partial = false;

	if (req.values?.charge_strategy !== undefined) {
		const norm = normalizeChargeStrategyFromString(req.values.charge_strategy);
		if (norm.status === "valid" && norm.strategy !== "unknown") {
			snapshot.charge_strategy = fieldFromUser(
				norm.strategy,
				"valid",
				req.issued_at,
				ownerType,
				ownerId,
				req.values.charge_strategy,
			);
		} else {
			valueErrors.push("invalid_charge_strategy");
			partial = true;
		}
	}

	if (req.values?.target_soc_pct !== undefined) {
		const norm = normalizeTargetSoc(req.values.target_soc_pct);
		if (norm.status === "valid") {
			snapshot.target_soc_pct = fieldFromUser(norm.value, "valid", req.issued_at, ownerType, ownerId, req.values.target_soc_pct);
		} else {
			valueErrors.push("invalid_target_soc_pct");
			partial = true;
		}
	}

	if (req.values?.deadline !== undefined) {
		const dl = req.values.deadline;
		const norm = normalizeDeadline(dl.at, tz, now, dl.type ?? "departure");
		if (norm.status === "valid") {
			snapshot.deadline = fieldFromUser(norm.value, "valid", req.issued_at, ownerType, ownerId, dl);
		} else if (norm.status === "expired") {
			valueErrors.push("deadline_expired");
			partial = true;
		} else {
			valueErrors.push("invalid_deadline");
			partial = true;
		}
	}

	const override = buildManualOverrideFromRequest(req, admin);
	if (override) {
		snapshot.manual_override = override;
	}

	if (req.clear_fields && req.clear_fields.length > 0) {
		snapshot = applyClearFields(snapshot, req.clear_fields);
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

export function snapshotToManualOverride(snapshot: IobrokerIntentSnapshot | null): ManualOverrideState | null {
	if (!snapshot?.manual_override?.active) {
		return null;
	}
	return snapshot.manual_override;
}
