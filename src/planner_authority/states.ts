import { ensureChannel, ensureStates, type StateDef, type StateHost } from "../ems_light/state_util";
import { withExpertCommon } from "../ems_light/expert_surface";
import { setOptionalNumberIfChanged, setStateIfChanged } from "../policy/core/state_write";
import type { PlannerAuthorityPublicStatus } from "./types";

export const PLANNER_AUTHORITY_STATE_IDS = {
	configuredSource: "planner.authority.configured_source",
	effectiveAuthority: "planner.authority.effective_authority",
	workerAuthoritative: "planner.authority.worker_authoritative",
	canonicalAllowed: "planner.authority.canonical_allowed",
	dryrunPilotState: "planner.authority.dryrun_pilot_state",
	dryrunPilotPrimaryCode: "planner.authority.dryrun_pilot_primary_code",
	leaseActive: "planner.authority.lease_active",
	leaseExpiresAt: "planner.authority.lease_expires_at",
	fallbackLatched: "planner.authority.fallback_latched",
	fallbackReason: "planner.authority.fallback_reason",
	viewQuality: "planner.authority.view_quality",
	planRevision: "planner.authority.plan_revision",
	generation: "planner.authority.generation",
	lastEventCode: "planner.authority.last_event_code",
	lastErrorCode: "planner.authority.last_error_code",
	activateWorkerDryrun: "planner.authority.activate_worker_dryrun",
	deactivateWorker: "planner.authority.deactivate_worker",
	rssBeforeWorkerJobMib: "planner.authority.memory.rss_before_worker_job_mib",
	rssAfterWorkerExitMib: "planner.authority.memory.rss_after_worker_exit_mib",
	lastWorkerDeltaMib: "planner.authority.memory.last_worker_delta_mib",
	legacyModuleLoaded: "planner.authority.memory.legacy_module_loaded",
} as const;

export const PLANNER_AUTHORITY_STATE_PREFIX = "planner.authority.";

function strState(id: string, name: string, def = "", write = false): StateDef {
	return {
		id,
		common: withExpertCommon({ name, type: "string", role: write ? "state" : "text", read: true, write, def }),
		defaultVal: def,
		setDefaultIfEmpty: !write,
		extendCommon: true,
	};
}

function numState(id: string, name: string, def = 0): StateDef {
	return {
		id,
		common: withExpertCommon({ name, type: "number", role: "value", read: true, write: false, def }),
		defaultVal: def,
		setDefaultIfEmpty: true,
		extendCommon: true,
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
		common: withExpertCommon({ name, type: "boolean", role, read: true, write, def }),
		defaultVal: def,
		setDefaultIfEmpty: !write,
		extendCommon: true,
	};
}

export async function ensurePlannerAuthorityStates(host: StateHost): Promise<void> {
	await ensureChannel(host, "planner.authority", "Planner Authority");
	const defs: StateDef[] = [
		strState(PLANNER_AUTHORITY_STATE_IDS.configuredSource, "Authority Source (Konfiguration)", "legacy"),
		strState(PLANNER_AUTHORITY_STATE_IDS.effectiveAuthority, "Authority (effektiv)", "legacy"),
		boolState(PLANNER_AUTHORITY_STATE_IDS.workerAuthoritative, "Worker autoritativ", false),
		boolState(PLANNER_AUTHORITY_STATE_IDS.canonicalAllowed, "Canonical erlaubt", false),
		strState(PLANNER_AUTHORITY_STATE_IDS.dryrunPilotState, "Dryrun Pilot Zustand", "not_ready"),
		strState(PLANNER_AUTHORITY_STATE_IDS.dryrunPilotPrimaryCode, "Dryrun Pilot Blockgrund"),
		boolState(PLANNER_AUTHORITY_STATE_IDS.leaseActive, "Lease aktiv", false),
		strState(PLANNER_AUTHORITY_STATE_IDS.leaseExpiresAt, "Lease läuft ab"),
		boolState(PLANNER_AUTHORITY_STATE_IDS.fallbackLatched, "Fallback verriegelt", false),
		strState(PLANNER_AUTHORITY_STATE_IDS.fallbackReason, "Fallback Grund"),
		strState(PLANNER_AUTHORITY_STATE_IDS.viewQuality, "View Qualität"),
		strState(PLANNER_AUTHORITY_STATE_IDS.planRevision, "Plan Revision"),
		numState(PLANNER_AUTHORITY_STATE_IDS.generation, "Generation"),
		strState(PLANNER_AUTHORITY_STATE_IDS.lastEventCode, "Letztes Authority Event"),
		strState(PLANNER_AUTHORITY_STATE_IDS.lastErrorCode, "Letzter Authority Fehler"),
		boolState(PLANNER_AUTHORITY_STATE_IDS.activateWorkerDryrun, "Worker Dryrun aktivieren", false, true, "button"),
		boolState(PLANNER_AUTHORITY_STATE_IDS.deactivateWorker, "Worker deaktivieren", false, true, "button"),
		numState(PLANNER_AUTHORITY_STATE_IDS.rssBeforeWorkerJobMib, "RSS vor Worker-Job (MiB)"),
		numState(PLANNER_AUTHORITY_STATE_IDS.rssAfterWorkerExitMib, "RSS nach Worker-Exit (MiB)"),
		numState(PLANNER_AUTHORITY_STATE_IDS.lastWorkerDeltaMib, "RSS Worker-Delta (MiB)"),
		boolState(PLANNER_AUTHORITY_STATE_IDS.legacyModuleLoaded, "Legacy-Modul geladen", false),
	];
	await ensureStates(host, defs);
}

