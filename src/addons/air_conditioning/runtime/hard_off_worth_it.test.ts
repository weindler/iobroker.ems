import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
	coolingDemandUrgency01,
	dehumidifyDemandUrgency01,
	isHardOffStartWorthwhile,
	minutesUntilHardOff,
} from "./hard_off_worth_it.js";

describe("minutesUntilHardOff", () => {
	it("19:15 mit Hard-Off 20:00 → 45 Minuten", () => {
		assert.equal(minutesUntilHardOff(19 * 60 + 15, "20:00"), 45);
	});

	it("null bei ungültiger Hard-Off-Konfiguration", () => {
		assert.equal(minutesUntilHardOff(19 * 60, ""), null);
	});

	it("wickelt über Mitternacht, wenn Hard-Off morgens liegt", () => {
		assert.equal(minutesUntilHardOff(23 * 60, "01:00"), 120);
	});
});

describe("demand urgency", () => {
	it("0 an der Schwelle, 1 bei voller Referenzspanne drüber, dazwischen linear", () => {
		assert.equal(coolingDemandUrgency01(26, 26, 2), 0);
		assert.equal(coolingDemandUrgency01(27, 26, 2), 0.5);
		assert.equal(coolingDemandUrgency01(28, 26, 2), 1);
		assert.equal(coolingDemandUrgency01(30, 26, 2), 1); // geclamped
	});

	it("0 ohne Raumtemperatur (kein erfundener Wert)", () => {
		assert.equal(coolingDemandUrgency01(null, 26, 2), 0);
	});

	it("Feuchte analog", () => {
		assert.equal(dehumidifyDemandUrgency01(65, 60, 10), 0.5);
		assert.equal(dehumidifyDemandUrgency01(null, 60, 10), 0);
	});
});

describe("isHardOffStartWorthwhile — 19:15 bei Hard-Off 20:00 (45 Min Restzeit)", () => {
	it("geringer Komfortbedarf → kein unsinniger Start (Restzeit unter Mindestlaufzeit)", () => {
		const r = isHardOffStartWorthwhile({
			remainingMinutesUntilHardOff: 45,
			demandUrgency01: 0.1, // knapp über der Schwelle
			minWorthwhileRuntimeMin: 60,
		});
		assert.equal(r.worthwhile, false);
		assert.match(r.reasonDe, /Hard-Off in 45 Min/);
	});

	it("hoher Komfortbedarf → Start bleibt trotz kurzer Restzeit möglich", () => {
		const r = isHardOffStartWorthwhile({
			remainingMinutesUntilHardOff: 45,
			demandUrgency01: 0.9,
			minWorthwhileRuntimeMin: 60,
		});
		assert.equal(r.worthwhile, true);
		assert.ok(r.requiredMinutes <= 45);
	});

	it("keine starre Grenze — bei voller Dringlichkeit ist auch eine sehr kurze Restzeit noch ok", () => {
		const r = isHardOffStartWorthwhile({
			remainingMinutesUntilHardOff: 5,
			demandUrgency01: 1,
			minWorthwhileRuntimeMin: 60,
		});
		assert.equal(r.worthwhile, true);
		assert.equal(r.requiredMinutes, 0);
	});

	it("ohne Hard-Off-Konfiguration ist jeder Start wirtschaftlich", () => {
		const r = isHardOffStartWorthwhile({
			remainingMinutesUntilHardOff: null,
			demandUrgency01: 0,
		});
		assert.equal(r.worthwhile, true);
	});
});
