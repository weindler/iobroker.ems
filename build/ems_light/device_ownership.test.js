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
    (0, node_test_1.it)("ein neuer Mismatch während eines laufenden Overrides verlängert die Frist, behält aber triggeredAt", () => {
        const first = (0, device_ownership_js_1.evaluateDeviceOwnership)({
            nowMs: NOW,
            mismatchDetected: true,
            mismatchKind: "manual_on",
            previous: (0, device_ownership_js_1.emptyDeviceOwnershipState)(),
            overrideDurationMs: 30 * 60_000,
            safetyOverride: false,
        });
        const renewed = (0, device_ownership_js_1.evaluateDeviceOwnership)({
            nowMs: NOW + 10 * 60_000,
            mismatchDetected: true,
            mismatchKind: "manual_on",
            previous: first,
            overrideDurationMs: 30 * 60_000,
            safetyOverride: false,
        });
        strict_1.default.ok(Date.parse(renewed.overrideUntilIso) > Date.parse(first.overrideUntilIso));
        strict_1.default.equal(renewed.triggeredAtIso, first.triggeredAtIso);
    });
});
