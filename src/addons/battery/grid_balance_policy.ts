/**
 * Netzausgleich — Policy-Anbindung (Phase 1 der Batterie-Entladungs-Neuordnung).
 *
 * Ziel: Batterie-Entladung trifft keine unabhängige wirtschaftliche Entscheidung mehr
 * außerhalb des Unified Planners. `grid_balance_contract.ts` (Preis-/Safety-Gates) und
 * `grid_balance_power.ts` (Restlast-Berechnung, Hardware-Clamp, Keepalive) bleiben reine
 * technische Ausführung. Diese Datei bildet die Brücke zur bereits vom Planner/Policy-Tick
 * (`operator/daily_plan/tick.ts` → `policy/battery_consumers/`) berechneten und veröffentlichten
 * Entscheidung (`planner.constraints.battery_consumer_<id>_allowed`): Ein Verbraucher, dem die
 * Batterie laut Policy (`mayUseBattery` / `onlyWhenCritical`) aktuell nicht erlaubt ist, darf
 * nicht indirekt über den Netzausgleichs-Restlast-Bezug aus der Batterie versorgt werden.
 *
 * Die eigentliche Policy-Entscheidung (allowed/reasonDe) wird hier NICHT neu berechnet —
 * sie kommt vom Unified-Planner-Tick. Diese Datei setzt nur um: Leistung von Verbrauchern,
 * die diese Freigabe nicht haben, wird aus der Netzausgleichs-Restlast herausgerechnet.
 *
 * Erweiterbar für spätere Phasen (bewusst NICHT in Phase 1 implementiert — nur Typ-Vorbereitung,
 * damit diese Datei dafür nicht erneut umgebaut werden muss): Batterie-Lade-Budget,
 * `requiredSocAtPvEndPct`, dynamischer Nachtverbrauch, `estimatedBatteryEmptyAtIso`.
 */

export type GridBalancePolicyExcludedConsumer = {
	/** Battery-Consumer-Id, z. B. "immersion_heater" (siehe `policy/battery_consumers/types.ts`). */
	id: string;
	/** Planner-Entscheidung: darf dieser Verbraucher aktuell die Batterie nutzen? */
	allowedOnBattery: boolean;
	/** Aktuell befohlene Leistung dieses Verbrauchers (W); null/0 = nicht aktiv. */
	commandedPowerW: number | null;
};

export type GridBalancePolicyLoadAdjustmentInput = {
	/** Rohe Hauslast (W) vor jeder Bereinigung (EV-Abzug erfolgt separat in grid_balance_power.ts). */
	rawConsumptionW: number;
	excludedConsumers: GridBalancePolicyExcludedConsumer[];
};

export type GridBalancePolicyLoadAdjustment = {
	/** Hauslast nach Abzug policy-ausgeschlossener Verbraucher — Eingang für den Netzausgleich. */
	policyAdjustedConsumptionW: number;
	/** Summe der aus der Restlast herausgerechneten Leistung (W); 0 = kein Ausschluss aktiv. */
	excludedLoadW: number;
	excludedConsumerIds: string[];
	reasonDe: string;
};

/**
 * Reserviert für spätere Phasen (Batterie-Laden, Nachtverbrauch, Reichweite) — noch nicht
 * ausgewertet. Nur Typ-Vorbereitung, damit der Aufrufer diese Felder schon mitgeben kann,
 * ohne dass sich die Signatur später erneut ändert.
 */
export type ReservedGridBalanceDischargeBudgetInput = {
	maxDischargePowerW?: number | null;
	requiredSocAtPvEndPct?: number | null;
	dynamicNightConsumptionW?: number | null;
	estimatedBatteryEmptyAtIso?: string | null;
};

function roundW(n: number): number {
	return Math.max(0, Math.round(n));
}

/**
 * Rechnet die Leistung policy-ausgeschlossener Verbraucher aus der Netzausgleichs-Restlast
 * heraus. Kein Preis-, kein SOC-, kein Hardware-Gate — das bleibt in `grid_balance_contract.ts`
 * / `grid_balance_power.ts`. Reine Lastkorrektur, analog zum bestehenden EV-Abzug
 * (`adjustConsumptionForEv`), nur policy- statt EV-getrieben.
 */
export function resolveGridBalancePolicyLoadAdjustment(
	input: GridBalancePolicyLoadAdjustmentInput,
): GridBalancePolicyLoadAdjustment {
	const raw = Number.isFinite(input.rawConsumptionW) ? Math.max(0, input.rawConsumptionW) : 0;
	const excluded = input.excludedConsumers.filter(
		(c) => c.allowedOnBattery === false && c.commandedPowerW !== null && c.commandedPowerW > 0,
	);
	const excludedLoadW = roundW(
		excluded.reduce((sum, c) => sum + Math.max(0, c.commandedPowerW ?? 0), 0),
	);
	const policyAdjustedConsumptionW = Math.max(0, raw - excludedLoadW);
	const excludedConsumerIds = excluded.map((c) => c.id);
	const reasonDe =
		excluded.length === 0
			? ""
			: `Netzausgleich ohne ${excluded
					.map((c) => `${c.id} (${roundW(c.commandedPowerW ?? 0)} W)`)
					.join(", ")} — Policy: Batterie für diesen Verbraucher nicht erlaubt.`;
	return { policyAdjustedConsumptionW, excludedLoadW, excludedConsumerIds, reasonDe };
}
