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
exports.SUPPORT_STATE_ALLOWLIST = exports.collectRichSupportDiagnostics = exports.collectSupportRuntimePersistFiles = exports.collectParsedJsonStateDiagnostics = exports.collectAddonDiagnostics = exports.collectBootstrapDiagnostics = exports.collectMappingDiagnostics = exports.collectHealthDiagnostics = exports.collectRuntimeDiagnosticStates = exports.collectSelectedStateSnapshot = exports.collectSystemSummary = void 0;
const fs = __importStar(require("node:fs/promises"));
const os = __importStar(require("node:os"));
const path = __importStar(require("node:path"));
const paths_1 = require("../backup_integration/paths");
const limits_1 = require("./limits");
/** Kern-States, die immer im Support-Snapshot stehen (auch ohne getStates). */
const SUPPORT_STATE_CORE = [
    "system.version",
    "global.execution_mode",
    "execution.safety.global_execution_mode",
    "execution.safety.summary_de",
    "addons.wallbox.mode",
    "addons.battery.mode",
    "addons.immersion_heater.mode",
    "addons.air_conditioning.mode",
    "addons.wallbox.status",
    "addons.wallbox.runtime.reason_de",
    "addons.wallbox.runtime.detail_json",
    "addons.wallbox.runtime.dispatch_status",
    "addons.wallbox.runtime.dispatch_reason_de",
    "addons.wallbox.runtime.execution_block_reason",
    "addons.wallbox.runtime.feedback_status",
    "addons.wallbox.runtime.write_allowed",
    "addons.wallbox.runtime.write_live_eligible",
    "addons.battery.status.state",
    "addons.battery.status.reason",
    "addons.battery.runtime.state",
    "addons.battery.runtime.reason_de",
    "addons.immersion_heater.runtime.state",
    "addons.immersion_heater.runtime.reason",
    "addons.immersion_heater.runtime.snapshot_json",
    "addons.air_conditioning.runtime.reason_de",
    "addons.air_conditioning.runtime.governance_allowed",
    "global_modes.active",
    "global_modes.requested",
    "policy.system.status",
    "policy.system.valid",
    "policy.global.status",
    "policy.global.valid",
    "learning.persistence.last_mirror",
    "backup.status",
    "backup.last_error",
    "backup.last_file_name",
    "backup.restore.status",
    "backup.restore.last_error",
    "backup.restore.plan_id",
    "support.diagnostic_mode",
    "support.last_error",
    "support.log_size_bytes",
];
/** Wildcard-Muster relativ zum Namespace — volle Runtime-/Diagnose-Bäume. */
const SUPPORT_STATE_PATTERNS = [
    "addons.wallbox.runtime.*",
    "addons.battery.status.*",
    "addons.battery.diagnostics.*",
    "addons.battery.runtime.*",
    "addons.immersion_heater.runtime.*",
    "addons.air_conditioning.runtime.*",
    "addons.air_conditioning.units.*",
    "execution.safety.*",
    "planner.intent.*",
    "planner.constraints.*",
    "backup.*",
    "support.*",
];
function parseInstance(namespace) {
    const m = namespace.match(/\.(\d+)$/);
    return m ? Number(m[1]) : 0;
}
function toSnapshotEntry(relId, st) {
    return {
        id: relId,
        value: st.val,
        ack: st.ack ?? false,
        ts: st.ts ?? 0,
        lc: st.lc ?? 0,
    };
}
function relativeId(namespace, absoluteId) {
    const prefix = `${namespace}.`;
    return absoluteId.startsWith(prefix) ? absoluteId.slice(prefix.length) : absoluteId;
}
async function readExactStates(host, ids) {
    const out = [];
    for (const rel of ids) {
        const st = await host.getStateAsync(rel);
        if (!st || st.val === undefined)
            continue;
        out.push(toSnapshotEntry(rel, st));
    }
    return out;
}
async function readPatternStates(host, patterns) {
    const byId = new Map();
    if (typeof host.getStatesAsync !== "function") {
        return [];
    }
    for (const pat of patterns) {
        const absolute = `${host.namespace}.${pat}`;
        try {
            const map = await host.getStatesAsync(absolute);
            for (const [absId, st] of Object.entries(map ?? {})) {
                if (!st || st.val === undefined)
                    continue;
                const rel = relativeId(host.namespace, absId);
                byId.set(rel, toSnapshotEntry(rel, st));
            }
        }
        catch {
            /* pattern optional */
        }
    }
    return [...byId.values()].sort((a, b) => a.id.localeCompare(b.id));
}
function tryParseJsonValue(val) {
    if (typeof val !== "string")
        return val;
    const t = val.trim();
    if (!t || (t[0] !== "{" && t[0] !== "["))
        return val;
    try {
        return JSON.parse(t);
    }
    catch {
        return val;
    }
}
async function readJsonFileSafe(filePath) {
    try {
        const st = await fs.stat(filePath);
        if (st.size > limits_1.EXPORT_LIMITS.MAX_PERSIST_FILE_READ_BYTES)
            return null;
        return JSON.parse(await fs.readFile(filePath, "utf8"));
    }
    catch {
        return null;
    }
}
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
/** Kern-Allowlist-Snapshot (Abwärtskompatibilität / Tests). */
async function collectSelectedStateSnapshot(host) {
    return readExactStates(host, SUPPORT_STATE_CORE);
}
exports.collectSelectedStateSnapshot = collectSelectedStateSnapshot;
/** Volle Runtime-/Diagnose-States für Support (Muster + Kern). */
async function collectRuntimeDiagnosticStates(host) {
    const byId = new Map();
    for (const e of await readExactStates(host, SUPPORT_STATE_CORE)) {
        byId.set(e.id, e);
    }
    for (const e of await readPatternStates(host, SUPPORT_STATE_PATTERNS)) {
        byId.set(e.id, e);
    }
    return [...byId.values()].sort((a, b) => a.id.localeCompare(b.id));
}
exports.collectRuntimeDiagnosticStates = collectRuntimeDiagnosticStates;
async function collectHealthDiagnostics(host) {
    const snapshot = await collectRuntimeDiagnosticStates(host);
    const liveEligible = snapshot.find((s) => s.id === "addons.wallbox.runtime.write_live_eligible");
    return {
        state_count: snapshot.length,
        bootstrap_complete: true,
        live_write_released: liveEligible ? liveEligible.value === true : null,
        collected_at: new Date().toISOString(),
        note: "Vollständige Runtime-States unter states/runtime_diagnostics.json und diagnostics/*",
    };
}
exports.collectHealthDiagnostics = collectHealthDiagnostics;
async function collectMappingDiagnostics(config) {
    const raw = config && typeof config === "object" ? config : {};
    const mappingKeys = Object.keys(raw).filter((k) => k.endsWith("_target") || k.endsWith("_state"));
    const enabledFlags = Object.keys(raw).filter((k) => k.endsWith("_enabled") && raw[k] === true);
    return {
        configured_mapping_keys: mappingKeys.length,
        enabled_mapping_flags: enabledFlags.length,
        has_vehicle_profiles: Array.isArray(raw.wb_vehicle_map)
            ? raw.wb_vehicle_map.length
            : Array.isArray(raw.wb_vehicle_profiles)
                ? raw.wb_vehicle_profiles.length
                : 0,
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
        wallbox_reason_de: (await host.getStateAsync("addons.wallbox.runtime.reason_de"))?.val ?? null,
        immersion_state: (await host.getStateAsync("addons.immersion_heater.runtime.state"))?.val ?? null,
        ac_reason_de: (await host.getStateAsync("addons.air_conditioning.runtime.reason_de"))?.val ?? null,
        battery_state: (await host.getStateAsync("addons.battery.status.state"))?.val ?? null,
    };
}
exports.collectAddonDiagnostics = collectAddonDiagnostics;
/** Parse JSON-States in eigene Diagnose-Dateien. */
async function collectParsedJsonStateDiagnostics(host) {
    const specs = [
        { rel: "addons.wallbox.runtime.detail_json", archivePath: "diagnostics/wallbox_detail.json" },
        {
            rel: "addons.immersion_heater.runtime.snapshot_json",
            archivePath: "diagnostics/immersion_snapshot.json",
        },
        {
            rel: "addons.wallbox.runtime.control_mapping_missing_json",
            archivePath: "diagnostics/wallbox_missing_mappings.json",
        },
    ];
    const out = [];
    for (const s of specs) {
        const st = await host.getStateAsync(s.rel);
        if (st?.val == null || String(st.val).trim() === "")
            continue;
        const parsed = tryParseJsonValue(st.val);
        out.push({
            path: s.archivePath,
            content: typeof parsed === "string" ? JSON.stringify({ raw: parsed }) : JSON.stringify(parsed),
        });
    }
    return out;
}
exports.collectParsedJsonStateDiagnostics = collectParsedJsonStateDiagnostics;
/** support_only Persistenzdateien (Heizstab/Klima Runtime). */
async function collectSupportRuntimePersistFiles(host) {
    const layout = (0, paths_1.resolveEmsPaths)(host);
    const files = [
        {
            abs: path.join(layout.runtimeAddonDir("immersion_heater"), "immersion_heater_runtime_v1.json"),
            archivePath: "diagnostics/persist/immersion_heater_runtime_v1.json",
        },
        {
            abs: path.join(layout.runtimeAddonDir("air_conditioning"), "air_conditioning_runtime_v1.json"),
            archivePath: "diagnostics/persist/air_conditioning_runtime_v1.json",
        },
    ];
    const out = [];
    for (const f of files) {
        const parsed = await readJsonFileSafe(f.abs);
        if (parsed == null)
            continue;
        out.push({ path: f.archivePath, content: JSON.stringify(parsed) });
    }
    return out;
}
exports.collectSupportRuntimePersistFiles = collectSupportRuntimePersistFiles;
/** Alle zusätzlichen Support-Diagnose-Einträge (neben den bisherigen Summaries). */
async function collectRichSupportDiagnostics(host) {
    const runtimeStates = await collectRuntimeDiagnosticStates(host);
    const entries = [
        {
            path: "states/runtime_diagnostics.json",
            content: JSON.stringify(runtimeStates),
        },
        {
            path: "diagnostics/collection_meta.json",
            content: JSON.stringify({
                collected_at: new Date().toISOString(),
                core_state_ids: SUPPORT_STATE_CORE.length,
                pattern_count: SUPPORT_STATE_PATTERNS.length,
                runtime_state_count: runtimeStates.length,
                includes: [
                    "runtime state trees (wallbox/battery/immersion/ac)",
                    "wallbox detail_json",
                    "immersion/ac runtime persist files",
                    "support logs if present",
                ],
            }),
        },
        ...(await collectParsedJsonStateDiagnostics(host)),
        ...(await collectSupportRuntimePersistFiles(host)),
    ];
    return entries;
}
exports.collectRichSupportDiagnostics = collectRichSupportDiagnostics;
/** @deprecated alias — Tests/Imports */
exports.SUPPORT_STATE_ALLOWLIST = SUPPORT_STATE_CORE;
