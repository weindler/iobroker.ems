"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const strict_1 = __importDefault(require("node:assert/strict"));
const planned_freeze_js_1 = require("./planned_freeze.js");
function cell(startIso, consumerId, kind, energyKwh) {
    return {
        slot: { startIso, endIso: "x" },
        consumerId,
        kind,
        allocatedPowerW: energyKwh * 4000,
        allocatedEnergyKwh: energyKwh,
        energySource: "pv_surplus",
        constraintIds: [],
        reasonCodes: [],
    };
}
(0, node_test_1.describe)("day_telemetry planned freeze", () => {
    const start = "2026-06-15T12:00:00.000Z";
    (0, node_test_1.it)("10) mehrere gleichzeitig geplante Verbraucher", () => {
        const allocs = [
            cell(start, "battery", "battery_charge", 0.5),
            cell(start, "wallbox", "wallbox", 1.2),
            cell(start, "immersion", "immersion_heater", 0.4),
            cell(start, "u1", "climate", 0.3),
            cell(start, "u2", "climate", 0.5),
        ];
        const map = (0, planned_freeze_js_1.sharedGroupMapFromClimateUnits)([
            { unitId: "u1", sharedPowerGroupId: "outdoor_1" },
            { unitId: "u2", sharedPowerGroupId: "outdoor_1" },
        ]);
        const frozen = (0, planned_freeze_js_1.freezePlannedConsumersForSlot)(allocs, start, map);
        strict_1.default.ok(frozen.some((f) => f.consumerId === "battery"));
        strict_1.default.ok(frozen.some((f) => f.consumerId === "wallbox"));
        strict_1.default.ok(frozen.some((f) => f.consumerId === "immersion"));
        strict_1.default.ok(frozen.some((f) => f.kind === "climate" && f.consumerId === "u1"));
        strict_1.default.ok(frozen.some((f) => f.kind === "climate" && f.consumerId === "u2"));
    });
    (0, node_test_1.it)("11) Shared AC elektrisch nur einmal (max)", () => {
        const allocs = [
            cell(start, "u1", "climate", 0.3),
            cell(start, "u2", "climate", 0.5),
        ];
        const map = (0, planned_freeze_js_1.sharedGroupMapFromClimateUnits)([
            { unitId: "u1", sharedPowerGroupId: "outdoor_1" },
            { unitId: "u2", sharedPowerGroupId: "outdoor_1" },
        ]);
        const frozen = (0, planned_freeze_js_1.freezePlannedConsumersForSlot)(allocs, start, map);
        const elec = frozen.filter((f) => f.kind === "climate_shared_electric");
        strict_1.default.equal(elec.length, 1);
        strict_1.default.equal(elec[0].consumerId, "outdoor_1");
        strict_1.default.equal(elec[0].energyKwh, 0.5);
    });
    (0, node_test_1.it)("Dedup plannedConsumers table", () => {
        let table = [];
        const a = (0, planned_freeze_js_1.freezePlannedConsumersForSlot)([cell(start, "battery", "battery_charge", 0.1)], start, null);
        const d1 = (0, planned_freeze_js_1.dedupePlannedConsumers)(table, a);
        table = d1.table;
        const d2 = (0, planned_freeze_js_1.dedupePlannedConsumers)(table, a);
        strict_1.default.equal(d1.index, d2.index);
        strict_1.default.equal(d2.table.length, 1);
    });
});
