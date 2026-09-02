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
	/**
	 * BLOCK B (additiv, optional): Opportunity-Cost dieser Batterie-kWh (ct/kWh), z. B. aus
	 * `battery_opportunity_cost.ts`. Wird NICHT übergeben (`undefined`/`null`) → exakt bisheriges
	 * Verhalten (Preis-/SOC-Gate wie vorher, kein dritter Gate). Wird übergeben und liegt der
	 * aktuelle Preis nicht klar über der Opportunity-Cost, wird die Freigabe zusätzlich
	 * eingeschränkt (nie erweitert) — Hold/Reserve/Preis-Gate bleiben unverändert vorrangig.
	 */
	opportunityCostCtPerKwh?: number | null;
	/** Mindestmarge (ct/kWh) über der Opportunity-Cost, ab der Netzausgleich noch lohnt. Default 3. */
	opportunityMarginCtPerKwh?: number;
	/**
	 * Gelernte GB-Economics. Wenn usable inkl. α/β/C_replace/Preis:
	 * 30-ct-Mindestpreis und alte Opportunity-Gate entfallen — Netto entscheidet.
	 * Fehlt oder nicht usable → unverändertes 30-ct-Fallback (+ optionale Opportunity).
	 */
	economics?: {
		usable: boolean;
		alpha: number | null;
		beta: number | null;
		cReplaceCtPerKwh: number | null;
		marginCtPerKwh?: number;
	} | null;
};

export type BatteryDischargeAuthorization = {
	allowed: boolean;
	/** 0, wenn nicht erlaubt. Sonst die wirtschaftliche Obergrenze — Hardware-Clamp bleibt lokal. */
	maxDischargeW: number;
	priceAllowed: boolean;
	socAllowed: boolean;
	/** BLOCK B: true, wenn keine Opportunity-Cost übergeben wurde ODER sie die Freigabe nicht einschränkt. */
	opportunityAllowed: boolean;
	/** true, wenn Economics nicht usable oder die Nettentscheidung erlaubt. */
	economicsAllowed: boolean;
	economicsUsable: boolean;
	netBenefitCtPerKwh: number | null;
	reasonDe: string;
};

export const DEFAULT_OPPORTUNITY_MARGIN_CT_PER_KWH = 3;
export const DEFAULT_ECONOMICS_DECISION_MARGIN_CT = 1.5;

