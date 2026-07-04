import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { deviceValuesMatch, writeForeignIfChanged } from "./device_write.js";

describe("deviceValuesMatch", () => {
	it("matches equal numbers and bool coercion", () => {
		assert.equal(deviceValuesMatch(2, 2), true);
		assert.equal(deviceValuesMatch(2, 2.0), true);
		assert.equal(deviceValuesMatch(true, 1), true);
		assert.equal(deviceValuesMatch(false, 0), true);
		assert.equal(deviceValuesMatch("2", 2), true);
	});

	it("respects numeric tolerance", () => {
		assert.equal(deviceValuesMatch(2000, 2050, { numericTolerance: 100 }), true);
		assert.equal(deviceValuesMatch(2000, 2200, { numericTolerance: 100 }), false);
	});

	it("detects mode change needed", () => {
		assert.equal(deviceValuesMatch(2, 1), false);
	});
});

describe("writeForeignIfChanged", () => {
	it("skips write when device already at target", async () => {
		const writes: Array<{ id: string; val: ioBroker.StateValue }> = [];
		const host = {
			getForeignStateAsync: async () => ({ val: 2, ack: true } as ioBroker.State),
			setForeignStateAsync: async (id: string, state: ioBroker.SettableState | ioBroker.StateValue) => {
				const val =
					state && typeof state === "object" && "val" in state
						? (state as ioBroker.SettableState).val
						: (state as ioBroker.StateValue);
				writes.push({ id, val: val ?? null });
			},
			log: { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} },
		};
		const r = await writeForeignIfChanged(host, {
			stateId: "sonnen.0.configurations.EM_OperatingMode",
			value: 2,
			reason: "test",
		});
		assert.equal(r.skipped, true);
		assert.equal(r.written, false);
		assert.equal(writes.length, 0);
	});

	it("writes when value differs", async () => {
		const writes: Array<{ id: string; val: ioBroker.StateValue }> = [];
		const host = {
			getForeignStateAsync: async () => ({ val: 2, ack: true } as ioBroker.State),
			setForeignStateAsync: async (id: string, state: ioBroker.SettableState | ioBroker.StateValue) => {
				const val =
					state && typeof state === "object" && "val" in state
						? (state as ioBroker.SettableState).val
						: (state as ioBroker.StateValue);
				writes.push({ id, val: val ?? null });
			},
		};
		const r = await writeForeignIfChanged(host, {
			stateId: "sonnen.0.configurations.EM_OperatingMode",
			value: 1,
			reason: "test",
		});
		assert.equal(r.skipped, false);
		assert.equal(r.written, true);
		assert.equal(writes.length, 1);
		assert.equal(writes[0].val, 1);
	});
});
