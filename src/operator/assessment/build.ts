/**
 * Deterministische operative EMS-Einschätzung.
 * Liest nur vorhandenen Plan, Contributions und Live-Zustände.
 * Entscheidet nicht parallel zum Planner.
 */

import type { PlanContribution } from "../types";
import type { UnifiedDayPlan, UnifiedDayPlannerInput, UnifiedFlexConsumerKind } from "../daily_plan/unified/types";
import type { AddonStrategicPlanSnapshot } from "../../beta/strategic_status";
import { localDateKeyInTimezone } from "../time";
import type {
	AssessmentClimateUnit,
	AssessmentTopic,
	AssessmentTopicStatus,
	OperationalAssessment,
} from "./types";

const ON_W = 50;
const NEAR_TARGET_SOC_PP = 3;
const MIN_EV_NEED_KWH = 0.2;
const CHEAPER_PRICE_DELTA_CT = 3;
const MIN_PRICED_SLOTS_FOR_DAY = 8;
const GOOD_PV_DAY_KWH = 15;

export type AssessmentLiveGb = {
	enabled: boolean | null;
	active: boolean | null;
	ready: boolean | null;
	priceAllowed: boolean | null;
	blockReason: string | null;
	requestedPowerW: number | null;
	minPriceCt: number | null;
	currentPriceCt: number | null;
};

export type AssessmentLiveImmersion = {
	boilerTempC: number | null;
	bufferTempC: number | null;
	targetTempC: number | null;
	maxTempC: number | null;
	boilerMinC: number | null;
	hygieneDue: boolean;
	forced: boolean;
	autoTargetReached: boolean;
	requiredFlexKwh: number | null;
	mode: string | null;
};

export type AssessmentBuildInput = {
	now: Date;
	timezone: string;
	plan: UnifiedDayPlan | null;
	plannerInput: UnifiedDayPlannerInput | null;
	contributions: PlanContribution[];
	strategy: AddonStrategicPlanSnapshot | null;
	pvTodayKwh: number | null;
	pvTomorrowKwh: number | null;
	weatherTodayMinC: number | null;
	weatherTodayMaxC: number | null;
	weatherTomorrowMinC: number | null;
	weatherTomorrowMaxC: number | null;
	surplusW: number | null;
	priceNowCt: number | null;
	gb: AssessmentLiveGb;
	immersion: AssessmentLiveImmersion;
};

function roundPct(n: number): number {
	return Math.round(n);
}

function fmtKwh(n: number): string {
	const v = Math.round(n * 10) / 10;
	return String(v).replace(".", ",");
}

function fmtCt(n: number): string {
	return n.toFixed(1).replace(".", ",");
}

function fmtClock(iso: string, timezone: string): string | null {
	const ms = Date.parse(iso);
	if (!Number.isFinite(ms)) return null;
	try {
		return new Intl.DateTimeFormat("de-DE", {
			timeZone: timezone || "Europe/Berlin",
			hour: "2-digit",
			minute: "2-digit",
		}).format(new Date(ms));
	} catch {
		return iso.slice(11, 16);
	}
}

function contribDetail(c: PlanContribution, key: string): unknown {
	return c.details?.[key];
}

function numDetail(c: PlanContribution, key: string): number | null {
	const v = contribDetail(c, key);
	return typeof v === "number" && Number.isFinite(v) ? v : null;
}

function strDetail(c: PlanContribution, key: string): string | null {
	const v = contribDetail(c, key);
	return typeof v === "string" && v.trim() ? v.trim() : null;
}

function boolDetail(c: PlanContribution, key: string): boolean | null {
	const v = contribDetail(c, key);
	return typeof v === "boolean" ? v : null;
}

function dayKey(ms: number, timezone: string): string {
	return localDateKeyInTimezone(new Date(ms), timezone);
}

function matchesConsumer(consumerId: string | undefined, allocationId: string): boolean {
	if (!consumerId) return true;
	return allocationId === consumerId;
}

