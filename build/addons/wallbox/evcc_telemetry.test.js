"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const strict_1 = __importDefault(require("node:assert/strict"));
const node_test_1 = require("node:test");
const evcc_telemetry_1 = require("./evcc_telemetry");
function mockHost(states) {
    return {
        async getForeignStateAsync(id) {
            if (!(id in states))
                return null;
            const val = states[id];
            if (val === "__missing__")
                return null;
            return { val, ts: Date.now(), ack: true };
        },
        async getStateAsync() {
            return null;
        },
        async setStateAsync() {
            return;
        },
        async setObjectNotExistsAsync() {
            return;
        },
    };
}
(0, node_test_1.describe)("wallbox evcc telemetry", () => {
    const now = new Date("2026-06-28T12:00:00.000Z");
    (0, node_test_1.it)("reads connected, charging and charge power from EVCC", async () => {
        const snap = await (0, evcc_telemetry_1.readEvccTelemetrySnapshot)(mockHost({
            "evcc.0.status.connected": true,
            "evcc.0.status.charging": true,
            "evcc.0.status.chargePower": 3500,
        }), {
            enabledStateId: "",
            connectedStateId: "evcc.0.status.connected",
            chargingStateId: "evcc.0.status.charging",
            chargePowerWStateId: "evcc.0.status.chargePower",
            sessionEnergyKwhStateId: "",
            vehicleSocStateId: "",
            planActiveStateId: "",
            planSocStateId: "",
            planTimeStateId: "",
            effectivePlanTimeStateId: "",
            activePhasesStateId: "",
            configuredPhasesStateId: "",
            minCurrentAStateId: "",
            maxCurrentAStateId: "",
        }, now);
        strict_1.default.equal(snap.connected.value, true);
        strict_1.default.equal(snap.charging.value, true);
        strict_1.default.equal(snap.charge_power_w.value, 3500);
    });
    (0, node_test_1.it)("reads effectivePlanTime as ISO string", async () => {
        const snap = await (0, evcc_telemetry_1.readEvccTelemetrySnapshot)(mockHost({
            "evcc.0.status.effectivePlanTime": 1_751_107_200,
        }), {
            enabledStateId: "",
            connectedStateId: "",
            chargingStateId: "",
            chargePowerWStateId: "",
            sessionEnergyKwhStateId: "",
            vehicleSocStateId: "",
            planActiveStateId: "",
            planSocStateId: "",
            planTimeStateId: "",
            effectivePlanTimeStateId: "evcc.0.status.effectivePlanTime",
            activePhasesStateId: "",
            configuredPhasesStateId: "",
            minCurrentAStateId: "",
            maxCurrentAStateId: "",
        }, now);
        strict_1.default.equal(snap.effective_plan_time.status, "valid");
        strict_1.default.match(snap.effective_plan_time.value ?? "", /^\d{4}-\d{2}-\d{2}T/);
    });
    (0, node_test_1.it)("missing EVCC values stay missing — not false or zero", async () => {
        const snap = await (0, evcc_telemetry_1.readEvccTelemetrySnapshot)(mockHost({
            "evcc.0.status.connected": "__missing__",
        }), {
            enabledStateId: "evcc.0.status.enabled",
            connectedStateId: "evcc.0.status.connected",
            chargingStateId: "evcc.0.status.charging",
            chargePowerWStateId: "",
            sessionEnergyKwhStateId: "",
            vehicleSocStateId: "",
            planActiveStateId: "",
            planSocStateId: "",
            planTimeStateId: "",
            effectivePlanTimeStateId: "",
            activePhasesStateId: "",
            configuredPhasesStateId: "",
            minCurrentAStateId: "",
            maxCurrentAStateId: "",
        }, now);
        strict_1.default.equal(snap.enabled.status, "missing");
        strict_1.default.equal(snap.connected.status, "missing");
        strict_1.default.equal(snap.charging.status, "missing");
        strict_1.default.equal(snap.enabled.value, null);
        strict_1.default.equal(snap.connected.value, null);
    });
    (0, node_test_1.it)("legacy go-e write targets do not affect EVCC telemetry read", async () => {
        const snap = await (0, evcc_telemetry_1.readEvccTelemetrySnapshot)(mockHost({
            "go-e.0.allow_charging": true,
            "go-e.0.amperePV": 16,
            "evcc.0.status.charging": false,
        }), {
            enabledStateId: "",
            connectedStateId: "",
            chargingStateId: "evcc.0.status.charging",
            chargePowerWStateId: "",
            sessionEnergyKwhStateId: "",
            vehicleSocStateId: "",
            planActiveStateId: "",
            planSocStateId: "",
            planTimeStateId: "",
            effectivePlanTimeStateId: "",
            activePhasesStateId: "",
            configuredPhasesStateId: "",
            minCurrentAStateId: "",
            maxCurrentAStateId: "",
        }, now);
        strict_1.default.equal(snap.charging.value, false);
        strict_1.default.equal(snap.enabled.status, "missing");
    });
});
