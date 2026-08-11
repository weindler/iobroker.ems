/**
 * Boiler-Learning A — frischer Start, keine Migration aus Puffer-Zyklen.
 * Ohne genug Samples: kein Fake-emptyAt (Hard nutzt dann nur aktuelle Boiler-Temp vs Min).
 */

import { setStateIfChanged } from "../../policy/core/state_write";
import { asNum, type StateHost } from "../../ems_light/state_util";
import { mappingBase } from "../../tree_paths";
import { ensureThermalBoilerLearningStates } from "./ensure_states";

export type ThermalBoilerRunHost = StateHost & {
	config?: unknown;
	getForeignStateAsync?: (id: string) => Promise<ioBroker.State | null | undefined>;
	log?: { info?: (m: string) => void; warn?: (m: string) => void; debug?: (m: string) => void };
};

async function resolveBoilerTempStateId(host: ThermalBoilerRunHost): Promise<string> {
	const c = host.config && typeof host.config === "object" ? (host.config as Record<string, unknown>) : {};
	const admin = typeof c.ih_boiler_temp_c_target === "string" ? c.ih_boiler_temp_c_target.trim() : "";
	if (admin) return admin;
	const base = mappingBase("immersion_heater", "boiler_temp_c");
	const en = await host.getStateAsync(`${base}.enabled`);
	if (en?.val === false) return "";
	const t = await host.getStateAsync(`${base}.target_state`);
	return typeof t?.val === "string" ? t.val.trim() : "";
}

export async function runThermalBoilerLearning(host: ThermalBoilerRunHost): Promise<void> {
	await ensureThermalBoilerLearningStates(host);
	const nowIso = new Date().toISOString();
	const stateId = await resolveBoilerTempStateId(host);
	let temp: number | null = null;
	if (stateId && host.getForeignStateAsync) {
		try {
			temp = asNum((await host.getForeignStateAsync(stateId))?.val);
		} catch {
			temp = null;
		}
	}
	if (temp === null) {
		temp = asNum((await host.getStateAsync("live.thermal.boiler_temp_c"))?.val);
	}

	const samples = asNum((await host.getStateAsync("learning.thermal_boiler.samples"))?.val) ?? 0;
	await setStateIfChanged(host, "learning.thermal_boiler.last_run", nowIso);
	await setStateIfChanged(host, "learning.thermal_boiler.current_temperature_c", temp);
	await setStateIfChanged(host, "learning.thermal_boiler.samples", samples);

	if (temp === null) {
		await setStateIfChanged(host, "learning.thermal_boiler.status", "insufficient_data");
		await setStateIfChanged(host, "learning.thermal_boiler.health", "degraded");
		await setStateIfChanged(
			host,
			"learning.thermal_boiler.reason_de",
			"Boiler-Sensor fehlt — kein Fake-emptyAt; Hard nur bei verfügbarer Live-Temperatur.",
		);
		await setStateIfChanged(host, "learning.thermal_boiler.estimated_empty_at", "");
		return;
	}

	/**
	 * Cycle-Fit bewusst noch nicht aus Puffer-Historie übernommen.
	 * Bis echte Boiler-Zyklen existieren: degraded, keine emptyAt-Deadline.
	 */
	await setStateIfChanged(host, "learning.thermal_boiler.status", "insufficient_data");
	await setStateIfChanged(host, "learning.thermal_boiler.health", "degraded");
	await setStateIfChanged(host, "learning.thermal_boiler.estimated_empty_at", "");
	await setStateIfChanged(host, "learning.thermal_boiler.estimated_remaining_hours", null);
	await setStateIfChanged(
		host,
		"learning.thermal_boiler.reason_de",
		`Boiler ${temp.toFixed(1)} °C — Learning sammelt Zyklen; noch keine belastbare Reichweite.`,
	);
}
