import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
	emptyTibberNowPrepareState,
	evaluateTibberNowPrepare,
	TIBBER_NOW_STABILIZE_DEFAULT_S,
} from "./tibber_now_prepare.js";

const NOW = Date.parse("2026-09-01T12:00:00.000Z");
const DELAY = TIBBER_NOW_STABILIZE_DEFAULT_S * 1000;

function evalAt(
	over: Partial<Parameters<typeof evaluateTibberNowPrepare>[0]> & { prev?: ReturnType<typeof emptyTibberNowPrepareState> },
) {
	return evaluateTibberNowPrepare({
		enabled: true,
		connected: true,
		nowMs: NOW,
		delayMs: DELAY,
		blocked: false,
		plannerWantsChargeOrStop: false,
		alreadyNow: false,
		prev: over.prev ?? emptyTibberNowPrepareState(),
		...over,
	});
}

describe("evaluateTibberNowPrepare", () => {
	it("ohne Grid-Rewards kein NOW", () => {
		const r = evalAt({ enabled: false, connected: true });
		assert.equal(r.action, "idle");
	});

	it("bereits verbunden beim Start: kein sofortiges NOW", () => {
		const r = evalAt({ connected: true, prev: emptyTibberNowPrepareState() });
		assert.equal(r.action, "idle");
		assert.equal(r.reason, "already_connected_at_start");
	});

	it("disconnected → connected wartet, dann set_now", () => {
		const disc = evalAt({ connected: false });
		assert.equal(disc.next.prevConnected, false);
		const wait = evalAt({ connected: true, prev: disc.next, nowMs: NOW });
		assert.equal(wait.action, "wait");
		const tooSoon = evalAt({ connected: true, prev: wait.next, nowMs: NOW + 60_000 });
		assert.equal(tooSoon.action, "wait");
		const ready = evalAt({ connected: true, prev: wait.next, nowMs: NOW + DELAY });
		assert.equal(ready.action, "set_now");
		const once = evalAt({ connected: true, prev: ready.next, nowMs: NOW + DELAY + 1000 });
		assert.equal(once.action, "idle");
	});

	it("Abstecken während Wartezeit bricht ab", () => {
		const disc = evalAt({ connected: false });
		const wait = evalAt({ connected: true, prev: disc.next });
		const cancel = evalAt({ connected: false, prev: wait.next });
		assert.equal(cancel.action, "cancel");
		assert.equal(cancel.next.connectedSinceMs, null);
	});

	it("Planner-Ladung/Stop oder Sperre verhindert NOW", () => {
		const disc = evalAt({ connected: false });
		const wait = evalAt({ connected: true, prev: disc.next });
		const blocked = evalAt({
			connected: true,
			prev: wait.next,
			nowMs: NOW + DELAY,
			blocked: true,
		});
		assert.equal(blocked.action, "wait");
		const planner = evalAt({
			connected: true,
			prev: wait.next,
			nowMs: NOW + DELAY,
			plannerWantsChargeOrStop: true,
		});
		assert.equal(planner.action, "wait");
	});
});
