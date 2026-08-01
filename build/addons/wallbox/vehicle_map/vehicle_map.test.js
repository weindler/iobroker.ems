"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const strict_1 = __importDefault(require("node:assert/strict"));
const node_test_1 = require("node:test");
const config_js_1 = require("./config.js");
const lookup_js_1 = require("./lookup.js");
(0, node_test_1.describe)("wallbox vehicle mini-map", () => {
    (0, node_test_1.it)("parses empty / missing as empty entries", () => {
        strict_1.default.deepEqual((0, config_js_1.wallboxVehicleMapFromAdapter)({}).entries, []);
        strict_1.default.deepEqual((0, config_js_1.wallboxVehicleMapFromAdapter)({ [config_js_1.WB_VEHICLE_MAP]: [] }).entries, []);
        strict_1.default.deepEqual((0, config_js_1.wallboxVehicleMapFromAdapter)({ [config_js_1.WB_VEHICLE_MAP]: null }).entries, []);
    });
    (0, node_test_1.it)("requires evcc_vehicle_id and keeps optional fields", () => {
        const cfg = (0, config_js_1.wallboxVehicleMapFromAdapter)({
            [config_js_1.WB_VEHICLE_MAP]: [
                { display_name: "no id" },
                {
                    evcc_vehicle_id: "ford",
                    display_name: "Ford",
                    enabled: true,
                    battery_capacity_net_kwh: 77,
                    max_ac_charge_power_w: 11000,
                },
            ],
        });
        strict_1.default.equal(cfg.entries.length, 1);
        strict_1.default.equal(cfg.entries[0].evccVehicleId, "ford");
        strict_1.default.equal(cfg.entries[0].displayName, "Ford");
        strict_1.default.equal(cfg.entries[0].batteryCapacityNetKwh, 77);
        strict_1.default.equal(cfg.entries[0].maxAcChargePowerW, 11000);
    });
    (0, node_test_1.it)("ignores non-positive capacity / power", () => {
        const cfg = (0, config_js_1.wallboxVehicleMapFromAdapter)({
            [config_js_1.WB_VEHICLE_MAP]: [
                {
                    evcc_vehicle_id: "x",
                    battery_capacity_net_kwh: 0,
                    max_ac_charge_power_w: -1,
                },
            ],
        });
        strict_1.default.equal(cfg.entries[0].batteryCapacityNetKwh, null);
        strict_1.default.equal(cfg.entries[0].maxAcChargePowerW, null);
    });
    (0, node_test_1.it)("dedupes by case-insensitive EVCC id (first wins)", () => {
        const cfg = (0, config_js_1.wallboxVehicleMapFromAdapter)({
            [config_js_1.WB_VEHICLE_MAP]: [
                { evcc_vehicle_id: "Car", battery_capacity_net_kwh: 50 },
                { evcc_vehicle_id: "car", battery_capacity_net_kwh: 99 },
            ],
        });
        strict_1.default.equal(cfg.entries.length, 1);
        strict_1.default.equal(cfg.entries[0].batteryCapacityNetKwh, 50);
    });
    (0, node_test_1.it)("lookup matches name then title; skips disabled", () => {
        const entries = (0, config_js_1.wallboxVehicleMapFromAdapter)({
            [config_js_1.WB_VEHICLE_MAP]: [
                { evcc_vehicle_id: "guest", enabled: false, battery_capacity_net_kwh: 40 },
                { evcc_vehicle_id: "db_id", display_name: "DB", battery_capacity_net_kwh: 60 },
            ],
        }).entries;
        strict_1.default.equal((0, lookup_js_1.lookupVehicleMapEntry)(entries, null, null), null);
        strict_1.default.equal((0, lookup_js_1.lookupVehicleMapEntry)(entries, "guest", null), null);
        strict_1.default.equal((0, lookup_js_1.lookupVehicleMapEntry)(entries, "db_id", null)?.batteryCapacityNetKwh, 60);
        strict_1.default.equal((0, lookup_js_1.lookupVehicleMapEntry)(entries, "other", "db_id")?.batteryCapacityNetKwh, 60);
        strict_1.default.equal((0, lookup_js_1.lookupVehicleMapEntry)(entries, "missing", "also_missing"), null);
    });
    (0, node_test_1.it)("migrates legacy fat profile row when EVCC id/name present", () => {
        const slim = (0, config_js_1.slimEntryFromLegacyProfileRow)({
            vehicle_id: "ford_explorer",
            display_name: "Ford",
            enabled: true,
            evcc_vehicle_name: "db:12",
            battery_capacity_net_kwh: 77,
            max_ac_charge_power_w: 11000,
            soc_state: "ignored.0.soc",
        });
        strict_1.default.ok(slim);
        strict_1.default.equal(slim.evccVehicleId, "db:12");
        strict_1.default.equal(slim.batteryCapacityNetKwh, 77);
        strict_1.default.equal((0, config_js_1.slimEntryFromLegacyProfileRow)({ vehicle_id: "no_evcc" }), null);
    });
});
