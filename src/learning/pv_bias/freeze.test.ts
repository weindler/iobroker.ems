import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
	buildFreezeSnapshot,
	decideForecastFreeze,
	freezeInstantMs,
	localDateKey,
} from "./freeze";

function atLocal(hours: number, minutes: number, dayOffset = 0): Date {
	const d = new Date();
	d.setHours(hours, minutes, 0, 0);
	d.setDate(d.getDate() + dayOffset);
	return d;
}

describe("pv_bias freeze", () => {
	it("freeze happens only once per day", () => {
		const frozenAt = atLocal(6, 5).toISOString();
		const later = atLocal(6, 15);
		const decision = decideForecastFreeze(later, true, "06:00", frozenAt);
		assert.equal(decision.shouldFreeze, false);
		assert.equal(decision.status, "ready");
	});

	it("adapter restart does not create new snapshot", () => {
		const frozenAt = atLocal(6, 2).toISOString();
		const afterRestart = atLocal(9, 30);
		const decision = decideForecastFreeze(afterRestart, true, "06:00", frozenAt);
		assert.equal(decision.shouldFreeze, false);
	});

	it("missing forecast yields error without zero", () => {
		const built = buildFreezeSnapshot(new Date(), "06:00", null, 40, "forecast.pv.today_kwh");
		assert.equal(built.ok, false);
		if (!built.ok) {
			assert.match(built.reason, /fehlt/);
		}
	});

	it("freeze time change waits until next calendar day", () => {
		const frozenAt = atLocal(6, 1).toISOString();
		const sameDayNewTime = atLocal(8, 5);
		const decision = decideForecastFreeze(sameDayNewTime, true, "08:00", frozenAt);
		assert.equal(decision.shouldFreeze, false);
	});

	it("new freeze time applies when no snapshot today yet", () => {
		const yesterday = atLocal(6, 0, -1).toISOString();
		const todayAfterNewTime = atLocal(8, 10);
		const decision = decideForecastFreeze(todayAfterNewTime, true, "08:00", yesterday);
		assert.equal(decision.shouldFreeze, true);
	});

	it("waits before freeze time", () => {
		const before = atLocal(5, 30);
		const decision = decideForecastFreeze(before, true, "06:00", null);
		assert.equal(decision.shouldFreeze, false);
		assert.equal(decision.status, "waiting");
	});

	it("creates snapshot after freeze time", () => {
		const after = atLocal(6, 10);
		const decision = decideForecastFreeze(after, true, "06:00", null);
		assert.equal(decision.shouldFreeze, true);
	});

	it("buildFreezeSnapshot keeps frozen values stable inputs", () => {
		const built = buildFreezeSnapshot(new Date(), "06:00", 30, 45, "forecast.pv.today_kwh");
		assert.equal(built.ok, true);
		if (built.ok) {
			assert.equal(built.snapshot.frozenTodayKwh, 30);
			assert.equal(built.snapshot.frozenTomorrowKwh, 45);
		}
	});

	it("localDateKey separates calendar days", () => {
		const today = atLocal(12, 0);
		const tomorrow = atLocal(12, 0, 1);
		assert.notEqual(localDateKey(today), localDateKey(tomorrow));
	});

	it("freezeInstantMs aligns with HH:MM", () => {
		const ref = atLocal(0, 0);
		const ms = freezeInstantMs("06:00", ref);
		assert.ok(ms !== null);
		const d = new Date(ms!);
		assert.equal(d.getHours(), 6);
		assert.equal(d.getMinutes(), 0);
	});
});
