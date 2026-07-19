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
    const humidUnit = (0, config_1.acUnitConfigFromAdapter)({
        ac_u1_enabled: true,
        ac_u1_on_temp_c: 26,
        ac_u1_off_temp_c: 24,
        ac_u1_max_humidity_pct: 60,
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
        strict_1.default.equal(res.modePurpose, "cooling");
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
    (0, node_test_1.it)("keeps running dry below off-temp when humidity is high", () => {
        const res = (0, fsm_1.evaluateAcUnitFsm)({
            now: new Date("2026-07-04T12:00:00"),
            addonEnabled: true,
            unit: humidUnit,
            roomTempC: 23,
            roomHumidityPct: 75,
            feedbackSwitchRaw: "on",
            cleaningActive: false,
        });
        strict_1.default.equal(res.demandStop, false);
        strict_1.default.equal(res.demandStart, false);
        strict_1.default.equal(res.modePurpose, "dehumidify");
    });
    (0, node_test_1.it)("starts dry when humidity high even below off-temp", () => {
        const res = (0, fsm_1.evaluateAcUnitFsm)({
            now: new Date("2026-07-04T12:00:00"),
            addonEnabled: true,
            unit: humidUnit,
            roomTempC: 23,
            roomHumidityPct: 75,
            feedbackSwitchRaw: "off",
            cleaningActive: false,
        });
        strict_1.default.equal(res.demandStart, true);
        strict_1.default.equal(res.demandStop, false);
        strict_1.default.equal(res.modePurpose, "dehumidify");
        strict_1.default.match(res.reasonDe, /dry/);
    });
    (0, node_test_1.it)("prefers cool over dry when temp is at/above on-temp", () => {
        const res = (0, fsm_1.evaluateAcUnitFsm)({
            now: new Date("2026-07-04T12:00:00"),
            addonEnabled: true,
            unit: humidUnit,
            roomTempC: 27,
            roomHumidityPct: 75,
            feedbackSwitchRaw: "off",
            cleaningActive: false,
        });
        strict_1.default.equal(res.demandStart, true);
        strict_1.default.equal(res.modePurpose, "cooling");
        strict_1.default.match(res.reasonDe, /cool/);
    });
    (0, node_test_1.it)("switches purpose to cool while running when temp rises above on-temp", () => {
        const res = (0, fsm_1.evaluateAcUnitFsm)({
            now: new Date("2026-07-04T12:00:00"),
            addonEnabled: true,
            unit: humidUnit,
            roomTempC: 26.5,
            roomHumidityPct: 75,
            feedbackSwitchRaw: "on",
            cleaningActive: false,
        });
        strict_1.default.equal(res.demandStop, false);
        strict_1.default.equal(res.modePurpose, "cooling");
    });
    (0, node_test_1.it)("stops when humidity drops below hysteresis and temp is not high", () => {
        const res = (0, fsm_1.evaluateAcUnitFsm)({
            now: new Date("2026-07-04T12:00:00"),
            addonEnabled: true,
            unit: humidUnit,
            roomTempC: 25,
            roomHumidityPct: 55,
            feedbackSwitchRaw: "on",
            cleaningActive: false,
        });
        strict_1.default.equal(res.demandStop, true);
        strict_1.default.match(res.reasonDe, /Entfeuchten fertig/);
    });
    (0, node_test_1.it)("does not demand stop in hysteresis band while already on", () => {
        const res = (0, fsm_1.evaluateAcUnitFsm)({
            now: new Date("2026-07-04T12:00:00"),
            addonEnabled: true,
            unit,
            roomTempC: 23.5,
            roomHumidityPct: 50,
            feedbackSwitchRaw: "on",
            cleaningActive: false,
        });
        strict_1.default.equal(res.demandStop, false);
        strict_1.default.equal(res.demandStart, false);
        strict_1.default.match(res.reasonDe, /Hysterese/);
    });
    (0, node_test_1.it)("does not start dry when mode_when_dehumidify is empty", () => {
        const noDry = (0, config_1.acUnitConfigFromAdapter)({
            ac_u1_enabled: true,
            ac_u1_on_temp_c: 26,
            ac_u1_off_temp_c: 24,
            ac_u1_max_humidity_pct: 60,
            ac_u1_mode_when_dehumidify: "",
            ac_u1_active_from: "08:00",
            ac_u1_active_until: "19:00",
            ac_u1_hard_off_at: "19:00",
        }, 1);
        const res = (0, fsm_1.evaluateAcUnitFsm)({
            now: new Date("2026-07-04T12:00:00"),
            addonEnabled: true,
            unit: noDry,
            roomTempC: 23,
            roomHumidityPct: 75,
            feedbackSwitchRaw: "off",
            cleaningActive: false,
        });
        strict_1.default.equal(res.demandStart, false);
        strict_1.default.equal(res.modePurpose, "cooling");
    });
    (0, node_test_1.it)("does not start cool when mode_when_cooling is empty", () => {
        const noCool = (0, config_1.acUnitConfigFromAdapter)({
            ac_u1_enabled: true,
            ac_u1_on_temp_c: 26,
            ac_u1_off_temp_c: 24,
            ac_u1_mode_when_cooling: "",
            ac_u1_mode_when_dehumidify: "dry",
            ac_u1_max_humidity_pct: 60,
            ac_u1_active_from: "08:00",
            ac_u1_active_until: "19:00",
            ac_u1_hard_off_at: "19:00",
        }, 1);
        const res = (0, fsm_1.evaluateAcUnitFsm)({
            now: new Date("2026-07-04T12:00:00"),
            addonEnabled: true,
            unit: noCool,
            roomTempC: 28,
            roomHumidityPct: 40,
            feedbackSwitchRaw: "off",
            cleaningActive: false,
        });
        strict_1.default.equal(res.demandStart, false);
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