function allocActive(
	plan: UnifiedDayPlan | null,
	kinds: UnifiedFlexConsumerKind[],
	nowMs: number,
	opts: { current?: boolean; today?: boolean; later?: boolean; timezone?: string; consumerId?: string },
): boolean {
	if (!plan) return false;
	const tz = opts.timezone ?? "Europe/Berlin";
	const today = dayKey(nowMs, tz);
	for (const a of plan.allocations) {
		if (!kinds.includes(a.kind)) continue;
		if (!matchesConsumer(opts.consumerId, a.consumerId)) continue;
		if (!(a.allocatedPowerW >= ON_W || a.allocatedEnergyKwh > 0.02)) continue;
		const start = Date.parse(a.slot.startIso);
		const end = Date.parse(a.slot.endIso);
		if (!Number.isFinite(start) || !Number.isFinite(end)) continue;
		const current = nowMs >= start && nowMs < end;
		const future = start > nowMs;
		if (opts.current && current) return true;
		if (opts.today && (current || future) && dayKey(start, tz) === today) return true;
		if (opts.later && future && dayKey(start, tz) > today) return true;
	}
	return false;
}

function firstAllocWindow(
	plan: UnifiedDayPlan | null,
	kinds: UnifiedFlexConsumerKind[],
	nowMs: number,
	timezone: string,
	consumerId?: string,
): { startIso: string; endIso: string; today: boolean } | null {
	if (!plan) return null;
	const today = dayKey(nowMs, timezone);
	let best: { startIso: string; endIso: string; today: boolean; start: number } | null = null;
	for (const a of plan.allocations) {
		if (!kinds.includes(a.kind)) continue;
		if (!matchesConsumer(consumerId, a.consumerId)) continue;
		if (!(a.allocatedPowerW >= ON_W || a.allocatedEnergyKwh > 0.02)) continue;
		const start = Date.parse(a.slot.startIso);
		const end = Date.parse(a.slot.endIso);
		if (!Number.isFinite(start) || !Number.isFinite(end) || end <= nowMs) continue;
		if (!best || start < best.start) {
			best = {
				startIso: a.slot.startIso,
				endIso: a.slot.endIso,
				today: dayKey(start, timezone) === today,
				start,
			};
		}
	}
	return best ? { startIso: best.startIso, endIso: best.endIso, today: best.today } : null;
}

type DayPriceStats = {
	minCt: number;
	minStartIso: string;
	minEndIso: string;
	pricedSlots: number;
};

function dayPriceStats(
	input: UnifiedDayPlannerInput | null,
	day: string,
	timezone: string,
): DayPriceStats | null {
	if (!input?.prices?.slots?.length) return null;
	let minCt = Infinity;
	let minStart = "";
	let minEnd = "";
	let n = 0;
	for (const s of input.prices.slots) {
		const ct = s.importCtPerKwh;
		const start = Date.parse(s.slot.startIso);
		if (ct == null || !Number.isFinite(ct) || !Number.isFinite(start)) continue;
		if (dayKey(start, timezone) !== day) continue;
		n += 1;
		if (ct < minCt) {
			minCt = ct;
			minStart = s.slot.startIso;
			minEnd = s.slot.endIso;
		}
	}
	if (n < MIN_PRICED_SLOTS_FOR_DAY || !Number.isFinite(minCt)) return null;
	return { minCt, minStartIso: minStart, minEndIso: minEnd, pricedSlots: n };
}

