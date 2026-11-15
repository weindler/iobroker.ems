import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { isFreshLastRun } from "./index";

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
