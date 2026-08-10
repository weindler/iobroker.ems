/**
 * Nächste belastbare PV-Versorgungsmöglichkeit — gemeinsam für Thermal-Bridge und Battery-Reserve.
 * Kein „PV > 0“, sondern kumulativer Surplus mit Confidence-Abschlag.
 * Pflichtenergie (nicht-thermisch) wird vor Opportunity-Erkennung vom Surplus abgezogen —
 * keine Doppelverwendung derselben PV-kWh als „sichere Versorgung“.
 */

import { FLOOR_EPS, findPvRecoverySlotIdx, type ReserveFloorSlot } from "./battery_reserve_floor";
import { IMMERSION_DEFAULT_KWH_PER_DEGREE_C } from "../../contributions/flexible/flex_demand";

/** Verbindliche PV-Ansprüche vor Flex-/Thermal-Opportunity (keine Zirkularität mit Thermal-Bridge). */
export type HardPvBoundConsumer = {
	remainingKwh: number;
	maxPowerW: number | null;
	deadlineMs: number;
	slotAllowed?: (slotStartIso: string) => boolean;
};

function round3(n: number): number {
	return Math.round(n * 1000) / 1000;
}

/**
 * Früheste-Slot-Bindung harter Pflichtlasten an Roh-Surplus (PV − Haus).
 * Thermal bewusst ausgenommen (Bridge hängt von next-PV ab).
 */
export function estimateHardPvBoundKwhBySlot(
	slots: ReserveFloorSlot[],
	nowMs: number,
	hardConsumers: HardPvBoundConsumer[],
): number[] {
	const bound = slots.map(() => 0);
	const slotH = 0.25;
	for (const c of hardConsumers) {
		let need = c.remainingKwh;
		if (!(need > FLOOR_EPS)) continue;
		const maxSlot =
			c.maxPowerW != null && c.maxPowerW > 0 ? (c.maxPowerW / 1000) * slotH : Number.POSITIVE_INFINITY;
		for (let i = 0; i < slots.length && need > FLOOR_EPS; i++) {
			const s = slots[i]!;
			if (s.startMs < nowMs - 60_000) continue;
			if (s.startMs >= c.deadlineMs) break;
			if (c.slotAllowed && !c.slotAllowed(s.startIso)) continue;
			const free = Math.max(0, s.pvKwh - s.houseKwh - bound[i]!);
			const take = Math.min(need, maxSlot, free);
			if (take > FLOOR_EPS) {
				bound[i] = bound[i]! + take;
				need -= take;
			}
		}
	}
	return bound.map(round3);
}

/** Reduziert Slot-PV um gebundene Pflichtenergie (Kopie — Allocation-Slots unverändert). */
export function applyHardPvBoundsToSlots<T extends ReserveFloorSlot>(
	slots: T[],
	boundKwhBySlot: number[],
): T[] {
	return slots.map((s, i) => {
		const bound = Math.max(0, boundKwhBySlot[i] ?? 0);
		if (!(bound > FLOOR_EPS)) return s;
		return { ...s, pvKwh: Math.max(0, s.pvKwh - bound) };
	});
}

export type NextReliablePvResult = {
	slotIdx: number | null;
	startIso: string | null;
	startMs: number | null;
	reasonDe: string;
};

/**
 * Wie findPvRecoverySlotIdx, aber PV-kWh werden mit Confidence abgewertet
 * (niedrige Confidence → Recovery später / schwieriger).
 *
 * @param afterMs Optional: erste Recovery mit startMs > afterMs (Slot-Zeitstempel,
 *   keine feste Stundenheuristik). Für Thermal-Bridge bevorzugt
 *   findNextReliablePvAfterCurrentWindow (Ende des aktuellen Surplus-Fensters).
 */
