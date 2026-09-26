/** Preisbrücke aus bekannten Viertelstunden. Keine Gerätebefehle. */
export type PriceBridgeSlot = {
	startIso: string;
	endIso: string;
	pvKwh: number | null;
	houseKwh: number | null;
	committedKwh: number;
	importCt: number | null;
	gridAllowed: boolean;
};

export type PriceBridgeInput = {
	slots: PriceBridgeSlot[];
	nowMs: number;
	socPct: number | null;
	capacityKwh: number | null;
	maxChargePowerW: number | null;
	minSocPct: number | null;
	maxSocPct: number | null;
	nightKwh: number | null;
	pvConfidencePct: number | null;
	chargeEfficiency: number | null;
	dischargeEfficiency: number | null;
	wearCtPerKwh: number | null;
	priceSource: string | null;
	mode: string;
};

export type PriceBridgeDecision = {
	usable: boolean;
	targetSocPct: number | null;
	gridEnergyKwh: number;
	chargeStartIso: string | null;
	chargeEndIso: string | null;
	peakStartIso: string | null;
	holdStartIso: string | null;
	holdEndIso: string | null;
	reasonDe: string;
};

function unavailable(reasonDe: string): PriceBridgeDecision {
	return { usable: false, targetSocPct: null, gridEnergyKwh: 0, chargeStartIso: null,
		chargeEndIso: null, peakStartIso: null, holdStartIso: null, holdEndIso: null, reasonDe };
}

