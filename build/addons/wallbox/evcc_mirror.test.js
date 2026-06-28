"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const strict_1 = __importDefault(require("node:assert/strict"));
const node_test_1 = require("node:test");
const ensure_evcc_states_1 = require("./ensure_evcc_states");
const evcc_config_1 = require("./evcc_config");
const index_1 = require("./index");
function mirrorHost(opts) {
    const writes = new Map();
    for (const [id, val] of Object.entries(opts.preset ?? {})) {
        writes.set(id, val);
    }
    const host = {
        config: opts.config,
        async getForeignStateAsync(id) {
            if (!(id in opts.foreign))
                return null;
            return { val: opts.foreign[id], ts: Date.now(), ack: true };
        },
        async getStateAsync(id) {
            if (!writes.has(id))
                return null;
            return { val: writes.get(id), ts: Date.now(), ack: true };
        },
        async setStateAsync(id, state) {
            const val = typeof state === "object" && state ? state.val : state;
            writes.set(id, val);
            return;
        },
        async setObjectNotExistsAsync() {
            return;
        },
        log: { debug() { }, info() { }, warn() { }, error() { } },
    };
    return { host, writes };
}
(0, node_test_1.describe)("wallbox evcc mirror states (plan times)", () => {
    const PLAN_SRC = "evcc.0.status.planTime";
    const EFF_SRC = "evcc.0.status.effectivePlanTime";
    const config = {
        [evcc_config_1.WB_EVCC_PLAN_TIME]: PLAN_SRC,
        [evcc_config_1.WB_EVCC_EFFECTIVE_PLAN_TIME]: EFF_SRC,
    };
    (0, node_test_1.it)("clears a stale effective_plan_time when the source is null", async () => {
        const { host, writes } = mirrorHost({
            config,
            foreign: { [PLAN_SRC]: null, [EFF_SRC]: null },
            preset: { [ensure_evcc_states_1.WALLBOX_EVCC_STATES.effectivePlanTime]: "2026-06-29T05:00:00.000Z" },
        });
        await (0, index_1.refreshWallboxEvccTelemetry)(host);
        strict_1.default.equal(writes.get(ensure_evcc_states_1.WALLBOX_EVCC_STATES.effectivePlanTime), "");
    });
    (0, node_test_1.it)("clears a stale plan_time when the source is null", async () => {
        const { host, writes } = mirrorHost({
            config,
            foreign: { [PLAN_SRC]: null, [EFF_SRC]: null },
            preset: { [ensure_evcc_states_1.WALLBOX_EVCC_STATES.planTime]: "2026-06-29T05:00:00.000Z" },
        });
        await (0, index_1.refreshWallboxEvccTelemetry)(host);
        strict_1.default.equal(writes.get(ensure_evcc_states_1.WALLBOX_EVCC_STATES.planTime), "");
    });
    (0, node_test_1.it)("clears the mirror state on an invalid source value", async () => {
        const { host, writes } = mirrorHost({
            config,
            foreign: { [PLAN_SRC]: "not-a-date", [EFF_SRC]: "null" },
            preset: {
                [ensure_evcc_states_1.WALLBOX_EVCC_STATES.planTime]: "2026-06-29T05:00:00.000Z",
                [ensure_evcc_states_1.WALLBOX_EVCC_STATES.effectivePlanTime]: "2026-06-29T05:00:00.000Z",
            },
        });
        await (0, index_1.refreshWallboxEvccTelemetry)(host);
        strict_1.default.equal(writes.get(ensure_evcc_states_1.WALLBOX_EVCC_STATES.planTime), "");
        strict_1.default.equal(writes.get(ensure_evcc_states_1.WALLBOX_EVCC_STATES.effectivePlanTime), "");
    });
    (0, node_test_1.it)("keeps a valid ISO timestamp in the mirror state", async () => {
        const { host, writes } = mirrorHost({
            config,
            foreign: { [EFF_SRC]: "2026-06-29T05:00:00.000Z" },
        });
        await (0, index_1.refreshWallboxEvccTelemetry)(host);
        strict_1.default.equal(writes.get(ensure_evcc_states_1.WALLBOX_EVCC_STATES.effectivePlanTime), "2026-06-29T05:00:00.000Z");
    });
    (0, node_test_1.it)("treats the EVCC zero-time sentinel as no plan and clears the mirror state", async () => {
        const { host, writes } = mirrorHost({
            config,
            foreign: { [EFF_SRC]: "0001-01-01T00:00:00Z" },
            preset: { [ensure_evcc_states_1.WALLBOX_EVCC_STATES.effectivePlanTime]: "2026-06-29T05:00:00.000Z" },
        });
        await (0, index_1.refreshWallboxEvccTelemetry)(host);
        strict_1.default.equal(writes.get(ensure_evcc_states_1.WALLBOX_EVCC_STATES.effectivePlanTime), "");
    });
    (0, node_test_1.it)("keeps other telemetry fields untouched while clearing plan times", async () => {
        const { host, writes } = mirrorHost({
            config: {
                ...config,
                wb_evcc_plan_active_state: "evcc.0.status.planActive",
                wb_evcc_plan_soc_state: "evcc.0.status.planSoc",
                wb_evcc_session_energy_kwh_state: "evcc.0.status.sessionEnergy",
                wb_evcc_vehicle_soc_state: "evcc.0.status.vehicleSoc",
                wb_evcc_charge_power_w_state: "evcc.0.status.chargePower",
            },
            foreign: {
                [PLAN_SRC]: null,
                [EFF_SRC]: null,
                "evcc.0.status.planActive": false,
                "evcc.0.status.planSoc": 80,
                "evcc.0.status.sessionEnergy": 219.683,
                "evcc.0.status.vehicleSoc": 55,
                "evcc.0.status.chargePower": 0,
            },
        });
        await (0, index_1.refreshWallboxEvccTelemetry)(host);
        strict_1.default.equal(writes.get(ensure_evcc_states_1.WALLBOX_EVCC_STATES.planTime), "");
        strict_1.default.equal(writes.get(ensure_evcc_states_1.WALLBOX_EVCC_STATES.effectivePlanTime), "");
        strict_1.default.equal(writes.get(ensure_evcc_states_1.WALLBOX_EVCC_STATES.planActive), false);
        strict_1.default.equal(writes.get(ensure_evcc_states_1.WALLBOX_EVCC_STATES.planSocPct), 80);
        strict_1.default.equal(writes.get(ensure_evcc_states_1.WALLBOX_EVCC_STATES.sessionEnergyKwh), 0.219683);
        strict_1.default.equal(writes.get(ensure_evcc_states_1.WALLBOX_EVCC_STATES.vehicleSocPct), 55);
        strict_1.default.equal(writes.get(ensure_evcc_states_1.WALLBOX_EVCC_STATES.chargePowerW), 0);
        const snapshotRaw = writes.get(ensure_evcc_states_1.WALLBOX_EVCC_STATES.snapshotJson);
        strict_1.default.equal(typeof snapshotRaw, "string");
        const snap = JSON.parse(String(snapshotRaw));
        strict_1.default.equal(snap.plan_time.value, null);
        strict_1.default.equal(snap.effective_plan_time.value, null);
        strict_1.default.equal(snap.plan_active.value, false);
        strict_1.default.equal(snap.session_energy_kwh.value, 0.219683);
    });
});
