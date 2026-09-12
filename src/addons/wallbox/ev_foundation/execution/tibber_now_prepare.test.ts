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
		const pending = evalAt({ connected: true, prev: ready.next, nowMs: NOW + DELAY + 1000 });
		assert.equal(pending.action, "set_now");
		const once = evalAt({ connected: true, prev: pending.next, nowMs: NOW + DELAY + 2000, alreadyNow: true });
		assert.equal(once.action, "idle");
		assert.equal(once.next.lastResult, "confirmed");
	});

	it("Abstecken während Wartezeit bricht ab", () => {
		const disc = evalAt({ connected: false });
		const wait = evalAt({ connected: true, prev: disc.next });
		const cancel = evalAt({ connected: false, prev: wait.next });
		assert.equal(cancel.action, "cancel");
		assert.equal(cancel.next.connectedSinceMs, null);
	});

	it("Safety-Sperre verzögert NOW, ohne den Plug-Edge zu verbrauchen", () => {
		const disc = evalAt({ connected: false });
		const wait = evalAt({ connected: true, prev: disc.next });
		const blocked = evalAt({
			connected: true,
			prev: wait.next,
			nowMs: NOW + DELAY,
			blocked: true,
		});
		assert.equal(blocked.action, "wait");
		const released = evalAt({
			connected: true,
			prev: blocked.next,
			nowMs: NOW + DELAY + 1000,
			blocked: false,
		});
		assert.equal(released.action, "set_now");
	});

	it("Feedback-Fehler beendet die Übergabe bis zum nächsten Anstecken", () => {
		const disc = evalAt({ connected: false });
		const wait = evalAt({ connected: true, prev: disc.next });
		const failed = evalAt({
			connected: true,
			prev: wait.next,
			nowMs: NOW + DELAY,
			feedbackFailed: true,
		});
		assert.equal(failed.action, "cancel");
		assert.equal(failed.reason, "feedback_failed");
		assert.equal(failed.next.prepareIssued, true);
	});
});