export function resolveBatteryDischargeAuthorization(
	input: BatteryDischargeAuthorizationInput,
): BatteryDischargeAuthorization {
	const socKnownForDiagnostics =
		input.socPct !== null &&
		Number.isFinite(input.socPct) &&
		input.requiredSocAtPvEndPct !== null &&
		input.socPct > input.requiredSocAtPvEndPct;

	const economicsReady = isEconomicsReady(input);
	const priceCheck = evaluateGridBalanceMinPrice({
		minPriceCtPerKwh: input.minPriceCtPerKwh,
		priceNowCt: input.priceNowCt,
	});
	/*
	 * Economics usable → 30-ct-Mindestpreis gilt nicht mehr als harte Untergrenze.
	 * Preis muss trotzdem bekannt sein. Economics nicht usable → bestehendes 30-ct-Fallback.
	 */
	if (!economicsReady && !priceCheck.passed) {
		return {
			allowed: false,
			maxDischargeW: 0,
			priceAllowed: false,
			socAllowed: socKnownForDiagnostics,
			opportunityAllowed: true,
			economicsAllowed: true,
			economicsUsable: false,
			netBenefitCtPerKwh: null,
			reasonDe: priceCheck.reasonDe,
		};
	}
	if (economicsReady && (input.priceNowCt == null || !Number.isFinite(input.priceNowCt))) {
		return {
			allowed: false,
			maxDischargeW: 0,
			priceAllowed: false,
			socAllowed: socKnownForDiagnostics,
			opportunityAllowed: true,
			economicsAllowed: false,
			economicsUsable: true,
			netBenefitCtPerKwh: null,
			reasonDe: "Strompreis unbekannt — Netzausgleich pausiert",
		};
	}

	if (input.requiredSocAtPvEndPct === null) {
		return blocked("Nacht-Reserve noch nicht ausreichend gelernt (predictedNightConsumptionKwh unbekannt) — Batterieentladung konservativ gesperrt.", {
			priceAllowed: true,
			socAllowed: false,
			economicsReady,
		});
	}

	const socKnown = input.socPct !== null && Number.isFinite(input.socPct);
	if (!socKnown) {
		return blocked("SOC unbekannt — Batterieentladung wirtschaftlich gesperrt.", {
			priceAllowed: true,
			socAllowed: false,
			economicsReady,
		});
	}
	const socAllowed = input.socPct! > input.requiredSocAtPvEndPct;
	if (!socAllowed) {
		return blocked(
			`SOC ${input.socPct!.toFixed(0)} % ≤ dynamische Reserve ${input.requiredSocAtPvEndPct} % — Batterieentladung wirtschaftlich gesperrt.`,
			{ priceAllowed: true, socAllowed: false, economicsReady },
		);
	}

	if (economicsReady) {
		const e = input.economics!;
		const priceNow = input.priceNowCt as number;
		const net = e.alpha! * priceNow - e.beta! * e.cReplaceCtPerKwh!;
		const margin = e.marginCtPerKwh ?? DEFAULT_ECONOMICS_DECISION_MARGIN_CT;
		if (!(net > margin)) {
			return {
				allowed: false,
				maxDischargeW: 0,
				priceAllowed: true,
				socAllowed: true,
				opportunityAllowed: true,
				economicsAllowed: false,
				economicsUsable: true,
				netBenefitCtPerKwh: net,
				reasonDe: `Economics: Netto ${net.toFixed(1)} ct/kWh ≤ Marge ${margin.toFixed(1)} (α=${e.alpha!.toFixed(2)} × ${priceNow.toFixed(1)} − β=${e.beta!.toFixed(2)} × C_replace ${e.cReplaceCtPerKwh!.toFixed(1)}) — Netzausgleich zurückgestellt.`,
			};
		}
		return {
			allowed: true,
			maxDischargeW: Math.max(0, Math.round(input.configuredMaxDischargeW)),
			priceAllowed: true,
			socAllowed: true,
			opportunityAllowed: true,
			economicsAllowed: true,
			economicsUsable: true,
			netBenefitCtPerKwh: net,
			reasonDe: `Economics: Netto ${net.toFixed(1)} ct/kWh > Marge ${margin.toFixed(1)}; SOC ${input.socPct!.toFixed(0)} % > dynamische Reserve ${input.requiredSocAtPvEndPct} %.`,
		};
	}

	/*
	 * BLOCK B — Opportunity-Cost-Zusatzgate (additiv, nie lockernd). Nur wirksam, wenn der
	 * Aufrufer eine Opportunity-Cost übergibt (sonst identisch zum bisherigen Verhalten).
	 * Reserve/Preis/SOC-Gates oben bleiben unverändert vorrangig — dieses Gate kann nur
	 * zusätzlich EINSCHRÄNKEN, nie eine sonst gesperrte Entladung freigeben.
	 */
	if (input.opportunityCostCtPerKwh != null && Number.isFinite(input.opportunityCostCtPerKwh)) {
		const margin = input.opportunityMarginCtPerKwh ?? DEFAULT_OPPORTUNITY_MARGIN_CT_PER_KWH;
		const priceNow = input.priceNowCt ?? 0;
		if (priceNow < input.opportunityCostCtPerKwh + margin) {
			return {
				allowed: false,
				maxDischargeW: 0,
				priceAllowed: true,
				socAllowed: true,
				opportunityAllowed: false,
				economicsAllowed: true,
				economicsUsable: false,
				netBenefitCtPerKwh: null,
				reasonDe: `Preis jetzt ${priceNow.toFixed(1)} ct/kWh liegt nicht ausreichend über der geschätzten Opportunity-Cost ${input.opportunityCostCtPerKwh.toFixed(1)} ct/kWh — Netzausgleich zurückgestellt (Batterie später voraussichtlich wertvoller).`,
			};
		}
	}

	return {
		allowed: true,
		maxDischargeW: Math.max(0, Math.round(input.configuredMaxDischargeW)),
		priceAllowed: true,
		socAllowed: true,
		opportunityAllowed: true,
		economicsAllowed: true,
		economicsUsable: false,
		netBenefitCtPerKwh: null,
		reasonDe: `${priceCheck.reasonDe}; SOC ${input.socPct!.toFixed(0)} % > dynamische Reserve ${input.requiredSocAtPvEndPct} %.`,
	};
}

function isEconomicsReady(input: BatteryDischargeAuthorizationInput): boolean {
	const e = input.economics;
	return !!(
		e &&
		e.usable &&
		e.alpha != null &&
		Number.isFinite(e.alpha) &&
		e.beta != null &&
		Number.isFinite(e.beta) &&
		e.cReplaceCtPerKwh != null &&
		Number.isFinite(e.cReplaceCtPerKwh)
	);
}

function blocked(
	reasonDe: string,
	flags: { priceAllowed: boolean; socAllowed: boolean; economicsReady: boolean },
): BatteryDischargeAuthorization {
	return {
		allowed: false,
		maxDischargeW: 0,
		priceAllowed: flags.priceAllowed,
		socAllowed: flags.socAllowed,
		opportunityAllowed: true,
		economicsAllowed: true,
		economicsUsable: flags.economicsReady,
		netBenefitCtPerKwh: null,
		reasonDe,
	};
}
