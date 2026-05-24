import type { BatteryTickHost } from "./grid_balance_runner";

/** Platzhalter: Winter-Netzladen (Modus 1, einmal charge) — folgt in separatem Schritt. */

export async function runWinterGridChargeTick(_adapter: BatteryTickHost): Promise<void> {
	/* no-op v0.0.18 */
}
