import type { ClimateSharedPowerStat } from "./types";

/** Anlaufphasen/kurze Spikes (Kompressorstart, Sensorrauschen) ausschließen. */
export const CLIMATE_SHARED_POWER_MIN_SEGMENT_RUNTIME_SEC = 300;
/** Unterhalb dieser Sample-Anzahl gilt die Kombination als nicht belastbar (Confidence 0). */
export const CLIMATE_SHARED_POWER_MIN_SAMPLE_COUNT = 3;
/** Ab dieser Sample-Anzahl gilt die Kombination als voll ausgelernt (Confidence-Sättigung). */
export const CLIMATE_SHARED_POWER_TARGET_SAMPLE_COUNT = 10;
/** Bis zu diesem Alter (Tage) keine Freshness-Abwertung. */
export const CLIMATE_SHARED_POWER_FRESHNESS_FULL_DAYS = 30;
/** Ab diesem Alter (Tage, = Day-Telemetry-Retention) Confidence durch Alter auf 0. */
export const CLIMATE_SHARED_POWER_FRESHNESS_ZERO_DAYS = 90;
/** Reliability-Gate: unterhalb dieser Confidence verwendet der Planner den Config-Fallback. */
export const CLIMATE_SHARED_POWER_MIN_CONFIDENCE = 0.3;

export function climateSharedPowerKey(groupId: string, mode: string, combo: string): string {
	return `${groupId}|${mode}|${combo}`;
}

export function parseClimateSharedPowerKey(
	key: string,
): { sharedPowerGroupId: string; mode: string; activeUnitCombination: string } | null {
	const parts = key.split("|");
	if (parts.length !== 3 || !parts[0] || !parts[1] || !parts[2]) return null;
	return { sharedPowerGroupId: parts[0], mode: parts[1], activeUnitCombination: parts[2] };
}

/** Effektive Leistung eines einzelnen Segments (kWh/Laufzeit) — nicht die Learning-Größe selbst. */
export function climateSegmentPowerW(seg: { energyKwh: number; runtimeSec: number }): number | null {
	if (seg.runtimeSec < CLIMATE_SHARED_POWER_MIN_SEGMENT_RUNTIME_SEC) return null;
	if (!(seg.energyKwh > 0)) return null;
	const hours = seg.runtimeSec / 3600;
	const w = (seg.energyKwh * 1000) / hours;
	return Number.isFinite(w) && w > 0 ? w : null;
}

function quantile(sortedAsc: number[], q: number): number {
	if (sortedAsc.length === 0) return 0;
	if (sortedAsc.length === 1) return sortedAsc[0]!;
	const pos = (sortedAsc.length - 1) * q;
	const base = Math.floor(pos);
	const rest = pos - base;
	if (base + 1 < sortedAsc.length) {
		return sortedAsc[base]! + rest * (sortedAsc[base + 1]! - sortedAsc[base]!);
	}
	return sortedAsc[base]!;
}

/**
 * Robuste Ausreißerfilterung (klassische IQR-Fences: außerhalb [Q1−1.5·IQR, Q3+1.5·IQR]
 * verworfen). Schützt gegen einzelne Sensor-Spikes/Fehlmessungen, ohne echte Streuung
 * (z. B. unterschiedliche Außentemperatur) systematisch wegzuschätzen.
 */
export function trimOutliersIqr(values: number[]): number[] {
	if (values.length < 4) return values;
	const sorted = [...values].sort((a, b) => a - b);
	const q1 = quantile(sorted, 0.25);
	const q3 = quantile(sorted, 0.75);
	const iqr = q3 - q1;
	if (!(iqr > 0)) return values;
	const lo = q1 - 1.5 * iqr;
	const hi = q3 + 1.5 * iqr;
	const kept = values.filter((v) => v >= lo && v <= hi);
	return kept.length > 0 ? kept : values;
}

function confidenceFromSamples(sampleCount: number, ageDays: number | null): number {
	if (sampleCount < CLIMATE_SHARED_POWER_MIN_SAMPLE_COUNT) return 0;
	const sampleFactor = Math.min(1, sampleCount / CLIMATE_SHARED_POWER_TARGET_SAMPLE_COUNT);
	let freshnessFactor = 1;
	if (ageDays != null && ageDays > CLIMATE_SHARED_POWER_FRESHNESS_FULL_DAYS) {
		const span = CLIMATE_SHARED_POWER_FRESHNESS_ZERO_DAYS - CLIMATE_SHARED_POWER_FRESHNESS_FULL_DAYS;
		freshnessFactor = Math.max(0, 1 - (ageDays - CLIMATE_SHARED_POWER_FRESHNESS_FULL_DAYS) / span);
	}
	return Math.round(sampleFactor * freshnessFactor * 100) / 100;
}

export type ClimateSharedPowerSampleInput = {
	sharedPowerGroupId: string | null;
	mode: string;
	activeUnitCombination: string;
	energyKwh: number;
	runtimeSec: number;
	valid: boolean;
	endTs: number;
};

