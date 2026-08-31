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

	it("derselbe fortlaufende Mismatch während eines Overrides verlängert die Frist nicht", () => {
		const first = evaluateDeviceOwnership({
			nowMs: NOW,
			mismatchDetected: true,
			mismatchKind: "manual_on",
			previous: emptyDeviceOwnershipState(),
			overrideDurationMs: 30 * 60_000,
			safetyOverride: false,
		});
		let current = first;
		for (let i = 1; i <= 100; i++) {
			current = evaluateDeviceOwnership({
				nowMs: NOW + i * 5_000,
				mismatchDetected: true,
				mismatchKind: "manual_on",
				previous: current,
				overrideDurationMs: 30 * 60_000,
				safetyOverride: false,
			});
			assert.equal(current.overrideUntilIso, first.overrideUntilIso, `Tick ${i}: paused_until darf nicht wandern`);
			assert.equal(current.triggeredAtIso, first.triggeredAtIso);
			assert.equal(current.owner, "user");
		}
	});

	it("nach Ablauf startet unveränderter Mismatch keinen neuen Override", () => {
		const first = evaluateDeviceOwnership({
			nowMs: NOW,
			mismatchDetected: true,
			mismatchKind: "manual_on",
			previous: emptyDeviceOwnershipState(),
			overrideDurationMs: 30 * 60_000,
			safetyOverride: false,
		});
		const after = evaluateDeviceOwnership({
			nowMs: NOW + 31 * 60_000,
			mismatchDetected: true,
			mismatchKind: "manual_on",
			previous: first,
			overrideDurationMs: 30 * 60_000,
			safetyOverride: false,
		});
		assert.equal(after.owner, "ems");
		assert.equal(after.overrideUntilIso, null);
		assert.match(after.reasonDe, /abgelaufen/);

		const stillOn = evaluateDeviceOwnership({
			nowMs: NOW + 31 * 60_000 + 5_000,
			mismatchDetected: true,
			mismatchKind: "manual_on",
			previous: after,
			overrideDurationMs: 30 * 60_000,
			safetyOverride: false,
		});
		assert.equal(stillOn.owner, "ems");
		assert.equal(stillOn.overrideUntilIso, null);
	});

	it("Lücke im Mismatch während aktivem Override (ON→OFF→ON) darf einen neuen Override setzen", () => {
		const first = evaluateDeviceOwnership({
			nowMs: NOW,
			mismatchDetected: true,
			mismatchKind: "manual_on",
			previous: emptyDeviceOwnershipState(),
			overrideDurationMs: 30 * 60_000,
			safetyOverride: false,
		});
		const gap = evaluateDeviceOwnership({
			nowMs: NOW + 5 * 60_000,
			mismatchDetected: false,
			previous: first,
			overrideDurationMs: 30 * 60_000,
			safetyOverride: false,
		});
		assert.equal(gap.owner, "user");
		assert.equal(gap.lastMismatchKind, "");
		const renewed = evaluateDeviceOwnership({
			nowMs: NOW + 6 * 60_000,
			mismatchDetected: true,
			mismatchKind: "manual_on",
			previous: gap,
			overrideDurationMs: 30 * 60_000,
			safetyOverride: false,
		});
		assert.equal(renewed.owner, "user");
		assert.ok(Date.parse(renewed.overrideUntilIso!) > Date.parse(first.overrideUntilIso!));
		assert.equal(renewed.triggeredAtIso, new Date(NOW + 6 * 60_000).toISOString());
	});

	it("anderes Mismatch-Kind während aktivem Override (manual_on → manual_off) setzt neu", () => {
		const first = evaluateDeviceOwnership({
			nowMs: NOW,
			mismatchDetected: true,
			mismatchKind: "manual_on",
			previous: emptyDeviceOwnershipState(),
			overrideDurationMs: 30 * 60_000,
			safetyOverride: false,
		});
		const flipped = evaluateDeviceOwnership({
			nowMs: NOW + 5 * 60_000,
			mismatchDetected: true,
			mismatchKind: "manual_off",
			previous: first,
			overrideDurationMs: 30 * 60_000,
			safetyOverride: false,
		});
		assert.equal(flipped.owner, "user");
		assert.ok(Date.parse(flipped.overrideUntilIso!) > Date.parse(first.overrideUntilIso!));
		assert.equal(flipped.lastMismatchKind, "manual_off");
	});

	it("Alt-Persist ohne lastMismatchKind verlängert einen laufenden Override nicht", () => {
		const first = evaluateDeviceOwnership({
			nowMs: NOW,
			mismatchDetected: true,
			mismatchKind: "manual_on",
			previous: emptyDeviceOwnershipState(),
			overrideDurationMs: 30 * 60_000,
			safetyOverride: false,
		});
		const legacy = { ...first };
		delete legacy.lastMismatchKind;
		const held = evaluateDeviceOwnership({
			nowMs: NOW + 10 * 60_000,
			mismatchDetected: true,
			mismatchKind: "manual_on",
			previous: legacy,
			overrideDurationMs: 30 * 60_000,
			safetyOverride: false,
		});
		assert.equal(held.overrideUntilIso, first.overrideUntilIso);
		assert.equal(held.owner, "user");
	});

	it("nach Ablauf und verschwundenem Mismatch darf ein neues Event erneut starten", () => {
		const first = evaluateDeviceOwnership({
			nowMs: NOW,
			mismatchDetected: true,
			mismatchKind: "manual_on",
			previous: emptyDeviceOwnershipState(),
			overrideDurationMs: 30 * 60_000,
			safetyOverride: false,
		});
		const expired = evaluateDeviceOwnership({
			nowMs: NOW + 31 * 60_000,
			mismatchDetected: true,
			mismatchKind: "manual_on",
			previous: first,
			overrideDurationMs: 30 * 60_000,
			safetyOverride: false,
		});
		assert.equal(expired.owner, "ems");
		const cleared = evaluateDeviceOwnership({
			nowMs: NOW + 32 * 60_000,
			mismatchDetected: false,
			previous: expired,
			overrideDurationMs: 30 * 60_000,
			safetyOverride: false,
		});
		assert.equal(cleared.lastMismatchKind, "");
		const again = evaluateDeviceOwnership({
			nowMs: NOW + 33 * 60_000,
			mismatchDetected: true,
			mismatchKind: "manual_on",
			previous: cleared,
			overrideDurationMs: 30 * 60_000,
			safetyOverride: false,
		});
		assert.equal(again.owner, "user");
		assert.ok(again.overrideUntilIso);
	});
});
