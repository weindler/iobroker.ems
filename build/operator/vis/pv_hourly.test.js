"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const strict_1 = __importDefault(require("node:assert/strict"));
const node_test_1 = require("node:test");
const pv_hourly_1 = require("./pv_hourly");
const tz = "Europe/Berlin";
// 15.11.2026 10:30 Berlin = 09:30 UTC
const now = new Date("2026-11-15T09:30:00Z");
const slot = (iso, w) => ({
    slot: { startIso: iso, endIso: new Date(Date.parse(iso) + 15 * 60_000).toISOString() },
    pvForecastPowerW: w,
});
(0, node_test_1.describe)("buildVisPvHourly", () => {
    (0, node_test_1.it)("fasst Viertelstunden zu Stunden zusammen (Ortszeit)", () => {
        // 11:00-12:00 Berlin = 10:00-11:00 UTC: 4 x 1000 W x 0,25 h = 1,0 kWh
        const slots = ["10:00", "10:15", "10:30", "10:45"].map((t) => slot(`2026-11-15T${t}:00Z`, 1000));
        const r = (0, pv_hourly_1.buildVisPvHourly)({ now, timezone: tz, slots, measured: [] });
        const today = r.days[0];
        strict_1.default.equal(today.label, "Heute");
        strict_1.default.deepEqual(today.hours, [{ h: 11, f: 1, m: null }]);
        strict_1.default.equal(today.forecastKwh, 1);
    });
    (0, node_test_1.it)("trennt heute und morgen", () => {
        const slots = [slot("2026-11-16T10:00:00Z", 2000), slot("2026-11-16T10:15:00Z", 2000)];
        const r = (0, pv_hourly_1.buildVisPvHourly)({ now, timezone: tz, slots, measured: [] });
        strict_1.default.equal(r.days[0].hours.length, 0);
        strict_1.default.equal(r.days[1].label, "Morgen");
        strict_1.default.equal(r.days[1].hours[0].f, 1);
    });
    (0, node_test_1.it)("zeigt gemessene Stunden von heute, aber keine aus der Zukunft", () => {
        const measured = [
            { hourStartMs: Date.parse("2026-11-15T08:00:00Z"), avgW: 600 },
            { hourStartMs: Date.parse("2026-11-15T12:00:00Z"), avgW: 900 },
        ];
        const r = (0, pv_hourly_1.buildVisPvHourly)({ now, timezone: tz, slots: [], measured });
        strict_1.default.deepEqual(r.days[0].hours, [{ h: 9, f: null, m: 0.6 }]);
        strict_1.default.equal(r.days[0].measuredKwh, 0.6);
    });
    (0, node_test_1.it)("lässt Nachtstunden ohne Ertrag weg und ignoriert kaputte Werte", () => {
        const slots = [slot("2026-11-15T22:00:00Z", 0), { slot: { startIso: "kaputt", endIso: "x" }, pvForecastPowerW: 500 }, slot("2026-11-15T10:00:00Z", -5)];
        const r = (0, pv_hourly_1.buildVisPvHourly)({ now, timezone: tz, slots, measured: [] });
        strict_1.default.equal(r.days[0].hours.length, 0);
    });
});