export function findNextReliablePvOpportunity(
	slots: ReserveFloorSlot[],
	fromIdx: number,
	pvConfidence01: number,
	afterMs?: number | null,
): NextReliablePvResult {
	const conf = Number.isFinite(pvConfidence01) ? Math.max(0.2, Math.min(1, pvConfidence01)) : 0.7;
	const adjusted = slots.map((s) => ({
		...s,
		pvKwh: s.pvKwh * conf,
	}));
	let searchFrom = Math.max(0, fromIdx);
	if (afterMs != null && Number.isFinite(afterMs)) {
		const afterIdx = slots.findIndex((s) => s.startMs > afterMs);
		if (afterIdx < 0) {
			return {
				slotIdx: null,
				startIso: null,
				startMs: null,
				reasonDe: "Keine belastbare PV-Recovery nach aktuellem Fenster.",
			};
		}
		searchFrom = Math.max(searchFrom, afterIdx);
	}
	const idx = findPvRecoverySlotIdx(adjusted, searchFrom);
	if (idx === null || !slots[idx]) {
		return {
			slotIdx: null,
			startIso: null,
			startMs: null,
			reasonDe: "Keine belastbare PV-Recovery im Horizon.",
		};
	}
	return {
		slotIdx: idx,
		startIso: slots[idx]!.startIso,
		startMs: slots[idx]!.startMs,
		reasonDe: `Belastbare PV-Recovery ab ${slots[idx]!.startIso} (conf=${(conf * 100).toFixed(0)} %).`,
	};
}

/**
 * 1 kW × Slotlänge (0,25 h) — an Raster gebunden, keine Uhrzeit-Heuristik.
 * Wird nur als „PV sichtbar“-Schwelle genutzt, nicht als Stunden-Cutoff.
 */
const SLOT_ENERGY_1KW_KWH = 0.25;

/** Meaningful Surplus/PV im Slot — Surplus > EPS oder mind. ~1 kW×Slot. */
function isMeaningfulSurplusSlot(s: ReserveFloorSlot): boolean {
	return Math.max(0, s.pvKwh - s.houseKwh) > FLOOR_EPS || s.pvKwh >= SLOT_ENERGY_1KW_KWH;
}

/**
 * Ende des aktuell laufenden / unmittelbar startenden Surplus-Fensters (Slot-Index).
 * Basiert nur auf Forecast-Slots: Surplus-Streak + max. 2 Slot-Lücken (30 min bei 15-min-Raster).
 * Keine Uhrzeit-/Stunden-Heuristik — ein separates Fenster in 2–5 h nach einer echten
 * Surplus-Pause wird nicht übersprungen.
 */
export function findEndOfCurrentSurplusWindowIdx(
	slots: ReserveFloorSlot[],
	fromIdx: number,
): number {
	if (slots.length === 0) return 0;
	const i = Math.max(0, Math.min(fromIdx, slots.length - 1));

	/** Kurzes Vorlauf-Fenster: Ramp-in ohne sofortigen Surplus (max. 4 Slots). */
	let start = i;
	while (start < slots.length && !isMeaningfulSurplusSlot(slots[start]!)) {
		if (start > i + 4) return i; // kein aktuelles Fenster → nichts überspringen
		start++;
	}
	if (start >= slots.length) return i;

	let end = start;
	let gap = 0;
	/** Strukturelle Slot-Lücke (2×15 min), keine Tages-/Stundenkonstante. */
	const gapSlots = 2;
	while (end < slots.length) {
		if (isMeaningfulSurplusSlot(slots[end]!)) {
			gap = 0;
			end++;
		} else {
			gap++;
			if (gap > gapSlots) break;
			end++;
		}
	}
	return Math.min(slots.length, end);
}

/**
 * Erster Surplus-Slot ab afterIdx (Start des nächsten Fensters).
 * Wichtig: nicht mit findPvRecoverySlotIdx verwechseln — der kann mitten in einer
 * Lücke starten, sobald der Blick voraus genug kumulativen Surplus sieht.
 */
export function findStartOfNextSurplusWindowIdx(
	slots: ReserveFloorSlot[],
	afterIdx: number,
): number | null {
	const start = Math.max(0, afterIdx);
	for (let i = start; i < slots.length; i++) {
		if (isMeaningfulSurplusSlot(slots[i]!)) return i;
	}
	return null;
}

/**
 * Nächste PV-Gelegenheit für Thermal-Bridge: Recovery NACH dem aktuellen Surplus-Fenster
 * (damit „hält bis nächste Versorgung“ nicht mit dem laufenden Peak verwechselt wird).
 *
 * Fenstergrenzen aus Roh-PV (keine Fragmentierung durch Pflichtbindung).
 * Zuverlässigkeit / freier Surplus: optional nach Abzug hard-bound kWh.
 */
