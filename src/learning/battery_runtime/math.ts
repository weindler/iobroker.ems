import { MS_PER_DAY, MS_PER_HOUR, MIN_RATE_SAMPLES, MIN_VALID_NIGHTS } from "./constants";
import type { PowerHistoryMeta } from "./history";
import {
	buildBatteryDeficitSeries,
	buildPvHouseNetSeries,
	DEFAULT_NIGHT_BRIDGE_FLUTTER_MS,
	findMinSocInRange,
	findNearestSoc as findNearestSocBridge,
	findSocAtOrBefore,
	findPvHouseNightBridges,
	integrateDischargeKwh,
	integratePowerKwh,
	recencyWeight,
	weightedAverage,
	type NightBridgeWindow,
} from "./night_bridge";
import { parseTimeHHMM, timestampAtLocalTime, localDateKey } from "./time";
import { resolveRequiredSocAtPvEndPct } from "./reserve";
import type {
	BatteryRuntimeComputeResult,
	BatteryRuntimeConfig,
	DailyAstroTimes,
	PowerPoint,
	SocPoint,
} from "./types";

function round2(n: number): number {
	return Math.round(n * 100) / 100;
}

function round3(n: number): number {
	return Math.round(n * 1000) / 1000;
}

function average(values: number[]): number | null {
	if (values.length === 0) return null;
	return round3(values.reduce((a, b) => a + b, 0) / values.length);
}

function findNearestSoc(points: SocPoint[], targetTs: number, maxDeltaMs: number): number | null {
	return findNearestSocBridge(points, targetTs, maxDeltaMs);
}

function clockAstroWindows(
	socPoints: SocPoint[],
	nightStart: string,
	nightEnd: string,
	astroDaily: DailyAstroTimes | null | undefined,
): NightBridgeWindow[] {
	const fixedStart = parseTimeHHMM(nightStart);
	const fixedEnd = parseTimeHHMM(nightEnd);
	if (!fixedStart || !fixedEnd || socPoints.length === 0) return [];

	const dateKeys = [...new Set(socPoints.map((p) => localDateKey(new Date(p.ts))))].sort();
	const out: NightBridgeWindow[] = [];
	for (let i = 0; i < dateKeys.length - 1; i++) {
		const dayKey = dateKeys[i]!;
		const nextKey = dateKeys[i + 1]!;
		const startTime = astroDaily?.startByDate.get(dayKey) ?? fixedStart;
		const endTime = astroDaily?.endByDate.get(nextKey) ?? fixedEnd;
		const startTs = timestampAtLocalTime(dayKey, startTime.hour, startTime.minute);
		const endTs = timestampAtLocalTime(nextKey, endTime.hour, endTime.minute);
		if (endTs <= startTs) continue;
		out.push({
			startTs,
			endTs,
			eveningDateKey: dayKey,
			method: astroDaily?.startByDate.has(dayKey) ? "astro" : "fixed_clock",
		});
	}
	return out;
}

/**
 * Uhr-/Astro-Hülle für denselben Abendtag — erweitert dynamische PV-/Batterie-Brücken
 * für Energie-/SOC-Messung, damit Abend vor Defizit-Erkennung und Morgen nach erstem
 * Surplus nicht systematisch abgeschnitten werden.
 */
function clockEnvelopeForEvening(
	eveningDateKey: string,
	nightStart: string,
	nightEnd: string,
	astroDaily: DailyAstroTimes | null | undefined,
): { startTs: number; endTs: number } | null {
	const fixedStart = parseTimeHHMM(nightStart);
	const fixedEnd = parseTimeHHMM(nightEnd);
	if (!fixedStart || !fixedEnd) return null;
	const parts = eveningDateKey.split("-").map((x) => parseInt(x, 10));
	if (parts.length !== 3 || parts.some((n) => !Number.isFinite(n))) return null;
	const [y, m, d] = parts as [number, number, number];
	const next = new Date(y, m - 1, d + 1);
	const nextKey = localDateKey(next);
	const startTime = astroDaily?.startByDate.get(eveningDateKey) ?? fixedStart;
	const endTime = astroDaily?.endByDate.get(nextKey) ?? fixedEnd;
	const startTs = timestampAtLocalTime(eveningDateKey, startTime.hour, startTime.minute);
	const endTs = timestampAtLocalTime(nextKey, endTime.hour, endTime.minute);
	if (!(endTs > startTs)) return null;
	return { startTs, endTs };
}