function assessEv(input: AssessmentBuildInput): AssessmentTopic {
	const nowMs = input.now.getTime();
	const wb = input.plannerInput?.wallbox ?? null;
	const wbC = input.contributions.find(
		(c) => c.contributionId === "wallbox.ev_session" || c.contributionId.startsWith("wallbox."),
	);
	const soc = wb?.vehicleSocPct ?? (wbC ? numDetail(wbC, "vehicleSocPct") : null);
	const target = wb?.targetSocPct ?? (wbC ? numDetail(wbC, "targetSocPct") : null);
	const connected = wb?.connectedNow ?? (wbC ? boolDetail(wbC, "connectedNow") : null);
	const need = wb?.requiredEnergyKwh ?? (wbC ? numDetail(wbC, "requiredEnergyKwh") : null);
	const hard = (wb?.hardRequiredEnergyKwh ?? 0) > 0.05 || wb?.energyGoalHard === true;
	const evcc = wb?.evccChargeMode ?? (wbC ? strDetail(wbC, "evccChargeMode") : null);
	const todayAlloc = allocActive(input.plan, ["wallbox"], nowMs, { today: true, timezone: input.timezone });
	const laterAlloc = allocActive(input.plan, ["wallbox"], nowMs, { later: true, timezone: input.timezone });
	const currentAlloc = allocActive(input.plan, ["wallbox"], nowMs, { current: true });
	const window = firstAllocWindow(input.plan, ["wallbox"], nowMs, input.timezone);

	const nearTarget =
		soc != null &&
		target != null &&
		soc + NEAR_TARGET_SOC_PP >= target &&
		(need == null || need < MIN_EV_NEED_KWH);
	const noNeed = nearTarget || need == null || need < MIN_EV_NEED_KWH;
	const socBit =
		soc != null && target != null
			? `SOC ${roundPct(soc)} %, Ziel ${roundPct(target)} %.`
			: soc != null
				? `SOC ${roundPct(soc)} %.`
				: "";

	if (currentAlloc) {
		return {
			status: "active",
			text: hard
				? `Pflichtladung läuft. ${socBit}`.trim()
				: `Fahrzeug wird geladen. ${socBit}`.trim(),
			next: null,
		};
	}

	if (todayAlloc) {
		const clock = window ? fmtClock(window.startIso, input.timezone) : null;
		return {
			status: "planned",
			text: hard
				? `Heute Pflichtladung vorgesehen${clock ? ` ab ${clock}` : ""}. ${socBit}`.trim()
				: `Heute ist ein Ladefenster geplant${clock ? ` ab ${clock}` : ""}. ${socBit}`.trim(),
			next: clock ? `Nächstes Fenster ab ${clock}.` : null,
		};
	}

	const today = dayKey(nowMs, input.timezone);
	const tomorrowKey = addOneDayKey(today);
	const todayPrices = dayPriceStats(input.plannerInput, today, input.timezone);
	const tomorrowPrices = dayPriceStats(input.plannerInput, tomorrowKey, input.timezone);
	const pvTomorrow = input.pvTomorrowKwh;
	const goodPvTomorrow = pvTomorrow != null && pvTomorrow >= GOOD_PV_DAY_KWH;

	if (noNeed) {
		const plug = connected === false ? " Fahrzeug nicht angesteckt." : connected === true ? " Fahrzeug ist angesteckt." : "";
		let next: string | null = laterAlloc
			? "Ein späteres Ladefenster steht im Plan."
			: "Nächstes sinnvolles Ladefenster wird anhand PV und verfügbarer Preise neu bewertet.";
		if (!laterAlloc && goodPvTomorrow && evcc !== "off") {
			next = `Morgen voraussichtlich PV-Ladefenster (${fmtKwh(pvTomorrow!)} kWh erwartet).`;
		} else if (!laterAlloc && tomorrowPrices && todayPrices && tomorrowPrices.minCt <= todayPrices.minCt - CHEAPER_PRICE_DELTA_CT) {
			const a = fmtClock(tomorrowPrices.minStartIso, input.timezone);
			const b = fmtClock(tomorrowPrices.minEndIso, input.timezone);
			next = a && b ? `Günstigeres Netzfenster morgen ${a}–${b}.` : "Günstigeres Netzfenster morgen verfügbar.";
		} else if (!laterAlloc && tomorrowPrices == null) {
			next = "Heute kein Ladebedarf. Nächstes Ladefenster wird neu bewertet.";
		}
		return {
			status: "idle",
			text: `Heute kein Laden nötig. ${socBit}${plug}`.trim(),
			next,
		};
	}

	if (connected === false && !hard) {
		let next = "Laden startet, sobald das Fahrzeug angesteckt ist.";
		if (goodPvTomorrow) next = `Morgen bei PV-Überschuss sinnvoll (${fmtKwh(pvTomorrow!)} kWh erwartet), sobald das Auto da ist.`;
		else if (tomorrowPrices == null) next = "Nächstes sinnvolles Ladefenster wird anhand PV und verfügbarer Preise neu bewertet.";
		return {
			status: "wait",
			text: `Heute kein unmittelbarer Ladebedarf — Fahrzeug nicht angesteckt. ${socBit}`.trim(),
			next,
		};
	}

	if (laterAlloc && window) {
		const clock = fmtClock(window.startIso, input.timezone);
		return {
			status: "planned",
			text: `Heute kein Ladefenster. ${socBit}`.trim(),
			next: clock ? `Nächstes Fenster ${window.today ? "heute" : "später"} ab ${clock}.` : "Späteres Ladefenster im Plan.",
		};
	}

	if (goodPvTomorrow) {
		return {
			status: "wait",
			text: `Heute kein Laden im Plan. ${socBit}`.trim(),
			next: `Laden voraussichtlich morgen sinnvoll, weil ausreichend PV erwartet wird (${fmtKwh(pvTomorrow!)} kWh).`,
		};
	}

	if (tomorrowPrices && todayPrices && tomorrowPrices.minCt <= todayPrices.minCt - CHEAPER_PRICE_DELTA_CT) {
		const a = fmtClock(tomorrowPrices.minStartIso, input.timezone);
		const b = fmtClock(tomorrowPrices.minEndIso, input.timezone);
		return {
			status: "wait",
			text: `Netzladen heute nicht sinnvoll. ${socBit}`.trim(),
			next: a && b ? `Günstigeres Fenster morgen ${a}–${b}.` : "Günstigeres Fenster morgen verfügbar.",
		};
	}

	return {
		status: "wait",
		text: `Heute kein Laden im Plan. ${socBit}`.trim(),
		next: "Nächstes sinnvolles Ladefenster wird anhand PV und verfügbarer Preise neu bewertet.",
	};
}

