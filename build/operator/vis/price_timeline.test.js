"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const strict_1 = __importDefault(require("node:assert/strict"));
const contribution_ids_1 = require("../contribution_ids");
const price_timeline_1 = require("./price_timeline");
const NOW = new Date("2026-08-17T12:07:00.000Z");
function slot(startIso, priceCt) {
    const start = Date.parse(startIso);
    return {
        startIso,
        endIso: new Date(start + 15 * 60_000).toISOString(),
        priceCtPerKwh: priceCt,
    };
}
function hoursAround(now, backH, aheadH, priceAt) {
    const out = [];
    const start = now.getTime() - backH * 3600_000;
    const end = now.getTime() + aheadH * 3600_000;
    for (let ms = start; ms < end; ms += 15 * 60_000) {
        out.push(slot(new Date(ms).toISOString(), priceAt(ms)));
    }
    return out;
}
function alloc(contributionId, startIso, allocatedPowerW, extra = {}) {
    return {
        contributionId,
        allocatedPowerW,
        slot: { startIso, endIso: new Date(Date.parse(startIso) + 15 * 60_000).toISOString() },
        ...extra,
    };
}
(0, node_test_1.describe)("buildVisPriceTimeline (read-only reshape)", () => {
    (0, node_test_1.it)("keeps last 6h and about next 18h from existing grid slots", () => {
        const grid = hoursAround(NOW, 10, 40, () => 24.3);
        const board = (0, price_timeline_1.buildVisPriceTimeline)({
            now: NOW,
            currentPriceCt: 24.3,
            gbMinPriceCt: 30,
            gbPriceAllowed: false,
            gridSlots: grid,
            batteryAlloc: [],
            wallboxAlloc: [],
            immersionAlloc: [],
            climateAlloc: [],
        });
        const first = Date.parse(board.slots[0].startIso);
        const last = Date.parse(board.slots[board.slots.length - 1].endIso);
        strict_1.default.ok(NOW.getTime() - first >= (price_timeline_1.VIS_PRICE_LOOKBACK_HOURS - 0.3) * 3600_000);
        strict_1.default.ok(NOW.getTime() - first <= (price_timeline_1.VIS_PRICE_LOOKBACK_HOURS + 0.3) * 3600_000);
        strict_1.default.ok(last - NOW.getTime() >= price_timeline_1.VIS_PRICE_MIN_AHEAD_HOURS * 3600_000 - 15 * 60_000);
        strict_1.default.ok(last - NOW.getTime() <= (price_timeline_1.VIS_PRICE_MIN_AHEAD_HOURS + 0.5) * 3600_000);
        strict_1.default.equal(board.slots.every((s) => s.priceCt === 24.3), true);
    });
    (0, node_test_1.it)("does not invent prices for missing grid slots", () => {
        const board = (0, price_timeline_1.buildVisPriceTimeline)({
            now: NOW,
            currentPriceCt: null,
            gbMinPriceCt: 30,
            gbPriceAllowed: null,
            gridSlots: [slot("2026-08-17T12:00:00.000Z", 36.7)],
            batteryAlloc: [],
            wallboxAlloc: [],
            immersionAlloc: [],
            climateAlloc: [],
        });
        strict_1.default.equal(board.slots.length, 1);
        strict_1.default.equal(board.slots[0].priceCt, 36.7);
        strict_1.default.equal(board.slots[0].current, true);
    });
    (0, node_test_1.it)("marks current 15-min and current local hour", () => {
        const grid = hoursAround(NOW, 2, 2, () => 20);
        const board = (0, price_timeline_1.buildVisPriceTimeline)({
            now: NOW,
            currentPriceCt: 20,
            gbMinPriceCt: 30,
            gbPriceAllowed: false,
            gridSlots: grid,
            batteryAlloc: [],
            wallboxAlloc: [],
            immersionAlloc: [],
            climateAlloc: [],
        });
        const current = board.slots.filter((s) => s.current);
        strict_1.default.equal(current.length, 1);
        strict_1.default.equal(current[0].currentHour, true);
        strict_1.default.ok(board.slots.filter((s) => s.currentHour).length >= 1);
    });
    (0, node_test_1.it)("reports calendar-day min/max with timestamps from real prices", () => {
        const grid = [
            slot("2026-08-17T06:00:00.000Z", 18.1),
            slot("2026-08-17T12:00:00.000Z", 24.3),
            slot("2026-08-17T17:00:00.000Z", 41.9),
            slot("2026-08-16T12:00:00.000Z", 9.9),
        ];
        const board = (0, price_timeline_1.buildVisPriceTimeline)({
            now: NOW,
            currentPriceCt: 24.3,
            gbMinPriceCt: 30,
            gbPriceAllowed: false,
            gridSlots: grid,
            batteryAlloc: [],
            wallboxAlloc: [],
            immersionAlloc: [],
            climateAlloc: [],
        });
        strict_1.default.equal(board.dayMin?.priceCt, 18.1);
        strict_1.default.equal(board.dayMin?.startIso, "2026-08-17T06:00:00.000Z");
        strict_1.default.equal(board.dayMax?.priceCt, 41.9);
        strict_1.default.equal(board.dayMax?.startIso, "2026-08-17T17:00:00.000Z");
    });
    (0, node_test_1.it)("GB price-ok is allowance, not an action; 24.3 blocked, 36.7 allowed", () => {
        const low = (0, price_timeline_1.buildVisPriceTimeline)({
            now: NOW,
            currentPriceCt: 24.3,
            gbMinPriceCt: 30,
            gbPriceAllowed: false,
            gridSlots: [slot("2026-08-17T12:00:00.000Z", 24.3)],
            batteryAlloc: [],
            wallboxAlloc: [],
            immersionAlloc: [],
            climateAlloc: [],
        });
        strict_1.default.equal(low.gbPriceAllowed, false);
        strict_1.default.equal(low.slots[0].gbPriceOk, false);
        strict_1.default.deepEqual(low.slots[0].actions, []);
        const high = (0, price_timeline_1.buildVisPriceTimeline)({
            now: NOW,
            currentPriceCt: 36.7,
            gbMinPriceCt: 30,
            gbPriceAllowed: true,
            gridSlots: [slot("2026-08-17T12:00:00.000Z", 36.7)],
            batteryAlloc: [],
            wallboxAlloc: [],
            immersionAlloc: [],
            climateAlloc: [],
        });
        strict_1.default.equal(high.slots[0].gbPriceOk, true);
        strict_1.default.deepEqual(high.slots[0].actions, []);
    });
    (0, node_test_1.it)("marks battery net-charge, EV, immersion, climate from Daily Plan allocations", () => {
        const start = "2026-08-17T12:00:00.000Z";
        const board = (0, price_timeline_1.buildVisPriceTimeline)({
            now: NOW,
            currentPriceCt: 36.7,
            gbMinPriceCt: 30,
            gbPriceAllowed: true,
            gridSlots: [slot(start, 36.7)],
            batteryAlloc: [
                alloc(contribution_ids_1.CONTRIBUTION_IDS.BATTERY_CHARGE, start, 2500, { energySource: "grid", gridPowerW: 2500 }),
            ],
            wallboxAlloc: [alloc(contribution_ids_1.CONTRIBUTION_IDS.WALLBOX_EV_SESSION, start, 7000)],
            immersionAlloc: [alloc(contribution_ids_1.CONTRIBUTION_IDS.IMMERSION_FLEXIBLE, start, 1700)],
            climateAlloc: [alloc("air_conditioning.unit_1", start, 800)],
        });
        strict_1.default.deepEqual(board.slots[0].actions, ["battery_grid", "ev", "immersion", "climate"]);
    });
    (0, node_test_1.it)("does not treat PV-surplus battery charge as Netzladen", () => {
        const start = "2026-08-17T12:00:00.000Z";
        const board = (0, price_timeline_1.buildVisPriceTimeline)({
            now: NOW,
            currentPriceCt: 10,
            gbMinPriceCt: 30,
            gbPriceAllowed: false,
            gridSlots: [slot(start, 10)],
            batteryAlloc: [
                alloc(contribution_ids_1.CONTRIBUTION_IDS.BATTERY_CHARGE, start, 2000, { energySource: "pv_surplus", gridPowerW: 0 }),
            ],
            wallboxAlloc: [],
            immersionAlloc: [],
            climateAlloc: [],
        });
        strict_1.default.deepEqual(board.slots[0].actions, []);
    });
    (0, node_test_1.it)("ignores sub-floor allocations (no second optimiser)", () => {
        const start = "2026-08-17T12:00:00.000Z";
        const board = (0, price_timeline_1.buildVisPriceTimeline)({
            now: NOW,
            currentPriceCt: 20,
            gbMinPriceCt: 30,
            gbPriceAllowed: false,
            gridSlots: [slot(start, 20)],
            batteryAlloc: [],
            wallboxAlloc: [alloc(contribution_ids_1.CONTRIBUTION_IDS.WALLBOX_EV_SESSION, start, 20)],
            immersionAlloc: [],
            climateAlloc: [],
        });
        strict_1.default.deepEqual(board.slots[0].actions, []);
    });
});