/** Beobachtungsfenster = dynamische Brücke ∪ Uhr-/Astro-Hülle (längere Nacht abbilden). */
export function expandBridgeWithClockEnvelope(
	bridge: NightBridgeWindow,
	nightStart: string,
	nightEnd: string,
	astroDaily?: DailyAstroTimes | null,
): { startTs: number; endTs: number } {
	const clock = clockEnvelopeForEvening(bridge.eveningDateKey, nightStart, nightEnd, astroDaily);
	if (!clock) return { startTs: bridge.startTs, endTs: bridge.endTs };
	const startTs = Math.min(bridge.startTs, clock.startTs);
	const endTs = Math.max(bridge.endTs, clock.endTs);
	if (!(endTs > startTs)) return { startTs: bridge.startTs, endTs: bridge.endTs };
	const durH = (endTs - startTs) / MS_PER_HOUR;
	if (durH < 4 || durH > 20) return { startTs: bridge.startTs, endTs: bridge.endTs };
	return { startTs, endTs };
}

/**
 * Nachtentladung über Brückenfenster (PV/Haus, Batterie, Astro oder feste Uhr).
 * Alle Kandidaten werden bewertet — dünnes pv_house (1 Nacht / 1 kWh) darf die
 * belastbare battery_discharge-Serie nicht überschreiben.
 */