function addOneDayKey(dateKey: string): string {
	const [y, m, d] = dateKey.split("-").map(Number);
	const dt = new Date(Date.UTC(y, m - 1, d + 1));
	const yy = dt.getUTCFullYear();
	const mm = String(dt.getUTCMonth() + 1).padStart(2, "0");
	const dd = String(dt.getUTCDate()).padStart(2, "0");
	return `${yy}-${mm}-${dd}`;
}

function assessImmersion(input: AssessmentBuildInput): AssessmentTopic {
	const nowMs = input.now.getTime();
	const live = input.immersion;
	const ihC = input.contributions.find((c) => c.contributionId.startsWith("immersion_heater."));
	const required = live.requiredFlexKwh ?? (ihC ? numDetail(ihC, "requiredEnergyKwh") : null);
	const hygiene = live.hygieneDue || (ihC ? boolDetail(ihC, "hygieneDue") === true : false);
	const forced = live.forced || live.mode === "force";
	const target =
		live.targetTempC ??
		(ihC ? numDetail(ihC, "targetTempC") : null) ??
		input.plannerInput?.thermal?.dayTargetTempC ??
		null;
	const buffer = live.bufferTempC ?? input.plannerInput?.thermal?.bufferTempC ?? null;
	const boiler = live.boilerTempC ?? input.plannerInput?.thermal?.boilerTempC ?? null;
	const boilerMin = live.boilerMinC ?? input.plannerInput?.thermal?.boilerMinTempC ?? input.plannerInput?.thermal?.minTempC ?? null;
	const maxT = live.maxTempC ?? input.plannerInput?.thermal?.maxTempC ?? null;
	const atTarget =
		live.autoTargetReached ||
		(buffer != null && target != null && buffer + 0.3 >= target) ||
		(buffer != null && maxT != null && buffer + 0.2 >= maxT);

	const current = allocActive(input.plan, ["immersion_heater"], nowMs, { current: true });
	const today = allocActive(input.plan, ["immersion_heater"], nowMs, { today: true, timezone: input.timezone });
	const later = allocActive(input.plan, ["immersion_heater"], nowMs, { later: true, timezone: input.timezone });
	const window = firstAllocWindow(input.plan, ["immersion_heater"], nowMs, input.timezone);

	if (live.mode === "off") {
		return { status: "off", text: "Heizstab ist ausgeschaltet.", next: null };
	}
	if (forced) {
		return {
			status: current ? "active" : "planned",
			text: "Heizstab im Zwangsbetrieb.",
			next: null,
		};
	}
	if (hygiene) {
		return {
			status: current ? "active" : today || later ? "planned" : "wait",
			text: "Hygiene steht an — Pflichtlauf.",
			next: window ? `Fenster ab ${fmtClock(window.startIso, input.timezone) ?? "Plan"}.` : "Sobald der Plan ein Fenster setzt.",
		};
	}
	if (current) {
		return {
			status: "active",
			text: "Heizstab läuft im geplanten Fenster.",
			next: null,
		};
	}
	if (boiler != null && boilerMin != null && boiler <= boilerMin + 1.5 && !atTarget) {
		return {
			status: today ? "planned" : "wait",
			text: `Boiler ${boiler.toFixed(0)} °C nähert sich der Untergrenze (${boilerMin.toFixed(0)} °C).`,
			next: today ? "Pflichtnahe Nachheizung im heutigen Plan." : "EMS bewertet den nächsten Lauf neu.",
		};
	}
	if (atTarget && !today) {
		return {
			status: "idle",
			text: "Zieltemperatur erreicht. Kein Heizbedarf – warten auf Abkühlung.",
			next: later ? "Späterer flexibler Bedarf steht im Plan." : "Nächster Lauf, sobald der Speicher abkühlt.",
		};
	}
	if (today && window) {
		const clock = fmtClock(window.startIso, input.timezone);
		return {
			status: "planned",
			text: atTarget
				? "Ziel praktisch erreicht; späterer flexibler Bedarf bleibt im Plan."
				: "Flexibler Heizbedarf — Lauf im PV-Fenster vorgesehen.",
			next: clock ? `Nächstes Fenster ab ${clock}.` : null,
		};
	}
	if (required != null && required > 0.15 && !atTarget) {
		return {
			status: "wait",
			text: "Flexibler Warmwasserbedarf, aktuell kein fahrbares Fenster.",
			next: "EMS wartet auf PV-Überschuss oder ein günstiges Fenster.",
		};
	}
	return {
		status: "idle",
		text: "Aktuell kein Heizbedarf.",
		next: null,
	};
}

