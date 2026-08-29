import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { configuredMeasuredConsumerSlots, measuredConsumerOverflowCount } from "./config";
import { MEASURED_CONSUMERS_CONFIG_KEY } from "./constants";

describe("measured_consumers/config", () => {
	it("liest eine generische Zeile korrekt ein", () => {
		const slots = configuredMeasuredConsumerSlots({
			[MEASURED_CONSUMERS_CONFIG_KEY]: [
				{ enabled: true, name: "TV", power_state_id: "sensor.tv", energy_state_id: "sensor.tv_e", initial_energy_kwh: "12.5" },
			],
		});
		assert.equal(slots.length, 1);
		assert.deepEqual(slots[0], {
			index: 1,
			enabled: true,
			name: "TV",
			powerStateId: "sensor.tv",
			energyStateId: "sensor.tv_e",
			initialEnergyKwh: 12.5,
		});
	});

	it("leere/fehlende Config ergibt leere Liste (kein Fehler)", () => {
		assert.deepEqual(configuredMeasuredConsumerSlots({}), []);
		assert.deepEqual(configuredMeasuredConsumerSlots(undefined), []);
		assert.deepEqual(configuredMeasuredConsumerSlots(null), []);
	});

	it("begrenzt auf 20 Slots und meldet Überschuss", () => {
		const rows = Array.from({ length: 23 }, (_, i) => ({ enabled: true, name: `V${i}`, power_state_id: `s.${i}` }));
		const slots = configuredMeasuredConsumerSlots({ [MEASURED_CONSUMERS_CONFIG_KEY]: rows });
		assert.equal(slots.length, 20);
		assert.equal(measuredConsumerOverflowCount({ [MEASURED_CONSUMERS_CONFIG_KEY]: rows }), 3);
	});

	it("fehlender Name bekommt generischen Default", () => {
		const slots = configuredMeasuredConsumerSlots({
			[MEASURED_CONSUMERS_CONFIG_KEY]: [{ enabled: true, power_state_id: "s.1" }],
		});
		assert.equal(slots[0].name, "Verbraucher 1");
	});

	it("leere Datenpunkt-Strings werden zu null (nicht leerer String)", () => {
		const slots = configuredMeasuredConsumerSlots({
			[MEASURED_CONSUMERS_CONFIG_KEY]: [{ enabled: true, name: "X", power_state_id: "", energy_state_id: "  " }],
		});
		assert.equal(slots[0].powerStateId, null);
		assert.equal(slots[0].energyStateId, null);
	});
});
