import { ensureChannel, ensureStates, type StateDef, type StateHost } from "../ems_light/state_util";
import { setOptionalNumberIfChanged, setStateIfChanged } from "../policy/core/state_write";
import type { PlannerAuthorizationPublicStatus } from "./types";

export const PLANNER_AUTHORIZATION_STATE_IDS = {
	configuredMode: "planner.takeover.authorization.configured_mode",
	effectiveMode: "planner.takeover.authorization.effective_mode",
	state: "planner.takeover.authorization.state",
	eligible: "planner.takeover.authorization.eligible",
	primaryBlockReason: "planner.takeover.authorization.primary_block_reason",
	blockReasonCount: "planner.takeover.authorization.block_reason_count",
	prepare: "planner.takeover.authorization.prepare",
	confirmChallengeId: "planner.takeover.authorization.confirm_challenge_id",
	confirm: "planner.takeover.authorization.confirm",
	cancel: "planner.takeover.authorization.cancel",
	challengeId: "planner.takeover.authorization.challenge_id",
	challengeCreatedAt: "planner.takeover.authorization.challenge_created_at",
	challengeExpiresAt: "planner.takeover.authorization.challenge_expires_at",
	confirmFailures: "planner.takeover.authorization.confirm_failures",
	grantActive: "planner.takeover.authorization.grant_active",
	grantCreatedAt: "planner.takeover.authorization.grant_created_at",
	grantExpiresAt: "planner.takeover.authorization.grant_expires_at",
	revisionMatch: "planner.takeover.authorization.revision_match",
	activationCapabilityPresent: "planner.takeover.authorization.activation_capability_present",
	permitMinted: "planner.takeover.authorization.permit_minted",
	canonicalAllowed: "planner.takeover.authorization.canonical_allowed",
	lastEventCode: "planner.takeover.authorization.last_event_code",
	lastErrorCode: "planner.takeover.authorization.last_error_code",
} as const;

export const PLANNER_AUTHORIZATION_STATE_PREFIX = "planner.takeover.authorization.";

function strState(id: string, name: string, def = "", write = false): StateDef {
	return {
		id,
		common: { name, type: "string", role: write ? "state" : "text", read: true, write, def },
		defaultVal: def,
		setDefaultIfEmpty: !write,
	};
}

function numState(id: string, name: string, def = 0): StateDef {
	return {
		id,
		common: { name, type: "number", role: "value", read: true, write: false, def },
		defaultVal: def,
		setDefaultIfEmpty: true,
	};
}

function boolState(
	id: string,
	name: string,
	def = false,
	write = false,
	role: "state" | "button" = "state",
): StateDef {
	return {
		id,
		common: { name, type: "boolean", role, read: true, write, def },
		defaultVal: def,
		setDefaultIfEmpty: !write,
	};
}

export async function ensurePlannerAuthorizationStates(host: StateHost): Promise<void> {
	await ensureChannel(host, "planner.takeover.authorization", "Planner Takeover Authorization");
	const defs: StateDef[] = [
		strState(PLANNER_AUTHORIZATION_STATE_IDS.configuredMode, "Authorization Mode (Konfiguration)", "disabled"),
		strState(PLANNER_AUTHORIZATION_STATE_IDS.effectiveMode, "Authorization Mode (effektiv)", "disabled"),
		strState(PLANNER_AUTHORIZATION_STATE_IDS.state, "Authorization Zustand", "disabled"),
		boolState(PLANNER_AUTHORIZATION_STATE_IDS.eligible, "Authorization eligible", false),
		strState(PLANNER_AUTHORIZATION_STATE_IDS.primaryBlockReason, "Authorization Blockgrund"),
		numState(PLANNER_AUTHORIZATION_STATE_IDS.blockReasonCount, "Authorization Blockgründe"),
		boolState(PLANNER_AUTHORIZATION_STATE_IDS.prepare, "Authorization Prepare", false, true, "button"),
		strState(PLANNER_AUTHORIZATION_STATE_IDS.confirmChallengeId, "Authorization Confirm Challenge-ID", "", true),
		boolState(PLANNER_AUTHORIZATION_STATE_IDS.confirm, "Authorization Confirm", false, true, "button"),
		boolState(PLANNER_AUTHORIZATION_STATE_IDS.cancel, "Authorization Cancel", false, true, "button"),
		strState(PLANNER_AUTHORIZATION_STATE_IDS.challengeId, "Authorization Challenge-ID"),
		strState(PLANNER_AUTHORIZATION_STATE_IDS.challengeCreatedAt, "Challenge erstellt"),
		strState(PLANNER_AUTHORIZATION_STATE_IDS.challengeExpiresAt, "Challenge läuft ab"),
		numState(PLANNER_AUTHORIZATION_STATE_IDS.confirmFailures, "Confirm Fehlversuche"),
		boolState(PLANNER_AUTHORIZATION_STATE_IDS.grantActive, "Grant aktiv", false),
		strState(PLANNER_AUTHORIZATION_STATE_IDS.grantCreatedAt, "Grant erstellt"),
		strState(PLANNER_AUTHORIZATION_STATE_IDS.grantExpiresAt, "Grant läuft ab"),
		boolState(PLANNER_AUTHORIZATION_STATE_IDS.revisionMatch, "Revision Match", false),
		boolState(PLANNER_AUTHORIZATION_STATE_IDS.activationCapabilityPresent, "Activation Capability", false),
		boolState(PLANNER_AUTHORIZATION_STATE_IDS.permitMinted, "Permit minted", false),
		boolState(PLANNER_AUTHORIZATION_STATE_IDS.canonicalAllowed, "Canonical allowed", false),
		strState(PLANNER_AUTHORIZATION_STATE_IDS.lastEventCode, "Letztes Authorization Event"),
		strState(PLANNER_AUTHORIZATION_STATE_IDS.lastErrorCode, "Letzter Authorization Fehler"),
	];
	await ensureStates(host, defs);
}