function climateUnitsFrom(input: AssessmentBuildInput): AssessmentClimateUnit[] {
	const units: AssessmentClimateUnit[] = [];
	const contribs = input.contributions.filter((c) => c.contributionId.startsWith("air_conditioning.unit_"));
	const byIndex = new Map<number, PlanContribution>();
	for (const c of contribs) {
		const idx = numDetail(c, "unitIndex") ?? Number(/unit_(\d+)/.exec(c.contributionId)?.[1]);
		if (Number.isFinite(idx)) byIndex.set(idx, c);
	}
	const sorted = [...byIndex.entries()].sort((a, b) => a[0] - b[0]);
	for (const [idx, c] of sorted) {
		if (boolDetail(c, "unitEnabled") === false) continue;
		const name = strDetail(c, "unitName") ?? `Klima ${idx}`;
		const coolingH = numDetail(c, "coolingHours") ?? 0;
		const heatingH = numDetail(c, "heatingHours") ?? 0;
		const dryH = numDetail(c, "dehumidifyHours") ?? 0;
		const likely = boolDetail(c, "likelyActive") === true;
		const reason = strDetail(c, "reasonDe") ?? "";
		const humidity = numDetail(c, "roomHumidityPct");
		const maxH = numDetail(c, "maxHumidityPct");
		const heatSet = numDetail(c, "heatSetpointC");

		const consumerId = `air_conditioning.unit_${idx}`;
		const plannedToday = allocActive(input.plan, ["climate"], input.now.getTime(), {
			today: true,
			timezone: input.timezone,
			consumerId,
		});
		const plannedCurrent = allocActive(input.plan, ["climate"], input.now.getTime(), {
			current: true,
			consumerId,
		});
		const window = firstAllocWindow(input.plan, ["climate"], input.now.getTime(), input.timezone, consumerId);
		const coolingDemand = coolingH >= 0.25 && likely;
		const heatDemand = heatingH >= 0.25 && likely;
		const dryDemand = dryH >= 0.25 && likely;
		const preCool = /Pre-Cooling|nähert sich/i.test(reason);

		let cooling: string;
		if (plannedToday || plannedCurrent) {
			if (preCool) {
				cooling = "Raum nähert sich der Komfortgrenze — Pre-Cooling im PV-Fenster vorgesehen.";
			} else if (coolingDemand || (!heatDemand && !dryDemand)) {
				cooling = "Kühlung heute vorgesehen.";
			} else {
				cooling = "Heute voraussichtlich keine Kühlung erforderlich.";
			}
		} else if (coolingDemand) {
			cooling = "Heute kein Kühlfenster im Plan.";
		} else {
			cooling = "Heute voraussichtlich keine Kühlung erforderlich.";
		}

		let heating: string | null = null;
		if (heatSet != null || heatingH >= 0.25) {
			heating = heatDemand && plannedToday ? "Heizen vorgesehen." : "Kein Climate-Heizbedarf.";
		}

		let dehumidify: string;
		if (dryDemand && (plannedToday || plannedCurrent)) {
			dehumidify =
				humidity != null
					? `${humidity.toFixed(0)} % Feuchte — Entfeuchtung vorgesehen.`
					: "Entfeuchtung vorgesehen.";
		} else if (dryDemand) {
			dehumidify =
				humidity != null
					? `${humidity.toFixed(0)} % Feuchte — kein Entfeuchtungsfenster im Plan.`
					: "Kein Entfeuchtungsfenster im Plan.";
		} else {
			dehumidify = "Entfeuchtung aktuell nicht erforderlich.";
		}

		const next =
			plannedToday && window
				? preCool
					? "Kühlung später heute wahrscheinlich."
					: `Nächstes Klimafenster ab ${fmtClock(window.startIso, input.timezone) ?? "Plan"}.`
				: coolingDemand
					? "Nächstes Fenster wird neu bewertet."
					: null;

		units.push({ unitIndex: idx, name, cooling, heating, dehumidify, next });
	}
	return units;
}

