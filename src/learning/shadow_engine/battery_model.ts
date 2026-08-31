/**
 * PHASE 5 — Deterministisches Batteriemodell für die Shadow-Welt "reference_no_ems".
 *
 * Bewusst einfach gehalten: naive Eigenverbrauchs-Ladelogik ohne EMS-Intelligenz
 * (kein Preis-/PV-Timing, keine Nachtreserve, keine Netzausgleich-Logik) — das ist
 * exakt die Referenz, gegen die der EMS-Vorteil gemessen werden soll. Keine perfekte
 * rückblickende Optimierung, keine erfundene Genauigkeit.
 *
 * Pro Slot: Überschuss (PV > Last) lädt die Batterie bis maxSocPct/Maximalleistung,
 * Rest wird eingespeist. Defizit (Last > PV) entlädt die Batterie bis minSocPct/
 * Maximalleistung, Rest kommt aus dem Netz. Slots mit fehlenden Grunddaten (PV oder
 * Last unbekannt) werden übersprungen (SOC bleibt unverändert) und als "missing"
 * gezählt statt eine 0 zu erfinden.
 */

export interface GreedyBatteryModelInput {
	pvKwh: Array<number | null>;
	totalLoadKwh: Array<number | null>;
	slotHours: number;
	startSocPct: number;
	usableCapacityKwh: number;
	minSocPct: number;
	maxSocPct: number;
	/** null/0 = keine Begrenzung (nur Kapazität/Slot-Dauer begrenzen). */
	maxChargeW: number | null;
	maxDischargeW: number | null;
}

export interface GreedyBatteryModelOutput {
	gridImportKwh: Array<number | null>;
	gridExportKwh: Array<number | null>;
	batteryChargeKwh: Array<number | null>;
	batteryDischargeKwh: Array<number | null>;
	socPct: Array<number | null>;
	missingSlots: number;
}

function round3(n: number): number {
	return Math.round(n * 1000) / 1000;
}

/**
 * Reine Funktion, keine I/O. Deterministisch bei gleichem Input — Voraussetzung für
 * die geforderte Reproduzierbarkeit der Shadow-Baseline.
 */
export function simulateGreedyBatterySelfConsumption(
	input: GreedyBatteryModelInput,
): GreedyBatteryModelOutput {
	const n = input.pvKwh.length;
	const out: GreedyBatteryModelOutput = {
		gridImportKwh: new Array(n).fill(null),
		gridExportKwh: new Array(n).fill(null),
		batteryChargeKwh: new Array(n).fill(null),
		batteryDischargeKwh: new Array(n).fill(null),
		socPct: new Array(n).fill(null),
		missingSlots: 0,
	};

	const cap = input.usableCapacityKwh > 0 ? input.usableCapacityKwh : 0;
	if (cap <= 0) {
		out.missingSlots = n;
		return out;
	}
	const minPct = Math.max(0, Math.min(100, input.minSocPct));
	const maxPct = Math.max(minPct, Math.min(100, input.maxSocPct));
	const minKwh = cap * (minPct / 100);
	const maxKwh = cap * (maxPct / 100);
	let socKwh = Math.max(minKwh, Math.min(maxKwh, cap * (Math.max(0, Math.min(100, input.startSocPct)) / 100)));

	const maxChargeKwhPerSlot =
		input.maxChargeW !== null && input.maxChargeW > 0
			? (input.maxChargeW / 1000) * input.slotHours
			: Number.POSITIVE_INFINITY;
	const maxDischargeKwhPerSlot =
		input.maxDischargeW !== null && input.maxDischargeW > 0
			? (input.maxDischargeW / 1000) * input.slotHours
			: Number.POSITIVE_INFINITY;

	for (let i = 0; i < n; i++) {
		const pv = input.pvKwh[i];
		const load = input.totalLoadKwh[i];
		if (pv === null || load === null) {
			out.missingSlots += 1;
			out.socPct[i] = round3((socKwh / cap) * 100);
			continue;
		}
		const net = pv - load;
		let gridImportKwh = 0;
		let gridExportKwh = 0;
		let chargeKwh = 0;
		let dischargeKwh = 0;
		if (net >= 0) {
			chargeKwh = Math.max(0, Math.min(net, maxKwh - socKwh, maxChargeKwhPerSlot));
			socKwh += chargeKwh;
			gridExportKwh = Math.max(0, net - chargeKwh);
		} else {
			const deficit = -net;
			dischargeKwh = Math.max(0, Math.min(deficit, socKwh - minKwh, maxDischargeKwhPerSlot));
			socKwh -= dischargeKwh;
			gridImportKwh = Math.max(0, deficit - dischargeKwh);
		}
		out.gridImportKwh[i] = round3(gridImportKwh);
		out.gridExportKwh[i] = round3(gridExportKwh);
		out.batteryChargeKwh[i] = round3(chargeKwh);
		out.batteryDischargeKwh[i] = round3(dischargeKwh);
		out.socPct[i] = round3((socKwh / cap) * 100);
	}
	return out;
}
