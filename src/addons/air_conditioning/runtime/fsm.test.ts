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
		assert.equal(res.modePurpose, "cooling");
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

	it("keeps running dry below off-temp when humidity is high", () => {
		const res = evaluateAcUnitFsm({
			now: new Date("2026-07-04T12:00:00"),
			addonEnabled: true,
			unit: humidUnit,
			roomTempC: 23,
			roomHumidityPct: 75,
			feedbackSwitchRaw: "on",
			cleaningActive: false,
		});
		assert.equal(res.demandStop, false);
		assert.equal(res.demandStart, false);
		assert.equal(res.modePurpose, "dehumidify");
	});

	it("starts dry when humidity high even below off-temp", () => {
		const res = evaluateAcUnitFsm({
			now: new Date("2026-07-04T12:00:00"),
			addonEnabled: true,
			unit: humidUnit,
			roomTempC: 23,
			roomHumidityPct: 75,
			feedbackSwitchRaw: "off",
			cleaningActive: false,
		});
		assert.equal(res.demandStart, true);
		assert.equal(res.demandStop, false);
		assert.equal(res.modePurpose, "dehumidify");
		assert.match(res.reasonDe, /dry/);
	});

	it("prefers cool over dry when temp is at/above on-temp", () => {
		const res = evaluateAcUnitFsm({
			now: new Date("2026-07-04T12:00:00"),
			addonEnabled: true,
			unit: humidUnit,
			roomTempC: 27,
			roomHumidityPct: 75,
			feedbackSwitchRaw: "off",
			cleaningActive: false,
		});
		assert.equal(res.demandStart, true);
		assert.equal(res.modePurpose, "cooling");
		assert.match(res.reasonDe, /cool/);
	});

	it("switches purpose to cool while running when temp rises above on-temp", () => {
		const res = evaluateAcUnitFsm({
			now: new Date("2026-07-04T12:00:00"),
			addonEnabled: true,
			unit: humidUnit,
			roomTempC: 26.5,
			roomHumidityPct: 75,
			feedbackSwitchRaw: "on",
			cleaningActive: false,
		});
		assert.equal(res.demandStop, false);
		assert.equal(res.modePurpose, "cooling");
	});

	it("stops when humidity drops below configured hysteresis", () => {
		// Dry-only: with cool also enabled, cool hysteresis would keep running above off-temp.
		const dryOnly = acUnitConfigFromAdapter(
			{
				ac_u1_enabled: true,
				ac_u1_on_temp_c: 26,
				ac_u1_off_temp_c: 24,
				ac_u1_max_humidity_pct: 60,
				ac_u1_mode_when_cooling: "",
				ac_u1_active_from: "08:00",
				ac_u1_active_until: "19:00",
				ac_u1_hard_off_at: "19:00",
			},
			1,
		);
		const res = evaluateAcUnitFsm({
			now: new Date("2026-07-04T12:00:00"),
			addonEnabled: true,
			unit: dryOnly,
			roomTempC: 25,
			roomHumidityPct: 55,
			feedbackSwitchRaw: "on",
			cleaningActive: false,
		});
		assert.equal(res.demandStop, true);
		assert.match(res.reasonDe, /Entfeuchten fertig/);
	});

	it("uses unit humidity hysteresis for dry off", () => {
		const dryOnly = acUnitConfigFromAdapter(
			{
				ac_u1_enabled: true,
				ac_u1_on_temp_c: 26,
				ac_u1_off_temp_c: 24,
				ac_u1_max_humidity_pct: 60,
				ac_u1_mode_when_cooling: "",
				ac_u1_active_from: "08:00",
				ac_u1_active_until: "19:00",
				ac_u1_hard_off_at: "19:00",
			},
			1,
		);
		const custom = {
			...dryOnly,
			humidityOffHysteresisPct: 10,
		};
		const stillOn = evaluateAcUnitFsm({
			now: new Date("2026-07-04T12:00:00"),
			addonEnabled: true,
			unit: custom,
			roomTempC: 25,
			roomHumidityPct: 55,
			feedbackSwitchRaw: "on",
			cleaningActive: false,
		});
		assert.equal(stillOn.demandStop, false);
		const off = evaluateAcUnitFsm({
			now: new Date("2026-07-04T12:00:00"),
			addonEnabled: true,
			unit: custom,
			roomTempC: 25,
			roomHumidityPct: 50,
			feedbackSwitchRaw: "on",
			cleaningActive: false,
		});
		assert.equal(off.demandStop, true);
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

	it("keeps cooling through temp hysteresis even when dry humidity is already low", () => {
		const res = evaluateAcUnitFsm({
			now: new Date("2026-07-04T12:00:00"),
			addonEnabled: true,
			unit: humidUnit,
			roomTempC: 24.68,
			roomHumidityPct: 38.88,
			feedbackSwitchRaw: "on",
			cleaningActive: false,
		});
		assert.equal(res.demandStop, false);
		assert.equal(res.demandStart, false);
		assert.match(res.reasonDe, /Hysterese/);
	});

	it("does not start dry when mode_when_dehumidify is empty", () => {
		const noDry = acUnitConfigFromAdapter(
			{
				ac_u1_enabled: true,
				ac_u1_on_temp_c: 26,
				ac_u1_off_temp_c: 24,
				ac_u1_max_humidity_pct: 60,
				ac_u1_mode_when_dehumidify: "",
				ac_u1_active_from: "08:00",
				ac_u1_active_until: "19:00",
				ac_u1_hard_off_at: "19:00",
			},
			1,
		);
		const res = evaluateAcUnitFsm({
			now: new Date("2026-07-04T12:00:00"),
			addonEnabled: true,
			unit: noDry,
			roomTempC: 23,
			roomHumidityPct: 75,
			feedbackSwitchRaw: "off",
			cleaningActive: false,
		});
		assert.equal(res.demandStart, false);
		assert.equal(res.modePurpose, "cooling");
	});

	it("does not start cool when mode_when_cooling is empty", () => {
		const noCool = acUnitConfigFromAdapter(
			{
				ac_u1_enabled: true,
				ac_u1_on_temp_c: 26,
				ac_u1_off_temp_c: 24,
				ac_u1_mode_when_cooling: "",
				ac_u1_mode_when_dehumidify: "dry",
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
			unit: noCool,
			roomTempC: 28,
			roomHumidityPct: 40,
			feedbackSwitchRaw: "off",
			cleaningActive: false,
		});
		assert.equal(res.demandStart, false);
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
