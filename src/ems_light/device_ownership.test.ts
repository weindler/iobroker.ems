import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
	emptyDeviceOwnershipState,
	evaluateDeviceOwnership,
	isOwnershipOverrideActive,
} from "./device_ownership.js";

const NOW = Date.parse("2026-08-28T19:15:00.000Z");

describe("generic device ownership / manual override", () => {
	it("stays EMS-owned when no mismatch is detected", () => {
		const r = evaluateDeviceOwnership({
			nowMs: NOW,
			mismatchDetected: false,
			previous: emptyDeviceOwnershipState(),
			overrideDurationMs: 30 * 60_000,
			safetyOverride: false,
		});
		assert.equal(r.owner, "ems");
		assert.equal(r.overrideUntilIso, null);
	});

	it("manuelles Einschalten Klima → EMS schaltet nicht sofort wieder aus (Override aktiv)", () => {
		const r = evaluateDeviceOwnership({
			nowMs: NOW,
			mismatchDetected: true,
			mismatchKind: "manual_on",
			previous: emptyDeviceOwnershipState(),
			overrideDurationMs: 30 * 60_000,
			safetyOverride: false,
		});
		assert.equal(r.owner, "user");
		assert.ok(isOwnershipOverrideActive(r, NOW));
		assert.ok(isOwnershipOverrideActive(r, NOW + 29 * 60_000));
		assert.ok(!isOwnershipOverrideActive(r, NOW + 31 * 60_000));
		assert.match(r.reasonDe, /Manuelles Einschalten/);
	});

	it("manuelles Ausschalten Klima → EMS schaltet nicht sofort wieder ein (Override aktiv)", () => {
		const r = evaluateDeviceOwnership({
			nowMs: NOW,
			mismatchDetected: true,
			mismatchKind: "manual_off",
			previous: emptyDeviceOwnershipState(),
			overrideDurationMs: 30 * 60_000,
			safetyOverride: false,
		});
		assert.equal(r.owner, "user");
		assert.match(r.reasonDe, /Manuelles Ausschalten/);
	});

	it("hält den Override über mehrere Ticks, ohne dass der Mismatch erneut erkannt werden muss", () => {
		const first = evaluateDeviceOwnership({
			nowMs: NOW,
			mismatchDetected: true,
			mismatchKind: "manual_on",
			previous: emptyDeviceOwnershipState(),
			overrideDurationMs: 30 * 60_000,
			safetyOverride: false,
		});
		const second = evaluateDeviceOwnership({
			nowMs: NOW + 5 * 60_000,
			mismatchDetected: false, // Mismatch nicht mehr aktiv erkannt (z. B. weil EMS-Wunsch inzwischen gleich ist)
			previous: first,
			overrideDurationMs: 30 * 60_000,
			safetyOverride: false,
		});
		assert.equal(second.owner, "user");
		assert.equal(second.overrideUntilIso, first.overrideUntilIso);
		assert.equal(second.triggeredAtIso, first.triggeredAtIso);
	});

	it("kehrt nach Ablauf der Override-Dauer automatisch zu EMS zurück", () => {
		const first = evaluateDeviceOwnership({
			nowMs: NOW,
			mismatchDetected: true,
			mismatchKind: "manual_on",
			previous: emptyDeviceOwnershipState(),
			overrideDurationMs: 30 * 60_000,
			safetyOverride: false,
		});
		const later = evaluateDeviceOwnership({
			nowMs: NOW + 31 * 60_000,
			mismatchDetected: false,
			previous: first,
			overrideDurationMs: 30 * 60_000,
			safetyOverride: false,
		});
		assert.equal(later.owner, "ems");
		assert.equal(later.overrideUntilIso, null);
	});

	it("Safety/kritischer Zustand übersteuert einen aktiven Manual Override sofort", () => {
		const first = evaluateDeviceOwnership({
			nowMs: NOW,
			mismatchDetected: true,
			mismatchKind: "manual_on",
			previous: emptyDeviceOwnershipState(),
			overrideDurationMs: 30 * 60_000,
			safetyOverride: false,
		});
		assert.equal(first.owner, "user");
		const overridden = evaluateDeviceOwnership({
			nowMs: NOW + 60_000,
			mismatchDetected: true,
			mismatchKind: "manual_on",
			previous: first,
			overrideDurationMs: 30 * 60_000,
			safetyOverride: true,
		});
		assert.equal(overridden.owner, "ems");
		assert.equal(overridden.overrideUntilIso, null);
		assert.match(overridden.reasonDe, /Safety/);
	});

	it("ein neuer Mismatch während eines laufenden Overrides verlängert die Frist, behält aber triggeredAt", () => {
		const first = evaluateDeviceOwnership({
			nowMs: NOW,
			mismatchDetected: true,
			mismatchKind: "manual_on",
			previous: emptyDeviceOwnershipState(),
			overrideDurationMs: 30 * 60_000,
			safetyOverride: false,
		});
		const renewed = evaluateDeviceOwnership({
			nowMs: NOW + 10 * 60_000,
			mismatchDetected: true,
			mismatchKind: "manual_on",
			previous: first,
			overrideDurationMs: 30 * 60_000,
			safetyOverride: false,
		});
		assert.ok(Date.parse(renewed.overrideUntilIso!) > Date.parse(first.overrideUntilIso!));
		assert.equal(renewed.triggeredAtIso, first.triggeredAtIso);
	});
});
