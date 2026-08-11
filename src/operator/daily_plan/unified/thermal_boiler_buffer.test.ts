/**
 * Boiler/Puffer Separation — T1–T15 + Realfall + Invarianten.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { resolveThermalPlannerEnergy } from "./next_reliable_pv";
import { bufferSoftHeadroomKwh, resolveBoilerBufferThermalEnergy } from "./thermal_boiler_buffer";
import { evaluateHygieneDuty, recordBoilerHygieneIfMet } from "../../../addons/immersion_heater/hygiene";
import { buildImmersionHeaterContributions } from "../../contributions/flexible/immersion_heater";
import { immersionDeviceConfigFromAdapter } from "../../../addons/immersion_heater/device_config";
import { plannerModePolicyFromGlobalMode } from "../../../planner/mode_policy";

const NOW = Date.parse("2026-08-11T10:00:00.000Z");
const COVER = Date.parse("2026-08-11T16:00:00.000Z");
const NEXT_PV = Date.parse("2026-08-12T06:00:00.000Z");

function bridge(over: Partial<Parameters<typeof resolveThermalPlannerEnergy>[0]> = {}) {
	return resolveThermalPlannerEnergy({
		nowMs: NOW,
		bufferTempC: 50,
		minTempC: 50,
		boilerTempC: 58,
		boilerMinTempC: 50,
		bufferMaxTempC: 63,
		headroomEnergyKwh: 4.94, // ~13 K * 0.38
		coolingRateCPerH: null,
		estimatedEmptyAtMs: null,
		boilerEmptyAtUsable: false,
		boilerSensorDegraded: false,
		hygieneMandatoryKwh: 0,
		nextReliablePvMs: NEXT_PV,
		currentWindowEndMs: COVER,
		pvConfidence01: 0.85,
		...over,
	});
}

function immersionCfg() {
	return immersionDeviceConfigFromAdapter({
		ih_boiler_min_temp_c: 50,
		ih_planning_max_temp_c: 63,
		ih_hygiene_target_temp_c: 60,
		ih_stage_1_set_state: "r.0.on",
		ih_stage_1_nominal_power_w: 1700,
	});
}

describe("boiler/puffer separation — Realfall + T1–T15", () => {
	it("Realfall / T1: Boiler 58 / Puffer 50 → Hard≈0, Soft>0, kein Buffer-Hard", () => {
		const r = bridge();
		assert.ok(r.mandatoryEnergyKwh < 0.05, `hard=${r.mandatoryEnergyKwh}`);
		assert.ok(r.economicHeadroomKwh > 1, `soft=${r.economicHeadroomKwh}`);
		assert.match(r.reasonDe, /Soft aus Puffer|Boiler über Min/i);
	});

	it("T2: Boiler 49 / Puffer 55 → Hard Warmwasser trotz warmem Puffer", () => {
		const r = bridge({ boilerTempC: 49, bufferTempC: 55, headroomEnergyKwh: 3 });
		assert.ok(r.mandatoryEnergyKwh > 0.3, `hard=${r.mandatoryEnergyKwh}`);
	});

	it("T3: Boiler 52 / Puffer 63 → Soft 0", () => {
		const soft = bufferSoftHeadroomKwh({ bufferTempC: 63, bufferMaxTempC: 63 });
		assert.equal(soft, 0);
		const r = bridge({ boilerTempC: 52, bufferTempC: 63, headroomEnergyKwh: 0, bufferMaxTempC: 63 });
		assert.ok(r.economicHeadroomKwh < 0.05);
		assert.ok(r.mandatoryEnergyKwh < 0.05);
	});

	it("T4: Boiler 48 / Puffer 63 → Hard erkannt, Soft 0 (Max blockiert Laden)", () => {
		const r = bridge({ boilerTempC: 48, bufferTempC: 63, headroomEnergyKwh: 0, bufferMaxTempC: 63 });
		assert.ok(r.mandatoryEnergyKwh > 0.5);
		assert.ok(r.economicHeadroomKwh < 0.05);
		const hy = evaluateHygieneDuty({
			nowMs: NOW,
			boilerTempC: 48,
			hygieneTargetTempC: 60,
			bufferTempC: 63,
			bufferMaxTempC: 63,
			lastBoilerHygieneAtIso: null,
			kwhPerDegreeC: 0.38,
		});
		assert.equal(hy.blockedByBufferMax, true);
		assert.equal(hy.mandatoryEnergyKwh, 0);
	});

	it("T5: Boiler-Learning degraded → keine Fake-emptyAt-Deadline", () => {
		const r = bridge({
			boilerTempC: 58,
			coolingRateCPerH: 0.8,
			estimatedEmptyAtMs: Date.parse("2026-08-11T18:00:00.000Z"),
			boilerEmptyAtUsable: false,
		});
		assert.ok(r.mandatoryEnergyKwh < 0.05);
	});

	it("T6: Boiler-Learning valid + emptyAt vor Cover → Hard möglich", () => {
		const r = resolveBoilerBufferThermalEnergy({
			nowMs: NOW,
			boilerTempC: 51,
			boilerMinTempC: 50,
			bufferTempC: 55,
			bufferMaxTempC: 63,
			softHeadroomEnergyKwh: 2,
			boilerCoolingRateCPerH: 0.6,
			boilerEstimatedEmptyAtMs: Date.parse("2026-08-11T14:00:00.000Z"),
			boilerEmptyAtUsable: true,
			nextReliablePvMs: NEXT_PV,
			currentWindowEndMs: COVER,
			pvConfidence01: 0.85,
		});
		assert.ok(r.mandatoryEnergyKwh > 0.1 || r.coversUntilNextPv === false || r.hardFromBoiler);
	});

	it("T7: Buffer-emptyAt darf keine Hard-Deadline erzeugen (I4)", () => {
		const r = bridge({
			boilerTempC: 58,
			/** Wenn fälschlich Buffer-emptyAt durchgereicht würde — usable=false blockt. */
			estimatedEmptyAtMs: Date.parse("2026-08-11T18:00:00.000Z"),
			boilerEmptyAtUsable: false,
			coolingRateCPerH: 1.2,
		});
		assert.ok(r.mandatoryEnergyKwh < 0.05);
	});

	it("T8: Soft-Headroom bei gutem PV-Tag messbar", () => {
		const soft = bufferSoftHeadroomKwh({ bufferTempC: 50, bufferMaxTempC: 63, softTargetTempC: 62 });
		assert.ok(soft > 3);
	});

	it("T9: Boiler warm → Contribution mandatory nicht wegen Puffer", () => {
		const [mand] = buildImmersionHeaterContributions({
			now: new Date(NOW),
			addonEnabled: true,
			governanceEnabled: true,
			globalModeOff: false,
			addonExecutionOff: false,
			modePolicy: plannerModePolicyFromGlobalMode("balanced"),
			config: immersionCfg(),
			bufferTempC: 50,
			boilerTempC: 58,
			boilerSensorDegraded: false,
			thermalMode: "auto",
			fault: false,
			lockout: false,
			relayMapped: true,
			pvTodayKwh: 40,
			pvTomorrowKwh: 20,
			pvBiasStatus: "ready",
			forecastModeEnabled: true,
			aiOptimizationAllowed: false,
			thermalLearning: {
				status: "valid",
				health: "ok",
				samples: 10,
				coolingRateCPerHAvg: 1.2,
				coolingConstantPerH: null,
				coolingAsymptoteC: null,
				estimatedRemainingHours: 8,
				estimatedEmptyAt: "2026-08-11T18:00:00.000Z",
				currentDayTypeRuntimeHoursMedian: null,
				reasonDe: "Puffer learning",
			},
			boilerLearning: {
				status: "missing",
				health: null,
				samples: 0,
				coolingRateCPerHAvg: null,
				coolingConstantPerH: null,
				coolingAsymptoteC: null,
				estimatedRemainingHours: null,
				estimatedEmptyAt: null,
				currentDayTypeRuntimeHoursMedian: null,
				reasonDe: "lernt",
			},
			hygieneDue: false,
		});
		assert.equal(mand.enabled, false);
		assert.match(mand.reasonDe, /Kein Pflichtbedarf/i);
	});

	it("T10: Hygiene innerhalb 7 Tage → kein Hygiene-Hard", () => {
		const hy = evaluateHygieneDuty({
			nowMs: NOW,
			boilerTempC: 55,
			hygieneTargetTempC: 60,
			bufferTempC: 50,
			bufferMaxTempC: 63,
			lastBoilerHygieneAtIso: new Date(NOW - 2 * 24 * 3600_000).toISOString(),
			kwhPerDegreeC: 0.38,
		});
		assert.equal(hy.due, false);
		assert.equal(hy.mandatoryEnergyKwh, 0);
	});

	it("T11: Hygiene-Deadline fällig → Hard", () => {
		const hy = evaluateHygieneDuty({
			nowMs: NOW,
			boilerTempC: 55,
			hygieneTargetTempC: 60,
			bufferTempC: 50,
			bufferMaxTempC: 63,
			lastBoilerHygieneAtIso: new Date(NOW - 8 * 24 * 3600_000).toISOString(),
			kwhPerDegreeC: 0.38,
		});
		assert.equal(hy.due, true);
		assert.ok(hy.mandatoryEnergyKwh > 0);
	});

	it("T12: Boiler >60 → Hygiene erfüllt", () => {
		const p = recordBoilerHygieneIfMet({
			boilerTempC: 61,
			hygieneTargetTempC: 60,
			nowIso: new Date(NOW).toISOString(),
			persist: { lastBoilerHygieneAtIso: null },
		});
		assert.ok(p.lastBoilerHygieneAtIso);
		const hy = evaluateHygieneDuty({
			nowMs: NOW + 1000,
			boilerTempC: 61,
			hygieneTargetTempC: 60,
			bufferTempC: 50,
			bufferMaxTempC: 63,
			lastBoilerHygieneAtIso: p.lastBoilerHygieneAtIso,
			kwhPerDegreeC: 0.38,
		});
		assert.equal(hy.due, false);
	});

	it("T13: Hygiene fällig + Puffer Max → keine Überschreitung", () => {
		const hy = evaluateHygieneDuty({
			nowMs: NOW,
			boilerTempC: 55,
			hygieneTargetTempC: 60,
			bufferTempC: 63,
			bufferMaxTempC: 63,
			lastBoilerHygieneAtIso: null,
			kwhPerDegreeC: 0.38,
		});
		assert.equal(hy.blockedByBufferMax, true);
		assert.equal(hy.mandatoryEnergyKwh, 0);
	});

	it("T14: Boiler-Sensor stale → kein Buffer-Hard-Pfad", () => {
		const r = bridge({ boilerTempC: null, boilerSensorDegraded: true, bufferTempC: 45 });
		assert.ok(r.mandatoryEnergyKwh < 0.05 || r.reasonDe.includes("Boiler"));
		assert.match(r.reasonDe, /kein Buffer-Hard|fehlt/i);
	});

	it("T15: Puffer-Max = Safety-Cap für Soft", () => {
		assert.equal(bufferSoftHeadroomKwh({ bufferTempC: 63, bufferMaxTempC: 63 }), 0);
		assert.ok(bufferSoftHeadroomKwh({ bufferTempC: 50, bufferMaxTempC: 63 }) > 0);
	});
});

describe("boiler/puffer invariants", () => {
	it("I1: Boiler warm => kein Hard nur wegen kaltem Puffer", () => {
		const r = bridge({ boilerTempC: 58, bufferTempC: 44, headroomEnergyKwh: 5 });
		assert.ok(r.mandatoryEnergyKwh < 0.05);
	});

	it("I4: Buffer-emptyAt never becomes hard when boilerEmptyAtUsable=false", () => {
		const r = bridge({
			estimatedEmptyAtMs: Date.parse("2026-08-11T20:00:00.000Z"),
			boilerEmptyAtUsable: false,
			coolingRateCPerH: 2,
			boilerTempC: 58,
		});
		assert.ok(r.mandatoryEnergyKwh < 0.05);
	});
});
