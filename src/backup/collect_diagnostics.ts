import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { resolveEmsPaths } from "../backup_integration/paths";
import { EXPORT_LIMITS } from "./limits";
import type { ExportArchiveEntry, ExportServiceHost, StateSnapshotEntry } from "./types";

/** Kern-States, die immer im Support-Snapshot stehen (auch ohne getStates). */
const SUPPORT_STATE_CORE: readonly string[] = [
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
const SUPPORT_STATE_PATTERNS: readonly string[] = [
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

type StatesMapHost = ExportServiceHost & {
	getStatesAsync?: (pattern: string) => Promise<Record<string, ioBroker.State | null | undefined>>;
};

function parseInstance(namespace: string): number {
	const m = namespace.match(/\.(\d+)$/);
	return m ? Number(m[1]) : 0;
}

function toSnapshotEntry(relId: string, st: ioBroker.State): StateSnapshotEntry {
	return {
		id: relId,
		value: st.val as ioBroker.StateValue,
		ack: st.ack ?? false,
		ts: st.ts ?? 0,
		lc: st.lc ?? 0,
	};
}

function relativeId(namespace: string, absoluteId: string): string {
	const prefix = `${namespace}.`;
	return absoluteId.startsWith(prefix) ? absoluteId.slice(prefix.length) : absoluteId;
}

async function readExactStates(host: ExportServiceHost, ids: readonly string[]): Promise<StateSnapshotEntry[]> {
	const out: StateSnapshotEntry[] = [];
	for (const rel of ids) {
		const st = await host.getStateAsync(rel);
		if (!st || st.val === undefined) continue;
		out.push(toSnapshotEntry(rel, st));
	}
	return out;
}

async function readPatternStates(host: StatesMapHost, patterns: readonly string[]): Promise<StateSnapshotEntry[]> {
	const byId = new Map<string, StateSnapshotEntry>();
	if (typeof host.getStatesAsync !== "function") {
		return [];
	}
	for (const pat of patterns) {
		const absolute = `${host.namespace}.${pat}`;
		try {
			const map = await host.getStatesAsync(absolute);
			for (const [absId, st] of Object.entries(map ?? {})) {
				if (!st || st.val === undefined) continue;
				const rel = relativeId(host.namespace, absId);
				byId.set(rel, toSnapshotEntry(rel, st));
			}
		} catch {
			/* pattern optional */
		}
	}
	return [...byId.values()].sort((a, b) => a.id.localeCompare(b.id));
}

function tryParseJsonValue(val: unknown): unknown {
	if (typeof val !== "string") return val;
	const t = val.trim();
	if (!t || (t[0] !== "{" && t[0] !== "[")) return val;
	try {
		return JSON.parse(t) as unknown;
	} catch {
		return val;
	}
}

async function readJsonFileSafe(filePath: string): Promise<unknown | null> {
	try {
		const st = await fs.stat(filePath);
		if (st.size > EXPORT_LIMITS.MAX_PERSIST_FILE_READ_BYTES) return null;
		return JSON.parse(await fs.readFile(filePath, "utf8")) as unknown;
	} catch {
		return null;
	}
}

export function collectSystemSummary(host: ExportServiceHost): Record<string, unknown> {
	const version =
		host.common?.version ??
		(host.config && typeof host.config === "object"
			? String((host.config as Record<string, unknown>).adapter_version ?? "")
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

/** Kern-Allowlist-Snapshot (Abwärtskompatibilität / Tests). */
export async function collectSelectedStateSnapshot(host: ExportServiceHost): Promise<StateSnapshotEntry[]> {
	return readExactStates(host, SUPPORT_STATE_CORE);
}

/** Volle Runtime-/Diagnose-States für Support (Muster + Kern). */
export async function collectRuntimeDiagnosticStates(host: ExportServiceHost): Promise<StateSnapshotEntry[]> {
	const byId = new Map<string, StateSnapshotEntry>();
	for (const e of await readExactStates(host, SUPPORT_STATE_CORE)) {
		byId.set(e.id, e);
	}
	for (const e of await readPatternStates(host as StatesMapHost, SUPPORT_STATE_PATTERNS)) {
		byId.set(e.id, e);
	}
	return [...byId.values()].sort((a, b) => a.id.localeCompare(b.id));
}

export async function collectHealthDiagnostics(host: ExportServiceHost): Promise<Record<string, unknown>> {
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

export async function collectMappingDiagnostics(config: unknown): Promise<Record<string, unknown>> {
	const raw = config && typeof config === "object" ? (config as Record<string, unknown>) : {};
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

export async function collectBootstrapDiagnostics(): Promise<Record<string, unknown>> {
	return {
		phase: "post_bootstrap",
		cold_start_recovery_documented: true,
	};
}

export async function collectAddonDiagnostics(host: ExportServiceHost): Promise<Record<string, unknown>> {
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

/** Parse JSON-States in eigene Diagnose-Dateien. */
export async function collectParsedJsonStateDiagnostics(
	host: ExportServiceHost,
): Promise<ExportArchiveEntry[]> {
	const specs: Array<{ rel: string; archivePath: string }> = [
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
	const out: ExportArchiveEntry[] = [];
	for (const s of specs) {
		const st = await host.getStateAsync(s.rel);
		if (st?.val == null || String(st.val).trim() === "") continue;
		const parsed = tryParseJsonValue(st.val);
		out.push({
			path: s.archivePath,
			content: typeof parsed === "string" ? JSON.stringify({ raw: parsed }) : JSON.stringify(parsed),
		});
	}
	return out;
}

/** support_only Persistenzdateien (Heizstab/Klima Runtime). */
export async function collectSupportRuntimePersistFiles(
	host: ExportServiceHost,
): Promise<ExportArchiveEntry[]> {
	const layout = resolveEmsPaths(host);
	const files: Array<{ abs: string; archivePath: string }> = [
		{
			abs: path.join(layout.runtimeAddonDir("immersion_heater"), "immersion_heater_runtime_v1.json"),
			archivePath: "diagnostics/persist/immersion_heater_runtime_v1.json",
		},
		{
			abs: path.join(layout.runtimeAddonDir("air_conditioning"), "air_conditioning_runtime_v1.json"),
			archivePath: "diagnostics/persist/air_conditioning_runtime_v1.json",
		},
	];
	const out: ExportArchiveEntry[] = [];
	for (const f of files) {
		const parsed = await readJsonFileSafe(f.abs);
		if (parsed == null) continue;
		out.push({ path: f.archivePath, content: JSON.stringify(parsed) });
	}
	return out;
}

/** Alle zusätzlichen Support-Diagnose-Einträge (neben den bisherigen Summaries). */
export async function collectRichSupportDiagnostics(
	host: ExportServiceHost,
): Promise<ExportArchiveEntry[]> {
	const runtimeStates = await collectRuntimeDiagnosticStates(host);
	const entries: ExportArchiveEntry[] = [
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

/** @deprecated alias — Tests/Imports */
export const SUPPORT_STATE_ALLOWLIST = SUPPORT_STATE_CORE;
