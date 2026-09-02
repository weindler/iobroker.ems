/**
 * Vergleichsfenster aus Day-Telemetry: primär GB-Episoden / Off-Windows,
 * ergänzend 15-Min-Slots (niedrigere Quelle, mehr Samples nötig).
 */

import type { DayTelemetryDayRecord, GridBalanceMatchWindow, GridBalanceRunSegment } from "../day_telemetry/types";
import { MIN_GB_ENERGY_KWH, MIN_STABLE_PHASE_SEC } from "./constants";
import type { MatchWindow } from "./alpha_beta";

function slotHours(day: DayTelemetryDayRecord): number {
	return day.slotWidthMs > 0 ? day.slotWidthMs / 3_600_000 : 0.25;
}

export function matchWindowsFromEpisode(seg: GridBalanceRunSegment): MatchWindow | null {
	if (!seg.usable) return null;
	if (!(seg.stableDurationSec >= MIN_STABLE_PHASE_SEC)) return null;
	if (!(seg.effectiveEnergyKwh >= MIN_GB_ENERGY_KWH)) return null;
	if (seg.stableImportKwh == null || seg.stableBatteryDischargeKwh == null) return null;
	return {
		startTs: seg.startTs,
		durationSec: seg.stableDurationSec,
		gbOn: true,
		eGbKwh: seg.effectiveEnergyKwh,
		importKwh: seg.stableImportKwh,
		batteryDischargeKwh: seg.stableBatteryDischargeKwh,
		houseMeanW: seg.stableHouseMeanW,
		pvMeanW: seg.stablePvMeanW,
		deficitMeanW: seg.stableDeficitMeanW,
		socMeanPct: seg.socStartPct,
		source: "episode",
	};
}

export function matchWindowsFromOffWindow(w: GridBalanceMatchWindow): MatchWindow | null {
	if (!w.usable) return null;
	if (!(w.durationSec >= MIN_STABLE_PHASE_SEC)) return null;
	if (w.importKwh == null || w.batteryDischargeKwh == null) return null;
	return {
		startTs: w.startTs,
		durationSec: w.durationSec,
		gbOn: false,
		eGbKwh: 0,
		importKwh: w.importKwh,
		batteryDischargeKwh: w.batteryDischargeKwh,
		houseMeanW: w.houseMeanW,
		pvMeanW: w.pvMeanW,
		deficitMeanW: w.deficitMeanW,
		socMeanPct: w.socMeanPct,
		source: "episode",
	};
}

export function matchWindowsFromSlots(day: DayTelemetryDayRecord): MatchWindow[] {
	const b = day.buckets;
	const hours = slotHours(day);
	const sec = hours * 3600;
	const out: MatchWindow[] = [];
	for (let i = 0; i < day.slotCount; i++) {
		const house = b.houseTotalKwh[i];
		const pv = b.pvKwh[i];
		const gi = b.gridImportKwh[i];
		const bd = b.batteryDischargedKwh[i];
		const gb = b.gridBalanceDischargeKwh[i];
		const soc = b.batterySocEndPct[i];
		if (house == null || gi == null || bd == null) continue;
		const houseW = house / hours;
		const pvW = pv != null ? pv / hours : null;
		const deficitW = pvW != null ? Math.max(0, houseW - pvW) : houseW;
		const eGb = gb != null && gb > 0 ? gb : 0;
		out.push({
			startTs: day.startMs + i * day.slotWidthMs,
			durationSec: sec,
			gbOn: eGb >= MIN_GB_ENERGY_KWH,
			eGbKwh: eGb,
			importKwh: gi,
			batteryDischargeKwh: bd,
			houseMeanW: houseW,
			pvMeanW: pvW,
			deficitMeanW: deficitW,
			socMeanPct: soc,
			source: "slot",
		});
	}
	return out;
}

export function collectMatchWindows(day: DayTelemetryDayRecord): MatchWindow[] {
	const out: MatchWindow[] = [];
	for (const seg of day.gridBalanceRunSegments ?? []) {
		const w = matchWindowsFromEpisode(seg);
		if (w) out.push(w);
	}
	for (const off of day.gridBalanceOffWindows ?? []) {
		const w = matchWindowsFromOffWindow(off);
		if (w) out.push(w);
	}
	if (out.filter((w) => w.gbOn).length < 4 || out.filter((w) => !w.gbOn).length < 4) {
		out.push(...matchWindowsFromSlots(day));
	}
	return out;
}
