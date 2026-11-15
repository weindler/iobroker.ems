"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const strict_1 = __importDefault(require("node:assert/strict"));
const node_test_1 = require("node:test");
const pv_hourly_history_1 = require("./pv_hourly_history");
const pv_hourly_1 = require("./pv_hourly");
const H = 3_600_000;
const tz = "Europe/Berlin";
(0, node_test_1.describe)("pv_hourly_history", () => {
    (0, node_test_1.it)("friert vergangene Stunden ein und schreibt laufende/künftige fort", () => {
        const now = Date.parse("2026-11-15T10:20:00Z");
        const cur = Math.floor(now / H) * H;
        const prev = { version: 1, f: { [String(cur - H)]: 1.2, [String(cur)]: 0.5 }, b: {} };
        const next = (0, pv_hourly_history_1.mergePvHistory)(prev, now, new Map([[cur - H, 9], [cur, 0.9], [cur + H, 1.4]]), new Map());
        strict_1.default.equal(next.f[String(cur - H)], 1.2);
        strict_1.default.equal(next.f[String(cur)], 0.9);
        strict_1.default.equal(next.f[String(cur + H)], 1.4);
    });
    (0, node_test_1.it)("entfernt Einträge älter als 10 Tage", () => {
        const now = Date.parse("2026-11-15T10:20:00Z");
        const old = String(now - 11 * 24 * H);
        const next = (0, pv_hourly_history_1.mergePvHistory)({ version: 1, f: { [old]: 1 }, b: { [old]: 1 } }, now, new Map(), new Map());
        strict_1.default.deepEqual(next, (0, pv_hourly_history_1.emptyPvHourlyHistory)());
    });
    (0, node_test_1.it)("skaliert Brightsky-Einstrahlung auf die Tagesschätzung (nur Volltage)", () => {
        const day0 = Date.parse("2026-11-16T00:00:00+01:00");
        const pts = Array.from({ length: 24 }, (_, i) => ({ startMs: day0 + i * H, solar: i >= 9 && i <= 14 ? 1 : 0 }));
        const part = Array.from({ length: 10 }, (_, i) => ({ startMs: Date.parse("2026-11-15T14:00:00+01:00") + i * H, solar: 1 }));
        const out = (0, pv_hourly_history_1.brightskyHourlyKwh)([...pts, ...part], new Map([["2026-11-16", 6], ["2026-11-15", 3]]), tz);
        const total = [...out.values()].reduce((s, v) => s + v, 0);
        strict_1.default.ok(Math.abs(total - 6) < 1e-9, String(total));
        strict_1.default.equal(out.get(day0 + 12 * H), 1);
        strict_1.default.equal(out.has(Date.parse("2026-11-15T14:00:00+01:00")), false);
    });
    (0, node_test_1.it)("baut die Stundenreihe aus Verlauf, Plan und Messung", () => {
        const now = new Date("2026-11-15T10:20:00Z");
        const cur = Math.floor(now.getTime() / H) * H;
        const r = (0, pv_hourly_1.buildVisPvHourly)({
            now,
            timezone: tz,
            slots: [{ slot: { startIso: new Date(cur + H).toISOString(), endIso: new Date(cur + H + 15 * 60_000).toISOString() }, pvForecastPowerW: 2000 }],
            measured: [{ hourStartMs: cur - H, avgW: 800 }],
            forecastByHour: { [String(cur - H)]: 1.1 },
            brightskyByHour: { [String(cur + 2 * H)]: 0.7 },
        });
        const byT = new Map(r.series.map((p) => [p.t, p]));
        strict_1.default.deepEqual(byT.get(cur - H), { t: cur - H, f: 1.1, b: null, m: 0.8 });
        strict_1.default.equal(byT.get(cur + H).f, 0.5);
        strict_1.default.equal(byT.get(cur + 2 * H).b, 0.7);
    });
});
