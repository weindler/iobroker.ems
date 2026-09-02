import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { advanceGridBalanceEpisode, type GbEpisodeSample } from "./grid_balance_segments.js";

function sample(over: Partial<GbEpisodeSample> = {}): GbEpisodeSample {
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

describe("GB episode stability segments", () => {
	it("öffnet Episode bei GB aktiv und schließt bei inaktiv", () => {
		let open = null;
		let buf: GbEpisodeSample[] = [];
		let list: import("./types.js").GridBalanceRunSegment[] = [];
		let prev: number | null = null;
		for (let i = 0; i < 5; i++) {
			const s = sample({ ts: 1_000_000 + i * 30_000, houseW: 400 + i, gbEffectiveW: 50 + i });
			const r = advanceGridBalanceEpisode(open, buf, s, prev, list);
			open = r.open;
			buf = r.buf;
			list = r.list;
			prev = s.ts;
		}
		assert.ok(open);
		const end = sample({ ts: 1_000_000 + 5 * 30_000, gbActive: false, gbEffectiveW: 0 });
		const closed = advanceGridBalanceEpisode(open, buf, end, prev, list);
		assert.equal(closed.open, null);
		assert.equal(closed.list.length, 1);
		assert.ok(closed.list[0]!.requestedEnergyKwh >= 0);
		assert.ok(closed.list[0]!.effectiveEnergyKwh >= 0);
	});

	it("wertet Lastsprung als unstable, nicht als feste Minuten", () => {
		let open = null;
		let buf: GbEpisodeSample[] = [];
		let list: import("./types.js").GridBalanceRunSegment[] = [];
		let prev: number | null = null;
		const points = [
			sample({ ts: 1_000_000, houseW: 400 }),
			sample({ ts: 1_030_000, houseW: 410 }),
			sample({ ts: 1_060_000, houseW: 405 }),
			sample({ ts: 1_090_000, houseW: 2500, gridW: 2000, gbEffectiveW: 400 }),
		];
		for (const s of points) {
			const r = advanceGridBalanceEpisode(open, buf, s, prev, list);
			open = r.open;
			buf = r.buf;
			list = r.list;
			prev = s.ts;
		}
		assert.ok(open);
		assert.ok(open!.unstableDurationSec > 0);
	});
});