function assessClimate(input: AssessmentBuildInput): OperationalAssessment["climate"] {
	const units = climateUnitsFrom(input);
	if (units.length === 0) {
		return { text: "Keine aktiven Klimageräte.", units: [] };
	}
	const anyCool = units.some((u) => !/keine Kühlung/.test(u.cooling));
	const anyDry = units.some((u) => /Entfeuchtung vorgesehen/.test(u.dehumidify));
	const text = anyCool || anyDry ? "Klima: Bedarf erkannt." : "Klima: heute voraussichtlich kein Bedarf.";
	return { text, units };
}

function assessBattery(input: AssessmentBuildInput): AssessmentTopic {
	const nowMs = input.now.getTime();
	const bat = input.plannerInput?.battery;
	const soc = bat?.socPct ?? null;
	const strat = input.strategy?.battery;
	const chargeNow = allocActive(input.plan, ["battery_charge"], nowMs, { current: true });
	const chargeToday = allocActive(input.plan, ["battery_charge"], nowMs, { today: true, timezone: input.timezone });
	const surplus = input.surplusW != null && input.surplusW >= 200;
	const full = soc != null && soc >= 99;

	if (chargeNow) {
		return {
			status: "active",
			text: soc != null ? `Batterie wird geladen (${roundPct(soc)} %).` : "Batterie wird geladen.",
			next: null,
		};
	}
	if (strat?.status === "hold") {
		return {
			status: "wait",
			text: soc != null ? `Batterie ${roundPct(soc)} % — Halt, keine Ladeaktion.` : "Batterie auf Halt.",
			next: null,
		};
	}
	if (strat?.status === "reserve_protected" || (full && !chargeToday)) {
		const reserve = full ? "Nachtreserve gesichert." : "Batterie wird heute für die Nacht geschont.";
		const feed = surplus || full ? " PV-Überschuss wird derzeit eingespeist." : "";
		return {
			status: "idle",
			text: `${soc != null ? `Batterie ${roundPct(soc)} %. ` : ""}${reserve}${feed}`.trim(),
			next: null,
		};
	}
	if (strat?.status === "available_for_discharge") {
		return {
			status: "idle",
			text: soc != null ? `Batterie ${roundPct(soc)} % — Entladung aktuell möglich.` : "Entladung aktuell möglich.",
			next: "Nur soweit Safety und Preis das erlauben.",
		};
	}
	if (chargeToday) {
		return {
			status: "planned",
			text: soc != null ? `Batterie ${roundPct(soc)} % — Ladung später heute geplant.` : "Batterieladung später heute geplant.",
			next: null,
		};
	}
	return {
		status: "idle",
		text: soc != null ? `Batterie ${roundPct(soc)} %.` : "Batterielage unbekannt.",
		next: strat?.summaryDe ?? null,
	};
}