export function planBatteryPriceBridge(input: PriceBridgeInput): PriceBridgeDecision {
	if (input.mode === "off") return unavailable("Batterieoptimierung ausgeschaltet.");
	if (input.priceSource !== "dynamic_tariff") return unavailable("Keine veröffentlichten Tibber-Preise für eine verbindliche Netzladung.");
	const { capacityKwh: cap, chargeEfficiency: etaC, dischargeEfficiency: etaD } = input;
	if (cap == null || cap <= 0 || input.socPct == null || input.minSocPct == null || input.maxSocPct == null ||
		etaC == null || etaC <= 0 || etaC > 1 || etaD == null || etaD <= 0 || etaD > 1 ||
		input.wearCtPerKwh == null || input.wearCtPerKwh < 0 || input.nightKwh == null ||
		input.pvConfidencePct == null) return unavailable("SOC, Nachtverbrauch, Wirkungsgrad oder Batteriekosten fehlen.");
	const slots = input.slots.filter(s => Date.parse(s.endIso) > input.nowMs);
	if (slots.length < 4 || slots.some(s => s.pvKwh == null || s.houseKwh == null ||
		!Number.isFinite(s.pvKwh) || !Number.isFinite(s.houseKwh)))
		return unavailable("PV- oder Hausprognose im Planungsfenster unvollständig.");
	// Tibber veröffentlicht kürzer als der PV-Ausblick: unbekannte spätere Preise
	// dürfen die bekannte Hochpreisphase nicht entwerten und werden nie geschätzt.
	const pricedEnd = slots.findIndex(s => s.importCt == null || !Number.isFinite(s.importCt));
	const publishedEnd = pricedEnd < 0 ? slots.length : pricedEnd;
	if (publishedEnd < 4) return unavailable("Veröffentlichte Preise reichen nicht für eine Netzladeentscheidung.");
	const confidence = Math.max(0.2, Math.min(1, input.pvConfidencePct / 100));
	const surplus = (s: PriceBridgeSlot) => Math.max(0, s.pvKwh! * confidence - s.houseKwh! - Math.max(0, s.committedKwh));
	// Die nächste PV-Erholung muss aus Nettoüberschuss bestehen, nicht aus der Tagessumme.
	let recovery = slots.length;
	for (let i = 1; i + 1 < slots.length; i++) {
		if (surplus(slots[i]!) <= 0 || surplus(slots[i + 1]!) <= 0) continue;
		const following = slots.slice(i, Math.min(slots.length, i + 48)).reduce((n, s) => n + surplus(s), 0);
		if (following >= Math.max(1, input.nightKwh * 0.5)) { recovery = i; break; }
	}
	const beforeRecovery = slots.slice(0, recovery);
	const withDemand = beforeRecovery.slice(0, publishedEnd).filter(s => s.houseKwh! > s.pvKwh! * confidence);
	if (!withDemand.length) return unavailable("Kein Netzbedarf vor der nächsten verlässlichen PV-Erholung.");
	const peak = withDemand.reduce((a, b) => b.importCt! > a.importCt! ? b : a);
	const peakIndex = slots.indexOf(peak);
	const cheap = slots.slice(0, peakIndex).filter(s => s.gridAllowed && s.importCt != null)
		.reduce<PriceBridgeSlot | null>((a, b) => !a || b.importCt! < a.importCt! ? b : a, null);
	if (!cheap) return unavailable("Kein erlaubtes Ladefenster vor dem teuren Netzbedarf.");
	const cost = cheap.importCt! / (etaC * etaD) + input.wearCtPerKwh;
	const safetyMargin = Math.max(2, cost * 0.05);
	if (peak.importCt! <= cost + safetyMargin) return unavailable("Preisvorteil nach Verlusten und Verschleiß nicht ausreichend.");
	const highDemand = withDemand.filter(s => s.importCt! >= peak.importCt! * 0.9)
		.reduce((n, s) => n + Math.max(0, s.houseKwh! - s.pvKwh! * confidence), 0);
	const totalDemand = beforeRecovery.reduce((n, s) => n + Math.max(0, s.houseKwh! - s.pvKwh! * confidence), 0);
	const uncertainty = 1 + (1 - confidence) * (input.mode === "comfort" ? 0.5 : 0.3);
	const targetStored = Math.min(cap * input.maxSocPct / 100,
		cap * input.minSocPct / 100 + Math.max(input.nightKwh, totalDemand / etaD, highDemand / etaD) * uncertainty);
	const storedPvBeforePeak = slots.slice(0, peakIndex).reduce((n, s) => n + surplus(s) * etaC, 0);
	const gap = Math.max(0, targetStored - cap * input.socPct / 100 - storedPvBeforePeak);
	const chargeIndex = slots.indexOf(cheap);
	const holdUseful = highDemand > 0 && input.socPct > input.minSocPct && cheap.importCt! < peak.importCt!;
	const gridEnergyKwh = input.mode === "eco" && recovery < slots.length ? 0 : gap / etaC;
	let chargeEndIndex = chargeIndex;
	let windowCapacityKwh = 0;
	for (let i = chargeIndex; i < peakIndex && slots[i]?.gridAllowed && slots[i]?.importCt != null; i++) {
		if (slots[i]!.importCt! / (etaC * etaD) + input.wearCtPerKwh >= peak.importCt! - safetyMargin) break;
		windowCapacityKwh += Math.max(0, input.maxChargePowerW ?? 0) *
			(Date.parse(slots[i]!.endIso) - Date.parse(slots[i]!.startIso)) / 3_600_000_000;
		chargeEndIndex = i;
		if (windowCapacityKwh + 1e-6 >= gridEnergyKwh) break;
	}
	if (gridEnergyKwh > 0 && (input.maxChargePowerW == null || input.maxChargePowerW <= 0 ||
		windowCapacityKwh + 1e-6 < gridEnergyKwh))
		return unavailable("Das günstige Ladefenster reicht bei der technischen Ladeleistung nicht für das berechnete Ziel.");
	return {
		usable: true,
		targetSocPct: Math.round(targetStored / cap * 1000) / 10,
		gridEnergyKwh: Math.round(gridEnergyKwh * 1000) / 1000,
		chargeStartIso: cheap.startIso,
		chargeEndIso: slots[chargeEndIndex]!.endIso,
		peakStartIso: peak.startIso,
		holdStartIso: holdUseful ? slots[0]!.startIso : null,
		holdEndIso: holdUseful ? peak.startIso : null,
		reasonDe: `Bis zur Hochpreisphase werden ${gridEnergyKwh.toFixed(2)} kWh Netzladung für ${Math.round(targetStored / cap * 100)} % Ziel-SOC benötigt; sicherer PV-Überschuss vorher ${storedPvBeforePeak.toFixed(2)} kWh.`,
	};
}
