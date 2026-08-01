import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
	slimEntryFromLegacyProfileRow,
	wallboxVehicleMapFromAdapter,
	WB_VEHICLE_MAP,
} from "./config.js";
import { lookupVehicleMapEntry } from "./lookup.js";

describe("wallbox vehicle mini-map", () => {
	it("parses empty / missing as empty entries", () => {
		assert.deepEqual(wallboxVehicleMapFromAdapter({}).entries, []);
		assert.deepEqual(wallboxVehicleMapFromAdapter({ [WB_VEHICLE_MAP]: [] }).entries, []);
		assert.deepEqual(wallboxVehicleMapFromAdapter({ [WB_VEHICLE_MAP]: null }).entries, []);
	});

	it("requires evcc_vehicle_id and keeps optional fields", () => {
		const cfg = wallboxVehicleMapFromAdapter({
			[WB_VEHICLE_MAP]: [
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
		assert.equal(cfg.entries.length, 1);
		assert.equal(cfg.entries[0]!.evccVehicleId, "ford");
		assert.equal(cfg.entries[0]!.displayName, "Ford");
		assert.equal(cfg.entries[0]!.batteryCapacityNetKwh, 77);
		assert.equal(cfg.entries[0]!.maxAcChargePowerW, 11000);
	});

	it("ignores non-positive capacity / power", () => {
		const cfg = wallboxVehicleMapFromAdapter({
			[WB_VEHICLE_MAP]: [
				{
					evcc_vehicle_id: "x",
					battery_capacity_net_kwh: 0,
					max_ac_charge_power_w: -1,
				},
			],
		});
		assert.equal(cfg.entries[0]!.batteryCapacityNetKwh, null);
		assert.equal(cfg.entries[0]!.maxAcChargePowerW, null);
	});

	it("dedupes by case-insensitive EVCC id (first wins)", () => {
		const cfg = wallboxVehicleMapFromAdapter({
			[WB_VEHICLE_MAP]: [
				{ evcc_vehicle_id: "Car", battery_capacity_net_kwh: 50 },
				{ evcc_vehicle_id: "car", battery_capacity_net_kwh: 99 },
			],
		});
		assert.equal(cfg.entries.length, 1);
		assert.equal(cfg.entries[0]!.batteryCapacityNetKwh, 50);
	});

	it("lookup matches name then title; skips disabled", () => {
		const entries = wallboxVehicleMapFromAdapter({
			[WB_VEHICLE_MAP]: [
				{ evcc_vehicle_id: "guest", enabled: false, battery_capacity_net_kwh: 40 },
				{ evcc_vehicle_id: "db_id", display_name: "DB", battery_capacity_net_kwh: 60 },
			],
		}).entries;

		assert.equal(lookupVehicleMapEntry(entries, null, null), null);
		assert.equal(lookupVehicleMapEntry(entries, "guest", null), null);
		assert.equal(lookupVehicleMapEntry(entries, "db_id", null)?.batteryCapacityNetKwh, 60);
		assert.equal(lookupVehicleMapEntry(entries, "other", "db_id")?.batteryCapacityNetKwh, 60);
		assert.equal(lookupVehicleMapEntry(entries, "missing", "also_missing"), null);
	});

	it("migrates legacy fat profile row when EVCC id/name present", () => {
		const slim = slimEntryFromLegacyProfileRow({
			vehicle_id: "ford_explorer",
			display_name: "Ford",
			enabled: true,
			evcc_vehicle_name: "db:12",
			battery_capacity_net_kwh: 77,
			max_ac_charge_power_w: 11000,
			soc_state: "ignored.0.soc",
		});
		assert.ok(slim);
		assert.equal(slim!.evccVehicleId, "db:12");
		assert.equal(slim!.batteryCapacityNetKwh, 77);
		assert.equal(slimEntryFromLegacyProfileRow({ vehicle_id: "no_evcc" }), null);
	});
});
