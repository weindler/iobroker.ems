import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { AC_UNIT_COUNT } from "../constants";
import { acUnitRuntimeStates, ensureAcRuntimeStates } from "./ensure_states";

describe("Klima-State-Anlage", () => {
	it("legt allocated_power_w auch für nicht konfigurierte Plätze an", async () => {
		const objects = new Map<string, ioBroker.Object>();
		const host = {
			config: { ac_u1_enabled: true, ac_u2_enabled: true },
			async setObjectNotExistsAsync(id: string, obj: ioBroker.Object) {
				if (!objects.has(id)) objects.set(id, obj);
			},
		};
		await ensureAcRuntimeStates(host);
		for (let i = 1; i <= AC_UNIT_COUNT; i++) {
			const id = acUnitRuntimeStates(i).allocatedPowerW;
			const obj = objects.get(id);
			assert.equal(obj?.type, "state", id);
			assert.equal(obj?.common.type, "number", id);
			assert.equal(obj?.common.unit, "W", id);
		}
		for (let i = 3; i <= AC_UNIT_COUNT; i++) {
			assert.equal(objects.has(acUnitRuntimeStates(i).estimatedPowerW), false);
		}
		const before = objects.size;
		await ensureAcRuntimeStates(host);
		assert.equal(objects.size, before);
	});
});
