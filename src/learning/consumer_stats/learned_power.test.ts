import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { emptyConsumerEntry } from "./buffer";
import { resolveConsumerEffectivePowerW } from "./learned_power";

describe("consumer learned power", () => {
	it("uses config power when no stats", () => {
		const r = resolveConsumerEffectivePowerW(undefined, 650, Date.now());
		assert.equal(r.powerW, 650);
		assert.equal(r.source, "config");
	});

	it("uses median learned power from day records", () => {
		const entry = emptyConsumerEntry("air_conditioning.unit_2", Date.now());
		const now = Date.now();
		for (let i = 0; i < 4; i++) {
			const d = new Date(now - i * 86_400_000);
			const key = d.toISOString().slice(0, 10);
			entry.days[key] = {
				dateKey: key,
				runtimeSec: 7200,
				energyKwh: 3.6,
				lastTickMs: now,
			};
		}
		const r = resolveConsumerEffectivePowerW(entry, 650, now);
		assert.equal(r.source, "learned");
		assert.equal(r.powerW, 1800);
	});
});
