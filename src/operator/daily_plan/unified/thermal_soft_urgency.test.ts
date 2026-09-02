import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { resolveThermalSoftUrgency } from "./thermal_soft_urgency.js";

const NOW = Date.parse("2026-09-01T10:00:00.000Z");

describe("resolveThermalSoftUrgency", () => {
	it("unbekannte Reichweite ändert Soft nicht (kein Skip)", () => {
		const u = resolveThermalSoftUrgency({ nowMs: NOW, emptyMs: null, nextReliablePvMs: NOW + 8 * 3600_000 });
		assert.equal(u.skipWeakSoftWindows, false);
		assert.equal(u.requireCoherentBlock, false);
		assert.equal(u.needScale, 0);
	});

	it("Overnight-Lücke bleibt dringlich", () => {
		const empty = NOW + 4 * 3600_000;
		const rec = NOW + 14 * 3600_000;
		const u = resolveThermalSoftUrgency({ nowMs: NOW, emptyMs: empty, nextReliablePvMs: rec });
		assert.ok(u.needScale > 0.9, `needScale=${u.needScale}`);
		assert.equal(u.skipWeakSoftWindows, false);
	});

	it("60 h Reichweite → keine Soft-Dringlichkeit, schwache Fenster weglassen", () => {
		const empty = NOW + 60 * 3600_000;
		const rec = NOW + 12 * 3600_000;
		const u = resolveThermalSoftUrgency({ nowMs: NOW, emptyMs: empty, nextReliablePvMs: rec });
		assert.equal(u.needScale, 0);
		assert.equal(u.skipWeakSoftWindows, true);
		assert.equal(u.requireCoherentBlock, true);
	});

	it("knapp über nächstem PV bleibt etwas Soft-Nutzen", () => {
		const empty = NOW + 10 * 3600_000;
		const rec = NOW + 8 * 3600_000;
		const u = resolveThermalSoftUrgency({ nowMs: NOW, emptyMs: empty, nextReliablePvMs: rec });
		assert.ok(u.needScale > 0.6, `needScale=${u.needScale}`);
		assert.equal(u.skipWeakSoftWindows, false);
	});
});
