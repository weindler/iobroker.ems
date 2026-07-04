"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const strict_1 = __importDefault(require("node:assert/strict"));
const node_test_1 = require("node:test");
const config_1 = require("../config");
const fsm_1 = require("./fsm");
(0, node_test_1.describe)("ac unit fsm", () => {
    const unit = (0, config_1.acUnitConfigFromAdapter)({
        ac_u1_enabled: true,
        ac_u1_on_temp_c: 24.5,
        ac_u1_off_temp_c: 23,
        ac_u1_active_from: "08:00",
        ac_u1_active_until: "19:00",
        ac_u1_hard_off_at: "19:00",
    }, 1);
    (0, node_test_1.it)("demands start when temp high and switch off", () => {
        const res = (0, fsm_1.evaluateAcUnitFsm)({
            now: new Date("2026-07-04T12:00:00"),
            addonEnabled: true,
            unit,
            roomTempC: 25,
            roomHumidityPct: 50,
            feedbackSwitchRaw: "off",
            cleaningActive: false,
        });
        strict_1.default.equal(res.demandStart, true);
        strict_1.default.equal(res.demandStop, false);
    });
    (0, node_test_1.it)("demands stop when temp low and switch on", () => {
        const res = (0, fsm_1.evaluateAcUnitFsm)({
            now: new Date("2026-07-04T12:00:00"),
            addonEnabled: true,
            unit,
            roomTempC: 22.5,
            roomHumidityPct: 50,
            feedbackSwitchRaw: "on",
            cleaningActive: false,
        });
        strict_1.default.equal(res.demandStart, false);
        strict_1.default.equal(res.demandStop, true);
    });
    (0, node_test_1.it)("blocks start during cleaning", () => {
        const res = (0, fsm_1.evaluateAcUnitFsm)({
            now: new Date("2026-07-04T12:00:00"),
            addonEnabled: true,
            unit,
            roomTempC: 30,
            roomHumidityPct: 50,
            feedbackSwitchRaw: "off",
            cleaningActive: true,
        });
        strict_1.default.equal(res.state, "cleaning");
        strict_1.default.equal(res.demandStart, false);
    });
});
