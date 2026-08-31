"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const strict_1 = __importDefault(require("node:assert/strict"));
const battery_model_1 = require("./battery_model");
(0, node_test_1.describe)("simulateGreedyBatterySelfConsumption", () => {
    (0, node_test_1.it)("lädt Batterie aus PV-Überschuss und speist Rest ein", () => {
        const r = (0, battery_model_1.simulateGreedyBatterySelfConsumption)({
            pvKwh: [2, 2],
            totalLoadKwh: [0.5, 0.5],
            slotHours: 0.25,
            startSocPct: 50,
            usableCapacityKwh: 10,
            minSocPct: 5,
            maxSocPct: 100,
            maxChargeW: null,
            maxDischargeW: null,
        });
        strict_1.default.equal(r.missingSlots, 0);
        strict_1.default.ok((r.batteryChargeKwh[0] ?? 0) > 0);
        strict_1.default.equal(r.gridImportKwh[0], 0);
    });
    (0, node_test_1.it)("entlädt Batterie bei Defizit bis Min-SOC, danach Netzbezug", () => {
        const r = (0, battery_model_1.simulateGreedyBatterySelfConsumption)({
            pvKwh: [0, 0, 0, 0],
            totalLoadKwh: [1, 1, 1, 1],
            slotHours: 0.25,
            startSocPct: 10,
            usableCapacityKwh: 10,
            minSocPct: 5,
            maxSocPct: 100,
            maxChargeW: null,
            maxDischargeW: null,
        });
        // Start 1 kWh verfügbar oberhalb Min-SOC (10%→5% von 10 kWh = 0.5 kWh)
        const totalDischarge = r.batteryDischargeKwh.reduce((s, v) => s + (v ?? 0), 0);
        strict_1.default.ok(totalDischarge <= 0.5 + 1e-6);
        const totalImport = r.gridImportKwh.reduce((s, v) => s + (v ?? 0), 0);
        strict_1.default.ok(totalImport > 0, "nach Erschöpfung der Batterie muss Netzbezug entstehen");
    });
    (0, node_test_1.it)("respektiert maxChargeW/maxDischargeW als Leistungsgrenze", () => {
        const r = (0, battery_model_1.simulateGreedyBatterySelfConsumption)({
            pvKwh: [5],
            totalLoadKwh: [0],
            slotHours: 1,
            startSocPct: 0,
            usableCapacityKwh: 10,
            minSocPct: 0,
            maxSocPct: 100,
            maxChargeW: 1000,
            maxDischargeW: null,
        });
        strict_1.default.equal(r.batteryChargeKwh[0], 1);
        strict_1.default.equal(r.gridExportKwh[0], 4);
    });
    (0, node_test_1.it)("markiert Slots mit fehlenden Grunddaten als missing statt 0 zu erfinden", () => {
        const r = (0, battery_model_1.simulateGreedyBatterySelfConsumption)({
            pvKwh: [1, null],
            totalLoadKwh: [1, 1],
            slotHours: 0.25,
            startSocPct: 50,
            usableCapacityKwh: 10,
            minSocPct: 5,
            maxSocPct: 100,
            maxChargeW: null,
            maxDischargeW: null,
        });
        strict_1.default.equal(r.missingSlots, 1);
        strict_1.default.equal(r.gridImportKwh[1], null);
    });
    (0, node_test_1.it)("ohne Kapazität ist alles missing (keine erfundene Simulation)", () => {
        const r = (0, battery_model_1.simulateGreedyBatterySelfConsumption)({
            pvKwh: [1],
            totalLoadKwh: [1],
            slotHours: 0.25,
            startSocPct: 50,
            usableCapacityKwh: 0,
            minSocPct: 5,
            maxSocPct: 100,
            maxChargeW: null,
            maxDischargeW: null,
        });
        strict_1.default.equal(r.missingSlots, 1);
    });
    (0, node_test_1.it)("ist deterministisch bei identischem Input (Reproduzierbarkeit)", () => {
        const input = {
            pvKwh: [0, 1, 2, 1, 0],
            totalLoadKwh: [0.5, 0.5, 0.5, 0.5, 0.5],
            slotHours: 0.25,
            startSocPct: 40,
            usableCapacityKwh: 10,
            minSocPct: 5,
            maxSocPct: 100,
            maxChargeW: 3000,
            maxDischargeW: 3000,
        };
        const a = (0, battery_model_1.simulateGreedyBatterySelfConsumption)(input);
        const b = (0, battery_model_1.simulateGreedyBatterySelfConsumption)(input);
        strict_1.default.deepEqual(a, b);
    });
});
