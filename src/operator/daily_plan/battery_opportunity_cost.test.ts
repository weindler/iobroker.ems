import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
	BATTERY_OPPORTUNITY_MAX_CT,
	BATTERY_OPPORTUNITY_MIN_CT,
	evaluateBatteryOpportunityCost,
} from "./battery_opportunity_cost.js";

const NOW = Date.parse("2026-06-15T12:00:00.000Z");

function slot(hOffset: number, ct: number | null) {
	return { startMs: NOW + hOffset * 3600_000, importCtPerKwh: ct };
}

describe("Block B — battery opportunity cost", () => {
	it("keine spätere Preisinformation → usable=false, Fallback 0", () => {
		const r = evaluateBatteryOpportunityCost({
			nowMs: NOW,
			priceSlots: [],
			headroomAboveReserveKwh: 2,
			pvRemainingTodayKwh: 0,
			plannedLaterDemandKwh: 0,
		});
		assert.equal(r.usable, false);
		assert.equal(r.opportunityCostCtPerKwh, 0);
		assert.ok(r.reasonCodes.includes("battery_opportunity_no_later_price_known"));
	});

	it("hoher späterer Preis-Peak, aber KEIN bekannter späterer Bedarf → deutlich abgeschlagen", () => {
		const r = evaluateBatteryOpportunityCost({
			nowMs: NOW,
			priceSlots: [slot(1, 20), slot(2, 45), slot(3, 15)],
			headroomAboveReserveKwh: 2,
			pvRemainingTodayKwh: 0,
			plannedLaterDemandKwh: 0,
		});
		assert.equal(r.usable, true);
		assert.ok(r.opportunityCostCtPerKwh < 45, `sollte abgeschlagen sein, got ${r.opportunityCostCtPerKwh}`);
		assert.ok(r.reasonCodes.includes("battery_opportunity_no_known_later_demand"));
	});

	it("hoher späterer Preis-Peak MIT bekanntem späteren Bedarf → voller Wert (gebunden)", () => {
		const r = evaluateBatteryOpportunityCost({
			nowMs: NOW,
			priceSlots: [slot(1, 20), slot(2, 45), slot(3, 15)],
			headroomAboveReserveKwh: 2,
			pvRemainingTodayKwh: 0,
			plannedLaterDemandKwh: 1.5,
		});
		assert.equal(r.usable, true);
		assert.equal(r.opportunityCostCtPerKwh, 45);
		assert.ok(r.reasonCodes.includes("battery_opportunity_later_demand_or_pv_pending"));
	});

	it("Rest-PV allein reicht bereits, um vollen Wert anzusetzen (kein Demand-Discount)", () => {
		const r = evaluateBatteryOpportunityCost({
			nowMs: NOW,
			priceSlots: [slot(1, 30)],
			headroomAboveReserveKwh: 1,
			pvRemainingTodayKwh: 5,
			plannedLaterDemandKwh: 0,
		});
		assert.equal(r.opportunityCostCtPerKwh, 30);
	});

	it("Bound gegen Scheingenauigkeit — extremer Preis wird gekappt", () => {
		const r = evaluateBatteryOpportunityCost({
			nowMs: NOW,
			priceSlots: [slot(1, 500)],
			headroomAboveReserveKwh: 1,
			pvRemainingTodayKwh: 0,
			plannedLaterDemandKwh: 2,
		});
		assert.equal(r.opportunityCostCtPerKwh, BATTERY_OPPORTUNITY_MAX_CT);
	});

	it("nie negativ, auch bei negativen/degenerierten Eingaben", () => {
		const r = evaluateBatteryOpportunityCost({
			nowMs: NOW,
			priceSlots: [slot(1, -5)],
			headroomAboveReserveKwh: 1,
			pvRemainingTodayKwh: 0,
			plannedLaterDemandKwh: 0,
		});
		assert.ok(r.opportunityCostCtPerKwh >= BATTERY_OPPORTUNITY_MIN_CT);
	});

	it("nur vergangene Preis-Slots (startMs <= nowMs) zählen nicht als 'später'", () => {
		const r = evaluateBatteryOpportunityCost({
			nowMs: NOW,
			priceSlots: [{ startMs: NOW - 3600_000, importCtPerKwh: 99 }, { startMs: NOW, importCtPerKwh: 99 }],
			headroomAboveReserveKwh: 1,
			pvRemainingTodayKwh: 0,
			plannedLaterDemandKwh: 1,
		});
		assert.equal(r.usable, false);
	});

	it("headroom unbekannt wird als Reason-Code vermerkt, blockiert aber nicht die Bewertung", () => {
		const r = evaluateBatteryOpportunityCost({
			nowMs: NOW,
			priceSlots: [slot(1, 30)],
			headroomAboveReserveKwh: null,
			pvRemainingTodayKwh: 0,
			plannedLaterDemandKwh: 1,
		});
		assert.ok(r.reasonCodes.includes("battery_opportunity_headroom_unknown"));
		assert.equal(r.usable, true);
		assert.equal(r.headroomAboveReserveKwh, null);
	});
});
