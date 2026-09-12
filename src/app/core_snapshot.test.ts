import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
	APP_CORE_CONTRACT,
	APP_CORE_SNAPSHOT_STATE,
	appCoreSnapshotStateIds,
	buildAppCoreSnapshot,
	publishAppCoreSnapshot,
} from "./core_snapshot.js";

const NOW = "2026-09-12T10:00:00.000Z";

describe("local app core snapshot", () => {
	it("combines planner, profiles, devices, learning and statistics without a second control path", () => {
		const values: Record<string, unknown> = {
			"system.version": "0.2.26",
			"planner.intent.daily_plan.status": "ready",
			"planner.intent.daily_plan.valid_until": "2026-09-15T10:00:00.000Z",
			"operator.outlook_72h.json": JSON.stringify({
				schemaVersion: 1,
				status: "ready",
				decisions: [
					{ consumerId: "battery", kind: "battery_charge", state: "scheduled" },
					{ consumerId: "air_conditioning.unit_1", kind: "climate", state: "deferred" },
				],
			}),
			"profiles.catalog_json": JSON.stringify({ schemaVersion: 1, entries: [] }),
			"statistics.energy.today_json": JSON.stringify({ autonomyPct: 81.2 }),
			"statistics.energy.period_json": JSON.stringify({ selfConsumptionPct: 73.4 }),
			"addons.battery.identity.controller_profile": "sonnen_em",
			"live.battery.soc_pct": 65,
			"addons.battery.runtime.battery_setpoint_owner": "grid_charge",
			"addons.battery.runtime.action": "grid_charge",
			"addons.battery.grid_balance.active": false,
			"addons.air_conditioning.units.unit_1.name": "Wohnzimmer",
			"addons.air_conditioning.units.unit_1.running": false,
			"addons.air_conditioning.units.unit_1.room_temp_c": 25.4,
			"learning.climate_thermal.unit_1.cooling_temp_rate_k_per_h": -1.2,
		};
		const snapshot = buildAppCoreSnapshot({
			generatedAtIso: NOW,
			health: "ok",
			executionMode: "dryrun",
			values,
			config: { ac_u1_profile: "samsung_localthings_hass" },
		});

		assert.equal(snapshot.schemaVersion, 1);
		assert.equal(snapshot.source, "local_iobroker");
		assert.equal(snapshot.localControlIndependentOfCloud, true);
		assert.equal(snapshot.controlPath, "unified_daily_plan");
		assert.equal(snapshot.planner.outlook72h?.status, "ready");
		assert.equal(snapshot.profiles.catalog?.schemaVersion, 1);
		assert.equal(snapshot.statistics.energyToday?.autonomyPct, 81.2);
		assert.equal(snapshot.devices.find((device) => device.id === "battery")?.next?.state, "scheduled");
		const climate = snapshot.devices.find((device) => device.id === "air_conditioning.unit_1");
		assert.equal(climate?.templateId, "samsung_localthings_hass");
		assert.equal(climate?.current.roomTempC, 25.4);
		assert.equal(climate?.learned.coolingTempRateKPerH, -1.2);
		assert.equal(climate?.next?.state, "deferred");
		assert.equal(snapshot.safety.gridBalanceMustBeOff, true);
		assert.equal(snapshot.safety.gridBalanceInvariantSatisfied, true);
	});

	it("preserves unknown values as null and reports invalid JSON/invariant violations", () => {
		const snapshot = buildAppCoreSnapshot({
			generatedAtIso: NOW,
			health: null,
			executionMode: null,
			values: {
				"operator.outlook_72h.json": "{bad",
				"profiles.catalog_json": "{}",
				"statistics.energy.today_json": "{}",
				"statistics.energy.period_json": "{}",
				"addons.battery.runtime.battery_setpoint_owner": "grid_charge",
				"addons.battery.grid_balance.active": true,
			},
			missingStateIds: ["live.battery.soc_pct"],
		});
		assert.equal(snapshot.planner.outlook72h, null);
		assert.deepEqual(snapshot.dataQuality.invalidJsonStateIds, ["operator.outlook_72h.json"]);
		assert.deepEqual(snapshot.dataQuality.missingStateIds, ["live.battery.soc_pct"]);
		assert.equal(snapshot.devices.find((device) => device.id === "battery")?.current.socPct, null);
		assert.equal(snapshot.safety.gridBalanceInvariantSatisfied, false);
	});

	it("does not report a disconnected leftover EVCC now mode as active fast charging", () => {
		const snapshot = buildAppCoreSnapshot({
			generatedAtIso: NOW,
			health: "ok",
			executionMode: "dryrun",
			values: {
				"addons.wallbox.status.evcc.connected": false,
				"addons.wallbox.status.evcc.charging": false,
				"addons.wallbox.status.evcc.charge_power_w": 0,
				"addons.wallbox.status.evcc.loadpoint_mode": "now",
				"addons.wallbox.runtime.battery_hold_for_ev_charge": false,
				"addons.battery.grid_balance.active": false,
			},
		});
		assert.equal(snapshot.safety.evccNowActive, false);
		assert.equal(snapshot.safety.externalFastChargeActive, false);
		assert.equal(snapshot.safety.gridBalanceMustBeOff, false);
		assert.equal(snapshot.safety.gridBalanceInvariantSatisfied, null);
	});

	it("reports connected actual EVCC now charging and manual battery charging as hard Grid-Balance conflicts", () => {
		const ev = buildAppCoreSnapshot({
			generatedAtIso: NOW,
			health: "ok",
			executionMode: "live",
			values: {
				"addons.wallbox.status.evcc.connected": true,
				"addons.wallbox.status.evcc.charging": true,
				"addons.wallbox.status.evcc.charge_power_w": 11000,
				"addons.wallbox.status.evcc.loadpoint_mode": "now",
				"addons.wallbox.runtime.battery_hold_for_ev_charge": true,
				"addons.battery.grid_balance.active": false,
			},
		});
		assert.equal(ev.safety.evccNowActive, true);
		assert.equal(ev.safety.externalFastChargeActive, true);
		assert.equal(ev.safety.gridBalanceMustBeOff, true);
		assert.equal(ev.safety.gridBalanceInvariantSatisfied, true);

		const battery = buildAppCoreSnapshot({
			generatedAtIso: NOW,
			health: "ok",
			executionMode: "live",
			values: {
				"addons.battery.telemetry.operating_mode": "manual",
				"addons.battery.telemetry.charging_power_w": 2000,
				"addons.battery.grid_balance.active": false,
			},
		});
		assert.equal(battery.safety.batteryGridChargeActive, true);
		assert.equal(battery.safety.gridBalanceMustBeOff, true);
		assert.equal(battery.safety.gridBalanceInvariantSatisfied, true);
	});

	it("publishes exactly one read-only aggregate state", async () => {
		const writes: Array<{ id: string; state: ioBroker.SettableState }> = [];
		const host = {
			config: {},
			async getStateAsync(id: string): Promise<ioBroker.State | null> {
				if (id === "profiles.catalog_json") return { val: "{}", ack: true } as ioBroker.State;
				if (id === "operator.outlook_72h.json") return { val: "{}", ack: true } as ioBroker.State;
				if (id === "statistics.energy.today_json" || id === "statistics.energy.period_json") {
					return { val: "{}", ack: true } as ioBroker.State;
				}
				return null;
			},
			async setStateAsync(id: string, state: ioBroker.SettableState): Promise<void> {
				writes.push({ id, state });
			},
		};
		const snapshot = await publishAppCoreSnapshot(host, {
			generatedAtIso: NOW,
			health: "degraded",
			executionMode: "dryrun",
		});
		assert.equal(writes.length, 1);
		assert.equal(writes[0]?.id, APP_CORE_SNAPSHOT_STATE);
		assert.equal(writes[0]?.state.ack, true);
		assert.equal(JSON.parse(String(writes[0]?.state.val)).schemaVersion, 1);
		assert.ok(snapshot.dataQuality.missingStateIds.length > 0);
		assert.ok(appCoreSnapshotStateIds().length > 100);
		assert.equal(APP_CORE_CONTRACT.readOnly, true);
	});
});
