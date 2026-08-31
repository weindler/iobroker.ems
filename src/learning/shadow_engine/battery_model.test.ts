import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { simulateGreedyBatterySelfConsumption } from "./battery_model";

describe("simulateGreedyBatterySelfConsumption", () => {
	it("lädt Batterie aus PV-Überschuss und speist Rest ein", () => {
		const r = simulateGreedyBatterySelfConsumption({
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
		assert.equal(r.missingSlots, 0);
		assert.ok((r.batteryChargeKwh[0] ?? 0) > 0);
		assert.equal(r.gridImportKwh[0], 0);
	});

	it("entlädt Batterie bei Defizit bis Min-SOC, danach Netzbezug", () => {
		const r = simulateGreedyBatterySelfConsumption({
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
		const totalDischarge = r.batteryDischargeKwh.reduce<number>((s, v) => s + (v ?? 0), 0);
		assert.ok(totalDischarge <= 0.5 + 1e-6);
		const totalImport = r.gridImportKwh.reduce<number>((s, v) => s + (v ?? 0), 0);
		assert.ok(totalImport > 0, "nach Erschöpfung der Batterie muss Netzbezug entstehen");
	});

	it("respektiert maxChargeW/maxDischargeW als Leistungsgrenze", () => {
		const r = simulateGreedyBatterySelfConsumption({
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
		assert.equal(r.batteryChargeKwh[0], 1);
		assert.equal(r.gridExportKwh[0], 4);
	});

	it("markiert Slots mit fehlenden Grunddaten als missing statt 0 zu erfinden", () => {
		const r = simulateGreedyBatterySelfConsumption({
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
		assert.equal(r.missingSlots, 1);
		assert.equal(r.gridImportKwh[1], null);
	});

	it("ohne Kapazität ist alles missing (keine erfundene Simulation)", () => {
		const r = simulateGreedyBatterySelfConsumption({
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
		assert.equal(r.missingSlots, 1);
	});

	it("ist deterministisch bei identischem Input (Reproduzierbarkeit)", () => {
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
		const a = simulateGreedyBatterySelfConsumption(input);
		const b = simulateGreedyBatterySelfConsumption(input);
		assert.deepEqual(a, b);
	});
});
