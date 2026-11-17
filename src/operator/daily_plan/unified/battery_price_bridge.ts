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
	/** Einspeisevergütung ct/kWh (optional, Standard 8). */
	exportCt?: number | null;
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

/** Mindestvorteil in ct über das ganze Planungsfenster, damit sich Netzladung oder Halten lohnt. */
const MIN_BENEFIT_CT = 3;
/** Weniger Netzladung lohnt keine Ladesequenz. */
const MIN_GRID_CHARGE_KWH = 0.2;
const DEFAULT_EXPORT_CT = 8;

export function planBatteryPriceBridge(input: PriceBridgeInput): PriceBridgeDecision {
	if (input.mode === "off") return unavailable("Batterieoptimierung ausgeschaltet.");
	if (input.priceSource !== "dynamic_tariff") return unavailable("Keine veröffentlichten Tibber-Preise für eine verbindliche Netzladung.");
	const { capacityKwh: cap, chargeEfficiency: etaC, dischargeEfficiency: etaD } = input;
	if (cap == null || cap <= 0 || input.socPct == null || input.minSocPct == null || input.maxSocPct == null ||
		etaC == null || etaC <= 0 || etaC > 1 || etaD == null || etaD <= 0 || etaD > 1 ||
		input.wearCtPerKwh == null || input.wearCtPerKwh < 0 || input.nightKwh == null ||
		input.pvConfidencePct == null) {
		const missing: string[] = [];
		if (cap == null || cap <= 0) missing.push("Batteriegröße");
		if (input.socPct == null) missing.push("Ladestand");
		if (input.minSocPct == null || input.maxSocPct == null) missing.push("Ladegrenzen");
		if (etaC == null || etaC <= 0 || etaC > 1 || etaD == null || etaD <= 0 || etaD > 1) missing.push("Wirkungsgrad");
		if (input.wearCtPerKwh == null || input.wearCtPerKwh < 0) missing.push("Verschleißkosten");
		if (input.nightKwh == null) missing.push("gelernter Nachtverbrauch");
		if (input.pvConfidencePct == null) missing.push("Sicherheit der PV-Prognose");
		return unavailable(`Noch nicht berechenbar, es fehlt: ${missing.join(", ")}.`);
	}
	const slots = input.slots.filter(s => Date.parse(s.endIso) > input.nowMs);
	if (slots.length < 4) return unavailable("PV- oder Hausprognose im Planungsfenster unvollständig.");
	// Tibber veröffentlicht kürzer als der PV-Ausblick: unbekannte spätere Preise werden nie geschätzt.
	const pricedEnd = slots.findIndex(s => s.importCt == null || !Number.isFinite(s.importCt));
	const publishedEnd = pricedEnd < 0 ? slots.length : pricedEnd;
	if (publishedEnd < 4) return unavailable("Veröffentlichte Preise reichen nicht für eine Netzladeentscheidung.");
	const plan = slots.slice(0, publishedEnd);
	if (plan.some(s => s.pvKwh == null || s.houseKwh == null || !Number.isFinite(s.pvKwh) || !Number.isFinite(s.houseKwh)))
		return unavailable("PV- oder Hausprognose im Planungsfenster unvollständig.");

	const confidence = Math.max(0.2, Math.min(1, input.pvConfidencePct / 100));
	const eMin = cap * input.minSocPct / 100;
	const eMax = cap * input.maxSocPct / 100;
	if (!(eMax > eMin)) return unavailable("Ladegrenzen der Batterie ungültig.");
	// Raster ~0,02 kWh, damit auch kleine Viertelstunden-Defizite (um 0,1 kWh) abbildbar sind.
	const levels = Math.max(8, Math.min(900, Math.ceil((eMax - eMin) / 0.02)));
	const step = (eMax - eMin) / levels;
	const stepPct = step / cap * 100;
	const exportCt = input.exportCt ?? DEFAULT_EXPORT_CT;
	const wearCt = input.wearCtPerKwh;
	const cMaxKwh = Math.max(0, input.maxChargePowerW ?? 0) * 0.25 / 1000;
	const eps = 1e-9;
	const modeFactor = input.mode === "eco" ? 2 : input.mode === "comfort" ? 0.5 : 1;
	const rawMargin = Math.max(2, 0.05 * Math.min(...plan.map(s => s.importCt!)) / (etaC * etaD) + wearCt);
	const marginCt = rawMargin * modeFactor;
	const minPrice = Math.min(...plan.map(s => s.importCt!));
	const terminalCtPerKwhStored = minPrice * etaD;

	type Flow = { dS: number; input: number; out: number; gridPart: number };
	const nSlots = plan.length;
	const houseNet = plan.map(s => s.houseKwh! - s.pvKwh! * confidence);
	const committed = plan.map(s => Math.max(0, s.committedKwh));
	const demand = plan.map((_, i) => houseNet[i]! + committed[i]!);
	const pvFree = demand.map(d => Math.max(0, -d));
	const outMax = houseNet.map(h => Math.max(0, h));

	/** Kosten einer Viertelstunde bei Speicheränderung dS (kWh gespeichert); null = unzulässig. */
	const slotCost = (i: number, dS: number): { cost: number; flow: Flow } | null => {
		const s = plan[i]!;
		let inKwh = 0, out = 0;
		if (dS > eps) {
			inKwh = dS / etaC;
			if (inKwh > cMaxKwh + eps) return null;
		} else if (dS < -eps) {
			out = -dS * etaD;
			if (out > outMax[i]! + eps) return null;
		}
		const gridPart = Math.max(0, inKwh - pvFree[i]!);
		if (gridPart > eps && !s.gridAllowed) return null;
		const net = demand[i]! + inKwh - out;
		const cost = (net > 0 ? net * s.importCt! : net * exportCt) + wearCt * out + marginCt * gridPart;
		return { cost, flow: { dS, input: inKwh, out, gridPart } };
	};

	const startE = cap * input.socPct / 100;
	const k0 = Math.max(0, Math.min(levels, Math.round((startE - eMin) / step)));
	const INF = Number.POSITIVE_INFINITY;
	let cur = new Float64Array(levels + 1).fill(INF);
	cur[k0] = 0;
	const parent = new Int16Array(nSlots * (levels + 1)).fill(-1);
	for (let i = 0; i < nSlots; i++) {
		const next = new Float64Array(levels + 1).fill(INF);
		const maxUp = Math.floor(cMaxKwh * etaC / step + eps);
		const maxDown = Math.floor(outMax[i]! / etaD / step + eps);
		for (let k = 0; k <= levels; k++) {
			const base = cur[k]!;
			if (base === INF) continue;
			// aufsteigend: Entladen vor Halten vor Laden (bei Gleichstand gewinnt der kleinere Zielstand)
			for (let k2 = Math.max(0, k - maxDown); k2 <= Math.min(levels, k + maxUp); k2++) {
				const sc = slotCost(i, (k2 - k) * step);
				if (!sc) continue;
				const total = base + sc.cost;
				if (total < next[k2]! - 1e-9) { next[k2] = total; parent[i * (levels + 1) + k2] = k; }
			}
		}
		cur = next;
	}
	let bestK = -1, bestCost = INF;
	for (let k = 0; k <= levels; k++) {
		const total = cur[k]! - terminalCtPerKwhStored * k * step;
		if (cur[k]! < INF && total < bestCost - 1e-9) { bestCost = total; bestK = k; }
	}
	if (bestK < 0) return unavailable("Kein zulässiger Batterieplan im bekannten Preisfenster.");
	const path: number[] = new Array(nSlots + 1);
	path[nSlots] = bestK;
	for (let i = nSlots - 1; i >= 0; i--) path[i] = parent[i * (levels + 1) + path[i + 1]!]!;
	const flows: Flow[] = [];
	for (let i = 0; i < nSlots; i++) flows.push(slotCost(i, (path[i + 1]! - path[i]!) * step)!.flow);

	// Vergleich: reine Eigenverbrauchsregelung (PV-Überschuss laden, Defizit entladen, nie halten oder Netz laden).
	let kB = k0, baseCost = 0;
	for (let i = 0; i < nSlots; i++) {
		let k2 = kB;
		if (pvFree[i]! > eps) {
			const up = Math.floor(Math.min(pvFree[i]! * etaC, cMaxKwh * etaC) / step + eps);
			k2 = Math.min(levels, kB + up);
		} else if (outMax[i]! > eps) {
			const down = Math.floor(outMax[i]! / etaD / step + eps);
			k2 = Math.max(0, kB - down);
		}
		baseCost += slotCost(i, (k2 - kB) * step)?.cost ?? 0;
		kB = k2;
	}
	baseCost -= terminalCtPerKwhStored * kB * step;
	const benefitCt = baseCost - bestCost;

	let first = -1, last = -1, gridKwh = 0;
	for (let i = 0; i < nSlots; i++) {
		const g = flows[i]!.gridPart;
		if (g > 0.01 && (first < 0 || i === last + 1)) {
			if (first < 0) first = i;
			last = i;
			gridKwh += g;
		} else if (first >= 0) break;
	}
	const holdSlot = (i: number): boolean => Math.abs(flows[i]!.dS) <= eps && houseNet[i]! > eps && path[i]! > 0;
	let holdFrom = -1, holdTo = -1;
	for (let i = first >= 0 ? last + 1 : 0; i < nSlots; i++) {
		if (holdSlot(i)) { if (holdFrom < 0) holdFrom = i; holdTo = i; }
		else if (holdFrom >= 0) break;
	}
	const hasCharge = first >= 0 && gridKwh >= MIN_GRID_CHARGE_KWH;
	const hasHold = holdFrom >= 0;
	if ((!hasCharge && !hasHold) || benefitCt < MIN_BENEFIT_CT)
		return unavailable("Preisvorteil nach Verlusten und Verschleiß nicht ausreichend.");
	let useFrom = -1;
	for (let i = (hasCharge ? last + 1 : 0); i < nSlots; i++) if (flows[i]!.out > eps) { useFrom = i; break; }
	const endIndex = hasCharge ? last : holdFrom;
	const targetStored = eMin + path[endIndex + 1]! * step;
	return {
		usable: true,
		targetSocPct: hasCharge ? Math.round(targetStored / cap * 1000) / 10 : null,
		gridEnergyKwh: hasCharge ? Math.round(gridKwh * 1000) / 1000 : 0,
		chargeStartIso: hasCharge ? plan[first]!.startIso : null,
		chargeEndIso: hasCharge ? plan[last]!.endIso : null,
		peakStartIso: useFrom >= 0 ? plan[useFrom]!.startIso : (hasHold ? plan[holdTo]!.endIso : plan[nSlots - 1]!.endIso),
		holdStartIso: hasHold ? plan[holdFrom]!.startIso : null,
		holdEndIso: hasHold ? plan[holdTo]!.endIso : null,
		reasonDe: `Optimierung über ${nSlots} bekannte Viertelstunden (Verluste ${Math.round((1 - etaC * etaD) * 100)} %, Verschleiß ${wearCt} ct/kWh, Sicherheitsmarge ${marginCt.toFixed(1)} ct/kWh): ${hasCharge ? `${gridKwh.toFixed(2)} kWh Netzladung bis ${Math.round(targetStored / cap * 100)} % Ziel-SOC` : "keine Netzladung"}${hasHold ? ", Entladung vor der teuren Phase aussetzen" : ""}; Vorteil gegenüber Eigenverbrauch rund ${Math.round(benefitCt)} ct.`,
	};
}