export function computeNightDischarges(params: {
	socPoints: SocPoint[];
	nightStart: string;
	nightEnd: string;
	astroDaily?: DailyAstroTimes | null;
	capacityKwh: number | null;
	/** PV-AC-Leistung (W), optional. */
	pvPowerPoints?: PowerPoint[] | null;
	/** Hausverbrauch (W), optional. */
	housePowerPoints?: PowerPoint[] | null;
	/** Batterieleistung (+ laden / − entladen), Fallback-Brücke. */
	batteryPowerPoints?: PowerPoint[] | null;
	flutterMs?: number;
	nowMs?: number;
}): {
	avgPct: number | null;
	avgKwh: number | null;
	validNights: number;
	method: NightBridgeWindow["method"] | "none";
	avgBridgeHours: number | null;
	/** Gewinnende Fenster — Basis für Nachtverbrauchs-Integration (dieselbe Nacht-Abgrenzung). */
	windows: NightBridgeWindow[];
} {
	const maxDelta = 3 * MS_PER_HOUR;
	const flutterMs = params.flutterMs ?? DEFAULT_NIGHT_BRIDGE_FLUTTER_MS;
	const nowMs = params.nowMs ?? Date.now();

	type Candidate = {
		method: NightBridgeWindow["method"];
		windows: NightBridgeWindow[];
	};
	const candidates: Candidate[] = [];

	const pv = params.pvPowerPoints ?? [];
	const house = params.housePowerPoints ?? [];
	if (pv.length > 0 && house.length > 0) {
		const net = buildPvHouseNetSeries(pv, house);
		const medianGap = (() => {
			const ts = net.map((p) => p.ts).sort((a, b) => a - b);
			const gaps: number[] = [];
			for (let i = 1; i < Math.min(ts.length, 40); i++) gaps.push(ts[i]! - ts[i - 1]!);
			if (gaps.length === 0) return 0;
			gaps.sort((a, b) => a - b);
			return gaps[Math.floor(gaps.length / 2)]!;
		})();
		const pvFlutter =
			medianGap >= 40 * 60_000 ? MS_PER_HOUR : flutterMs;
		const windows = findPvHouseNightBridges(net, {
			flutterMs: pvFlutter,
			method: "pv_house",
			bucketMs: medianGap >= 40 * 60_000 ? MS_PER_HOUR : undefined,
		});
		if (windows.length > 0) {
			candidates.push({ method: "pv_house", windows });
		}
	}
	if ((params.batteryPowerPoints?.length ?? 0) > 0) {
		const net = buildBatteryDeficitSeries(params.batteryPowerPoints!);
		const windows = findPvHouseNightBridges(net, {
			flutterMs,
			method: "battery_discharge",
		});
		if (windows.length > 0) {
			candidates.push({ method: "battery_discharge", windows });
		}
	}
	{
		const windows = clockAstroWindows(
			params.socPoints,
			params.nightStart,
			params.nightEnd,
			params.astroDaily,
		);
		if (windows.length > 0) {
			candidates.push({ method: windows[0]!.method, windows });
		}
	}

	function scoreWindows(windows: NightBridgeWindow[]): {
		avgPct: number | null;
		avgKwh: number | null;
		validNights: number;
		avgBridgeHours: number | null;
	} {
		const pctDischarges: number[] = [];
		const kwhDischarges: number[] = [];
		const weights: number[] = [];
		const bridgeHours: number[] = [];

		for (const w of windows) {
			const obs = expandBridgeWithClockEnvelope(
				w,
				params.nightStart,
				params.nightEnd,
				params.astroDaily,
			);
			/** Abend: SOC bei/vor Beobachtungsstart; Morgen: Tiefstwert im erweiterten Fenster. */
			const socStart =
				findSocAtOrBefore(params.socPoints, obs.startTs, maxDelta) ??
				findNearestSoc(params.socPoints, obs.startTs, maxDelta);
			const socEnd =
				findMinSocInRange(params.socPoints, obs.startTs, obs.endTs) ??
				findSocAtOrBefore(params.socPoints, obs.endTs, maxDelta) ??
				findNearestSoc(params.socPoints, obs.endTs, maxDelta);
			if (socStart === null || socEnd === null) continue;

			const dischargePct = socStart - socEnd;
			if (dischargePct <= 0 || dischargePct > 65) continue;

			const ageDays = Math.max(0, (nowMs - w.endTs) / MS_PER_DAY);
			const weight = recencyWeight(ageDays);
			pctDischarges.push(round2(dischargePct));
			weights.push(weight);
			/** Brückendauer bleibt die dynamische Erkennung (Diagnose), nicht die Uhr-Hülle. */
			bridgeHours.push((w.endTs - w.startTs) / MS_PER_HOUR);
			if (params.capacityKwh !== null) {
				kwhDischarges.push(round3((dischargePct / 100) * params.capacityKwh));
			}
		}

		return {
			avgPct: weightedAverage(pctDischarges, weights),
			avgKwh:
				params.capacityKwh !== null && kwhDischarges.length === weights.length
					? weightedAverage(kwhDischarges, weights)
					: null,
			validNights: pctDischarges.length,
			avgBridgeHours: average(bridgeHours),
		};
	}

	function methodRank(m: NightBridgeWindow["method"]): number {
		switch (m) {
			case "pv_house":
				return 0;
			case "battery_discharge":
				return 1;
			case "astro":
				return 2;
			default:
				return 3;
		}
	}

	/**
	 * Belastbar bevorzugen: deutlich mehr gültige Nächte schlägt Methodenrang.
	 * Sonst Gleichstand → pv_house vor battery_discharge (Kommentar / Tests).
	 * Verhindert, dass dünnes pv_house (z. B. 4 Nächte bei spärlicher PV-Historie)
	 * eine dichte battery_discharge-/Astro-Serie überschreibt.
	 */
	function prefer(
		a: ReturnType<typeof scoreWindows> & { method: NightBridgeWindow["method"] },
		b: ReturnType<typeof scoreWindows> & { method: NightBridgeWindow["method"] },
	): boolean {
		const aOk = a.validNights >= MIN_VALID_NIGHTS;
		const bOk = b.validNights >= MIN_VALID_NIGHTS;
		if (aOk && bOk) {
			const aDominates =
				a.validNights >= b.validNights * 2 && a.validNights >= b.validNights + 3;
			const bDominates =
				b.validNights >= a.validNights * 2 && b.validNights >= a.validNights + 3;
			if (aDominates !== bDominates) return aDominates;
			if (a.method !== b.method) return methodRank(a.method) < methodRank(b.method);
			return a.validNights >= b.validNights;
		}
		if (aOk !== bOk) return aOk;
		if (a.validNights !== b.validNights) return a.validNights > b.validNights;
		return methodRank(a.method) < methodRank(b.method);
	}

	let best: (ReturnType<typeof scoreWindows> & { method: NightBridgeWindow["method"] }) | null =
		null;
	for (const c of candidates) {
		const scored = { ...scoreWindows(c.windows), method: c.method };
		if (!best || prefer(scored, best)) {
			best = scored;
		}
	}

	if (!best) {
		return {
			avgPct: null,
			avgKwh: null,
			validNights: 0,
			method: "none",
			avgBridgeHours: null,
			windows: [],
		};
	}

	const bestWindows = candidates.find((c) => c.method === best!.method)?.windows ?? [];
	return {
		avgPct: best.avgPct,
		avgKwh: best.avgKwh,
		validNights: best.validNights,
		method: best.method,
		avgBridgeHours: best.avgBridgeHours,
		windows: bestWindows,
	};
}

