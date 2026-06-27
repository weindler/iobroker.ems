"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.resetGlobalModesRuntime = exports.runGlobalModes = void 0;
const state_write_1 = require("../policy/core/state_write");
const constants_1 = require("./constants");
const config_1 = require("./config");
const ensure_states_1 = require("./ensure_states");
const persist_1 = require("./persist");
const resolve_1 = require("./resolve");
const schema_1 = require("./schema");
let lastActiveMode = null;
async function runGlobalModes(host) {
    const adminDefault = (0, config_1.globalModeDefaultFromConfig)(host.config);
    await (0, ensure_states_1.ensureGlobalModesStates)(host, adminDefault);
    const requestedSt = await host.getStateAsync("global_modes.requested");
    const adminSeenSt = await host.getStateAsync("global_modes.admin_default");
    const lastAdminSeen = adminSeenSt?.val != null && String(adminSeenSt.val).trim() !== "" ? String(adminSeenSt.val).trim() : null;
    const decision = (0, resolve_1.decideRequestedWrite)({
        currentRequestedRaw: requestedSt?.val,
        adminDefault,
        lastAdminSeen,
    });
    let requestedRaw = requestedSt?.val;
    if (decision.writeRequested !== null) {
        await host.setStateAsync("global_modes.requested", { val: decision.writeRequested, ack: true });
        requestedRaw = decision.writeRequested;
        if (decision.reason === "admin_changed") {
            host.log.info(`Global Mode set from admin default: ${lastAdminSeen ?? "?"} -> ${decision.writeRequested}`);
        }
    }
    // Admin-Default merken (für Erkennung künftiger Admin-Änderungen).
    if (lastAdminSeen !== adminDefault) {
        await host.setStateAsync("global_modes.admin_default", { val: adminDefault, ack: true });
    }
    const resolution = (0, resolve_1.resolveGlobalModes)({
        requestedRaw,
        adminDefault,
        hasPersistedRequested: requestedRaw != null && String(requestedRaw).trim() !== "",
    });
    // Benutzer-Kommando bestätigen: ein manueller Write auf requested kommt mit
    // ack=false (im Objektbaum gelb). Wir bestätigen den gültigen Wert, ohne ihn
    // zu verändern. Bei ungültigem Wert bleibt er unbestätigt sichtbar.
    if (decision.writeRequested === null && resolution.valid && requestedSt?.ack === false) {
        await host.setStateAsync("global_modes.requested", { val: resolution.requested, ack: true });
    }
    const ts = new Date().toISOString();
    const issuesJson = JSON.stringify(resolution.issues);
    const profileJson = JSON.stringify((0, schema_1.profileForMode)(resolution.active));
    const writes = [
        { id: "global_modes.active", val: resolution.active },
        { id: "global_modes.available_json", val: (0, schema_1.availableModesJson)() },
        { id: "global_modes.effective_profile_json", val: profileJson },
        { id: "global_modes.status", val: resolution.status },
        { id: "global_modes.valid", val: resolution.valid },
        { id: "global_modes.issues_json", val: issuesJson },
    ];
    const { changed } = await (0, state_write_1.setStatesIfRevisionChanged)(host, "global_modes.revision", resolution.revision, writes, "global_modes.updated_at", ts);
    if (lastActiveMode !== null && lastActiveMode !== resolution.active) {
        host.log.info(`Global Mode changed: ${lastActiveMode} -> ${resolution.active}`);
    }
    lastActiveMode = resolution.active;
    if (changed && resolution.status === "fallback") {
        host.log.warn(`Global Mode fallback: active=${constants_1.DEFAULT_GLOBAL_MODE} (${resolution.issues[0]?.message ?? ""})`);
    }
    const dataDir = host.getAbsolutePath?.("global_modes");
    if (dataDir) {
        const prev = await (0, persist_1.readGlobalModesPersistRevision)(dataDir);
        if (prev !== resolution.revision) {
            await (0, persist_1.writeGlobalModesPersist)(dataDir, resolution);
        }
    }
    return resolution;
}
exports.runGlobalModes = runGlobalModes;
function resetGlobalModesRuntime() {
    lastActiveMode = null;
}
exports.resetGlobalModesRuntime = resetGlobalModesRuntime;
