"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const strict_1 = __importDefault(require("node:assert/strict"));
const slots_1 = require("../day_telemetry/slots");
const math_1 = require("./math");
const run_1 = require("./run");
function smardHistory(nowMs) {
    const points = [];
    for (let day = 1; day <= 120; day++) {
        for (let hour = 0; hour < 24; hour++) {
            for (let quarter = 0; quarter < 4; quarter++) {
                points.push({ ts: nowMs - day * 86_400_000 + hour * 3_600_000 + quarter * 900_000, ctPerKwh: 8 + hour * 0.2 });
            }
        }
    }
    return points;
}
function weatherForLayout(dateKeys, timezone) {
    return ["Nord", "West", "Mitte", "Ost", "Süd"].map((region) => ({
        region,
        points: dateKeys.flatMap((key) => (0, slots_1.buildDaySlotLayout)(key, timezone).slots
            .filter((_, index) => index % 4 === 0)
            .map((slot) => ({ ts: slot.startMs, temperatureC: 15, windKmh: 20, solarKwhM2: 0.25, cloudPct: 30 }))),
    }));
}
(0, node_test_1.describe)("Greenshare-artige Sieben-Tage-Preisprognose", () => {
    (0, node_test_1.it)("lernt den Tibber-Endpreis-Spread aus zeitlich überlappenden Viertelstunden", () => {
        const smard = [0, 1, 2, 3].map((index) => ({ ts: index * 900_000, ctPerKwh: 10 + index }));
        const tibber = smard.map((point) => ({ slotStartMs: point.ts, priceCtPerKwh: point.ctPerKwh + 20 }));
        const spread = (0, math_1.learnTibberSpread)(smard, tibber);
        strict_1.default.equal(spread.expectedCtPerKwh, 20);
        strict_1.default.equal(spread.sampleCount, 4);
    });
    (0, node_test_1.it)("behält gelernte Vergleichspaare, ergänzt neue und entfernt veraltete", () => {
        const nowMs = Date.parse("2026-09-19T12:00:00.000Z");
        const recentTs = nowMs - 86_400_000;
        const newTs = nowMs;
        const pairs = (0, run_1.mergeSpreadPairs)([
            { ts: nowMs - 181 * 86_400_000, tibberCtPerKwh: 30, smardCtPerKwh: 10 },
            { ts: recentTs, tibberCtPerKwh: 31, smardCtPerKwh: 11 },
        ], [{ ts: newTs, ctPerKwh: 12 }], [{ slotStartMs: newTs, priceCtPerKwh: 33 }], nowMs);
        strict_1.default.deepEqual(pairs, [
            { ts: recentTs, tibberCtPerKwh: 31, smardCtPerKwh: 11 },
            { ts: newTs, tibberCtPerKwh: 33, smardCtPerKwh: 12 },
        ]);
    });
    (0, node_test_1.it)("behält Tibber als echte 15-Minuten-Werte und schätzt danach nur stündlich", () => {
        const timezone = "Europe/Berlin";
        const now = new Date("2026-09-19T08:00:00.000Z");
        const today = "2026-09-19";
        const dateKeys = Array.from({ length: 7 }, (_, index) => {
            const date = new Date(Date.UTC(2026, 8, 19 + index));
            return date.toISOString().slice(0, 10);
        });
        const smard = smardHistory(now.getTime());
        const firstSlots = (0, slots_1.buildDaySlotLayout)(today, timezone).slots.filter((slot) => slot.startMs >= now.getTime()).slice(0, 4);
        const tibber = firstSlots.map((slot, index) => ({ slotStartMs: slot.startMs, priceCtPerKwh: 30 + index }));
        const outlook = (0, math_1.buildPriceOutlook)({ now, timezone, tibber, smard, weather: weatherForLayout(dateKeys, timezone), smardAvailable: true, weatherAvailable: true });
        const published = outlook.days[0].hours.filter((hour) => hour.kind === "published");
        const estimated = outlook.days.flatMap((day) => day.hours).filter((hour) => hour.kind === "estimated");
        strict_1.default.equal(published.length, 4);
        strict_1.default.ok(published.every((hour) => hour.resolutionMinutes === 15));
        strict_1.default.ok(estimated.length > 0);
        strict_1.default.ok(estimated.every((hour) => hour.resolutionMinutes === 60));
        strict_1.default.equal(outlook.informationalOnly, true);
    });
    (0, node_test_1.it)("zeigt bei fehlender wesentlicher Quelle keine erfundene Zahl", () => {
        const outlook = (0, math_1.buildPriceOutlook)({ now: new Date("2026-09-19T08:00:00.000Z"), timezone: "Europe/Berlin", tibber: [], smard: [], weather: [], smardAvailable: false, weatherAvailable: false });
        strict_1.default.equal(outlook.status, "unavailable");
        strict_1.default.ok(outlook.days.every((day) => day.avgCtPerKwh === null));
    });
    (0, node_test_1.it)("erzeugt lokale PV-Rohenergie aus Bright-Sky-Globalstrahlung und kWp", () => {
        const weather = [{
                region: "Anlagenstandort",
                points: [
                    { ts: Date.parse("2026-09-19T10:00:00.000Z"), temperatureC: 20, windKmh: 5, solarKwhM2: 0.5, cloudPct: 10 },
                    { ts: Date.parse("2026-09-19T11:00:00.000Z"), temperatureC: 21, windKmh: 5, solarKwhM2: 0.5, cloudPct: 10 },
                ],
            }];
        const result = (0, math_1.buildLocalPvRawKwh)({ weather, pvKwp: 10, timezone: "Europe/Berlin", now: new Date("2026-09-19T08:00:00.000Z") });
        strict_1.default.equal(result[0], 8.2);
    });
    (0, node_test_1.it)("bildet DST-Tage ohne erfundene 15-Minuten-Schätzungen ab", () => {
        const timezone = "Europe/Berlin";
        strict_1.default.equal((0, slots_1.buildDaySlotLayout)("2026-03-29", timezone).slotCount, 92);
        strict_1.default.equal((0, slots_1.buildDaySlotLayout)("2026-03-30", timezone).slotCount, 96);
        const now = new Date("2026-10-24T22:00:00.000Z");
        const layout = (0, slots_1.buildDaySlotLayout)("2026-10-25", timezone);
        strict_1.default.equal(layout.slotCount, 100);
        const outlook = (0, math_1.buildPriceOutlook)({ now, timezone, tibber: [], smard: smardHistory(now.getTime()), weather: weatherForLayout(["2026-10-25", "2026-10-26", "2026-10-27", "2026-10-28", "2026-10-29", "2026-10-30", "2026-10-31"], timezone), smardAvailable: true, weatherAvailable: true });
        strict_1.default.ok(outlook.days[0].hours.every((hour) => hour.resolutionMinutes === 60));
    });
});
