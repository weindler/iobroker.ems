import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildDaySlotLayout } from "../day_telemetry/slots.js";
import { emptyDayRecord } from "../day_telemetry/types.js";
import { DOMAIN_QUALITY, TELEMETRY_DOMAIN, encodeDomainQuality } from "../day_telemetry/quality_mask.js";
import { evaluateAllDomainEligibility, evaluateDomainEligibility } from "./eligibility.js";
import { EVALUATOR_DOMAIN } from "./types.js";

function freshDay(dateKey = "2026-06-15", tz = "Europe/Berlin") {
	const layout = buildDaySlotLayout(dateKey, tz);
	return emptyDayRecord(dateKey, tz, layout.startMs, layout.endMs, layout.slotCount);
}

describe("daily_evaluator eligibility", () => {
	it("keine Evidenz für Domäne → not_applicable (nicht insufficient_data)", () => {
		const day = freshDay();
		const elig = evaluateDomainEligibility(day, EVALUATOR_DOMAIN.EV);
		assert.equal(elig.status, "not_applicable");
		assert.equal(elig.reasonCode, "no_evidence_of_domain");
	});

	it("EV: Snapshot wallboxConnected=true ohne connect-Event zählt als Evidenz (Mitternachts-Fall, Korrektur #7)", () => {
		const day = freshDay();
		day.forecastSnapshots.push({
			id: "s1",
			tsIso: "2026-06-15T00:05:00.000Z",
			date: "2026-06-15",
			timezone: "Europe/Berlin",
			globalMode: "balanced",
			contributionRevision: 1,
			pvExpectedDayKwh: null,
			houseLoadExpectedDayKwh: null,
			batterySocPct: null,
			batteryCapacityKwh: null,
			batteryNightReserveKwh: null,
			priceSlots: [],
			pvSlotKwh: [],
			wallboxRequiredEnergyKwh: null,
			wallboxDeadlineIso: null,
			wallboxConnected: true,
			wallboxPresenceDigest: null,
			thermalBufferTempC: null,
			thermalEmptyAtIso: null,
			thermalHeadroomKwh: null,
			climateUnits: [],
			wallboxTargetSocPct: null,
			wallboxMinimumDepartureSocPct: null,
			wallboxEnergyGoalHard: null,
			wallboxManagementMode: null,
			batteryDecision: null,
		});
		/* Kein ev_connected-Event heute (Verbindung bestand schon vor Mitternacht) */
		const elig = evaluateDomainEligibility(day, EVALUATOR_DOMAIN.EV);
		assert.notEqual(elig.status, "not_applicable");
	});

	it("EV: nur connect-Event ohne Snapshot/Energie zählt ebenfalls als Evidenz", () => {
		const day = freshDay();
		day.statusEvents.push({ tsIso: "2026-06-15T10:00:00.000Z", kind: "ev_connected", detail: "" });
		const elig = evaluateDomainEligibility(day, EVALUATOR_DOMAIN.EV);
		assert.notEqual(elig.status, "not_applicable");
	});

	it("Evidenz vorhanden + hohe Coverage → evaluable", () => {
		const day = freshDay();
		day.statusEvents.push({ tsIso: "2026-06-15T10:00:00.000Z", kind: "ev_connected", detail: "" });
		for (let i = 0; i < day.slotCount; i++) {
			day.buckets.evChargedKwh[i] = 0.05;
			day.buckets.qualityMask[i] = encodeDomainQuality(0, TELEMETRY_DOMAIN.EV, DOMAIN_QUALITY.ok);
		}
		const elig = evaluateDomainEligibility(day, EVALUATOR_DOMAIN.EV);
		assert.equal(elig.status, "evaluable");
		assert.ok(elig.coveragePct >= 80);
	});

	it("Evidenz vorhanden + niedrige Coverage → insufficient_data", () => {
		const day = freshDay();
		day.statusEvents.push({ tsIso: "2026-06-15T10:00:00.000Z", kind: "ev_connected", detail: "" });
		/* nur 5 von vielen Slots ok, Rest bleibt unobserved (null) */
		for (let i = 0; i < 5; i++) {
			day.buckets.qualityMask[i] = encodeDomainQuality(0, TELEMETRY_DOMAIN.EV, DOMAIN_QUALITY.ok);
		}
		const elig = evaluateDomainEligibility(day, EVALUATOR_DOMAIN.EV);
		assert.equal(elig.status, "insufficient_data");
	});

	it("Battery/Thermal/Climate: gleiche Evidenz-Logik unabhängig prüfbar", () => {
		const day = freshDay();
		day.buckets.batterySocEndPct[10] = 55;
		const elig = evaluateDomainEligibility(day, EVALUATOR_DOMAIN.BATTERY);
		assert.notEqual(elig.status, "not_applicable");

		const climateElig = evaluateDomainEligibility(day, EVALUATOR_DOMAIN.CLIMATE);
		assert.equal(climateElig.status, "not_applicable");
	});

	it("evaluateAllDomainEligibility liefert genau 4 Domänen", () => {
		const day = freshDay();
		const all = evaluateAllDomainEligibility(day);
		assert.equal(all.length, 4);
		const domains = all.map((e) => e.domain).sort();
		assert.deepEqual(domains, ["battery", "climate", "ev", "thermal"]);
	});

	it("DST-Tage (92/100 Slots) — totalSlotCount folgt dem jeweiligen Tag", () => {
		const dstSpring = freshDay("2026-03-29", "Europe/Berlin");
		const eligSpring = evaluateDomainEligibility(dstSpring, EVALUATOR_DOMAIN.BATTERY);
		assert.equal(eligSpring.totalSlotCount, 92);

		const dstAutumn = freshDay("2026-10-25", "Europe/Berlin");
		const eligAutumn = evaluateDomainEligibility(dstAutumn, EVALUATOR_DOMAIN.BATTERY);
		assert.equal(eligAutumn.totalSlotCount, 100);
	});
});
