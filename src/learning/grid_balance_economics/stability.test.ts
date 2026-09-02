import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { isStabilityWindowStable } from "./stability.js";

describe("GB economics stability", () => {
	it("braucht mehrere ruhige Messungen", () => {
		assert.equal(
			isStabilityWindowStable([
				{ houseW: 400, pvW: 0, gridW: 30, gbEffectiveW: 50 },
				{ houseW: 410, pvW: 0, gridW: 28, gbEffectiveW: 52 },
			]),
			false,
		);
	});

	it("erkennt stabile Nachtlast relativ + mit Mindesttoleranz", () => {
		assert.equal(
			isStabilityWindowStable([
				{ houseW: 380, pvW: 0, gridW: 25, gbEffectiveW: 50 },
				{ houseW: 400, pvW: 0, gridW: 30, gbEffectiveW: 48 },
				{ houseW: 390, pvW: 0, gridW: 22, gbEffectiveW: 55 },
			]),
			true,
		);
	});

	it("wird bei Lastsprung unstable", () => {
		assert.equal(
			isStabilityWindowStable([
				{ houseW: 400, pvW: 0, gridW: 30, gbEffectiveW: 50 },
				{ houseW: 420, pvW: 0, gridW: 28, gbEffectiveW: 52 },
				{ houseW: 2200, pvW: 0, gridW: 1800, gbEffectiveW: 400 },
			]),
			false,
		);
	});

	it("erfindet fehlende Hauslast nicht als 0", () => {
		assert.equal(
			isStabilityWindowStable([
				{ houseW: null, pvW: 0, gridW: 30, gbEffectiveW: 50 },
				{ houseW: null, pvW: 0, gridW: 28, gbEffectiveW: 52 },
				{ houseW: null, pvW: 0, gridW: 22, gbEffectiveW: 55 },
			]),
			false,
		);
	});
});
