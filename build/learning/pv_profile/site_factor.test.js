"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const strict_1 = __importDefault(require("node:assert/strict"));
const site_factor_1 = require("./site_factor");
const pv_shape_1 = require("../../operator/contributions/pv_shape");
const TZ = "Europe/Berlin";
const LAT = 48;
const LON = 13;
const DAY = 86_400_000;
function makeDays(n, nowMs, shade) {
    const out = [];
    const startOfToday = Math.floor(nowMs / DAY) * DAY;
    for (let d = 1; d <= n; d++) {
        for (let h = 0; h < 24; h++) {
            const hourStartMs = startOfToday - d * DAY + h * 3_600_000;
            const cs = (0, pv_shape_1.clearSkyWeight)((0, pv_shape_1.solarElevationDeg)(new Date(hourStartMs + 1_800_000), LAT, LON));
            out.push({ hourStartMs, avgW: 5000 * cs * shade(h) });
        }
    }
    return out;
}
(0, node_test_1.describe)("PV-Profil (Dach-Faktor je Stunde)", () => {
    const now = Date.parse("2026-06-20T12:00:00Z");
    (0, node_test_1.it)("zu wenig Tage → inaktiv, Faktor 1", () => {
        const p = (0, site_factor_1.computeSiteFactors)(makeDays(3, now, () => 1), LAT, LON, TZ, now);
        strict_1.default.equal(p.active, false);
        strict_1.default.equal((0, site_factor_1.siteFactorAt)(p, now, TZ), 1);
        strict_1.default.match(p.noteDe, /3 von 5/);
    });
    (0, node_test_1.it)("neutrales Dach → Faktoren nahe 1", () => {
        const p = (0, site_factor_1.computeSiteFactors)(makeDays(12, now, () => 1), LAT, LON, TZ, now);
        strict_1.default.equal(p.active, true);
        for (const f of p.factors)
            strict_1.default.ok(Math.abs(f - 1) < 0.05, String(f));
    });
    (0, node_test_1.it)("Verschattung am Nachmittag senkt den Faktor dort und hebt den Rest", () => {
        const p = (0, site_factor_1.computeSiteFactors)(makeDays(20, now, (h) => (h >= 13 && h <= 15 ? 0.5 : 1)), LAT, LON, TZ, now);
        strict_1.default.equal(p.active, true);
        const afternoon = (0, site_factor_1.siteFactorAt)(p, Date.parse("2026-06-20T14:30:00Z"), TZ); // 16:30 Ortszeit (UTC 13–15 verschattet)
        const noon = (0, site_factor_1.siteFactorAt)(p, Date.parse("2026-06-20T10:30:00Z"), TZ);
        strict_1.default.ok(afternoon < noon);
        strict_1.default.ok(afternoon < 0.8);
    });
});