/**
 * Nachtenergie-Bedarf für die dynamische Reserve.
 *
 * Pro Brückenfenster (dieselbe Abgrenzung wie Entladung), Beobachtung erweitert um
 * Uhr-/Astro-Hülle:
 *   houseKwh           — Hauslast-Integration
 *   batteryDischargeKwh — integrierte Batterie-Entladeleistung
 *   socDeltaKwh        — SOC-Start − SOC-Tief × Kapazität
 *
 * Maßgeblich: max der verfügbaren Signale (keine systematische Unterschätzung durch
 * Haus-only). Sondernächte:
 * - SOC steigt (Netz-/PV-Ladung) → ausgeschlossen
 * - SOC-Abfall > 65 % → ausgeschlossen (Ausreißer)
 * - Hauslast >> Batterie-/SOC-Signale (EV/Heizstab aus Netz) → Batteriebedarf, nicht Haus
 * - nach Aggregation: Werte > 2.5× Median werden verworfen
 *
 * `houseAvgKwh` bleibt separat für avg_night_load_w / Grid-Import-Diagnose.
 */
export function computeNightConsumption(params: {
	windows: NightBridgeWindow[];
	housePowerPoints: PowerPoint[];
	batteryPowerPoints?: PowerPoint[] | null;
	socPoints?: SocPoint[] | null;
	capacityKwh?: number | null;
	nightStart?: string;
	nightEnd?: string;
	astroDaily?: DailyAstroTimes | null;
	nowMs?: number;
}): { avgKwh: number | null; houseAvgKwh: number | null; validNights: number } {
	if (params.windows.length === 0) {
		return { avgKwh: null, houseAvgKwh: null, validNights: 0 };
	}
	const nowMs = params.nowMs ?? Date.now();
	const maxDelta = 3 * MS_PER_HOUR;
	const housePoints = params.housePowerPoints ?? [];
	const batteryPoints = params.batteryPowerPoints ?? [];
	const socPoints = params.socPoints ?? [];
	const capacity = params.capacityKwh ?? null;
	const nightStart = params.nightStart ?? "22:00";
	const nightEnd = params.nightEnd ?? "06:00";

	const needValues: number[] = [];
	const houseValues: number[] = [];
	const needWeights: number[] = [];
	const houseWeights: number[] = [];

	for (const w of params.windows) {
		const obs = expandBridgeWithClockEnvelope(w, nightStart, nightEnd, params.astroDaily);
		const ageDays = Math.max(0, (nowMs - w.endTs) / MS_PER_DAY);
		const weight = recencyWeight(ageDays);

		const houseKwh =
			housePoints.length > 0 ? integratePowerKwh(housePoints, obs.startTs, obs.endTs) : null;
		const batKwh =
			batteryPoints.length > 0
				? integrateDischargeKwh(batteryPoints, obs.startTs, obs.endTs)
				: null;

		let socDeltaKwh: number | null = null;
		let dischargePct: number | null = null;
		if (socPoints.length > 0 && capacity !== null && capacity > 0) {
			const socStart =
				findSocAtOrBefore(socPoints, obs.startTs, maxDelta) ??
				findNearestSoc(socPoints, obs.startTs, maxDelta);
			const socEnd =
				findMinSocInRange(socPoints, obs.startTs, obs.endTs) ??
				findSocAtOrBefore(socPoints, obs.endTs, maxDelta) ??
				findNearestSoc(socPoints, obs.endTs, maxDelta);
			if (socStart !== null && socEnd !== null) {
				dischargePct = socStart - socEnd;
				if (dischargePct > 0 && dischargePct <= 65) {
					socDeltaKwh = round3((dischargePct / 100) * capacity);
				}
			}
		}

		if (houseKwh !== null && houseKwh > 0) {
			houseValues.push(houseKwh);
			houseWeights.push(weight);
		}

		/*
		 * Sondernacht: Batterie wurde geladen (SOC steigt) und keine nennenswerte Entladung —
		 * keine Reserve-Lernprobe (Netzladung / PV-Rest).
		 */
		const batteryDelivered =
			(socDeltaKwh !== null && socDeltaKwh > 0) || (batKwh !== null && batKwh > 0.05);
		if (dischargePct !== null && dischargePct <= 0 && !batteryDelivered) {
			continue;
		}
		if (dischargePct !== null && dischargePct > 65) {
			continue;
		}

		const batterySignals: number[] = [];
		if (socDeltaKwh !== null && socDeltaKwh > 0) batterySignals.push(socDeltaKwh);
		if (batKwh !== null && batKwh > 0) batterySignals.push(batKwh);
		const batteryNeed = batterySignals.length > 0 ? Math.max(...batterySignals) : null;

		let nightNeed: number | null = null;
		if (batteryNeed !== null && houseKwh !== null && houseKwh > 0) {
			/*
			 * EV/Heizstab/Klima aus dem Netz blähen die Hauslast auf, ohne Batteriereserve zu
			 * brauchen — dann Batteriebedarf, nicht Hauslast.
			 */
			if (houseKwh > batteryNeed * 1.75) {
				nightNeed = batteryNeed;
			} else {
				nightNeed = Math.max(batteryNeed, houseKwh);
			}
		} else if (batteryNeed !== null) {
			nightNeed = batteryNeed;
		} else if (houseKwh !== null && houseKwh > 0) {
			nightNeed = houseKwh;
		}

		if (nightNeed === null || !(nightNeed > 0)) continue;
		needValues.push(round3(nightNeed));
		needWeights.push(weight);
	}

	const filtered = trimNightNeedOutliers(needValues, needWeights);
	return {
		avgKwh: weightedAverage(filtered.values, filtered.weights),
		houseAvgKwh: weightedAverage(houseValues, houseWeights),
		validNights: filtered.values.length,
	};
}

