"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const strict_1 = __importDefault(require("node:assert/strict"));
const device_ownership_js_1 = require("./device_ownership.js");
const NOW = Date.parse("2026-08-28T19:15:00.000Z");
(0, node_test_1.describe)("generic device ownership / manual override", () => {
    (0, node_test_1.it)("stays EMS-owned when no mismatch is detected", () => {
        const r = (0, device_ownership_js_1.evaluateDeviceOwnership)({
            nowMs: NOW,
            mismatchDetected: false,
            previous: (0, device_ownership_js_1.emptyDeviceOwnershipState)(),
            overrideDurationMs: 30 * 60_000,
            safetyOverride: false,
        });
        strict_1.default.equal(r.owner, "ems");
        strict_1.default.equal(r.overrideUntilIso, null);
    });
    (0, node_test_1.it)("manuelles Einschalten Klima → EMS schaltet nicht sofort wieder aus (Override aktiv)", () => {
        const r = (0, device_ownership_js_1.evaluateDeviceOwnership)({
            nowMs: NOW,
            mismatchDetected: true,
            mismatchKind: "manual_on",
            previous: (0, device_ownership_js_1.emptyDeviceOwnershipState)(),
            overrideDurationMs: 30 * 60_000,
            safetyOverride: false,
        });
        strict_1.default.equal(r.owner, "user");
        strict_1.default.ok((0, device_ownership_js_1.isOwnershipOverrideActive)(r, NOW));
        strict_1.default.ok((0, device_ownership_js_1.isOwnershipOverrideActive)(r, NOW + 29 * 60_000));
        strict_1.default.ok(!(0, device_ownership_js_1.isOwnershipOverrideActive)(r, NOW + 31 * 60_000));
        strict_1.default.match(r.reasonDe, /Manuelles Einschalten/);
    });
    (0, node_test_1.it)("manuelles Ausschalten Klima → EMS schaltet nicht sofort wieder ein (Override aktiv)", () => {
        const r = (0, device_ownership_js_1.evaluateDeviceOwnership)({
            nowMs: NOW,
            mismatchDetected: true,
            mismatchKind: "manual_off",
            previous: (0, device_ownership_js_1.emptyDeviceOwnershipState)(),
            overrideDurationMs: 30 * 60_000,
            safetyOverride: false,
        });
        strict_1.default.equal(r.owner, "user");
        strict_1.default.match(r.reasonDe, /Manuelles Ausschalten/);
    });
    (0, node_test_1.it)("hält den Override über mehrere Ticks, ohne dass der Mismatch erneut erkannt werden muss", () => {
        const first = (0, device_ownership_js_1.evaluateDeviceOwnership)({
            nowMs: NOW,
            mismatchDetected: true,
            mismatchKind: "manual_on",
            previous: (0, device_ownership_js_1.emptyDeviceOwnershipState)(),
            overrideDurationMs: 30 * 60_000,
            safetyOverride: false,
        });
        const second = (0, device_ownership_js_1.evaluateDeviceOwnership)({
            nowMs: NOW + 5 * 60_000,
            mismatchDetected: false, // Mismatch nicht mehr aktiv erkannt (z. B. weil EMS-Wunsch inzwischen gleich ist)
            previous: first,
            overrideDurationMs: 30 * 60_000,
            safetyOverride: false,
        });
        strict_1.default.equal(second.owner, "user");
        strict_1.default.equal(second.overrideUntilIso, first.overrideUntilIso);
        strict_1.default.equal(second.triggeredAtIso, first.triggeredAtIso);
    });
    (0, node_test_1.it)("kehrt nach Ablauf der Override-Dauer automatisch zu EMS zurück", () => {
        const first = (0, device_ownership_js_1.evaluateDeviceOwnership)({
            nowMs: NOW,
            mismatchDetected: true,
            mismatchKind: "manual_on",
            previous: (0, device_ownership_js_1.emptyDeviceOwnershipState)(),
            overrideDurationMs: 30 * 60_000,
            safetyOverride: false,
        });
        const later = (0, device_ownership_js_1.evaluateDeviceOwnership)({
            nowMs: NOW + 31 * 60_000,
            mismatchDetected: false,
            previous: first,
            overrideDurationMs: 30 * 60_000,
            safetyOverride: false,
        });
        strict_1.default.equal(later.owner, "ems");
        strict_1.default.equal(later.overrideUntilIso, null);
    });
    (0, node_test_1.it)("Safety/kritischer Zustand übersteuert einen aktiven Manual Override sofort", () => {
        const first = (0, device_ownership_js_1.evaluateDeviceOwnership)({
            nowMs: NOW,
            mismatchDetected: true,
            mismatchKind: "manual_on",
            previous: (0, device_ownership_js_1.emptyDeviceOwnershipState)(),
            overrideDurationMs: 30 * 60_000,
            safetyOverride: false,
        });
        strict_1.default.equal(first.owner, "user");
        const overridden = (0, device_ownership_js_1.evaluateDeviceOwnership)({
            nowMs: NOW + 60_000,
            mismatchDetected: true,
            mismatchKind: "manual_on",
            previous: first,
            overrideDurationMs: 30 * 60_000,
            safetyOverride: true,
        });
        strict_1.default.equal(overridden.owner, "ems");
        strict_1.default.equal(overridden.overrideUntilIso, null);
        strict_1.default.match(overridden.reasonDe, /Safety/);
    });
    (0, node_test_1.it)("derselbe fortlaufende Mismatch während eines Overrides verlängert die Frist nicht", () => {
        const first = (0, device_ownership_js_1.evaluateDeviceOwnership)({
            nowMs: NOW,
            mismatchDetected: true,
            mismatchKind: "manual_on",
            previous: (0, device_ownership_js_1.emptyDeviceOwnershipState)(),
            overrideDurationMs: 30 * 60_000,
            safetyOverride: false,
        });
        let current = first;
        for (let i = 1; i <= 100; i++) {
            current = (0, device_ownership_js_1.evaluateDeviceOwnership)({
                nowMs: NOW + i * 5_000,
                mismatchDetected: true,
                mismatchKind: "manual_on",
                previous: current,
                overrideDurationMs: 30 * 60_000,
                safetyOverride: false,
            });
            strict_1.default.equal(current.overrideUntilIso, first.overrideUntilIso, `Tick ${i}: paused_until darf nicht wandern`);
            strict_1.default.equal(current.triggeredAtIso, first.triggeredAtIso);
            strict_1.default.equal(current.owner, "user");
        }
    });
    (0, node_test_1.it)("nach Ablauf startet unveränderter Mismatch keinen neuen Override", () => {
        const first = (0, device_ownership_js_1.evaluateDeviceOwnership)({
            nowMs: NOW,
            mismatchDetected: true,
            mismatchKind: "manual_on",
            previous: (0, device_ownership_js_1.emptyDeviceOwnershipState)(),
            overrideDurationMs: 30 * 60_000,
            safetyOverride: false,
        });
        const after = (0, device_ownership_js_1.evaluateDeviceOwnership)({
            nowMs: NOW + 31 * 60_000,
            mismatchDetected: true,
            mismatchKind: "manual_on",
            previous: first,
            overrideDurationMs: 30 * 60_000,
            safetyOverride: false,
        });
        strict_1.default.equal(after.owner, "ems");
        strict_1.default.equal(after.overrideUntilIso, null);
        strict_1.default.match(after.reasonDe, /abgelaufen/);
        const stillOn = (0, device_ownership_js_1.evaluateDeviceOwnership)({
            nowMs: NOW + 31 * 60_000 + 5_000,
            mismatchDetected: true,
            mismatchKind: "manual_on",
            previous: after,
            overrideDurationMs: 30 * 60_000,
            safetyOverride: false,
        });
        strict_1.default.equal(stillOn.owner, "ems");
        strict_1.default.equal(stillOn.overrideUntilIso, null);
    });
    (0, node_test_1.it)("Lücke im Mismatch während aktivem Override (ON→OFF→ON) darf einen neuen Override setzen", () => {
        const first = (0, device_ownership_js_1.evaluateDeviceOwnership)({
            nowMs: NOW,
            mismatchDetected: true,
            mismatchKind: "manual_on",
            previous: (0, device_ownership_js_1.emptyDeviceOwnershipState)(),
            overrideDurationMs: 30 * 60_000,
            safetyOverride: false,
        });
        const gap = (0, device_ownership_js_1.evaluateDeviceOwnership)({
            nowMs: NOW + 5 * 60_000,
            mismatchDetected: false,
            previous: first,
            overrideDurationMs: 30 * 60_000,
            safetyOverride: false,
        });
        strict_1.default.equal(gap.owner, "user");
        strict_1.default.equal(gap.lastMismatchKind, "");
        const renewed = (0, device_ownership_js_1.evaluateDeviceOwnership)({
            nowMs: NOW + 6 * 60_000,
            mismatchDetected: true,
            mismatchKind: "manual_on",
            previous: gap,
            overrideDurationMs: 30 * 60_000,
            safetyOverride: false,
        });
        strict_1.default.equal(renewed.owner, "user");
        strict_1.default.ok(Date.parse(renewed.overrideUntilIso) > Date.parse(first.overrideUntilIso));
        strict_1.default.equal(renewed.triggeredAtIso, new Date(NOW + 6 * 60_000).toISOString());
    });
    (0, node_test_1.it)("anderes Mismatch-Kind während aktivem Override (manual_on → manual_off) setzt neu", () => {
        const first = (0, device_ownership_js_1.evaluateDeviceOwnership)({
            nowMs: NOW,
            mismatchDetected: true,
            mismatchKind: "manual_on",
            previous: (0, device_ownership_js_1.emptyDeviceOwnershipState)(),
            overrideDurationMs: 30 * 60_000,
            safetyOverride: false,
        });
        const flipped = (0, device_ownership_js_1.evaluateDeviceOwnership)({
            nowMs: NOW + 5 * 60_000,
            mismatchDetected: true,
            mismatchKind: "manual_off",
            previous: first,
            overrideDurationMs: 30 * 60_000,
            safetyOverride: false,
        });
        strict_1.default.equal(flipped.owner, "user");
        strict_1.default.ok(Date.parse(flipped.overrideUntilIso) > Date.parse(first.overrideUntilIso));
        strict_1.default.equal(flipped.lastMismatchKind, "manual_off");
    });
    (0, node_test_1.it)("Alt-Persist ohne lastMismatchKind verlängert einen laufenden Override nicht", () => {
        const first = (0, device_ownership_js_1.evaluateDeviceOwnership)({
            nowMs: NOW,
            mismatchDetected: true,
            mismatchKind: "manual_on",
            previous: (0, device_ownership_js_1.emptyDeviceOwnershipState)(),
            overrideDurationMs: 30 * 60_000,
            safetyOverride: false,
        });
        const legacy = { ...first };
        delete legacy.lastMismatchKind;
        const held = (0, device_ownership_js_1.evaluateDeviceOwnership)({
            nowMs: NOW + 10 * 60_000,
            mismatchDetected: true,
            mismatchKind: "manual_on",
            previous: legacy,
            overrideDurationMs: 30 * 60_000,
            safetyOverride: false,
        });
        strict_1.default.equal(held.overrideUntilIso, first.overrideUntilIso);
        strict_1.default.equal(held.owner, "user");
    });
    (0, node_test_1.it)("nach Ablauf und verschwundenem Mismatch darf ein neues Event erneut starten", () => {
        const first = (0, device_ownership_js_1.evaluateDeviceOwnership)({
            nowMs: NOW,
            mismatchDetected: true,
            mismatchKind: "manual_on",
            previous: (0, device_ownership_js_1.emptyDeviceOwnershipState)(),
            overrideDurationMs: 30 * 60_000,
            safetyOverride: false,
        });
        const expired = (0, device_ownership_js_1.evaluateDeviceOwnership)({
            nowMs: NOW + 31 * 60_000,
            mismatchDetected: true,
            mismatchKind: "manual_on",
            previous: first,
            overrideDurationMs: 30 * 60_000,
            safetyOverride: false,
        });
        strict_1.default.equal(expired.owner, "ems");
        const cleared = (0, device_ownership_js_1.evaluateDeviceOwnership)({
            nowMs: NOW + 32 * 60_000,
            mismatchDetected: false,
            previous: expired,
            overrideDurationMs: 30 * 60_000,
            safetyOverride: false,
        });
        strict_1.default.equal(cleared.lastMismatchKind, "");
        const again = (0, device_ownership_js_1.evaluateDeviceOwnership)({
            nowMs: NOW + 33 * 60_000,
            mismatchDetected: true,
            mismatchKind: "manual_on",
            previous: cleared,
            overrideDurationMs: 30 * 60_000,
            safetyOverride: false,
        });
        strict_1.default.equal(again.owner, "user");
        strict_1.default.ok(again.overrideUntilIso);
    });
});
