import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { isFreshLastRun, BATTERY_RUNTIME_INTERVAL_MIN_AGE_MS, GRID_BALANCE_ECONOMICS_INTERVAL_MIN_AGE_MS } from "./index";

describe("isFreshLastRun", () => {
	const now = Date.parse("2026-11-15T08:00:00Z");
	it("frisch bei jüngerem Lauf", () => {
		assert.equal(isFreshLastRun("2026-11-15T06:00:00Z", now), true);
	});
	it("nicht frisch bei altem Lauf", () => {
		assert.equal(isFreshLastRun("2026-11-15T04:00:00Z", now), false);
	});
	it("nicht frisch bei leerem, ungültigem oder zukünftigem Wert", () => {
		assert.equal(isFreshLastRun("", now), false);
		assert.equal(isFreshLastRun("kaputt", now), false);
		assert.equal(isFreshLastRun(null, now), false);
		assert.equal(isFreshLastRun("2026-11-15T09:00:00Z", now), false);
	});
});

describe("Batterie-Laufzeit im Intervall", () => {
	const now = Date.parse("2026-11-16T22:52:00Z");
	it("läuft stündlich nicht, aber etwa alle 6 Stunden", () => {
		const maxAge = BATTERY_RUNTIME_INTERVAL_MIN_AGE_MS;
		assert.equal(isFreshLastRun("2026-11-16T21:52:00Z", now, maxAge), true, "nach 1 h noch frisch");
		assert.equal(isFreshLastRun("2026-11-16T17:52:00Z", now, maxAge), true, "nach 5 h noch frisch");
		assert.equal(isFreshLastRun("2026-11-16T16:52:00Z", now, maxAge), false, "nach 6 h wieder fällig");
		assert.equal(isFreshLastRun("2026-11-16T16:52:01Z", now, maxAge), false, "6 h minus Zeitdrift wird nicht übersprungen");
	});
});

describe("Netzausgleich-Wirtschaft im Intervall", () => {
	const now = Date.parse("2026-11-17T03:19:00Z");
	it("läuft nicht stündlich, aber nach rund 6 Stunden wieder", () => {
		const maxAge = GRID_BALANCE_ECONOMICS_INTERVAL_MIN_AGE_MS;
		assert.equal(isFreshLastRun("2026-11-17T02:19:00Z", now, maxAge), true);
		assert.equal(isFreshLastRun("2026-11-16T21:19:00Z", now, maxAge), false);
	});
});