/** Verwirft Ausreißer oberhalb von 2.5× Median (Sondernächte mit extremem Verbrauch). */
function trimNightNeedOutliers(
	values: number[],
	weights: number[],
): { values: number[]; weights: number[] } {
	if (values.length < 4) return { values, weights };
	const sorted = [...values].sort((a, b) => a - b);
	const mid = Math.floor(sorted.length / 2);
	const median =
		sorted.length % 2 === 0 ? (sorted[mid - 1]! + sorted[mid]!) / 2 : sorted[mid]!;
	if (!(median > 0)) return { values, weights };
	const cap = median * 2.5;
	const outV: number[] = [];
	const outW: number[] = [];
	for (let i = 0; i < values.length; i++) {
		if (values[i]! <= cap) {
			outV.push(values[i]!);
			outW.push(weights[i]!);
		}
	}
	return outV.length > 0 ? { values: outV, weights: outW } : { values, weights };
}

export function computeSocRates(socPoints: SocPoint[]): {
	avgChargeRatePctH: number | null;
	avgDischargeRatePctH: number | null;
} {
	const chargeRates: number[] = [];
	const dischargeRates: number[] = [];

	for (let i = 1; i < socPoints.length; i++) {
		const prev = socPoints[i - 1];
		const cur = socPoints[i];
		const dtHours = (cur.ts - prev.ts) / MS_PER_HOUR;
		if (dtHours <= 0 || dtHours > 6) continue;

		const dSoc = cur.socPct - prev.socPct;
		if (dSoc > 0.05) {
			chargeRates.push(dSoc / dtHours);
		} else if (dSoc < -0.05) {
			dischargeRates.push(Math.abs(dSoc) / dtHours);
		}
	}

	return {
		avgChargeRatePctH: average(chargeRates),
		avgDischargeRatePctH: average(dischargeRates),
	};
}

export function computePowerStats(powerPoints: PowerPoint[]): {
	avgChargePowerW: number | null;
	avgDischargePowerW: number | null;
	maxChargePowerW: number | null;
	maxDischargePowerW: number | null;
} {
	const charge: number[] = [];
	const discharge: number[] = [];

	for (const p of powerPoints) {
		if (p.powerW > 0) charge.push(p.powerW);
		else if (p.powerW < 0) discharge.push(Math.abs(p.powerW));
	}

	return {
		avgChargePowerW: average(charge),
		avgDischargePowerW: average(discharge),
		maxChargePowerW: charge.length ? Math.max(...charge) : null,
		maxDischargePowerW: discharge.length ? Math.max(...discharge) : null,
	};
}

/** Zeitpunkt der letzten Vollladung aus Geräte-Counter (Sekunden seit Voll). */
export function fullChargeFromSecondsSince(seconds: number, now: Date): string {
	return new Date(now.getTime() - seconds * 1000).toISOString();
}

