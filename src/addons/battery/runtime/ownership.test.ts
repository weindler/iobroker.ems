import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { canSafeRestore, emptyOwnership, isForeignManualControl } from "./ownership.js";

describe("battery ownership", () => {
	it("no restore without ownership", () => {
		assert.equal(canSafeRestore(emptyOwnership()), false);
	});

	it("restore allowed when EMS wrote manual mode", () => {
		const o = { ...emptyOwnership(), active: true, manualModeWritten: true };
		assert.equal(canSafeRestore(o), true);
	});

	it("foreign manual control detected at startup", () => {
		assert.equal(
			isForeignManualControl({ currentMode: 1, manualModeValue: 1, ownership: emptyOwnership() }),
			true,
		);
	});

	it("not foreign when EMS owns", () => {
		const o = { ...emptyOwnership(), active: true };
		assert.equal(isForeignManualControl({ currentMode: 1, manualModeValue: 1, ownership: o }), false);
	});
});