function userGbBlock(reason: string | null, priceAllowed: boolean | null, minCt: number | null, nowCt: number | null): string {
	const r = (reason ?? "").toLowerCase();
	if (priceAllowed === false || r.includes("price") || r.includes("preis")) {
		const bit =
			nowCt != null && minCt != null
				? ` (${fmtCt(nowCt)} ct, Freigabe ab ${fmtCt(minCt)} ct)`
				: "";
		return `Aktuell gesperrt – Strompreis unter Freigabegrenze${bit}.`;
	}
	if (r.includes("soc") || r.includes("reserve")) return "Aktuell gesperrt – Reserve/SOC-Grenze.";
	if (r.includes("ev") || r.includes("wallbox") || r.includes("hold")) return "Aktuell gesperrt – Fahrzeugladung hat Vorrang.";
	if (r.includes("ready") || r.includes("mapping") || r.includes("stale")) return "Aktuell gesperrt – technische Freigabe fehlt.";
	if (reason && reason.trim() && !/[._]/.test(reason) && reason.length < 80) return `Aktuell gesperrt – ${reason.trim()}`;
	return "Netzausgleich aktuell nicht freigegeben.";
}

function assessGridBalance(input: AssessmentBuildInput): AssessmentTopic {
	const gb = input.gb;
	const requested = gb.requestedPowerW ?? 0;
	if (gb.enabled === false) {
		return { status: "off", text: "Netzausgleich ist ausgeschaltet.", next: null };
	}
	if (gb.active === true && requested > 10) {
		return { status: "active", text: "Netzausgleich aktiv.", next: null };
	}
	if (gb.priceAllowed === false) {
		return {
			status: "blocked",
			text: userGbBlock(gb.blockReason, false, gb.minPriceCt, gb.currentPriceCt ?? input.priceNowCt),
			next: null,
		};
	}
	if (gb.ready === false) {
		return {
			status: "blocked",
			text: userGbBlock(gb.blockReason, gb.priceAllowed, gb.minPriceCt, gb.currentPriceCt ?? input.priceNowCt),
			next: null,
		};
	}
	if (requested > 10) {
		return { status: "planned", text: "Netzausgleich angefordert, wartet auf Freigabe.", next: null };
	}
	return { status: "idle", text: "Netzausgleich bereit, aktuell kein Abruf.", next: null };
}

