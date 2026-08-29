import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
	decideIntegrationGap,
	energyCounterDeltaPreciseKwh,
	integratePowerAcrossSlots,
	splitAmountAcrossSlots,
} from "./energy_integrate.js";
import { buildDaySlotLayout } from "./slots.js";
import { DAY_TELEMETRY_MAX_GAP_MS } from "./constants.js";
import { energyCounterDeltaKwh } from "../../statistics/compute.js";

describe("day_telemetry energy integrate", () => {
	const layout = buildDaySlotLayout("2026-06-15", "Europe/Berlin");
	const slot14 = layout.slots.find((s) => {
		const d = new Date(s.startMs);
		/* lokale Stunde via layout: Slot bei 14:00 */
		return s.index === 14 * 4;
	})!;

	it("4) Tick über Slotgrenze proportional geteilt (14:14:45–14:15:45)", () => {
		const fromMs = slot14.startMs + 14 * 60_000 + 45_000; /* 14:14:45 */
		const toMs = fromMs + 60_000; /* 14:15:45 */
		const shares = splitAmountAcrossSlots(layout, fromMs, toMs, 1.0);
		assert.equal(shares.length, 2);
		assert.ok(Math.abs(shares[0].energyKwh - 0.25) < 1e-9);
		assert.ok(Math.abs(shares[1].energyKwh - 0.75) < 1e-9);
		assert.equal(shares[0].slotIndex + 1, shares[1].slotIndex);
	});

	it("5) kleine Energie-Deltas gehen nicht verloren (anders als round3 early)", () => {
		const precise = energyCounterDeltaPreciseKwh(100.0, 100.0004);
		assert.ok(precise.deltaKwh != null && precise.deltaKwh > 0);
		assert.ok(precise.deltaKwh! > 0.0003);
		/* Bestehende Statistik-Funktion rundet früh — Nachweis der Differenz */
		const rounded = energyCounterDeltaKwh(100.0, 100.0004);
		assert.equal(rounded.deltaKwh, 0);
	});

	it("6) Counter Reset", () => {
		const d = energyCounterDeltaPreciseKwh(100.5, 0.1);
		assert.equal(d.deltaKwh, 0);
		assert.equal(d.reset, true);
		assert.equal(d.newBaseline, 0.1);
	});

	it("8) lange Datenlücke", () => {
		const prev = 1_000_000;
		const cur = prev + DAY_TELEMETRY_MAX_GAP_MS + 1;
		const g = decideIntegrationGap(prev, cur);
		assert.equal(g.kind, "gap_too_long");
	});

	it("Power-Integration über Grenze", () => {
		const fromMs = slot14.startMs + 14 * 60_000 + 45_000;
		const toMs = fromMs + 60_000;
		/* 60_000 W × (60/3600) h / 1000 = 1 kWh */
		const shares = integratePowerAcrossSlots(layout, fromMs, toMs, 60_000);
		const sum = shares.reduce((s, x) => s + x.energyKwh, 0);
		assert.ok(Math.abs(sum - 1) < 1e-9, `sum=${sum}`);
		assert.equal(shares.length, 2);
	});

	it("Restart: first sample kein Phantom", () => {
		const d = energyCounterDeltaPreciseKwh(null, 542.224);
		assert.equal(d.deltaKwh, 0);
		assert.equal(d.newBaseline, 542.224);
		const g = decideIntegrationGap(null, Date.now());
		assert.equal(g.kind, "first_sample");
	});
});