export function isPlannerAuthorizationState(relativeId: string): boolean {
	return relativeId.startsWith(PLANNER_AUTHORIZATION_STATE_PREFIX);
}

export async function writePlannerAuthorizationStates(
	host: StateHost,
	status: PlannerAuthorizationPublicStatus,
): Promise<void> {
	await setStateIfChanged(host, PLANNER_AUTHORIZATION_STATE_IDS.configuredMode, status.configuredMode);
	await setStateIfChanged(host, PLANNER_AUTHORIZATION_STATE_IDS.effectiveMode, status.effectiveMode);
	await setStateIfChanged(host, PLANNER_AUTHORIZATION_STATE_IDS.state, status.state);
	await setStateIfChanged(host, PLANNER_AUTHORIZATION_STATE_IDS.eligible, status.eligible);
	await setStateIfChanged(host, PLANNER_AUTHORIZATION_STATE_IDS.primaryBlockReason, status.primaryBlockReason ?? "");
	await setOptionalNumberIfChanged(host, PLANNER_AUTHORIZATION_STATE_IDS.blockReasonCount, status.blockReasonCount);
	await setStateIfChanged(host, PLANNER_AUTHORIZATION_STATE_IDS.challengeId, status.challengeId ?? "");
	await setStateIfChanged(host, PLANNER_AUTHORIZATION_STATE_IDS.challengeCreatedAt, status.challengeCreatedAt ?? "");
	await setStateIfChanged(host, PLANNER_AUTHORIZATION_STATE_IDS.challengeExpiresAt, status.challengeExpiresAt ?? "");
	await setOptionalNumberIfChanged(host, PLANNER_AUTHORIZATION_STATE_IDS.confirmFailures, status.confirmFailures);
	await setStateIfChanged(host, PLANNER_AUTHORIZATION_STATE_IDS.grantActive, status.grantActive);
	await setStateIfChanged(host, PLANNER_AUTHORIZATION_STATE_IDS.grantCreatedAt, status.grantCreatedAt ?? "");
	await setStateIfChanged(host, PLANNER_AUTHORIZATION_STATE_IDS.grantExpiresAt, status.grantExpiresAt ?? "");
	await setStateIfChanged(host, PLANNER_AUTHORIZATION_STATE_IDS.revisionMatch, status.revisionMatch);
	await setStateIfChanged(host, PLANNER_AUTHORIZATION_STATE_IDS.activationCapabilityPresent, false);
	await setStateIfChanged(host, PLANNER_AUTHORIZATION_STATE_IDS.permitMinted, false);
	await setStateIfChanged(host, PLANNER_AUTHORIZATION_STATE_IDS.canonicalAllowed, false);
	await setStateIfChanged(host, PLANNER_AUTHORIZATION_STATE_IDS.lastEventCode, status.lastEventCode ?? "");
	await setStateIfChanged(host, PLANNER_AUTHORIZATION_STATE_IDS.lastErrorCode, status.lastErrorCode ?? "");
}
