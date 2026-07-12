import { refreshAirConditioningRuntime } from "../addons/air_conditioning";
import { runBatteryControlTick } from "../addons/battery";
import { refreshImmersionHeaterRuntime } from "../addons/immersion_heater";
import { refreshWallboxEvccTelemetry } from "../addons/wallbox";
import type { StaticStateTreeHost } from "./ensure_static_tree";

export type ReconcileHost = StaticStateTreeHost & ioBroker.Adapter;

/**
 * Nach Öffnung der Bootstrap-Barriere: aktuelle Fremdeingänge erneut einlesen.
 * Schließt die Lücke zwischen Modul-Initial-Read (Phase E/F) und Barriereöffnung.
 */
export async function runPostBootstrapReconciliation(host: ReconcileHost): Promise<void> {
	await refreshWallboxEvccTelemetry(host);
	await runBatteryControlTick(host);
	await refreshImmersionHeaterRuntime(host);
	await refreshAirConditioningRuntime(host);
}
