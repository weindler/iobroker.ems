import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { learnAlphaBeta, windowsMatch, type MatchWindow } from "./alpha_beta.js";

function win(p: Partial<MatchWindow> & Pick<MatchWindow, "gbOn" | "startTs">): MatchWindow {
	return {
		durationSec: 600,
		eGbKwh: p.gbOn ? 0.2 : 0,
		importKwh: p.gbOn ? 0.02 : 0.12,
		batteryDischargeKwh: p.gbOn ? 0.22 : 0.05,
		houseMeanW: 400,
		pvMeanW: 0,
		deficitMeanW: 400,
		socMeanPct: 70,
		source: "episode",
		...p,
	};
}

describe("α/β learning", () => {
	it("ist ohne Paare nicht usable (Cold Start)", () => {
		const r = learnAlphaBeta([]);
		assert.equal(r.usable, false);
		assert.equal(r.alpha, null);
		assert.equal(r.beta, null);
	});

	it("zwingt β nicht auf ≥ α", () => {
		const ons: MatchWindow[] = [];
		const offs: MatchWindow[] = [];
		for (let i = 0; i < 10; i++) {
			ons.push(
				win({
					gbOn: true,
					startTs: Date.parse("2026-01-10T02:00:00Z") + i * 3600_000,
					importKwh: 0.08,
					batteryDischargeKwh: 0.1,
					eGbKwh: 0.2,
				}),
			);
			offs.push(
				win({
					gbOn: false,
					startTs: Date.parse("2026-01-11T02:00:00Z") + i * 3600_000,
					importKwh: 0.1,
					batteryDischargeKwh: 0.08,
				}),
			);
		}
		const r = learnAlphaBeta([...ons, ...offs]);
		assert.ok(r.alpha != null && r.beta != null);
		/* beobachtetes β darf kleiner als α sein — nicht zurechtbiegen */
		if (r.beta! < r.alpha!) {
			assert.ok(r.beta! < r.alpha!);
		}
	});

	it("senkt usable bei zu großer Streuung", () => {
		const windows: MatchWindow[] = [];
		for (let i = 0; i < 12; i++) {
			windows.push(
				win({
					gbOn: true,
					startTs: Date.parse("2026-01-10T02:00:00Z") + i * 3600_000,
					importKwh: i % 2 === 0 ? 0.01 : 0.4,
					batteryDischargeKwh: i % 2 === 0 ? 0.05 : 0.9,
					eGbKwh: 0.2,
				}),
			);
			windows.push(
				win({
					gbOn: false,
					startTs: Date.parse("2026-01-11T02:00:00Z") + i * 3600_000,
					importKwh: 0.12,
					batteryDischargeKwh: 0.05,
				}),
			);
		}
		const r = learnAlphaBeta(windows);
		assert.equal(r.usable, false);
	});

	it("matched nur vergleichbare Lagen", () => {
		const on = win({ gbOn: true, startTs: Date.parse("2026-01-10T02:00:00Z"), houseMeanW: 400 });
		const offOk = win({ gbOn: false, startTs: Date.parse("2026-01-11T02:00:00Z"), houseMeanW: 420 });
		const offFar = win({ gbOn: false, startTs: Date.parse("2026-01-11T02:00:00Z"), houseMeanW: 2500 });
		assert.equal(windowsMatch(on, offOk), true);
		assert.equal(windowsMatch(on, offFar), false);
	});
});
