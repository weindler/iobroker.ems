import { MS_PER_DAY, MS_PER_HOUR, MIN_RATE_SAMPLES, MIN_VALID_NIGHTS } from "./constants";
import type { PowerHistoryMeta } from "./history";
import {
	buildBatteryDeficitSeries,
	buildPvHouseNetSeries,
	DEFAULT_NIGHT_BRIDGE_FLUTTER_MS,
	findMinSocPointInRange,
	findNearestSoc as findNearestSocBridge,
	findSocAtOrBefore,
	findPvHouseNightBridges,
	hasInterimRecharge,
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
 * Uhr-/Astro-Hülle nur bei echten Astro-Zeiten (Sonnenuntergang/-aufgang).
 * Feste 22–06 werden bewusst NICHT verwendet — Sommer-/Winterdifferenz wäre zu groß
 * und würde die dynamische PV-/Batterie-Brücke verfälschen.
 */
function clockEnvelopeForEvening(
	eveningDateKey: string,
	_nightStart: string,
	_nightEnd: string,
	astroDaily: DailyAstroTimes | null | undefined,
): { startTs: number; endTs: number } | null {
	if (!astroDaily?.startByDate.has(eveningDateKey)) return null;
	const startTime = astroDaily.startByDate.get(eveningDateKey)!;
	const parts = eveningDateKey.split("-").map((x) => parseInt(x, 10));
	if (parts.length !== 3 || parts.some((n) => !Number.isFinite(n))) return null;
	const [y, m, d] = parts as [number, number, number];
	const nextKey = localDateKey(new Date(y, m - 1, d + 1));
	const endTime = astroDaily.endByDate.get(nextKey) ?? astroDaily.startByDate.get(nextKey);
	if (!endTime) return null;
	const startTs = timestampAtLocalTime(eveningDateKey, startTime.hour, startTime.minute);
	const endTs = timestampAtLocalTime(nextKey, endTime.hour, endTime.minute);
	if (!(endTs > startTs)) return null;
	return { startTs, endTs };
}

/** Beobachtungsfenster = dynamische Brücke ∪ Astro-Hülle (nur wenn Astro konfiguriert). */
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
	/**
	 * PFLICHT-FIX 1 Korrektur: EMS-eigene Netzausgleichs-Entladeleistung (≥ 0 W,
	 * `addons.battery.grid_balance.effective_power_w`). Wird — falls für die jeweilige Nacht
	 * belastbar bestimmbar — vom SOC-basierten Nachtbedarf abgezogen, damit EMS seinen eigenen
	 * zusätzlichen Batterieeinsatz nicht als normalen Nachtgrundbedarf lernt. Leeres Array =
	 * keine Netzausgleichs-Historie verfügbar → Verhalten unverändert (keine Attribution nötig).
	 */
	gridBalancePowerPoints?: PowerPoint[] | null;
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
	/** Diagnose: Nächte mit tatsächlich abgezogener Netzausgleichs-Energie (PFLICHT-FIX 1). */
	gridBalanceAttributedNights: number;
	/** Diagnose: Nächte ausgeschlossen, weil Netzausgleichs-Anteil nicht belastbar bestimmbar war. */
	gridBalanceExcludedNights: number;
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

	const gridBalancePoints = params.gridBalancePowerPoints ?? [];

	function scoreWindows(windows: NightBridgeWindow[]): {
		avgPct: number | null;
		avgKwh: number | null;
		validNights: number;
		avgBridgeHours: number | null;
		gridBalanceAttributedNights: number;
		gridBalanceExcludedNights: number;
	} {
		type NightRecord = { pct: number; kwh: number | null; weight: number; bridgeHours: number };
		const nights: NightRecord[] = [];
		let gridBalanceAttributedNights = 0;
		let gridBalanceExcludedNights = 0;

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
			const minPoint = findMinSocPointInRange(params.socPoints, obs.startTs, obs.endTs);
			const socEnd =
				minPoint?.socPct ??
				findSocAtOrBefore(params.socPoints, obs.endTs, maxDelta) ??
				findNearestSoc(params.socPoints, obs.endTs, maxDelta);
			if (socStart === null || socEnd === null) continue;

			const dischargePct = socStart - socEnd;
			if (dischargePct <= 0 || dischargePct > 65) continue;

			/*
			 * Zwischenladung (z. B. Netzladung mitten in der Nacht) vor dem Tiefpunkt verfälscht
			 * den einfachen Start-Ende-SOC — diese Nacht ist keine „normale“ Nacht und fließt
			 * nicht in die Reserve-Basis ein.
			 */
			if (minPoint && hasInterimRecharge(params.socPoints, obs.startTs, minPoint.ts)) continue;

			let nightPct = dischargePct;
			let nightKwh = params.capacityKwh !== null ? (dischargePct / 100) * params.capacityKwh : null;

			/*
			 * PFLICHT-FIX 1 Korrektur: EMS-eigene Netzausgleichs-Entladung darf den realen
			 * SOC-Abfall nicht als normalen Nachtgrundbedarf lernen lassen. Nur abziehen, wenn
			 * für GENAU dieses Fenster eine belastbare Leistungsserie vorliegt (≥ 50 % Abdeckung,
			 * siehe `integratePowerKwh`) — sonst Sample ausschließen statt zu schätzen. Ohne
			 * jegliche Netzausgleichs-Historie (leeres Array) bleibt das Verhalten unverändert.
			 */
			if (gridBalancePoints.length > 0 && nightKwh !== null) {
				const gbKwh = integratePowerKwh(gridBalancePoints, obs.startTs, obs.endTs);
				if (gbKwh === null) {
					gridBalanceExcludedNights++;
					continue;
				}
				if (gbKwh > 0.01) {
					const netKwh = Math.max(0, nightKwh - gbKwh);
					nightPct =
						params.capacityKwh! > 0 ? Math.max(0, (netKwh / params.capacityKwh!) * 100) : nightPct;
					nightKwh = netKwh;
					gridBalanceAttributedNights++;
				}
			}

			const ageDays = Math.max(0, (nowMs - w.endTs) / MS_PER_DAY);
			nights.push({
				pct: round2(nightPct),
				kwh: nightKwh !== null ? round3(nightKwh) : null,
				weight: recencyWeight(ageDays),
				/** Brückendauer bleibt die dynamische Erkennung (Diagnose), nicht die Uhr-Hülle. */
				bridgeHours: (w.endTs - w.startTs) / MS_PER_HOUR,
			});
		}

		/** Sondernächte mit extremem Verbrauch (> 2.5× Median) dürfen den Lernwert nicht verzerren. */
		const trimmed = trimNightOutliers(nights);

		const kwhRecords = trimmed.filter((n) => n.kwh !== null);
		return {
			avgPct: weightedAverage(trimmed.map((n) => n.pct), trimmed.map((n) => n.weight)),
			avgKwh:
				params.capacityKwh !== null && kwhRecords.length === trimmed.length
					? weightedAverage(kwhRecords.map((n) => n.kwh!), kwhRecords.map((n) => n.weight))
					: null,
			validNights: trimmed.length,
			avgBridgeHours: average(trimmed.map((n) => n.bridgeHours)),
			gridBalanceAttributedNights,
			gridBalanceExcludedNights,
		};
	}

	function isDynamicMethod(m: NightBridgeWindow["method"]): boolean {
		return m === "pv_house" || m === "battery_discharge";
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
	 * Dynamische Brücken (PV/Haus, Batterie) haben absolute Priorität vor Astro/fixed_clock.
	 * Night-Count-Dominanz gilt nur innerhalb derselben Klasse — sonst überschreibt
	 * fixed_clock (jede SOC-Nacht 22–06) jede saisonale PV-Brücke.
	 */
	function prefer(
		a: ReturnType<typeof scoreWindows> & { method: NightBridgeWindow["method"] },
		b: ReturnType<typeof scoreWindows> & { method: NightBridgeWindow["method"] },
	): boolean {
		const aDyn = isDynamicMethod(a.method);
		const bDyn = isDynamicMethod(b.method);
		const aOk = a.validNights >= MIN_VALID_NIGHTS;
		const bOk = b.validNights >= MIN_VALID_NIGHTS;

		if (aDyn !== bDyn) {
			if (aDyn && aOk) return true;
			if (bDyn && bOk) return false;
			if (aDyn !== bDyn) return aDyn;
		}

		if (aOk && bOk) {
			if (aDyn && bDyn) {
				const aDominates =
					a.validNights >= b.validNights * 2 && a.validNights >= b.validNights + 3;
				const bDominates =
					b.validNights >= a.validNights * 2 && b.validNights >= a.validNights + 3;
				if (aDominates !== bDominates) return aDominates;
			}
			if (a.method !== b.method) return methodRank(a.method) < methodRank(b.method);
			return a.validNights >= b.validNights;
		}
		if (aOk !== bOk) return aOk;
		if (a.validNights !== b.validNights) return a.validNights > b.validNights;
		return methodRank(a.method) < methodRank(b.method);
	}

	function pickBest(
		list: Candidate[],
	): (ReturnType<typeof scoreWindows> & { method: NightBridgeWindow["method"] }) | null {
		let best: (ReturnType<typeof scoreWindows> & { method: NightBridgeWindow["method"] }) | null =
			null;
		for (const c of list) {
			const scored = { ...scoreWindows(c.windows), method: c.method };
			if (!best || prefer(scored, best)) best = scored;
		}
		return best;
	}

	/*
	 * Phase 1: nur dynamische Kandidaten. Feste Uhr / Astro erst, wenn keine dynamische
	 * Methode ≥ MIN_VALID_NIGHTS liefert — nie als Konkurrent um Nachtanzahl.
	 */
	let best = pickBest(candidates);
	if (!best || best.validNights < MIN_VALID_NIGHTS) {
		const clockWindows = clockAstroWindows(
			params.socPoints,
			params.nightStart,
			params.nightEnd,
			params.astroDaily,
		);
		if (clockWindows.length > 0) {
			const clockCandidate: Candidate = {
				method: clockWindows[0]!.method,
				windows: clockWindows,
			};
			const withClock = [...candidates, clockCandidate];
			const clockBest = pickBest(withClock);
			if (clockBest && (!best || prefer(clockBest, best))) {
				best = clockBest;
				if (!candidates.some((c) => c.method === clockCandidate.method)) {
					candidates.push(clockCandidate);
				}
			}
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
			gridBalanceAttributedNights: 0,
			gridBalanceExcludedNights: 0,
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
		gridBalanceAttributedNights: best.gridBalanceAttributedNights,
		gridBalanceExcludedNights: best.gridBalanceExcludedNights,
	};
}

/** Verwirft Nächte mit `pct` oberhalb von 2.5× Median (Sondernächte mit extremem Verbrauch). */
function trimNightOutliers<T extends { pct: number }>(nights: T[]): T[] {
	if (nights.length < 4) return nights;
	const sorted = [...nights].map((n) => n.pct).sort((a, b) => a - b);
	const mid = Math.floor(sorted.length / 2);
	const median = sorted.length % 2 === 0 ? (sorted[mid - 1]! + sorted[mid]!) / 2 : sorted[mid]!;
	if (!(median > 0)) return nights;
	const cap = median * 2.5;
	const kept = nights.filter((n) => n.pct <= cap);
	return kept.length > 0 ? kept : nights;
}

/**
 * Diagnose: Ø Hauslast über dieselben Brückenfenster wie die Nachtentladung — NICHT die
 * Reserve-Basis. Dient nur der Netzbezug-Schätzung (`predictedNightGridImportKwh`). Kein
 * eigener SOC-/Batterie-Pfad, keine Filterung außer „Wert vorhanden“ — die Reserve kommt
 * ausschließlich aus `computeNightDischarges`.
 */
export function computeNightHouseLoadDiagnostic(params: {
	windows: NightBridgeWindow[];
	housePowerPoints: PowerPoint[];
	nightStart?: string;
	nightEnd?: string;
	astroDaily?: DailyAstroTimes | null;
	nowMs?: number;
}): { avgKwh: number | null; validNights: number } {
	if (params.windows.length === 0 || params.housePowerPoints.length === 0) {
		return { avgKwh: null, validNights: 0 };
	}
	const nowMs = params.nowMs ?? Date.now();
	const nightStart = params.nightStart ?? "22:00";
	const nightEnd = params.nightEnd ?? "06:00";

	const values: number[] = [];
	const weights: number[] = [];
	for (const w of params.windows) {
		const obs = expandBridgeWithClockEnvelope(w, nightStart, nightEnd, params.astroDaily);
		const houseKwh = integratePowerKwh(params.housePowerPoints, obs.startTs, obs.endTs);
		if (houseKwh === null || !(houseKwh > 0)) continue;
		const ageDays = Math.max(0, (nowMs - w.endTs) / MS_PER_DAY);
		values.push(houseKwh);
		weights.push(recencyWeight(ageDays));
	}
	return { avgKwh: weightedAverage(values, weights), validNights: values.length };
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
	/** PFLICHT-FIX 1 Korrektur — siehe `computeNightDischarges`. */
	gridBalancePowerPoints?: PowerPoint[] | null;
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
		gridBalancePowerPoints: params.gridBalancePowerPoints,
		nowMs: params.now.getTime(),
	});
	const houseLoad = computeNightHouseLoadDiagnostic({
		windows: night.windows,
		housePowerPoints: params.housePowerPoints ?? [],
		nightStart: params.cfg.nightStart,
		nightEnd: params.cfg.nightEnd,
		astroDaily: params.astroDaily,
		nowMs: params.now.getTime(),
	});
	/*
	 * EINE führende Nachtenergie-Größe: `night.avgKwh` (SOC-Delta × Kapazität, Zwischenladung
	 * und Extrem-Ausreißer bereits ausgeschlossen in computeNightDischarges). Kein zweiter,
	 * konkurrierender Rechenweg mehr. `predictedNightConsumptionKwh` bleibt als State-/Feldname
	 * aus Planner-Kompatibilität bestehen (battery_reserve_target.ts, reserve.ts), ist aber
	 * identisch zu `avgNightDischargeKwh` — keine eigene Berechnung.
	 * avg_night_load_w wird daraus abgeleitet, damit Stunden × Last algebraisch zum Bedarf passt.
	 * houseLoad ist reine Netzbezug-Diagnose und beeinflusst die Reserve NICHT.
	 */
	const predictedNightConsumptionKwh = night.avgKwh;
	/*
	 * Netzbezug in der Nacht ≈ Hausverbrauch minus dem, was die Batterie davon deckte —
	 * Diagnose, keine dritte Messreihe, geht nicht in die Reserve ein.
	 */
	const predictedNightGridImportKwh =
		houseLoad.avgKwh !== null && night.avgKwh !== null
			? round3(Math.max(0, houseLoad.avgKwh - night.avgKwh))
			: null;
	const avgNightLoadW =
		predictedNightConsumptionKwh !== null &&
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
		nightConsumptionValidNights: houseLoad.validNights,
		predictedNightGridImportKwh,
		avgNightLoadW,
		requiredSocAtPvEndPct: reserve.requiredSocAtPvEndPct,
		requiredNightReserveKwh: reserve.requiredReserveKwh,
		nightReserveReasonDe: reserve.reasonDe,
		gridBalanceAttributedNights: night.gridBalanceAttributedNights,
		gridBalanceExcludedNights: night.gridBalanceExcludedNights,
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
	gridBalanceAttributedNights: 0,
	gridBalanceExcludedNights: 0,
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
