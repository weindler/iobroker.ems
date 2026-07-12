"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || function (mod) {
    if (mod && mod.__esModule) return mod;
    var result = {};
    if (mod != null) for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
    __setModuleDefault(result, mod);
    return result;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.collectAddonDiagnostics = exports.collectBootstrapDiagnostics = exports.collectMappingDiagnostics = exports.collectHealthDiagnostics = exports.collectSelectedStateSnapshot = exports.collectSystemSummary = void 0;
const os = __importStar(require("node:os"));
/** Allowlist relativer State-IDs für Support-Snapshot. */
const SUPPORT_STATE_ALLOWLIST = [
    "system.version",
    "global.execution_mode",
    "execution.safety.global_execution_mode",
    "addons.wallbox.mode",
    "addons.battery.mode",
    "addons.immersion_heater.mode",
    "addons.air_conditioning.mode",
    "addons.wallbox.status",
    "addons.battery.status.state",
    "addons.battery.status.reason",
    "addons.immersion_heater.runtime.state",
    "addons.air_conditioning.runtime.summary.reason_de",
    "global_modes.active",
    "global_modes.requested",
    "policy.system.status",
    "policy.system.valid",
    "policy.global.status",
    "policy.global.valid",
    "learning.persistence.last_mirror",
    "backup.status",
    "backup.last_error",
    "support.diagnostic_mode",
];
function collectSystemSummary(host) {
    const version = host.common?.version ??
        (host.config && typeof host.config === "object"
            ? String(host.config.adapter_version ?? "")
            : "");
    return {
        adapter_version: version,
        node_version: process.version,
        platform: os.platform(),
        arch: os.arch(),
        instance: parseInstance(host.namespace),
        export_at: new Date().toISOString(),
        uptime_sec: Math.floor(process.uptime()),
        memory_rss_mb: Math.round(process.memoryUsage().rss / (1024 * 1024)),
    };
}
exports.collectSystemSummary = collectSystemSummary;
function parseInstance(namespace) {
    const m = namespace.match(/\.(\d+)$/);
    return m ? Number(m[1]) : 0;
}
async function collectSelectedStateSnapshot(host) {
    const out = [];
    for (const rel of SUPPORT_STATE_ALLOWLIST) {
        const st = await host.getStateAsync(rel);
        if (!st || st.val === undefined)
            continue;
        out.push({
            id: rel,
            value: st.val,
            ack: st.ack ?? false,
            ts: st.ts ?? 0,
            lc: st.lc ?? 0,
        });
    }
    return out;
}
exports.collectSelectedStateSnapshot = collectSelectedStateSnapshot;
async function collectHealthDiagnostics(host) {
    const snapshot = await collectSelectedStateSnapshot(host);
    return {
        state_count: snapshot.length,
        bootstrap_complete: true,
        live_write_released: false,
        states: snapshot,
    };
}
exports.collectHealthDiagnostics = collectHealthDiagnostics;
async function collectMappingDiagnostics(config) {
    const raw = config && typeof config === "object" ? config : {};
    const mappingKeys = Object.keys(raw).filter((k) => k.endsWith("_target") || k.endsWith("_state"));
    return {
        configured_mapping_keys: mappingKeys.length,
        has_vehicle_profiles: Array.isArray(raw.wb_vehicle_profiles) ? raw.wb_vehicle_profiles.length : 0,
    };
}
exports.collectMappingDiagnostics = collectMappingDiagnostics;
async function collectBootstrapDiagnostics() {
    return {
        phase: "post_bootstrap",
        cold_start_recovery_documented: true,
    };
}
exports.collectBootstrapDiagnostics = collectBootstrapDiagnostics;
async function collectAddonDiagnostics(host) {
    return {
        wallbox_mode: (await host.getStateAsync("addons.wallbox.mode"))?.val ?? null,
        battery_mode: (await host.getStateAsync("addons.battery.mode"))?.val ?? null,
        immersion_mode: (await host.getStateAsync("addons.immersion_heater.mode"))?.val ?? null,
        ac_mode: (await host.getStateAsync("addons.air_conditioning.mode"))?.val ?? null,
    };
}
exports.collectAddonDiagnostics = collectAddonDiagnostics;