/**
 * Baut die vollständige Statistik NEU aus allen übergebenen Segmenten (kein inkrementelles
 * Update) — analog zu anderen Retention-basierten Learnings (`battery_runtime`). Segmente
 * ohne `sharedPowerGroupId` (eigenständige Units) werden hier bewusst NICHT gelernt — für
 * diese greift weiterhin die bestehende Pro-Unit-`consumer_stats`-Learning-Kette
 * (`resolveConsumerEffectivePowerW`), die für nicht geteilte Außengeräte korrekt ist.
 */
export function computeClimateSharedPowerStats(
	segments: ClimateSharedPowerSampleInput[],
	nowMs: number,
): Record<string, ClimateSharedPowerStat> {
	const byKey = new Map<string, { powers: number[]; lastTs: number }>();
	for (const seg of segments) {
		if (!seg.valid) continue;
		if (!seg.sharedPowerGroupId) continue;
		if (!seg.activeUnitCombination || seg.activeUnitCombination === "none") continue;
		const w = climateSegmentPowerW(seg);
		if (w === null) continue;
		const key = climateSharedPowerKey(seg.sharedPowerGroupId, seg.mode, seg.activeUnitCombination);
		const bucket = byKey.get(key) ?? { powers: [], lastTs: 0 };
		bucket.powers.push(w);
		bucket.lastTs = Math.max(bucket.lastTs, seg.endTs);
		byKey.set(key, bucket);
	}

	const result: Record<string, ClimateSharedPowerStat> = {};
	for (const [key, bucket] of byKey) {
		const parsed = parseClimateSharedPowerKey(key);
		if (!parsed) continue;
		const trimmed = trimOutliersIqr(bucket.powers);
		const sorted = [...trimmed].sort((a, b) => a - b);
		const sampleCount = trimmed.length;
		const ageDays = bucket.lastTs > 0 ? Math.max(0, Math.round((nowMs - bucket.lastTs) / 86_400_000)) : null;
		const p25 = sampleCount > 0 ? quantile(sorted, 0.25) : null;
		const p75 = sampleCount > 0 ? quantile(sorted, 0.75) : null;
		result[key] = {
			sharedPowerGroupId: parsed.sharedPowerGroupId,
			mode: parsed.mode,
			activeUnitCombination: parsed.activeUnitCombination,
			sampleCount,
			medianPowerW: sampleCount > 0 ? Math.round(quantile(sorted, 0.5)) : null,
			p75PowerW: p75 !== null ? Math.round(p75) : null,
			spreadW: p75 !== null && p25 !== null ? Math.round(p75 - p25) : null,
			minPowerW: sampleCount > 0 ? Math.round(sorted[0]!) : null,
			maxPowerW: sampleCount > 0 ? Math.round(sorted[sorted.length - 1]!) : null,
			lastSampleAtIso: bucket.lastTs > 0 ? new Date(bucket.lastTs).toISOString() : null,
			ageDays,
			confidence: confidenceFromSamples(sampleCount, ageDays),
		};
	}
	return result;
}

export type ClimateSharedPowerResolution = {
	powerW: number;
	source: "learned" | "config";
	confidence: number;
	sampleCount: number;
	reasonDe: string;
};

/**
 * Reliability-/Confidence-Gate für den Planner: gelernter (p75-)Wert nur bei ausreichender
 * Sample-Anzahl/Aktualität, sonst der bestehende sichere Config-Fallback. Nie erfunden, nie
 * Peak-Werte als Energie — reine Leistungsgrößen aus echten Segmenten.
 */
export function resolveClimateSharedPowerW(
	stat: ClimateSharedPowerStat | undefined,
	fallbackConfigPowerW: number,
): ClimateSharedPowerResolution {
	const safeConfig = fallbackConfigPowerW > 0 ? Math.round(fallbackConfigPowerW) : 0;
	if (!stat || stat.confidence < CLIMATE_SHARED_POWER_MIN_CONFIDENCE || stat.p75PowerW == null) {
		return {
			powerW: safeConfig,
			source: "config",
			confidence: stat?.confidence ?? 0,
			sampleCount: stat?.sampleCount ?? 0,
			reasonDe: stat
				? `Climate-Learning für diese Kombination unzureichend (${stat.sampleCount} Sample(s), ` +
					`Confidence ${Math.round(stat.confidence * 100)}%) — Config-Fallback.`
				: "Kein Climate-Learning-Sample für diese Kombination — Config-Fallback.",
		};
	}
	return {
		powerW: stat.p75PowerW,
		source: "learned",
		confidence: stat.confidence,
		sampleCount: stat.sampleCount,
		reasonDe:
			`Gelernt aus ${stat.sampleCount} Segment(en) für ${stat.sharedPowerGroupId}/${stat.mode}/` +
			`${stat.activeUnitCombination} (p75=${stat.p75PowerW} W, Confidence ${Math.round(stat.confidence * 100)}%).`,
	};
}
