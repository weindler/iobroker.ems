/**
 * PHASE 3 — Shared-Power/Climate Learning.
 *
 * Lernt reale elektrische Leistung pro (SharedPowerGroup × Betriebsart × aktive Innengeräte)
 * aus den bestehenden `ClimateRunSegment`s (Day Telemetry). Löst eine reale Fehlerquelle: die
 * bisherige PRO-UNIT-Learning-Kette (`consumer_stats`/`resolveConsumerEffectivePowerW`) speist
 * bei geteilten Außengeräten den rohen (nicht deduplizierten) Sensorwert in die Statistik JEDER
 * Unit — Tage, an denen beide Innengeräte gleichzeitig liefen, blähen so den gelernten
 * Einzel-Wert künstlich auf (der Sensor zeigt dann die kombinierte Außengerät-Leistung, nicht
 * den Anteil dieser einen Unit). Diese neue, kombinationsbewusste Statistik trennt „Wohnzimmer
 * alleine“, „Josef alleine“ und „Wohnzimmer+Josef gemeinsam“ konsequent in unterschiedliche
 * Learning-Keys — keine Vermischung, keine Doppelzählung.
 */

export const CLIMATE_SHARED_POWER_FILENAME = "climate_shared_power_v1.json";

export type ClimateSharedPowerStat = {
	sharedPowerGroupId: string;
	mode: string;
	/** z. B. "1", "2", "1+2" — siehe `activeUnitCombinationKey` in day_telemetry/sources.ts. */
	activeUnitCombination: string;
	/** Anzahl gültiger Segmente NACH Ausreißerfilterung. */
	sampleCount: number;
	/** Median — rein diagnostisch/Anzeige, nicht die Planner-Größe. */
	medianPowerW: number | null;
	/** p75 — konservativer Planner-Wert (bewusst leicht über dem Median). */
	p75PowerW: number | null;
	/** Streuung (p75−p25, IQR) — Diagnose der Stabilität dieser Kombination. */
	spreadW: number | null;
	minPowerW: number | null;
	maxPowerW: number | null;
	lastSampleAtIso: string | null;
	/** Alter der letzten Probe in Tagen — fließt in Confidence (Freshness) ein. */
	ageDays: number | null;
	/** 0..1 — Sample-Anzahl × Aktualität. 0 = nicht belastbar (Planner nutzt Fallback). */
	confidence: number;
};

export type ClimateSharedPowerPersist = {
	version: 1;
	generatedAtIso: string;
	/** Key = `climateSharedPowerKey(groupId, mode, combo)`. */
	stats: Record<string, ClimateSharedPowerStat>;
};