export function isPlannerAuthorityState(relativeId: string): boolean {
	return relativeId.startsWith(PLANNER_AUTHORITY_STATE_PREFIX);
}

export async function writePlannerAuthorityMemoryStates(
	host: StateHost,
	memory: {
		rssBeforeWorkerJobMib: number | null;
		rssAfterWorkerExitMib: number | null;
		lastWorkerDeltaMib: number | null;
		legacyModuleLoaded: boolean;
	},
): Promise<void> {
	await setOptionalNumberIfChanged(
		host,
		PLANNER_AUTHORITY_STATE_IDS.rssBeforeWorkerJobMib,
		memory.rssBeforeWorkerJobMib,
	);
	await setOptionalNumberIfChanged(
		host,
		PLANNER_AUTHORITY_STATE_IDS.rssAfterWorkerExitMib,
		memory.rssAfterWorkerExitMib,
	);
	await setOptionalNumberIfChanged(host, PLANNER_AUTHORITY_STATE_IDS.lastWorkerDeltaMib, memory.lastWorkerDeltaMib);
	await setStateIfChanged(host, PLANNER_AUTHORITY_STATE_IDS.legacyModuleLoaded, memory.legacyModuleLoaded);
}

export async function writePlannerAuthorityStates(
	host: StateHost,
	status: PlannerAuthorityPublicStatus,
): Promise<void> {
	// worker_authoritative and canonical_allowed are derived: dryrun only, never live.
	const workerAuthoritative =
		status.effectiveAuthority === "worker_dryrun" && status.leaseActive === true;
	await setStateIfChanged(host, PLANNER_AUTHORITY_STATE_IDS.configuredSource, status.configuredSource);
	await setStateIfChanged(host, PLANNER_AUTHORITY_STATE_IDS.effectiveAuthority, status.effectiveAuthority);
	await setStateIfChanged(host, PLANNER_AUTHORITY_STATE_IDS.workerAuthoritative, workerAuthoritative);
	await setStateIfChanged(host, PLANNER_AUTHORITY_STATE_IDS.canonicalAllowed, workerAuthoritative);
	await setStateIfChanged(host, PLANNER_AUTHORITY_STATE_IDS.dryrunPilotState, status.dryrunPilotState);
	await setStateIfChanged(
		host,
		PLANNER_AUTHORITY_STATE_IDS.dryrunPilotPrimaryCode,
		status.dryrunPilotPrimaryCode ?? "",
	);
	await setStateIfChanged(host, PLANNER_AUTHORITY_STATE_IDS.leaseActive, status.leaseActive);
	await setStateIfChanged(host, PLANNER_AUTHORITY_STATE_IDS.leaseExpiresAt, status.leaseExpiresAt ?? "");
	await setStateIfChanged(host, PLANNER_AUTHORITY_STATE_IDS.fallbackLatched, status.fallbackLatched);
	await setStateIfChanged(host, PLANNER_AUTHORITY_STATE_IDS.fallbackReason, status.fallbackReason ?? "");
	await setStateIfChanged(host, PLANNER_AUTHORITY_STATE_IDS.viewQuality, status.viewQuality ?? "");
	await setStateIfChanged(host, PLANNER_AUTHORITY_STATE_IDS.planRevision, status.planRevision ?? "");
	await setOptionalNumberIfChanged(host, PLANNER_AUTHORITY_STATE_IDS.generation, status.generation ?? 0);
	await setStateIfChanged(host, PLANNER_AUTHORITY_STATE_IDS.lastEventCode, status.lastEventCode ?? "");
	await setStateIfChanged(host, PLANNER_AUTHORITY_STATE_IDS.lastErrorCode, status.lastErrorCode ?? "");
}
