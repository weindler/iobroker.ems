"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.writePlannerAuthorityStates = exports.writePlannerAuthorityMemoryStates = exports.isPlannerAuthorityState = exports.ensurePlannerAuthorityStates = exports.PLANNER_AUTHORITY_STATE_PREFIX = exports.PLANNER_AUTHORITY_STATE_IDS = void 0;
const state_util_1 = require("../ems_light/state_util");
const state_write_1 = require("../policy/core/state_write");
exports.PLANNER_AUTHORITY_STATE_IDS = {
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
};
exports.PLANNER_AUTHORITY_STATE_PREFIX = "planner.authority.";
function strState(id, name, def = "", write = false) {
    return {
        id,
        common: { name, type: "string", role: write ? "state" : "text", read: true, write, def },
        defaultVal: def,
        setDefaultIfEmpty: !write,
    };
}
function numState(id, name, def = 0) {
    return {
        id,
        common: { name, type: "number", role: "value", read: true, write: false, def },
        defaultVal: def,
        setDefaultIfEmpty: true,
    };
}
function boolState(id, name, def = false, write = false, role = "state") {
    return {
        id,
        common: { name, type: "boolean", role, read: true, write, def },
        defaultVal: def,
        setDefaultIfEmpty: !write,
    };
}
async function ensurePlannerAuthorityStates(host) {
    await (0, state_util_1.ensureChannel)(host, "planner.authority", "Planner Authority");
    const defs = [
        strState(exports.PLANNER_AUTHORITY_STATE_IDS.configuredSource, "Authority Source (Konfiguration)", "legacy"),
        strState(exports.PLANNER_AUTHORITY_STATE_IDS.effectiveAuthority, "Authority (effektiv)", "legacy"),
        boolState(exports.PLANNER_AUTHORITY_STATE_IDS.workerAuthoritative, "Worker autoritativ", false),
        boolState(exports.PLANNER_AUTHORITY_STATE_IDS.canonicalAllowed, "Canonical erlaubt", false),
        strState(exports.PLANNER_AUTHORITY_STATE_IDS.dryrunPilotState, "Dryrun Pilot Zustand", "not_ready"),
        strState(exports.PLANNER_AUTHORITY_STATE_IDS.dryrunPilotPrimaryCode, "Dryrun Pilot Blockgrund"),
        boolState(exports.PLANNER_AUTHORITY_STATE_IDS.leaseActive, "Lease aktiv", false),
        strState(exports.PLANNER_AUTHORITY_STATE_IDS.leaseExpiresAt, "Lease läuft ab"),
        boolState(exports.PLANNER_AUTHORITY_STATE_IDS.fallbackLatched, "Fallback verriegelt", false),
        strState(exports.PLANNER_AUTHORITY_STATE_IDS.fallbackReason, "Fallback Grund"),
        strState(exports.PLANNER_AUTHORITY_STATE_IDS.viewQuality, "View Qualität"),
        strState(exports.PLANNER_AUTHORITY_STATE_IDS.planRevision, "Plan Revision"),
        numState(exports.PLANNER_AUTHORITY_STATE_IDS.generation, "Generation"),
        strState(exports.PLANNER_AUTHORITY_STATE_IDS.lastEventCode, "Letztes Authority Event"),
        strState(exports.PLANNER_AUTHORITY_STATE_IDS.lastErrorCode, "Letzter Authority Fehler"),
        boolState(exports.PLANNER_AUTHORITY_STATE_IDS.activateWorkerDryrun, "Worker Dryrun aktivieren", false, true, "button"),
        boolState(exports.PLANNER_AUTHORITY_STATE_IDS.deactivateWorker, "Worker deaktivieren", false, true, "button"),
        numState(exports.PLANNER_AUTHORITY_STATE_IDS.rssBeforeWorkerJobMib, "RSS vor Worker-Job (MiB)"),
        numState(exports.PLANNER_AUTHORITY_STATE_IDS.rssAfterWorkerExitMib, "RSS nach Worker-Exit (MiB)"),
        numState(exports.PLANNER_AUTHORITY_STATE_IDS.lastWorkerDeltaMib, "RSS Worker-Delta (MiB)"),
        boolState(exports.PLANNER_AUTHORITY_STATE_IDS.legacyModuleLoaded, "Legacy-Modul geladen", false),
    ];
    await (0, state_util_1.ensureStates)(host, defs);
}
exports.ensurePlannerAuthorityStates = ensurePlannerAuthorityStates;
function isPlannerAuthorityState(relativeId) {
    return relativeId.startsWith(exports.PLANNER_AUTHORITY_STATE_PREFIX);
}
exports.isPlannerAuthorityState = isPlannerAuthorityState;
async function writePlannerAuthorityMemoryStates(host, memory) {
    if (memory.rssBeforeWorkerJobMib != null) {
        await (0, state_write_1.setStateIfChanged)(host, exports.PLANNER_AUTHORITY_STATE_IDS.rssBeforeWorkerJobMib, memory.rssBeforeWorkerJobMib);
    }
    if (memory.rssAfterWorkerExitMib != null) {
        await (0, state_write_1.setStateIfChanged)(host, exports.PLANNER_AUTHORITY_STATE_IDS.rssAfterWorkerExitMib, memory.rssAfterWorkerExitMib);
    }
    if (memory.lastWorkerDeltaMib != null) {
        await (0, state_write_1.setStateIfChanged)(host, exports.PLANNER_AUTHORITY_STATE_IDS.lastWorkerDeltaMib, memory.lastWorkerDeltaMib);
    }
    await (0, state_write_1.setStateIfChanged)(host, exports.PLANNER_AUTHORITY_STATE_IDS.legacyModuleLoaded, memory.legacyModuleLoaded);
}
exports.writePlannerAuthorityMemoryStates = writePlannerAuthorityMemoryStates;
async function writePlannerAuthorityStates(host, status) {
    // worker_authoritative and canonical_allowed are derived: dryrun only, never live.
    const workerAuthoritative = status.effectiveAuthority === "worker_dryrun" && status.leaseActive === true;
    await (0, state_write_1.setStateIfChanged)(host, exports.PLANNER_AUTHORITY_STATE_IDS.configuredSource, status.configuredSource);
    await (0, state_write_1.setStateIfChanged)(host, exports.PLANNER_AUTHORITY_STATE_IDS.effectiveAuthority, status.effectiveAuthority);
    await (0, state_write_1.setStateIfChanged)(host, exports.PLANNER_AUTHORITY_STATE_IDS.workerAuthoritative, workerAuthoritative);
    await (0, state_write_1.setStateIfChanged)(host, exports.PLANNER_AUTHORITY_STATE_IDS.canonicalAllowed, workerAuthoritative);
    await (0, state_write_1.setStateIfChanged)(host, exports.PLANNER_AUTHORITY_STATE_IDS.dryrunPilotState, status.dryrunPilotState);
    await (0, state_write_1.setStateIfChanged)(host, exports.PLANNER_AUTHORITY_STATE_IDS.dryrunPilotPrimaryCode, status.dryrunPilotPrimaryCode ?? "");
    await (0, state_write_1.setStateIfChanged)(host, exports.PLANNER_AUTHORITY_STATE_IDS.leaseActive, status.leaseActive);
    await (0, state_write_1.setStateIfChanged)(host, exports.PLANNER_AUTHORITY_STATE_IDS.leaseExpiresAt, status.leaseExpiresAt ?? "");
    await (0, state_write_1.setStateIfChanged)(host, exports.PLANNER_AUTHORITY_STATE_IDS.fallbackLatched, status.fallbackLatched);
    await (0, state_write_1.setStateIfChanged)(host, exports.PLANNER_AUTHORITY_STATE_IDS.fallbackReason, status.fallbackReason ?? "");
    await (0, state_write_1.setStateIfChanged)(host, exports.PLANNER_AUTHORITY_STATE_IDS.viewQuality, status.viewQuality ?? "");
    await (0, state_write_1.setStateIfChanged)(host, exports.PLANNER_AUTHORITY_STATE_IDS.planRevision, status.planRevision ?? "");
    await (0, state_write_1.setStateIfChanged)(host, exports.PLANNER_AUTHORITY_STATE_IDS.generation, status.generation ?? 0);
    await (0, state_write_1.setStateIfChanged)(host, exports.PLANNER_AUTHORITY_STATE_IDS.lastEventCode, status.lastEventCode ?? "");
    await (0, state_write_1.setStateIfChanged)(host, exports.PLANNER_AUTHORITY_STATE_IDS.lastErrorCode, status.lastErrorCode ?? "");
}
exports.writePlannerAuthorityStates = writePlannerAuthorityStates;
