"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.syncAllMappingsFromConfig = exports.cleanupDynamicPlaceholders = exports.ensureDynamicVehicleProfiles = exports.ensureStaticStateTree = void 0;
const air_conditioning_1 = require("../addons/air_conditioning");
const battery_1 = require("../addons/battery");
const immersion_heater_1 = require("../addons/immersion_heater");
const measured_consumers_1 = require("../addons/measured_consumers");
const wallbox_1 = require("../addons/wallbox");
const governance_1 = require("../addons/governance");
const runtime_surface_1 = require("../addons/runtime_surface");
const ems_light_1 = require("../ems_light");
const execution_mode_1 = require("../execution_mode");
const status_wallbox_1 = require("../status_wallbox");
const base_ensure_1 = require("./base_ensure");
const ensure_states_1 = require("../backup/ensure_states");
const cleanup_1 = require("../surface_cleanup/cleanup");
/** Phase B — statischer EMS-State-Tree ohne dynamische Fahrzeugprofile. */
async function ensureStaticStateTree(host) {
    await (0, execution_mode_1.ensureChannelTree)(host.setObjectNotExistsAsync.bind(host));
    await (0, base_ensure_1.ensureCommandBaseStates)(host);
    await (0, execution_mode_1.ensureGlobalExecutionStates)(host);
    await (0, execution_mode_1.ensureAddonExecutionModeStates)(host);
    await (0, base_ensure_1.ensureAddonBasisStates)(host);
    await (0, governance_1.ensureAddonGovernanceStates)(host);
    await (0, runtime_surface_1.ensureAddonRuntimeSurfaceStates)(host);
    await (0, ems_light_1.ensureEmsLightStateTree)(host);
    await (0, ensure_states_1.ensureBackupStates)(host);
    await (0, status_wallbox_1.ensureWallboxStatusStates)(host);
    await (0, wallbox_1.ensureWallboxStaticStateTree)(host);
    await (0, battery_1.ensureBatteryStateTree)(host);
    await (0, immersion_heater_1.ensureImmersionHeaterStateTree)(host);
    await (0, air_conditioning_1.ensureAirConditioningStateTree)(host);
    await (0, measured_consumers_1.ensureMeasuredConsumersStateTree)(host);
}
exports.ensureStaticStateTree = ensureStaticStateTree;
/** Phase C — no-op since v0.1.227 (fat vehicle profile trees removed; see `wb_vehicle_map`). */
async function ensureDynamicVehicleProfiles(host) {
    await (0, wallbox_1.ensureWallboxDynamicVehicleProfiles)(host);
}
exports.ensureDynamicVehicleProfiles = ensureDynamicVehicleProfiles;
/**
 * Phase 4B1 — controlled cleanup of unconfigured AC / orphan vehicle placeholders.
 * Runs after ensure so configured trees exist; idempotent.
 */
async function cleanupDynamicPlaceholders(host) {
    const cleanupHost = {
        namespace: host.namespace,
        config: host.config,
        log: host.log,
        getObjectAsync: (id) => host.getObjectAsync(id),
        delObjectAsync: (id, opts) => host.delObjectAsync(id, opts),
        listRelativeObjectIds: async () => {
            const listFn = host.getObjectListAsync;
            if (typeof listFn !== "function") {
                return [];
            }
            // Full instance namespace — cleanup needs stub leaves + mapping allowed_values.
            const start = `${host.namespace}.`;
            const end = `${host.namespace}.\uffff`;
            const res = await listFn.call(host, { startkey: start, endkey: end });
            const rows = res?.rows ?? [];
            const prefix = `${host.namespace}.`;
            return rows
                .map((r) => r.id)
                .filter((id) => id.startsWith(prefix))
                .map((id) => id.slice(prefix.length));
        },
    };
    await (0, cleanup_1.runDynamicSurfaceCleanup)(cleanupHost);
}
exports.cleanupDynamicPlaceholders = cleanupDynamicPlaceholders;
/** Mapping kommt aus der Adapterkonfiguration — keine ioBroker-Spiegel mehr. */
async function syncAllMappingsFromConfig(_host) {
    return;
}
exports.syncAllMappingsFromConfig = syncAllMappingsFromConfig;
