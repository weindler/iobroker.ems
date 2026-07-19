import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { acUnitConfigFromAdapter } from "../config";
import { evaluateAcUnitFsm } from "./fsm";

describe("ac unit fsm", () => {
	const unit = acUnitConfigFromAdapter(
		{
			ac_u1_enabled: true,
			ac_u1_on_temp_c: 24.5,
			ac_u1_off_temp_c: 23,
			ac_u1_active_from: "08:00",
			ac_u1_active_until: "19:00",
			ac_u1_hard_off_at: "19:00",
		},
		1,
	);

	it("demands start when temp high and switch off", () => {
		const res = evaluateAcUnitFsm({
			now: new Date("2026-07-04T12:00:00"),
			addonEnabled: true,
			unit,
			roomTempC: 25,
			roomHumidityPct: 50,
			feedbackSwitchRaw: "off",
			cleaningActive: false,
		});
		assert.equal(res.demandStart, true);
		assert.equal(res.demandStop, false);
	});

	it("demands stop when temp low and switch on", () => {
		const res = evaluateAcUnitFsm({
			now: new Date("2026-07-04T12:00:00"),
			addonEnabled: true,
			unit,
			roomTempC: 22.5,
			roomHumidityPct: 50,
			feedbackSwitchRaw: "on",
			cleaningActive: false,
		});
		assert.equal(res.demandStart, false);
		assert.equal(res.demandStop, true);
	});

	it("still demands stop below off-temp when humidity is high", () => {
		const humidUnit = acUnitConfigFromAdapter(
			{
				ac_u1_enabled: true,
				ac_u1_on_temp_c: 26,
				ac_u1_off_temp_c: 24,
				ac_u1_max_humidity_pct: 60,
				ac_u1_active_from: "08:00",
				ac_u1_active_until: "19:00",
				ac_u1_hard_off_at: "19:00",
			},
			1,
		);
		const res = evaluateAcUnitFsm({
			now: new Date("2026-07-04T12:00:00"),
			addonEnabled: true,
			unit: humidUnit,
			roomTempC: 23,
			roomHumidityPct: 75,
			feedbackSwitchRaw: "on",
			cleaningActive: false,
		});
		assert.equal(res.demandStop, true);
		assert.equal(res.demandStart, false);
	});

	it("does not demand stop in hysteresis band while already on", () => {
		const res = evaluateAcUnitFsm({
			now: new Date("2026-07-04T12:00:00"),
			addonEnabled: true,
			unit,
			roomTempC: 23.5,
			roomHumidityPct: 50,
			feedbackSwitchRaw: "on",
			cleaningActive: false,
		});
		assert.equal(res.demandStop, false);
		assert.equal(res.demandStart, false);
		assert.match(res.reasonDe, /Hysterese/);
	});

	it("blocks start during cleaning", () => {
		const res = evaluateAcUnitFsm({
			now: new Date("2026-07-04T12:00:00"),
			addonEnabled: true,
			unit,
			roomTempC: 30,
			roomHumidityPct: 50,
			feedbackSwitchRaw: "off",
			cleaningActive: true,
		});
		assert.equal(res.state, "cleaning");
		assert.equal(res.demandStart, false);
	});
});
