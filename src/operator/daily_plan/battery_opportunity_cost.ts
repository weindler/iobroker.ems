/**
 * BLOCK B — Battery Opportunity Cost.
 *
 * Transparente, gebundene Bewertung: "was ist eine aktuell entnommene Batterie-kWh
 * voraussichtlich wert, wenn sie NICHT jetzt entladen wird?" — als ct/kWh-Schätzung mit
 * Reason-Codes, keine versteckte Genauigkeit, keine eigene Reserve-/Safety-Logik (die bleibt
 * unverändert bei den bestehenden Gates: `battery_reserve_target.ts`, `battery_reserve_floor.ts`,
 * `passive_battery_energy.ts`). Dieses Modul liefert NUR einen zusätzlichen Wirtschaftlichkeits-
 * Faktor, der optional in bestehende Entscheidungen einfließen kann (Netzausgleich, s.
 * `battery_discharge_authority.ts`) — es ersetzt keine bestehende Gate-Logik und hebelt keine
 * aus.
 *
 * Bewusst einfach: kein neues Preismodell, keine KI, keine Selbstmodifikation. Bounded gegen
 * Scheingenauigkeit (siehe `BATTERY_OPPORTUNITY_MAX_CT`).
 */

import { clampToBounds } from "./unified/learning_gate";

export const BATTERY_OPPORTUNITY_MIN_CT = 0;
/** Realistische Obergrenze (ct/kWh) — verhindert Scheingenauigkeit bei Preis-Ausreißern. */
export const BATTERY_OPPORTUNITY_MAX_CT = 60;
/** Abschlagsfaktor, wenn kein bekannter späterer Bedarf (Thermal/EV/PV) vorliegt. */
export const BATTERY_OPPORTUNITY_NO_DEMAND_DISCOUNT = 0.3;
/**
 * Headroom oberhalb der Reserve muss mindestens das X-Fache des bekannten späteren
 * Netto-Bedarfs (Demand abzüglich erwarteter PV) betragen, um als „reichlich" zu gelten —
 * erst dann greift der Abschlag unten. Verhindert, dass ein einzelner hoher Preis-Peak
 * irgendwo im Forecast-Horizont bei hohem SOC/viel Headroom grundlos ein Entladebudget von 0
 * erzeugt (PFLICHT-FIX 2).
 */
export const BATTERY_OPPORTUNITY_SURPLUS_HEADROOM_MULTIPLIER = 1.5;
/** Abschlagsfaktor, wenn das Headroom den bekannten späteren Bedarf bereits reichlich deckt. */
export const BATTERY_OPPORTUNITY_SURPLUS_DISCOUNT = 0.3;

export type BatteryOpportunityCostPriceSlot = {
	startMs: number;
	importCtPerKwh: number | null;
};

export type BatteryOpportunityCostInput = {
	nowMs: number;
	/** Bekannte zukünftige Preis-Slots (Forecast) — dieselbe Preisreihe wie der Unified Planner. */
	priceSlots: BatteryOpportunityCostPriceSlot[];
	/** Aktueller SOC in kWh oberhalb der dynamischen Reserve; null = unbekannt. */
	headroomAboveReserveKwh: number | null;
	/** Rest-PV-Prognose für heute (kWh); null = unbekannt. Reduziert Opportunity, wenn hoch. */
	pvRemainingTodayKwh: number | null;
	/** Bekannter Restbedarf geplanter Verbraucher später (Thermal-Headroom + EV-Ziel), kWh. */
	plannedLaterDemandKwh: number | null;
};

export type BatteryOpportunityCostReasonCode =
	| "battery_opportunity_no_later_price_known"
	| "battery_opportunity_no_known_later_demand"
	| "battery_opportunity_later_demand_or_pv_pending"
	| "battery_opportunity_headroom_unknown"
	| "battery_opportunity_headroom_exceeds_later_demand";

export type BatteryOpportunityCostResult = {
	/** ct/kWh, gebunden auf [BATTERY_OPPORTUNITY_MIN_CT, BATTERY_OPPORTUNITY_MAX_CT]. */
	opportunityCostCtPerKwh: number;
	headroomAboveReserveKwh: number | null;
	reasonCodes: BatteryOpportunityCostReasonCode[];
	/** false = keine belastbare spätere Preisinformation — Wert ist der konservative Fallback (0). */
	usable: boolean;
};

