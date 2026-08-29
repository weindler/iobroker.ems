/**
 * Battery-Discharge-Authority (Phase 1b der Batterie-Entladungs-Neuordnung).
 *
 * Der Unified Planner entscheidet, OB Netzausgleichs-Entladung für den aktuellen Slot
 * wirtschaftlich zulässig ist und welches Leistungsbudget dafür gilt. `grid_balance_power.ts`
 * bleibt technische Ausführung (Restlast-Berechnung, Hardware-Clamp, Ownership, Keepalive) und
 * übernimmt dieses Budget nur als zusätzliche Obergrenze — niemals mehr Leistung als hier erlaubt.
 *
 * Wiederverwendung statt Duplikation:
 * - Preisregel: `evaluateGridBalanceMinPrice` (grid_balance.ts) — dieselbe Funktion, die auch
 *   die lokale Netzausgleichs-Logik prüft. Keine zweite Preisregel.
 * - SOC-Boden: `requiredSocAtPvEndPct` — die EINE zentrale, dynamische Batterie-Reserve
 *   (`battery_reserve_target.ts`), die reale Nachtverbrauchs-Historie (`learning/battery_runtime`),
 *   PV-Forecast (`unified/next_reliable_pv.ts`) und das bestehende Lade-/Reserveziel der
 *   `battery.charge`-Contribution zusammenführt. Kein fester Prozentwert. Das absolute
 *   Hardware-Minimum bleibt unverändert lokal in der Runtime.
 * - Leistungsbudget: bestehendes Admin-Feld `bat_grid_balance_max_w` (config.gridBalance.maxTargetW)
 *   — keine neue Konfiguration.
 *
 * Fällt `requiredSocAtPvEndPct` aus (Reserve noch nicht ableitbar — weder Forecast noch
 * Historie) → konservativ gesperrt (kein Wirtschafts-Entladebudget), statt eines zweiten
 * versteckten festen Prozentwerts.
 *
 * Bewusst NICHT Teil dieses Blocks: Klima, Heizstab-Planung, Wallbox, Ownership-Umbau.
 */

import { evaluateGridBalanceMinPrice } from "../../addons/battery/grid_balance";

export type BatteryDischargeAuthorizationInput = {
	priceNowCt: number | null;
	minPriceCtPerKwh: number;
	socPct: number | null;
	/**
	 * Dynamisch gelernte Reserve (Phase 1d) — SOC, der am Ende der nutzbaren PV mindestens
	 * stehen bleiben muss. `null` = noch nicht berechenbar (zu wenig Nacht-Historie) →
	 * konservativ gesperrt, kein fester Fallback-Prozentwert.
	 */
	requiredSocAtPvEndPct: number | null;
	/** Bestehende Admin-Konfigurationsobergrenze für Netzausgleich (W). */
	configuredMaxDischargeW: number;
};

export type BatteryDischargeAuthorization = {
	allowed: boolean;
	/** 0, wenn nicht erlaubt. Sonst die wirtschaftliche Obergrenze — Hardware-Clamp bleibt lokal. */
	maxDischargeW: number;
	priceAllowed: boolean;
	socAllowed: boolean;
	reasonDe: string;
};

export function resolveBatteryDischargeAuthorization(
	input: BatteryDischargeAuthorizationInput,
): BatteryDischargeAuthorization {
	const socKnownForDiagnostics =
		input.socPct !== null &&
		Number.isFinite(input.socPct) &&
		input.requiredSocAtPvEndPct !== null &&
		input.socPct > input.requiredSocAtPvEndPct;

	const priceCheck = evaluateGridBalanceMinPrice({
		minPriceCtPerKwh: input.minPriceCtPerKwh,
		priceNowCt: input.priceNowCt,
	});
	if (!priceCheck.passed) {
		return {
			allowed: false,
			maxDischargeW: 0,
			priceAllowed: false,
			socAllowed: socKnownForDiagnostics,
			reasonDe: priceCheck.reasonDe,
		};
	}

	if (input.requiredSocAtPvEndPct === null) {
		return {
			allowed: false,
			maxDischargeW: 0,
			priceAllowed: true,
			socAllowed: false,
			reasonDe:
				"Nacht-Reserve noch nicht ausreichend gelernt (predictedNightConsumptionKwh unbekannt) — Batterieentladung konservativ gesperrt.",
		};
	}

	const socKnown = input.socPct !== null && Number.isFinite(input.socPct);
	if (!socKnown) {
		return {
			allowed: false,
			maxDischargeW: 0,
			priceAllowed: true,
			socAllowed: false,
			reasonDe: "SOC unbekannt — Batterieentladung wirtschaftlich gesperrt.",
		};
	}
	const socAllowed = input.socPct! > input.requiredSocAtPvEndPct;
	if (!socAllowed) {
		return {
			allowed: false,
			maxDischargeW: 0,
			priceAllowed: true,
			socAllowed: false,
			reasonDe: `SOC ${input.socPct!.toFixed(0)} % ≤ dynamische Reserve ${input.requiredSocAtPvEndPct} % — Batterieentladung wirtschaftlich gesperrt.`,
		};
	}

	return {
		allowed: true,
		maxDischargeW: Math.max(0, Math.round(input.configuredMaxDischargeW)),
		priceAllowed: true,
		socAllowed: true,
		reasonDe: `${priceCheck.reasonDe}; SOC ${input.socPct!.toFixed(0)} % > dynamische Reserve ${input.requiredSocAtPvEndPct} %.`,
	};
}
