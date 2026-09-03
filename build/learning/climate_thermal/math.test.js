"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const strict_1 = __importDefault(require("node:assert/strict"));
const types_1 = require("../day_telemetry/types");
const constants_1 = require("../day_telemetry/constants");
const slots_1 = require("../day_telemetry/slots");
const math_1 = require("./math");
function dayWithSlots(opts) {
    const dateKey = opts.dateKey ?? "2026-08-01";
    const layout = (0, slots_1.buildDaySlotLayout)(dateKey, "Europe/Berlin");
    const day = (0, types_1.emptyDayRecord)(dateKey, "Europe/Berlin", layout.startMs, layout.endMs, layout.slotCount);
    const start = opts.startHour ?? 10;
    const startSlot = Math.floor((start * 3600_000) / constants_1.DAY_TELEMETRY_SLOT_MS);
    for (let i = 0; i < opts.unitTemps.length; i++) {
        const src = opts.unitTemps[i];
        const idx = startSlot + i;
        if (idx >= day.slotCount)
            break;
        const sample = {
            unitIndex: 1,
            roomTempC: src.temp,
            roomHumidityPct: src.hum ?? 50,
            targetTempC: 17,
            coolingOnTempC: 26,
            coolingOffTempC: 24,
            heatingSetpointC: null,
            maxHumidityPct: 60,
            modesAvailable: ["cooling"],
            running: src.running,
            modePurpose: src.purpose,
            hardOffAt: "20:00",
            demandUrgency01: null,
            ownershipOwner: "ems",
            overrideActive: src.override === true,
            plannedEnergyKwh: null,
            sharedPowerGroupId: "outdoor_1",
            activeUnitCombination: src.running ? "1" : null,
        };
        day.buckets.climateUnitSlots[idx] = [sample];
        day.buckets.outdoorTempC[idx] = 28;
    }
    return day;
}
function manyPassiveDays(rateKPerH, count, startDate = "2026-07-01") {
    const days = [];
    for (let d = 0; d < count; d++) {
        const dateKey = `2026-07-${String(d + 1).padStart(2, "0")}`;
        /* 8 Slots = 2h passive */
        const temps = [];
        for (let s = 0; s < 8; s++) {
            temps.push({ running: false, purpose: "off", temp: 24 + rateKPerH * (s * 0.25) });
        }
        days.push(dayWithSlots({ dateKey, unitTemps: temps }));
    }
    return days;
}
(0, node_test_1.describe)("climate thermal math", () => {
    (0, node_test_1.it)("lernt passive Erwärmung und Abkühlung getrennt, ohne 0 zu erfinden", () => {
        const warm = dayWithSlots({
            dateKey: "2026-07-01",
            unitTemps: Array.from({ length: 8 }, (_, i) => ({
                running: false,
                purpose: "off",
                temp: 22 + i * 0.3,
            })),
        });
        const cool = dayWithSlots({
            dateKey: "2026-07-02",
            unitTemps: Array.from({ length: 8 }, (_, i) => ({
                running: false,
                purpose: "off",
                temp: 26 - i * 0.2,
            })),
        });
        const samples = (0, math_1.collectPassiveTempSamples)([warm, cool], 1);
        strict_1.default.equal(samples.length, 2);
        strict_1.default.ok(samples[0].rate > 0);
        strict_1.default.ok(samples[1].rate < 0);
    });
    (0, node_test_1.it)("verwirft Messsprünge und kurze Segmente", () => {
        const jump = dayWithSlots({
            unitTemps: [
                { running: false, purpose: "off", temp: 22 },
                { running: false, purpose: "off", temp: 28 },
                { running: false, purpose: "off", temp: 28.1 },
            ],
        });
        strict_1.default.equal((0, math_1.collectPassiveTempSamples)([jump], 1).length, 0);
        const short = (0, types_1.emptyDayRecord)("2026-07-01", "Europe/Berlin", 0, 86_400_000, 96);
        short.climateRunSegments = [(0, math_1.thermalTestSegment)({ runtimeSec: 120, energyKwh: 0.02 })];
        strict_1.default.equal((0, math_1.collectActiveTempSamples)([short], 1, "cooling").length, 0);
    });
    (0, node_test_1.it)("Cooling-Wirkung aus echten Segmenten; Mode-Wechsel nicht vermischen", () => {
        const day = (0, types_1.emptyDayRecord)("2026-07-01", "Europe/Berlin", 0, 86_400_000, 96);
        day.climateRunSegments = [
            (0, math_1.thermalTestSegment)({
                mode: "cooling",
                runtimeSec: 1800,
                unitObservations: [
                    {
                        unitIndex: 1,
                        roomTempStartC: 27,
                        roomTempEndC: 25.2,
                        roomHumidityStartPct: 55,
                        roomHumidityEndPct: 54,
                        overrideActive: false,
                    },
                ],
            }),
            (0, math_1.thermalTestSegment)({
                mode: "heating",
                runtimeSec: 1800,
                endTs: 4_000_000,
                unitObservations: [
                    {
                        unitIndex: 1,
                        roomTempStartC: 18,
                        roomTempEndC: 20,
                        roomHumidityStartPct: 40,
                        roomHumidityEndPct: 39,
                        overrideActive: false,
                    },
                ],
            }),
        ];
        const cooling = (0, math_1.collectActiveTempSamples)([day], 1, "cooling");
        const heating = (0, math_1.collectActiveTempSamples)([day], 1, "heating");
        strict_1.default.equal(cooling.length, 1);
        strict_1.default.ok(cooling[0].rate < 0);
        strict_1.default.equal(heating.length, 1);
        strict_1.default.ok(heating[0].rate > 0);
    });
    (0, node_test_1.it)("Heating disabled ohne Segmente → unavailable, kein 0-Sample", () => {
        const model = (0, math_1.computeClimateThermalUnitModel)([], { unitIndex: 1, enabled: true, modesAvailable: ["cooling"] }, Date.now());
        strict_1.default.equal(model.heating.status, "unavailable");
        strict_1.default.equal(model.heating.rate, null);
        strict_1.default.equal(model.heating.usable, false);
        strict_1.default.equal(model.heating.sampleCount, 0);
        strict_1.default.match(model.heating.reasonDe, /nicht verfügbar/);
    });
    (0, node_test_1.it)("Dehumidify lernt Feuchte- und Temperatur-Nebeneffekt getrennt", () => {
        const day = (0, types_1.emptyDayRecord)("2026-07-01", "Europe/Berlin", 0, 86_400_000, 96);
        day.climateRunSegments = [
            (0, math_1.thermalTestSegment)({
                mode: "dehumidify",
                runtimeSec: 1800,
                unitObservations: [
                    {
                        unitIndex: 1,
                        roomTempStartC: 24,
                        roomTempEndC: 23.7,
                        roomHumidityStartPct: 70,
                        roomHumidityEndPct: 62,
                        overrideActive: false,
                    },
                ],
            }),
        ];
        const hum = (0, math_1.collectDehumidifyHumiditySamples)([day], 1);
        const temp = (0, math_1.collectActiveTempSamples)([day], 1, "dehumidify");
        strict_1.default.equal(hum.length, 1);
        strict_1.default.ok(hum[0].rate < 0);
        strict_1.default.equal(temp.length, 1);
        strict_1.default.ok(temp[0].rate < 0);
    });
    (0, node_test_1.it)("Manual-/External-Override wird vom automatischen Lernen ausgeschlossen", () => {
        const day = (0, types_1.emptyDayRecord)("2026-07-01", "Europe/Berlin", 0, 86_400_000, 96);
        day.climateRunSegments = [
            (0, math_1.thermalTestSegment)({
                overrideActive: true,
                unitObservations: [
                    {
                        unitIndex: 1,
                        roomTempStartC: 27,
                        roomTempEndC: 25,
                        roomHumidityStartPct: 50,
                        roomHumidityEndPct: 49,
                        overrideActive: true,
                    },
                ],
            }),
        ];
        const model = (0, math_1.computeClimateThermalUnitModel)([day], { unitIndex: 1, enabled: true, modesAvailable: ["cooling"] }, Date.now());
        strict_1.default.equal(model.cooling.sampleCount, 0);
        strict_1.default.equal(model.cooling.usable, false);
    });
    (0, node_test_1.it)("Shared Solo vs Kombination bleibt als Kontext getrennt, kWh nicht aufgeteilt", () => {
        const day = (0, types_1.emptyDayRecord)("2026-07-01", "Europe/Berlin", 0, 86_400_000, 96);
        day.climateRunSegments = [
            (0, math_1.thermalTestSegment)({
                activeUnitCombination: "1",
                energyKwh: 0.35,
                unitObservations: [
                    {
                        unitIndex: 1,
                        roomTempStartC: 27,
                        roomTempEndC: 25.5,
                        roomHumidityStartPct: 50,
                        roomHumidityEndPct: 49,
                        overrideActive: false,
                    },
                ],
            }),
            (0, math_1.thermalTestSegment)({
                activeUnitCombination: "1+2",
                energyKwh: 0.5,
                endTs: 5_000_000,
                unitObservations: [
                    {
                        unitIndex: 1,
                        roomTempStartC: 27,
                        roomTempEndC: 26,
                        roomHumidityStartPct: 50,
                        roomHumidityEndPct: 49,
                        overrideActive: false,
                    },
                    {
                        unitIndex: 2,
                        roomTempStartC: 26,
                        roomTempEndC: 25.2,
                        roomHumidityStartPct: 48,
                        roomHumidityEndPct: 47,
                        overrideActive: false,
                    },
                ],
            }),
        ];
        const solo = (0, math_1.collectActiveTempSamples)([day], 1, "cooling").filter((s) => s.solo);
        const shared = (0, math_1.collectActiveTempSamples)([day], 1, "cooling").filter((s) => !s.solo);
        strict_1.default.equal(solo.length, 1);
        strict_1.default.equal(shared.length, 1);
        strict_1.default.equal(day.climateRunSegments[1].energyKwh, 0.5);
    });
    (0, node_test_1.it)("usable bleibt bei zu wenig Daten false; hohe Streuung senkt Confidence / usable", () => {
        const few = manyPassiveDays(0.4, 3);
        const fewModel = (0, math_1.computeClimateThermalUnitModel)(few, { unitIndex: 1, enabled: true, modesAvailable: ["cooling"] }, Date.now());
        strict_1.default.ok(fewModel.passive.sampleCount < math_1.CLIMATE_THERMAL_MIN_SAMPLES);
        strict_1.default.equal(fewModel.passive.usable, false);
        const days = [];
        for (let i = 0; i < 12; i++) {
            const rate = i % 2 === 0 ? 0.2 : 3.5;
            days.push(dayWithSlots({
                dateKey: `2026-07-${String(i + 1).padStart(2, "0")}`,
                unitTemps: Array.from({ length: 8 }, (_, s) => ({
                    running: false,
                    purpose: "off",
                    temp: 22 + rate * (s * 0.25),
                })),
            }));
        }
        const spread = (0, math_1.computeClimateThermalUnitModel)(days, { unitIndex: 1, enabled: true, modesAvailable: ["cooling"] }, Date.now());
        strict_1.default.ok(spread.passive.sampleCount >= math_1.CLIMATE_THERMAL_MIN_SAMPLES);
        strict_1.default.equal(spread.passive.usable, false);
        strict_1.default.ok(spread.passive.confidence < 0.7);
    });
    (0, node_test_1.it)("genug homogene Passive-Samples → usable true", () => {
        const days = manyPassiveDays(0.35, 12);
        const model = (0, math_1.computeClimateThermalUnitModel)(days, { unitIndex: 1, enabled: true, modesAvailable: ["cooling"] }, Date.parse("2026-07-13T12:00:00Z"));
        strict_1.default.ok(model.passive.sampleCount >= math_1.CLIMATE_THERMAL_MIN_SAMPLES);
        strict_1.default.equal(model.passive.usable, true);
        strict_1.default.ok(model.passive.rate != null && model.passive.rate > 0);
        strict_1.default.ok(model.passive.warmingRateKPerH != null);
    });
    (0, node_test_1.it)("schlechte Daten (fehlende Raumtemperatur) erzeugen kein Sample", () => {
        const day = (0, types_1.emptyDayRecord)("2026-07-01", "Europe/Berlin", 0, 86_400_000, 96);
        day.climateRunSegments = [
            (0, math_1.thermalTestSegment)({
                unitObservations: [
                    {
                        unitIndex: 1,
                        roomTempStartC: null,
                        roomTempEndC: null,
                        roomHumidityStartPct: null,
                        roomHumidityEndPct: null,
                        overrideActive: false,
                    },
                ],
            }),
        ];
        strict_1.default.equal((0, math_1.collectActiveTempSamples)([day], 1, "cooling").length, 0);
    });
});
