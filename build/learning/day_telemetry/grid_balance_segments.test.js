"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const strict_1 = __importDefault(require("node:assert/strict"));
const grid_balance_segments_js_1 = require("./grid_balance_segments.js");
function sample(over = {}) {
    return {
        ts: 1_000_000,
        houseW: 400,
        pvW: 0,
        gridW: 30,
        gbEffectiveW: 50,
        gbRequestedW: 75,
        batteryDischargeW: 60,
        gridImportW: 30,
        socPct: 70,
        priceCt: 36,
        gbActive: true,
        ...over,
    };
}
(0, node_test_1.describe)("GB episode stability segments", () => {
    (0, node_test_1.it)("öffnet Episode bei GB aktiv und schließt bei inaktiv", () => {
        let open = null;
        let buf = [];
        let list = [];
        let prev = null;
        for (let i = 0; i < 5; i++) {
            const s = sample({ ts: 1_000_000 + i * 30_000, houseW: 400 + i, gbEffectiveW: 50 + i });
            const r = (0, grid_balance_segments_js_1.advanceGridBalanceEpisode)(open, buf, s, prev, list);
            open = r.open;
            buf = r.buf;
            list = r.list;
            prev = s.ts;
        }
        strict_1.default.ok(open);
        const end = sample({ ts: 1_000_000 + 5 * 30_000, gbActive: false, gbEffectiveW: 0 });
        const closed = (0, grid_balance_segments_js_1.advanceGridBalanceEpisode)(open, buf, end, prev, list);
        strict_1.default.equal(closed.open, null);
        strict_1.default.equal(closed.list.length, 1);
        strict_1.default.ok(closed.list[0].requestedEnergyKwh >= 0);
        strict_1.default.ok(closed.list[0].effectiveEnergyKwh >= 0);
    });
    (0, node_test_1.it)("wertet Lastsprung als unstable, nicht als feste Minuten", () => {
        let open = null;
        let buf = [];
        let list = [];
        let prev = null;
        const points = [
            sample({ ts: 1_000_000, houseW: 400 }),
            sample({ ts: 1_030_000, houseW: 410 }),
            sample({ ts: 1_060_000, houseW: 405 }),
            sample({ ts: 1_090_000, houseW: 2500, gridW: 2000, gbEffectiveW: 400 }),
        ];
        for (const s of points) {
            const r = (0, grid_balance_segments_js_1.advanceGridBalanceEpisode)(open, buf, s, prev, list);
            open = r.open;
            buf = r.buf;
            list = r.list;
            prev = s.ts;
        }
        strict_1.default.ok(open);
        strict_1.default.ok(open.unstableDurationSec > 0);
    });
});
