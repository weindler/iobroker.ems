"use strict";
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.CLIMATE_SHARED_POWER_FILENAME = void 0;
exports.CLIMATE_SHARED_POWER_FILENAME = "climate_shared_power_v1.json";
