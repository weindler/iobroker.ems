import * as os from "node:os";
import type { ExportServiceHost, StateSnapshotEntry } from "./types";

/** Allowlist relativer State-IDs für Support-Snapshot. */
const SUPPORT_STATE_ALLOWLIST: readonly string[] = [
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

function parseInstance(namespace: string): number {
	const m = namespace.match(/\.(\d+)$/);
	return m ? Number(m[1]) : 0;
}

export async function collectSelectedStateSnapshot(host: ExportServiceHost): Promise<StateSnapshotEntry[]> {
	const out: StateSnapshotEntry[] = [];
	for (const rel of SUPPORT_STATE_ALLOWLIST) {
		const st = await host.getStateAsync(rel);
		if (!st || st.val === undefined) continue;
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

export async function collectHealthDiagnostics(host: ExportServiceHost): Promise<Record<string, unknown>> {
	const snapshot = await collectSelectedStateSnapshot(host);
	return {
		state_count: snapshot.length,
		bootstrap_complete: true,
		live_write_released: false,
		states: snapshot,
	};
}

export async function collectMappingDiagnostics(config: unknown): Promise<Record<string, unknown>> {
	const raw = config && typeof config === "object" ? (config as Record<string, unknown>) : {};
	const mappingKeys = Object.keys(raw).filter((k) => k.endsWith("_target") || k.endsWith("_state"));
	return {
		configured_mapping_keys: mappingKeys.length,
		has_vehicle_profiles: Array.isArray(raw.wb_vehicle_profiles) ? raw.wb_vehicle_profiles.length : 0,
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
	};
}