export function resolveLastFullCharge(params: {
	secondsSinceFull: number | null;
	socPointsForFullCharge: SocPoint[];
	fullChargeSoc: number;
	currentSocPct: number | null;
	now: Date;
}): { lastFullCharge: string | null; fullChargeSource: "device" | "soc_history" | null } {
	if (params.secondsSinceFull !== null) {
		return {
			lastFullCharge: fullChargeFromSecondsSince(params.secondsSinceFull, params.now),
			fullChargeSource: "device",
		};
	}
	const live =
		params.currentSocPct !== null
			? { socPct: params.currentSocPct, ts: params.now.getTime() }
			: null;
	return {
		lastFullCharge: findLastFullCharge(
			params.socPointsForFullCharge,
			params.fullChargeSoc,
			live,
		),
		fullChargeSource: params.socPointsForFullCharge.length > 0 || live ? "soc_history" : null,
	};
}

export function findLastFullCharge(
	socPoints: SocPoint[],
	fullChargeSoc: number,
	live?: { socPct: number; ts: number } | null,
): string | null {
	let lastTs: number | null = null;
	for (const p of socPoints) {
		if (p.socPct >= fullChargeSoc) {
			lastTs = p.ts;
		}
	}
	if (live && live.socPct >= fullChargeSoc && (lastTs === null || live.ts >= lastTs)) {
		lastTs = live.ts;
	}
	return lastTs !== null ? new Date(lastTs).toISOString() : null;
}

/** Kalendertage (lokal) zwischen Vollladung und jetzt — „gestern voll“ = 1. */
export function calendarDaysSince(isoTs: string, now: Date): number | null {
	const lastMs = Date.parse(isoTs);
	if (!Number.isFinite(lastMs)) {
		return null;
	}
	const lastDay = new Date(lastMs);
	lastDay.setHours(0, 0, 0, 0);
	const nowDay = new Date(now);
	nowDay.setHours(0, 0, 0, 0);
	return Math.round((nowDay.getTime() - lastDay.getTime()) / MS_PER_DAY);
}

export function computeTopoffStatus(params: {
	lastFullCharge: string | null;
	topoffIntervalDays: number;
	now: Date;
}): {
	daysSinceFull: number | null;
	topoffDaysRemaining: number | null;
	topoffDue: boolean | null;
} {
	if (!params.lastFullCharge) {
		return { daysSinceFull: null, topoffDaysRemaining: null, topoffDue: null };
	}
	const daysSinceFull = calendarDaysSince(params.lastFullCharge, params.now);
	if (daysSinceFull === null) {
		return { daysSinceFull: null, topoffDaysRemaining: null, topoffDue: null };
	}
	const topoffDaysRemaining = Math.max(0, params.topoffIntervalDays - daysSinceFull);
	return {
		daysSinceFull,
		topoffDaysRemaining,
		topoffDue: daysSinceFull >= params.topoffIntervalDays,
	};
}

export function estimateRuntimeDays(
	currentSocPct: number | null,
	avgNightDischargePct: number | null,
): number | null {
	if (
		currentSocPct === null ||
		avgNightDischargePct === null ||
		avgNightDischargePct <= 0 ||
		currentSocPct <= 0
	) {
		return null;
	}
	return round2(currentSocPct / avgNightDischargePct);
}

