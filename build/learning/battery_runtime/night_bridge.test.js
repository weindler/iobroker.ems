"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const strict_1 = __importDefault(require("node:assert/strict"));
const night_bridge_1 = require("./night_bridge");
const BUCKET = night_bridge_1.NIGHT_BRIDGE_BUCKET_MS;
function seriesFromHours(dayStartMs, hours) {
    const pv = [];
    const house = [];
    for (const row of hours) {
        const ts = dayStartMs + row.h * 3_600_000 + BUCKET / 2;
        pv.push({ ts, powerW: row.pv });
        house.push({ ts, powerW: row.house });
    }
    return { pv, house };
}
(0, node_test_1.describe)("night_bridge PV/Haus", () => {
    (0, node_test_1.it)("Abend: PV < Haus → Brückenstart; Morgen: PV > Haus → Brückenende", () => {
        /** 2026-08-20 00:00 lokal ≈ nutze UTC-Stunden als Näherung für Test. */
        const day0 = Date.parse("2026-08-20T00:00:00.000Z");
        const hours = [];
        for (let h = 0; h < 48; h++) {
            let pv = 0;
            let house = 400;
            if (h >= 8 && h < 19)
                pv = 3000; // Tag 0 PV
            if (h >= 19 && h < 24)
                pv = 200; // Abend Defizit
            if (h >= 24 && h < 31)
                pv = 0; // Nacht
            if (h >= 31 && h < 40)
                pv = 2500; // Morgen Tag 1
            if (h >= 24 && h < 31)
                house = 350;
            hours.push({ h, pv, house });
        }
        const { pv, house } = seriesFromHours(day0, hours);
        const net = (0, night_bridge_1.buildPvHouseNetSeries)(pv, house);
        const bridges = (0, night_bridge_1.findPvHouseNightBridges)(net, { flutterMs: BUCKET, deficitW: 100 });
        strict_1.default.ok(bridges.length >= 1, `expected bridge, got ${bridges.length}`);
        const b = bridges[0];
        strict_1.default.equal(b.method, "pv_house");
        const startH = (b.startTs - day0) / 3_600_000;
        const endH = (b.endTs - day0) / 3_600_000;
        strict_1.default.ok(startH >= 18.5 && startH <= 21, `evening start h=${startH}`);
        strict_1.default.ok(endH >= 30.5 && endH <= 33, `morning end h=${endH}`);
        strict_1.default.ok((endH - startH) >= 8, `bridge hours ${endH - startH}`);
    });
    (0, node_test_1.it)("Flattern: einzelnes Defizit-Bucket reicht nicht", () => {
        const points = [
            { ts: 1_000_000, netW: 500 },
            { ts: 1_000_000 + BUCKET, netW: -500 },
            { ts: 1_000_000 + 2 * BUCKET, netW: 500 },
        ];
        const start = (0, night_bridge_1.findSustainedDeficitStart)(points, 0, 9e12, {
            flutterMs: 2 * BUCKET,
            deficitW: 100,
            bucketMs: BUCKET,
        });
        strict_1.default.equal(start, null);
    });
    (0, node_test_1.it)("Recency: jüngere Nächte stärker", () => {
        strict_1.default.ok((0, night_bridge_1.recencyWeight)(0) > (0, night_bridge_1.recencyWeight)(14));
        strict_1.default.ok((0, night_bridge_1.recencyWeight)(14) > (0, night_bridge_1.recencyWeight)(28));
        const avg = (0, night_bridge_1.weightedAverage)([10, 40], [1, 0.01]);
        strict_1.default.ok(avg !== null && avg < 15, `recent-weighted avg=${avg}`);
    });
});
