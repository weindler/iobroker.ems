"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const strict_1 = __importDefault(require("node:assert/strict"));
const config_1 = require("./config");
const constants_1 = require("./constants");
(0, node_test_1.describe)("measured_consumers/config", () => {
    (0, node_test_1.it)("liest eine generische Zeile korrekt ein", () => {
        const slots = (0, config_1.configuredMeasuredConsumerSlots)({
            [constants_1.MEASURED_CONSUMERS_CONFIG_KEY]: [
                { enabled: true, name: "TV", power_state_id: "sensor.tv", energy_state_id: "sensor.tv_e", initial_energy_kwh: "12.5" },
            ],
        });
        strict_1.default.equal(slots.length, 1);
        strict_1.default.deepEqual(slots[0], {
            index: 1,
            enabled: true,
            name: "TV",
            powerStateId: "sensor.tv",
            energyStateId: "sensor.tv_e",
            initialEnergyKwh: 12.5,
        });
    });
    (0, node_test_1.it)("leere/fehlende Config ergibt leere Liste (kein Fehler)", () => {
        strict_1.default.deepEqual((0, config_1.configuredMeasuredConsumerSlots)({}), []);
        strict_1.default.deepEqual((0, config_1.configuredMeasuredConsumerSlots)(undefined), []);
        strict_1.default.deepEqual((0, config_1.configuredMeasuredConsumerSlots)(null), []);
    });
    (0, node_test_1.it)("begrenzt auf 20 Slots und meldet Überschuss", () => {
        const rows = Array.from({ length: 23 }, (_, i) => ({ enabled: true, name: `V${i}`, power_state_id: `s.${i}` }));
        const slots = (0, config_1.configuredMeasuredConsumerSlots)({ [constants_1.MEASURED_CONSUMERS_CONFIG_KEY]: rows });
        strict_1.default.equal(slots.length, 20);
        strict_1.default.equal((0, config_1.measuredConsumerOverflowCount)({ [constants_1.MEASURED_CONSUMERS_CONFIG_KEY]: rows }), 3);
    });
    (0, node_test_1.it)("fehlender Name bekommt generischen Default", () => {
        const slots = (0, config_1.configuredMeasuredConsumerSlots)({
            [constants_1.MEASURED_CONSUMERS_CONFIG_KEY]: [{ enabled: true, power_state_id: "s.1" }],
        });
        strict_1.default.equal(slots[0].name, "Verbraucher 1");
    });
    (0, node_test_1.it)("leere Datenpunkt-Strings werden zu null (nicht leerer String)", () => {
        const slots = (0, config_1.configuredMeasuredConsumerSlots)({
            [constants_1.MEASURED_CONSUMERS_CONFIG_KEY]: [{ enabled: true, name: "X", power_state_id: "", energy_state_id: "  " }],
        });
        strict_1.default.equal(slots[0].powerStateId, null);
        strict_1.default.equal(slots[0].energyStateId, null);
    });
});