export function computeBatteryRuntimeLearning(params: {
	socPoints: SocPoint[];
	/** Roh-SOC ohne Stunden-Dedup — Vollladungs-Peaks (optional, sonst socPoints). */
	socPointsForFullCharge?: SocPoint[];
	/** Sekunden seit Vollladung vom Gerät (Sonnen) — hat Vorrang vor SOC-History. */
	secondsSinceFull: number | null;
	powerPoints: PowerPoint[];
	pvPowerPoints?: PowerPoint[] | null;
	housePowerPoints?: PowerPoint[] | null;
	capacityKwh: number | null;
	currentSocPct: number | null;
	cfg: BatteryRuntimeConfig;
	sourceSocStateId: string;
	sourcePowerStateId: string;
	now: Date;
	sampleDays: number;
	astroDaily?: DailyAstroTimes | null;
}): BatteryRuntimeComputeResult {
	const night = computeNightDischarges({
		socPoints: params.socPoints,
		nightStart: params.cfg.nightStart,
		nightEnd: params.cfg.nightEnd,
		astroDaily: params.astroDaily,
		capacityKwh: params.capacityKwh,
		pvPowerPoints: params.pvPowerPoints,
		housePowerPoints: params.housePowerPoints,
		batteryPowerPoints: params.powerPoints,
		nowMs: params.now.getTime(),
	});
	const nightConsumption = computeNightConsumption({
		windows: night.windows,
		housePowerPoints: params.housePowerPoints ?? [],
		batteryPowerPoints: params.powerPoints,
		socPoints: params.socPoints,
		capacityKwh: params.capacityKwh,
		nightStart: params.cfg.nightStart,
		nightEnd: params.cfg.nightEnd,
		astroDaily: params.astroDaily,
		nowMs: params.now.getTime(),
	});
	/*
	 * predictedNightConsumptionKwh = einheitlicher Nachtenergie-Bedarf (max aus Haus /
	 * Batterie-Entladung / SOC-Delta) — führende Learning-Basis für die Planner-Reserve.
	 * houseAvgKwh bleibt Diagnose für Last/W und Netzbezug-Schätzung.
	 */
	const predictedNightConsumptionKwh = nightConsumption.avgKwh;
	const houseAvgKwh = nightConsumption.houseAvgKwh;
	/*
	 * Netzbezug in der Nacht ≈ Hausverbrauch minus dem, was die Batterie davon deckte —
	 * Diagnose, keine dritte Messreihe.
	 */
	const predictedNightGridImportKwh =
		houseAvgKwh !== null && night.avgKwh !== null
			? round3(Math.max(0, houseAvgKwh - night.avgKwh))
			: null;
	const avgNightLoadW =
		houseAvgKwh !== null && night.avgBridgeHours !== null && night.avgBridgeHours > 0
			? round2((houseAvgKwh / night.avgBridgeHours) * 1000)
			: predictedNightConsumptionKwh !== null &&
				  night.avgBridgeHours !== null &&
				  night.avgBridgeHours > 0
				? round2((predictedNightConsumptionKwh / night.avgBridgeHours) * 1000)
				: null;
	const reserve = resolveRequiredSocAtPvEndPct({
		predictedNightConsumptionKwh,
		usableCapacityKwh: params.capacityKwh,
	});
	const rates = computeSocRates(params.socPoints);
	const powerStats =
		params.powerPoints.length > 0
			? computePowerStats(params.powerPoints)
			: {
					avgChargePowerW: null,
					avgDischargePowerW: null,
					maxChargePowerW: null,
					maxDischargePowerW: null,
				};

	const fullChargePoints = params.socPointsForFullCharge ?? params.socPoints;
	const { lastFullCharge, fullChargeSource } = resolveLastFullCharge({
		secondsSinceFull: params.secondsSinceFull,
		socPointsForFullCharge: fullChargePoints,
		fullChargeSoc: params.cfg.fullChargeSoc,
		currentSocPct: params.currentSocPct,
		now: params.now,
	});
	const topoff = computeTopoffStatus({
		lastFullCharge,
		topoffIntervalDays: params.cfg.topoffIntervalDays,
		now: params.now,
	});

	const estimatedRuntimeDays = estimateRuntimeDays(
		params.currentSocPct,
		night.avgPct,
	);

	let status: BatteryRuntimeComputeResult["status"] = "ready";
	if (night.validNights < MIN_VALID_NIGHTS && rates.avgChargeRatePctH === null) {
		status = "insufficient_data";
	} else if (night.validNights < MIN_VALID_NIGHTS) {
		status = "partial";
	}

	const hasRates =
		(rates.avgChargeRatePctH !== null || rates.avgDischargeRatePctH !== null) &&
		params.socPoints.length >= MIN_RATE_SAMPLES;

	if (status === "ready" && !hasRates && night.validNights < MIN_VALID_NIGHTS) {
		status = "insufficient_data";
	}

	return {
		status,
		sampleDays: params.sampleDays,
		avgNightDischargePct: night.avgPct,
		avgNightDischargeKwh: night.avgKwh,
		avgChargeRatePctH: rates.avgChargeRatePctH,
		avgDischargeRatePctH: rates.avgDischargeRatePctH,
		avgChargePowerW: powerStats.avgChargePowerW,
		avgDischargePowerW: powerStats.avgDischargePowerW,
		maxChargePowerW: powerStats.maxChargePowerW,
		maxDischargePowerW: powerStats.maxDischargePowerW,
		lastFullCharge,
		daysSinceFull: topoff.daysSinceFull,
		secondsSinceFullCharge: params.secondsSinceFull,
		fullChargeSource,
		topoffIntervalDays: params.cfg.topoffIntervalDays,
		topoffDaysRemaining: topoff.topoffDaysRemaining,
		topoffDue: topoff.topoffDue,
		estimatedRuntimeDays,
		currentSocPct: params.currentSocPct,
		capacityKwh: params.capacityKwh,
		sourceSocStateId: params.sourceSocStateId,
		sourcePowerStateId: params.sourcePowerStateId,
		lastError: "",
		powerHistoryRawRows: null,
		powerHistoryNormalizedRows: null,
		powerRawChargeSamples: null,
		powerRawDischargeSamples: null,
		powerHourlyChargePoints: null,
		powerHourlyDischargePoints: null,
		powerInvertApplied: null,
		powerInvertAuto: null,
		powerHistoryMode: "",
		nightBridgeMethod: night.method,
		avgNightBridgeHours: night.avgBridgeHours,
		nightBridgeValidNights: night.validNights,
		predictedNightConsumptionKwh,
		nightConsumptionValidNights: nightConsumption.validNights,
		predictedNightGridImportKwh,
		avgNightLoadW,
		requiredSocAtPvEndPct: reserve.requiredSocAtPvEndPct,
		requiredNightReserveKwh: reserve.requiredReserveKwh,
		nightReserveReasonDe: reserve.reasonDe,
	};
}