/**
 * Schätzt den Wert einer jetzt entnommenen Batterie-kWh anhand des bekannten späteren
 * Preis-Peaks. Ohne bekannten späteren Bedarf (Thermal/EV/PV) wird der Wert deutlich
 * abgeschlagen (Batterie würde sonst nur ungenutzt herumstehen oder niedrigwertig exportieren).
 * Mit bekanntem Bedarf, aber reichlich Headroom oberhalb der Reserve (PFLICHT-FIX 2), wird
 * ebenfalls abgeschlagen — sonst blockiert ein einzelner später Preis-Peak grundlos jedes
 * Entladebudget, obwohl genug Energie für Netzausgleich UND den späteren Bedarf da ist.
 * Rührt NICHT an Reserve/Safety selbst — `headroomAboveReserveKwh` verändert nur die
 * Knappheits-Schätzung dieses Moduls, nie die Gates in `battery_reserve_target.ts` /
 * `battery_reserve_floor.ts` / `passive_battery_energy.ts`.
 */
export function evaluateBatteryOpportunityCost(
	input: BatteryOpportunityCostInput,
): BatteryOpportunityCostResult {
	const reasonCodes: BatteryOpportunityCostReasonCode[] = [];
	if (input.headroomAboveReserveKwh == null || !Number.isFinite(input.headroomAboveReserveKwh)) {
		reasonCodes.push("battery_opportunity_headroom_unknown");
	}

	const laterPrices = input.priceSlots
		.filter((s) => s.startMs > input.nowMs && s.importCtPerKwh != null && Number.isFinite(s.importCtPerKwh))
		.map((s) => s.importCtPerKwh as number);

	if (laterPrices.length === 0) {
		reasonCodes.push("battery_opportunity_no_later_price_known");
		return {
			opportunityCostCtPerKwh: BATTERY_OPPORTUNITY_MIN_CT,
			headroomAboveReserveKwh: input.headroomAboveReserveKwh,
			reasonCodes,
			usable: false,
		};
	}

	const laterPeakCt = Math.max(...laterPrices);
	const laterDemandKwh = Math.max(0, input.plannedLaterDemandKwh ?? 0);
	const pvPending = Math.max(0, input.pvRemainingTodayKwh ?? 0);

	let cost = laterPeakCt;
	if (laterDemandKwh <= 0.01 && pvPending <= 0.01) {
		cost *= BATTERY_OPPORTUNITY_NO_DEMAND_DISCOUNT;
		reasonCodes.push("battery_opportunity_no_known_later_demand");
	} else {
		reasonCodes.push("battery_opportunity_later_demand_or_pv_pending");
		/*
		 * PFLICHT-FIX 2: ein bekannter späterer Bedarf allein rechtfertigt keinen vollen
		 * Peak-Preis, wenn das Headroom oberhalb der Reserve diesen Netto-Bedarf (Bedarf
		 * abzüglich erwarteter PV) bereits reichlich abdeckt. Sonst hält ein einzelner hoher
		 * Preis-Peak irgendwo im Forecast-Horizont das Entladebudget grundlos bei 0, obwohl
		 * bei hohem SOC genug Energie oberhalb der Reserve für Netzausgleich UND den späteren
		 * Bedarf vorhanden ist. Rührt weiterhin nicht an Reserve/Safety selbst — nur an der
		 * Schätzung, wie knapp die Lage tatsächlich ist.
		 */
		if (laterDemandKwh > 0.01) {
			const requiredLaterKwh = Math.max(0.01, laterDemandKwh - pvPending);
			const headroomKnown =
				input.headroomAboveReserveKwh != null && Number.isFinite(input.headroomAboveReserveKwh);
			if (
				headroomKnown &&
				input.headroomAboveReserveKwh! > 0 &&
				input.headroomAboveReserveKwh! >= requiredLaterKwh * BATTERY_OPPORTUNITY_SURPLUS_HEADROOM_MULTIPLIER
			) {
				cost *= BATTERY_OPPORTUNITY_SURPLUS_DISCOUNT;
				reasonCodes.push("battery_opportunity_headroom_exceeds_later_demand");
			}
		}
	}

	return {
		opportunityCostCtPerKwh: clampToBounds(cost, BATTERY_OPPORTUNITY_MIN_CT, BATTERY_OPPORTUNITY_MAX_CT),
		headroomAboveReserveKwh: input.headroomAboveReserveKwh,
		reasonCodes,
		usable: true,
	};
}
