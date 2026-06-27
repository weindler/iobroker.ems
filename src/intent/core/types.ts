/** Phase 3B — User Intent Foundation (read-only capture, no planner decisions). */

export type IntentSource = "evcc" | "iobroker" | "admin" | "ems_ui" | "addon" | "unknown";

export type IntentOwner =
	| "user"
	| "evcc"
	| "admin_config"
	| "iobroker_automation"
	| "external_automation"
	| "device"
	| "unknown";

export type ChangeKind =
	| "manual_explicit"
	| "manual_inferred"
	| "automation"
	| "configured"
	| "restored"
	| "unknown";

export type WallboxChargeStrategy = "off" | "min_pv" | "pv" | "immediate" | "unknown";

export type IntentState =
	| "available"
	| "partial"
	| "none"
	| "invalid"
	| "expired"
	| "conflict"
	| "disabled"
	| "not_configured";

export type IntentFieldStatus = "valid" | "missing" | "invalid" | "expired";

export interface IntentOrigin {
	source: IntentSource;
	owner: IntentOwner;
	owner_id?: string;
	change_kind: ChangeKind;
}

export interface IntentField<T> {
	value: T | null;
	status: IntentFieldStatus;
	origin: IntentOrigin;
	observed_at: string;
	changed_at?: string;
	valid_until?: string;
	raw_value?: unknown;
}

export type WallboxDeadlineType = "ready_by" | "departure";

export interface WallboxDeadlineValue {
	type: WallboxDeadlineType;
	at: string;
	timezone: string;
}

export interface ManualOverrideState {
	active: boolean;
	scope: string[];
	source: IntentSource;
	owner: IntentOwner;
	owner_id?: string;
	started_at?: string;
	valid_until?: string;
	reason?: string;
}

export type IobrokerRequestStatus =
	| "accepted"
	| "accepted_partial"
	| "rejected_invalid"
	| "rejected_expired"
	| "duplicate";

export interface IobrokerRequestResult {
	request_id: string;
	status: IobrokerRequestStatus;
	processed_at: string;
	revision: number;
	errors: string[];
}

/** Kandidat für ein einzelnes Feld aus einer Quelle. */
export interface FieldCandidate<T> {
	value: T | null;
	status: IntentFieldStatus;
	origin: IntentOrigin;
	observed_at: string;
	changed_at?: string;
	valid_until?: string;
	raw_value?: unknown;
	priority: number;
}
