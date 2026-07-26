"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const strict_1 = __importDefault(require("node:assert/strict"));
const live_surplus_js_1 = require("./live_surplus.js");
const TZ = "UTC";
const NOW = new Date("2026-07-11T10:07:00.000Z");
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
