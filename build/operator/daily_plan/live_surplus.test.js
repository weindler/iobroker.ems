"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const strict_1 = __importDefault(require("node:assert/strict"));
const quality_1 = require("../quality");
const live_surplus_js_1 = require("./live_surplus.js");
const TZ = "UTC";
const NOW = new Date("2026-07-11T10:07:00.000Z");
function slotStub(startIso, endIso, pv, house) {
    const bal = pv - house;
    const avail = Math.max(0, bal);
    return {
        slot: { startIso, endIso },
        pvForecastPowerW: pv,
        fixedHouseLoadPowerW: house,
        fixedBalancePowerW: bal,
        gridPriceCtPerKwh: 20,
        gridImportAllowed: true,
        configuredGridImportLimitW: 11000,
        remainingGridImportPowerW: 11000,
        availablePvSurplusPowerW: avail,
        allocatedFlexiblePowerW: 0,
        allocatedPvPowerW: 0,
        allocatedGridPowerW: 0,
        allocatedBatteryPowerW: 0,
        remainingPvSurplusPowerW: avail,
        remainingGridImportPowerWAfterAlloc: 11000,
        remainingBatteryDischargePowerW: 0,
        allocations: [],
        quality: (0, quality_1.operatorQuality)("valid", "OK"),
        reasonDe: "test",
    };
}
(0, node_test_1.describe)("buildOperatorLiveSurplus (Roadmap Block 3.3 — Live-Cache statt altem Planner-Tick)", () => {
    (0, node_test_1.it)("PV über Hauslast -> surplusW gesetzt, deficitW 0", () => {
        const r = (0, live_surplus_js_1.buildOperatorLiveSurplus)({ pvPowerW: 3000, houseLoadW: 500, now: NOW, timezone: TZ });
        strict_1.default.equal(r.surplusW, 2500);
        strict_1.default.equal(r.deficitW, 0);
        strict_1.default.equal(r.status, "valid");
        strict_1.default.equal(r.slotStartIso, "2026-07-11T10:00:00.000Z");
    });
    (0, node_test_1.it)("Hauslast über PV -> deficitW gesetzt, surplusW 0", () => {
        const r = (0, live_surplus_js_1.buildOperatorLiveSurplus)({ pvPowerW: 200, houseLoadW: 900, now: NOW, timezone: TZ });
        strict_1.default.equal(r.surplusW, 0);
        strict_1.default.equal(r.deficitW, 700);
    });
    (0, node_test_1.it)("fehlende Live-Cache-Werte -> null statt erfundener 0, status missing", () => {
        const r = (0, live_surplus_js_1.buildOperatorLiveSurplus)({ pvPowerW: null, houseLoadW: 500, now: NOW, timezone: TZ });
        strict_1.default.equal(r.surplusW, null);
        strict_1.default.equal(r.deficitW, null);
        strict_1.default.equal(r.status, "missing");
    });
    (0, node_test_1.it)("slotStartIso folgt dem 15-Minuten-Raster der aktuellen Zeit", () => {
        const r = (0, live_surplus_js_1.buildOperatorLiveSurplus)({ pvPowerW: 1000, houseLoadW: 1000, now: NOW, timezone: TZ });
        strict_1.default.equal(r.slotStartIso, "2026-07-11T10:00:00.000Z");
    });
});
(0, node_test_1.describe)("applyLiveNowBalanceToCurrentSlot (Beta-Befund 002)", () => {
    (0, node_test_1.it)("setzt NOW konsistent live-live, Zukunft unverändert", () => {
        const slots = [
            slotStub("2026-07-11T10:00:00.000Z", "2026-07-11T10:15:00.000Z", 2000, 800),
            slotStub("2026-07-11T10:15:00.000Z", "2026-07-11T10:30:00.000Z", 2000, 800),
        ];
        const ok = (0, live_surplus_js_1.applyLiveNowBalanceToCurrentSlot)(slots, NOW.getTime(), {
            pvPowerW: 5000,
            houseLoadW: 1000,
            pvAgeSec: 5,
            houseAgeSec: 5,
        });
        strict_1.default.equal(ok, true);
        strict_1.default.equal(slots[0].pvForecastPowerW, 5000);
        strict_1.default.equal(slots[0].fixedHouseLoadPowerW, 1000);
        strict_1.default.equal(slots[0].availablePvSurplusPowerW, 4000);
        strict_1.default.equal((0, live_surplus_js_1.slotBalanceIsConsistent)(slots[0]), true);
        strict_1.default.equal(slots[1].availablePvSurplusPowerW, 1200);
    });
    (0, node_test_1.it)("kein Mix mehr: Live-Surplus ohne Live-PV/HL wird nicht angewandt", () => {
        const slots = [slotStub("2026-07-11T10:00:00.000Z", "2026-07-11T10:15:00.000Z", 2000, 800)];
        const ok = (0, live_surplus_js_1.applyLiveNowBalanceToCurrentSlot)(slots, NOW.getTime(), {
            pvPowerW: null,
            houseLoadW: 1000,
        });
        strict_1.default.equal(ok, false);
        strict_1.default.equal(slots[0].availablePvSurplusPowerW, 1200);
    });
});
