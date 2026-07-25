"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const strict_1 = __importDefault(require("node:assert/strict"));
const pv_shape_1 = require("./pv_shape");
// München-ähnliche Koordinaten, Sommer.
const LAT = 48.14;
const LON = 11.58;
const SUMMER_NOON_UTC = new Date("2026-07-11T10:00:00.000Z"); // ~12:00 lokale Solarzeit
const SUMMER_MIDNIGHT_UTC = new Date("2026-07-11T22:00:00.000Z");
function quarterSlotsForDay(dateKey) {
    const slots = [];
    const dayStart = Date.parse(`${dateKey}T00:00:00.000Z`);
    for (let i = 0; i < 96; i++) {
        const startMs = dayStart + i * 15 * 60_000;
        const endMs = startMs + 15 * 60_000;
        slots.push({ startIso: new Date(startMs).toISOString(), endIso: new Date(endMs).toISOString() });
    }
    return slots;
}
(0, node_test_1.describe)("solarElevationDeg", () => {
    (0, node_test_1.it)("is high around local solar noon in summer", () => {
        const elevation = (0, pv_shape_1.solarElevationDeg)(SUMMER_NOON_UTC, LAT, LON);
        strict_1.default.ok(elevation > 50, `expected high elevation at noon, got ${elevation}`);
    });
    (0, node_test_1.it)("is negative at night", () => {
        const elevation = (0, pv_shape_1.solarElevationDeg)(SUMMER_MIDNIGHT_UTC, LAT, LON);
        strict_1.default.ok(elevation < 0, `expected negative elevation at night, got ${elevation}`);
    });
});
(0, node_test_1.describe)("clearSkyWeight", () => {
    (0, node_test_1.it)("is zero below the horizon", () => {
        strict_1.default.equal((0, pv_shape_1.clearSkyWeight)(-5), 0);
        strict_1.default.equal((0, pv_shape_1.clearSkyWeight)(0), 0);
    });
    (0, node_test_1.it)("increases with elevation", () => {
        strict_1.default.ok((0, pv_shape_1.clearSkyWeight)(10) < (0, pv_shape_1.clearSkyWeight)(60));
    });
});
(0, node_test_1.describe)("buildPvShapeForDay", () => {
    const slots = quarterSlotsForDay("2026-07-11");
    (0, node_test_1.it)("returns empty without valid daily kWh", () => {
        strict_1.default.deepEqual((0, pv_shape_1.buildPvShapeForDay)(slots, null, LAT, LON, [], null), []);
        strict_1.default.deepEqual((0, pv_shape_1.buildPvShapeForDay)(slots, 0, LAT, LON, [], null), []);
        strict_1.default.deepEqual((0, pv_shape_1.buildPvShapeForDay)(slots, -5, LAT, LON, [], null), []);
    });
    (0, node_test_1.it)("returns empty without lat/lon", () => {
        strict_1.default.deepEqual((0, pv_shape_1.buildPvShapeForDay)(slots, 30, null, LON, [], null), []);
        strict_1.default.deepEqual((0, pv_shape_1.buildPvShapeForDay)(slots, 30, LAT, null, [], null), []);
    });
    (0, node_test_1.it)("distributes the daily kWh so the sum matches (clear-sky only)", () => {
        const result = (0, pv_shape_1.buildPvShapeForDay)(slots, 30, LAT, LON, [], null);
        strict_1.default.equal(result.length, 96);
        const energyKwh = result.reduce((sum, r) => sum + (r.pvPowerW * 0.25) / 1000, 0);
        strict_1.default.ok(Math.abs(energyKwh - 30) < 0.5, `expected ~30 kWh, got ${energyKwh}`);
    });
    (0, node_test_1.it)("is zero at night and peaks around midday", () => {
        const result = (0, pv_shape_1.buildPvShapeForDay)(slots, 30, LAT, LON, [], null);
        const nightSlot = result.find((r) => r.slot.startIso === "2026-07-11T00:00:00.000Z");
        const noonSlot = result.find((r) => r.slot.startIso === "2026-07-11T10:00:00.000Z");
        strict_1.default.equal(nightSlot?.pvPowerW, 0);
        strict_1.default.ok((noonSlot?.pvPowerW ?? 0) > 0);
        const maxPower = Math.max(...result.map((r) => r.pvPowerW));
        const peakSlot = result.find((r) => r.pvPowerW === maxPower);
        // Sonnenhöchststand bei lon≈11.6° liegt nahe 11:13 UTC — Peak muss im Vormittagsfenster liegen.
        strict_1.default.ok(peakSlot && peakSlot.slot.startIso >= "2026-07-11T09:00:00.000Z" && peakSlot.slot.startIso <= "2026-07-11T13:00:00.000Z", `expected peak near midday, got ${peakSlot?.slot.startIso}`);
    });
    (0, node_test_1.it)("dampens a cloudy hour relative to a clear hour on the same day", () => {
        const clear = (0, pv_shape_1.buildPvShapeForDay)(slots, 30, LAT, LON, [], null);
        const cloudy = (0, pv_shape_1.buildPvShapeForDay)(slots, 30, LAT, LON, [{ hourStartIso: "2026-07-11T10:00:00.000Z", cloudPct: 90, solarEstimateKwh: null }], null);
        const clearNoon = clear.find((r) => r.slot.startIso === "2026-07-11T10:00:00.000Z")?.pvPowerW ?? 0;
        const cloudyNoon = cloudy.find((r) => r.slot.startIso === "2026-07-11T10:00:00.000Z")?.pvPowerW ?? 0;
        strict_1.default.ok(cloudyNoon < clearNoon, `expected cloudy (${cloudyNoon}) < clear (${clearNoon})`);
        // total day energy stays normalized to dailyKwh even though one hour is redistributed
        const cloudyEnergyKwh = cloudy.reduce((sum, r) => sum + (r.pvPowerW * 0.25) / 1000, 0);
        strict_1.default.ok(Math.abs(cloudyEnergyKwh - 30) < 0.5);
    });
    (0, node_test_1.it)("prefers solar_estimate over cloud_cover for the same hour when both given", () => {
        const withEstimate = (0, pv_shape_1.buildPvShapeForDay)(slots, 30, LAT, LON, [{ hourStartIso: "2026-07-11T10:00:00.000Z", cloudPct: 90, solarEstimateKwh: 5 }], null);
        const withCloudOnly = (0, pv_shape_1.buildPvShapeForDay)(slots, 30, LAT, LON, [{ hourStartIso: "2026-07-11T10:00:00.000Z", cloudPct: 90, solarEstimateKwh: null }], null);
        const estimateNoon = withEstimate.find((r) => r.slot.startIso === "2026-07-11T10:00:00.000Z")?.pvPowerW ?? 0;
        const cloudOnlyNoon = withCloudOnly.find((r) => r.slot.startIso === "2026-07-11T10:00:00.000Z")?.pvPowerW ?? 0;
        strict_1.default.notEqual(estimateNoon, cloudOnlyNoon);
    });
    (0, node_test_1.it)("caps power at the configured kWp ceiling", () => {
        const uncapped = (0, pv_shape_1.buildPvShapeForDay)(slots, 30, LAT, LON, [], null);
        const maxUncapped = Math.max(...uncapped.map((r) => r.pvPowerW));
        const capW = Math.round(maxUncapped * 0.5);
        const capped = (0, pv_shape_1.buildPvShapeForDay)(slots, 30, LAT, LON, [], capW);
        strict_1.default.ok(Math.max(...capped.map((r) => r.pvPowerW)) <= capW);
        const energyKwh = capped.reduce((sum, r) => sum + (r.pvPowerW * 0.25) / 1000, 0);
        strict_1.default.ok(energyKwh < 30, "capping should reduce total energy below the daily target");
    });
    (0, node_test_1.it)("returns empty for an empty slot list", () => {
        strict_1.default.deepEqual((0, pv_shape_1.buildPvShapeForDay)([], 30, LAT, LON, [], null), []);
    });
});