const EMPTY_POWER_DIAGNOSTICS = {
	powerHistoryRawRows: null,
	powerHistoryNormalizedRows: null,
	powerRawChargeSamples: null,
	powerRawDischargeSamples: null,
	powerHourlyChargePoints: null,
	powerHourlyDischargePoints: null,
	powerInvertApplied: null,
	powerInvertAuto: null,
	powerHistoryMode: "",
	nightBridgeMethod: "none",
	avgNightBridgeHours: null,
	nightBridgeValidNights: 0,
} as const;

export function withPowerDiagnostics(
	result: BatteryRuntimeComputeResult,
	meta: PowerHistoryMeta | null,
): BatteryRuntimeComputeResult {
	if (!meta) return result;
	return {
		...result,
		powerHistoryRawRows: meta.rawRows,
		powerHistoryNormalizedRows: meta.normalizedRows,
		powerRawChargeSamples: meta.rawChargeSamples,
		powerRawDischargeSamples: meta.rawDischargeSamples,
		powerHourlyChargePoints: meta.hourlyChargePoints,
		powerHourlyDischargePoints: meta.hourlyDischargePoints,
		powerInvertApplied: meta.powerInvert,
		powerInvertAuto: meta.powerInvertAuto,
		powerHistoryMode: meta.powerHistoryMode,
	};
}

export function noSourceResult(cfg: BatteryRuntimeConfig): BatteryRuntimeComputeResult {
	return {
		status: "no_source",
		sampleDays: 0,
		avgNightDischargePct: null,
		avgNightDischargeKwh: null,
		predictedNightConsumptionKwh: null,
		nightConsumptionValidNights: 0,
		predictedNightGridImportKwh: null,
		avgNightLoadW: null,
		requiredSocAtPvEndPct: null,
		requiredNightReserveKwh: null,
		nightReserveReasonDe: "Keine Datenquelle — Reserve nicht berechenbar.",
		avgChargeRatePctH: null,
		avgDischargeRatePctH: null,
		avgChargePowerW: null,
		avgDischargePowerW: null,
		maxChargePowerW: null,
		maxDischargePowerW: null,
		lastFullCharge: null,
		daysSinceFull: null,
		secondsSinceFullCharge: null,
		fullChargeSource: null,
		topoffIntervalDays: cfg.topoffIntervalDays,
		topoffDaysRemaining: null,
		topoffDue: null,
		estimatedRuntimeDays: null,
		currentSocPct: null,
		capacityKwh: null,
		sourceSocStateId: "",
		sourcePowerStateId: "",
		lastError:
			"Keine SOC-Quelle — Admin-State oder addons.battery.mapping.soc_pct konfigurieren.",
		...EMPTY_POWER_DIAGNOSTICS,
	};
}

export function disabledResult(cfg: BatteryRuntimeConfig): BatteryRuntimeComputeResult {
	return {
		...noSourceResult(cfg),
		status: "disabled",
		lastError: "Battery Runtime Learning in Admin deaktiviert.",
	};
}

export function errorResult(
	message: string,
	cfg: BatteryRuntimeConfig,
	sources: { soc: string; power: string },
): BatteryRuntimeComputeResult {
	return {
		...noSourceResult(cfg),
		status: "error",
		sourceSocStateId: sources.soc,
		sourcePowerStateId: sources.power,
		lastError: message,
	};
}