function assessForecast(input: AssessmentBuildInput): string {
	const bits: string[] = [];
	if (input.pvTodayKwh != null) bits.push(`Heute ${fmtKwh(input.pvTodayKwh)} kWh PV erwartet`);
	if (input.pvTomorrowKwh != null) bits.push(`morgen ${fmtKwh(input.pvTomorrowKwh)} kWh`);
	const tmin = input.weatherTomorrowMinC ?? input.weatherTodayMinC;
	const tmax = input.weatherTomorrowMaxC ?? input.weatherTodayMaxC;
	if (input.weatherTodayMinC != null && input.weatherTodayMaxC != null) {
		bits.push(`heute ${Math.round(input.weatherTodayMinC)}–${Math.round(input.weatherTodayMaxC)} °C`);
	} else if (tmin != null && tmax != null) {
		bits.push(`${Math.round(tmin)}–${Math.round(tmax)} °C`);
	}
	if (bits.length === 0) return "Forecast noch nicht vollständig.";
	return `${bits.join(", ")}.`;
}

function overallFrom(parts: {
	ev: AssessmentTopic;
	immersion: AssessmentTopic;
	climate: OperationalAssessment["climate"];
	battery: AssessmentTopic;
	gridBalance: AssessmentTopic;
}): OperationalAssessment["overall"] {
	const active = [parts.ev, parts.immersion, parts.battery, parts.gridBalance].some((p) => p.status === "active");
	const planned = [parts.ev, parts.immersion, parts.battery].some((p) => p.status === "planned");
	const bits = [parts.battery.text, parts.ev.text, parts.immersion.text, parts.climate.text].filter(Boolean);
	return {
		status: active ? "active" : planned ? "planned" : "idle",
		summary: bits.slice(0, 3).join(" "),
	};
}

/**
 * Baut die Einschätzung ausschließlich aus übergebenem Plan-/Live-Zustand.
 */
export function buildOperationalAssessment(input: AssessmentBuildInput): OperationalAssessment {
	const ev = assessEv(input);
	const immersion = assessImmersion(input);
	const climate = assessClimate(input);
	const battery = assessBattery(input);
	const gridBalance = assessGridBalance(input);
	const forecast = { text: assessForecast(input) };
	const overall = overallFrom({ ev, immersion, climate, battery, gridBalance });

	return {
		schemaVersion: 1,
		generatedAtIso: input.now.toISOString(),
		overall,
		ev,
		immersion,
		climate,
		battery,
		gridBalance,
		forecast,
	};
}

export function formatOperationalAssessmentDe(a: OperationalAssessment): string {
	const lines: string[] = ["EMS-Einschätzung"];
	lines.push(`Auto: ${a.ev.text}${a.ev.next ? ` ${a.ev.next}` : ""}`);
	lines.push(`Heizstab: ${a.immersion.text}${a.immersion.next ? ` ${a.immersion.next}` : ""}`);
	if (a.climate.units.length === 0) {
		lines.push(`Klima: ${a.climate.text}`);
	} else {
		for (const u of a.climate.units) {
			const heat = u.heating ? ` ${u.heating}` : "";
			lines.push(`Klima ${u.name}: ${u.cooling}${heat} ${u.dehumidify}`);
		}
	}
	lines.push(`Batterie: ${a.battery.text}`);
	lines.push(`Netzausgleich: ${a.gridBalance.text}`);
	return lines.join("\n");
}