export function findNextReliablePvAfterCurrentWindow(
	slots: ReserveFloorSlot[],
	fromIdx: number,
	pvConfidence01: number,
	_nowMs: number,
	boundKwhBySlot?: number[] | null,
): NextReliablePvResult {
	void _nowMs;
	const hasBound = boundKwhBySlot != null && boundKwhBySlot.some((b) => b > FLOOR_EPS);
	const checkSlots = hasBound ? applyHardPvBoundsToSlots(slots, boundKwhBySlot!) : slots;
	const afterIdx = findEndOfCurrentSurplusWindowIdx(slots, fromIdx);
	let nextSurplusIdx = findStartOfNextSurplusWindowIdx(slots, afterIdx);
	if (nextSurplusIdx !== null && nextSurplusIdx > fromIdx && hasBound) {
		/** Wenn Roh-Start nach Bindung keinen freien Surplus hat → nächstes freies Fenster. */
		const free = Math.max(
			0,
			(checkSlots[nextSurplusIdx]?.pvKwh ?? 0) - (checkSlots[nextSurplusIdx]?.houseKwh ?? 0),
		);
		if (free <= FLOOR_EPS) {
			nextSurplusIdx = findStartOfNextSurplusWindowIdx(checkSlots, nextSurplusIdx);
		}
	}
	if (nextSurplusIdx !== null && nextSurplusIdx > fromIdx) {
		const reliable = findNextReliablePvOpportunity(checkSlots, nextSurplusIdx, pvConfidence01);
		if (reliable.slotIdx !== null) {
			const s = slots[nextSurplusIdx]!;
			return {
				slotIdx: nextSurplusIdx,
				startIso: s.startIso,
				startMs: s.startMs,
				reasonDe: hasBound
					? `Nächstes Surplus-Fenster ab ${s.startIso} (nach Pflichtbindung conf-geprüft).`
					: `Nächstes Surplus-Fenster ab ${s.startIso} (conf-geprüft).`,
			};
		}
	}
	/** Kein Folgef Fenster / kurzer Horizon: erste Recovery ab now. */
	return findNextReliablePvOpportunity(checkSlots, fromIdx, pvConfidence01);
}

/**
 * Erwarteter Nettobedarf (Haus − abgewertete PV) von fromIdx bis recoveryIdx (exklusiv Recovery-Start).
 * Nie negativ; Unsicherheitsanteil über (1−confidence).
 */
export function expectedNetDemandUntilPvKwh(
	slots: ReserveFloorSlot[],
	fromIdx: number,
	recoveryIdx: number | null,
	pvConfidence01: number,
): number {
	if (slots.length === 0) return 0;
	const conf = Number.isFinite(pvConfidence01) ? Math.max(0.2, Math.min(1, pvConfidence01)) : 0.7;
	const end = recoveryIdx !== null ? Math.max(fromIdx, recoveryIdx) : slots.length - 1;
	let net = 0;
	for (let j = fromIdx; j < end && j < slots.length; j++) {
		const s = slots[j]!;
		const pvEff = s.pvKwh * conf;
		net += Math.max(0, s.houseKwh - pvEff);
	}
	return Math.round(net * 1000) / 1000;
}

export type ThermalBridgeEnergyInput = {
	nowMs: number;
	bufferTempC: number | null;
	minTempC: number | null;
	/** Contribution-/Bridge-Headroom Richtung Target (kann Precharge enthalten). */
	headroomEnergyKwh: number | null;
	coolingRateCPerH: number | null;
	estimatedEmptyAtMs: number | null;
	nextReliablePvMs: number | null;
	pvConfidence01: number;
	kwhPerDegreeC?: number | null;
};

export type ThermalBridgeEnergyResult = {
	/** Energie, die der Unified Planner als Thermal-Bedarf setzt. */
	plannerEnergyKwh: number;
	mandatoryEnergyKwh: number;
	economicHeadroomKwh: number;
	coversUntilNextPv: boolean;
	reasonDe: string;
};

/**
 * Mindestenergie bis zur nächsten belastbaren PV vs. wirtschaftlichem Precharge-Rest.
 * Wenn der Puffer bis nextReliablePv ≥ minTemp hält und emptyAt nicht davor liegt:
 * kein Zwang Richtung Target — nur kleine Unsicherheitsmarge.
 */
