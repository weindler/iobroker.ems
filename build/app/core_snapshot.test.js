"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const strict_1 = __importDefault(require("node:assert/strict"));
const node_test_1 = require("node:test");
const core_snapshot_js_1 = require("./core_snapshot.js");
const NOW = "2026-09-12T10:00:00.000Z";
(0, node_test_1.describe)("local app core snapshot", () => {
    (0, node_test_1.it)("combines planner, profiles, devices, learning and statistics without a second control path", () => {
        const values = {
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
        const snapshot = (0, core_snapshot_js_1.buildAppCoreSnapshot)({
            generatedAtIso: NOW,
            health: "ok",
            executionMode: "dryrun",
            values,
            config: { ac_u1_profile: "samsung_localthings_hass" },
        });
        strict_1.default.equal(snapshot.schemaVersion, 1);
        strict_1.default.equal(snapshot.source, "local_iobroker");
        strict_1.default.equal(snapshot.localControlIndependentOfCloud, true);
        strict_1.default.equal(snapshot.controlPath, "unified_daily_plan");
        strict_1.default.equal(snapshot.planner.outlook72h?.status, "ready");
        strict_1.default.equal(snapshot.profiles.catalog?.schemaVersion, 1);
        strict_1.default.equal(snapshot.statistics.energyToday?.autonomyPct, 81.2);
        strict_1.default.equal(snapshot.devices.find((device) => device.id === "battery")?.next?.state, "scheduled");
        const climate = snapshot.devices.find((device) => device.id === "air_conditioning.unit_1");
        strict_1.default.equal(climate?.templateId, "samsung_localthings_hass");
        strict_1.default.equal(climate?.current.roomTempC, 25.4);
        strict_1.default.equal(climate?.learned.coolingTempRateKPerH, -1.2);
        strict_1.default.equal(climate?.next?.state, "deferred");
        strict_1.default.equal(snapshot.safety.gridBalanceMustBeOff, true);
        strict_1.default.equal(snapshot.safety.gridBalanceInvariantSatisfied, true);
    });
    (0, node_test_1.it)("preserves unknown values as null and reports invalid JSON/invariant violations", () => {
        const snapshot = (0, core_snapshot_js_1.buildAppCoreSnapshot)({
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
        strict_1.default.equal(snapshot.planner.outlook72h, null);
        strict_1.default.deepEqual(snapshot.dataQuality.invalidJsonStateIds, ["operator.outlook_72h.json"]);
        strict_1.default.deepEqual(snapshot.dataQuality.missingStateIds, ["live.battery.soc_pct"]);
        strict_1.default.equal(snapshot.devices.find((device) => device.id === "battery")?.current.socPct, null);
        strict_1.default.equal(snapshot.safety.gridBalanceInvariantSatisfied, false);
    });
    (0, node_test_1.it)("does not report a disconnected leftover EVCC now mode as active fast charging", () => {
        const snapshot = (0, core_snapshot_js_1.buildAppCoreSnapshot)({
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
        strict_1.default.equal(snapshot.safety.evccNowActive, false);
        strict_1.default.equal(snapshot.safety.externalFastChargeActive, false);
        strict_1.default.equal(snapshot.safety.gridBalanceMustBeOff, false);
        strict_1.default.equal(snapshot.safety.gridBalanceInvariantSatisfied, null);
    });
    (0, node_test_1.it)("reports connected actual EVCC now charging and manual battery charging as hard Grid-Balance conflicts", () => {
        const ev = (0, core_snapshot_js_1.buildAppCoreSnapshot)({
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
        strict_1.default.equal(ev.safety.evccNowActive, true);
        strict_1.default.equal(ev.safety.externalFastChargeActive, true);
        strict_1.default.equal(ev.safety.gridBalanceMustBeOff, true);
        strict_1.default.equal(ev.safety.gridBalanceInvariantSatisfied, true);
        const battery = (0, core_snapshot_js_1.buildAppCoreSnapshot)({
            generatedAtIso: NOW,
            health: "ok",
            executionMode: "live",
            values: {
                "addons.battery.telemetry.operating_mode": "manual",
                "addons.battery.telemetry.charging_power_w": 2000,
                "addons.battery.grid_balance.active": false,
            },
        });
        strict_1.default.equal(battery.safety.batteryGridChargeActive, true);
        strict_1.default.equal(battery.safety.gridBalanceMustBeOff, true);
        strict_1.default.equal(battery.safety.gridBalanceInvariantSatisfied, true);
    });
    (0, node_test_1.it)("publishes exactly one read-only aggregate state", async () => {
        const writes = [];
        const host = {
            config: {},
            async getStateAsync(id) {
                if (id === "profiles.catalog_json")
                    return { val: "{}", ack: true };
                if (id === "operator.outlook_72h.json")
                    return { val: "{}", ack: true };
                if (id === "statistics.energy.today_json" || id === "statistics.energy.period_json") {
                    return { val: "{}", ack: true };
                }
                return null;
            },
            async setStateAsync(id, state) {
                writes.push({ id, state });
            },
        };
        const snapshot = await (0, core_snapshot_js_1.publishAppCoreSnapshot)(host, {
            generatedAtIso: NOW,
            health: "degraded",
            executionMode: "dryrun",
        });
        strict_1.default.equal(writes.length, 1);
        strict_1.default.equal(writes[0]?.id, core_snapshot_js_1.APP_CORE_SNAPSHOT_STATE);
        strict_1.default.equal(writes[0]?.state.ack, true);
        strict_1.default.equal(JSON.parse(String(writes[0]?.state.val)).schemaVersion, 1);
        strict_1.default.ok(snapshot.dataQuality.missingStateIds.length > 0);
        strict_1.default.ok((0, core_snapshot_js_1.appCoreSnapshotStateIds)().length > 100);
        strict_1.default.equal(core_snapshot_js_1.APP_CORE_CONTRACT.readOnly, true);
    });
});