export function resolveThermalPlannerEnergy(input: ThermalBridgeEnergyInput): ThermalBridgeEnergyResult {
	const headroom =
		input.headroomEnergyKwh !== null && Number.isFinite(input.headroomEnergyKwh)
			? Math.max(0, input.headroomEnergyKwh)
			: 0;
	const kwhPerC =
		input.kwhPerDegreeC != null && input.kwhPerDegreeC > 0
			? input.kwhPerDegreeC
			: IMMERSION_DEFAULT_KWH_PER_DEGREE_C;
	const conf = Number.isFinite(input.pvConfidence01)
		? Math.max(0.2, Math.min(1, input.pvConfidence01))
		: 0.7;

	const fallback = (reasonDe: string): ThermalBridgeEnergyResult => ({
		plannerEnergyKwh: headroom,
		mandatoryEnergyKwh: headroom,
		economicHeadroomKwh: 0,
		coversUntilNextPv: false,
		reasonDe,
	});

	if (
		input.bufferTempC === null ||
		input.minTempC === null ||
		input.coolingRateCPerH === null ||
		!(input.coolingRateCPerH > 0) ||
		input.nextReliablePvMs === null ||
		!(input.nextReliablePvMs >= input.nowMs - 60_000)
	) {
		return fallback("Thermal-Bridge ohne belastbare PV/Kühlrate — Contribution-Headroom.");
	}

	const hoursToPv = (input.nextReliablePvMs - input.nowMs) / 3600_000;
	const emptyAtKnown =
		input.estimatedEmptyAtMs !== null &&
		Number.isFinite(input.estimatedEmptyAtMs) &&
		input.estimatedEmptyAtMs > input.nowMs;

	/*
	 * Primär: Learning-emptyAt. Liegt emptyAt nach nextReliablePv, reicht der Puffer
	 * bis zur PV-Gelegenheit — kein Target-Precharge-Zwang (Audit 09.08.).
	 */
	if (emptyAtKnown && input.estimatedEmptyAtMs! >= input.nextReliablePvMs - 60_000) {
		const uncertaintyK =
			conf < 0.7 ? input.coolingRateCPerH * hoursToPv * ((0.7 - conf) / 0.7) * 0.35 : 0;
		const mandatory = Math.round(Math.max(0, uncertaintyK) * kwhPerC * 1000) / 1000;
		return {
			plannerEnergyKwh: mandatory,
			mandatoryEnergyKwh: mandatory,
			economicHeadroomKwh: 0,
			coversUntilNextPv: true,
			reasonDe: `emptyAt nach nächster PV — kein Target-Precharge (conf=${(conf * 100).toFixed(0)} %).`,
		};
	}

	if (emptyAtKnown && input.estimatedEmptyAtMs! < input.nextReliablePvMs) {
		return {
			plannerEnergyKwh: headroom,
			mandatoryEnergyKwh: headroom,
			economicHeadroomKwh: 0,
			coversUntilNextPv: false,
			reasonDe: "emptyAt vor nächster PV — voller Mindest-/Bridge-Bedarf.",
		};
	}

	/** Fallback ohne emptyAt: Kühlrate bis PV. */
	const tempAtPv = input.bufferTempC - input.coolingRateCPerH * hoursToPv;
	const marginK =
		conf < 0.7 ? input.coolingRateCPerH * hoursToPv * ((0.7 - conf) / 0.7) * 0.5 : 0;
	const covers = tempAtPv >= input.minTempC + marginK - FLOOR_EPS;

	if (covers) {
		const uncertaintyK = marginK;
		const mandatory = Math.round(Math.max(0, uncertaintyK) * kwhPerC * 1000) / 1000;
		return {
			plannerEnergyKwh: mandatory,
			mandatoryEnergyKwh: mandatory,
			economicHeadroomKwh: 0,
			coversUntilNextPv: true,
			reasonDe: `Puffer hält bis PV (~${tempAtPv.toFixed(1)} °C ≥ ${input.minTempC} °C) — kein Target-Precharge.`,
		};
	}

	const needDeltaC = input.minTempC + marginK - tempAtPv;
	const mandatory = Math.round(Math.max(0, needDeltaC) * kwhPerC * 1000) / 1000;
	const economic = Math.max(0, headroom - mandatory);
	return {
		plannerEnergyKwh: Math.max(mandatory, headroom),
		mandatoryEnergyKwh: mandatory,
		economicHeadroomKwh: economic,
		coversUntilNextPv: false,
		reasonDe: `Mindestenergie ~${mandatory.toFixed(2)} kWh bis PV (Δ${needDeltaC.toFixed(1)} K).`,
	};
}
