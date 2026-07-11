"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const strict_1 = __importDefault(require("node:assert/strict"));
const node_fs_1 = require("node:fs");
const node_path_1 = require("node:path");
const resolve_js_1 = require("./resolve.js");
const soc_energy_js_1 = require("./soc_energy.js");
const baseline_js_1 = require("./baseline.js");
const types_js_1 = require("./types.js");
const execute_js_1 = require("../runtime/execute.js");
const NOW = new Date("2026-07-11T12:00:00.000Z");
const FRESH_TS = NOW.getTime() - 60_000;
const STALE_TS = NOW.getTime() - 20 * 60_000;
function baseProfile(overrides = {}) {
    return {
        vehicleId: "car_a",
        displayName: "Car A",
        enabled: true,
        isGuest: false,
        source: "manual",
        evccVehicleId: null,
        evccVehicleName: null,
        batteryCapacityNetKwh: 77,
        maxAcChargePowerW: 11000,
        supportedPhases: [1, 3],
        preferredPhases: 3,
        minCurrentA: 6,
        maxCurrentA: 16,
        defaultTargetSocPct: 80,
        minimumDepartureSocPct: 50,
        maximumSocPct: 90,
        chargeEfficiencyPct: 90,
        referenceRangeAt100PctKm: 500,
        socFallbackMaxAgeMin: 120,
        socStateId: "foreign.soc",
        rangeStateId: "foreign.range",
        connectedStateId: null,
        chargingStateId: null,
        sessionEnergyStateId: "foreign.session",
        createdAt: NOW.toISOString(),
        updatedAt: NOW.toISOString(),
        ...overrides,
    };
}
function baseInput(overrides = {}) {
    return {
        vehicleId: "car_a",
        profile: baseProfile(),
        directSocPct: 53,
        directSocStale: false,
        directSocFromConfiguredState: true,
        rangeKm: 250,
        rangeStale: false,
        sessionEnergyKwh: 5,
        sessionEnergyStale: false,
        rollforwardAnchor: null,
        lastTrustedSnapshot: null,
        now: NOW,
        ...overrides,
    };
}
function directAnchor(overrides = {}) {
    const observedAtMs = NOW.getTime() - 30 * 60_000;
    return {
        vehicleId: "car_a",
        socPct: 40,
        observedAtMs,
        sessionEnergyKwh: 2,
        rootSource: "direct",
        ...overrides,
    };
}
function lastTrustedSnap(overrides = {}) {
    const observedAtMs = NOW.getTime() - 30 * 60_000;
    return {
        vehicleId: "car_a",
        socPct: 40,
        originalSource: "direct",
        quality: "high",
        observedAtMs,
        ...overrides,
    };
}
function baselineCompat(overrides = {}) {
    const observedAtMs = overrides.baselineAt
        ? Date.parse(overrides.baselineAt)
        : NOW.getTime() - 30 * 60_000;
    return directAnchor({
        vehicleId: overrides.vehicleId ?? "car_a",
        socPct: overrides.baselineSocPct ?? 40,
        sessionEnergyKwh: overrides.sessionEnergyKwh ?? 2,
        observedAtMs,
    });
}
(0, node_test_1.describe)("isValidDirectSocPct", () => {
    (0, node_test_1.it)("accepts 0 and 100", () => {
        strict_1.default.equal((0, soc_energy_js_1.isValidDirectSocPct)(0), true);
        strict_1.default.equal((0, soc_energy_js_1.isValidDirectSocPct)(100), true);
    });
    (0, node_test_1.it)("rejects invalid values", () => {
        strict_1.default.equal((0, soc_energy_js_1.isValidDirectSocPct)(-1), false);
        strict_1.default.equal((0, soc_energy_js_1.isValidDirectSocPct)(101), false);
        strict_1.default.equal((0, soc_energy_js_1.isValidDirectSocPct)(NaN), false);
        strict_1.default.equal((0, soc_energy_js_1.isValidDirectSocPct)(null), false);
        strict_1.default.equal((0, soc_energy_js_1.isValidDirectSocPct)(undefined), false);
    });
});
(0, node_test_1.describe)("resolveVehicleSocAndEnergy direct SOC", () => {
    (0, node_test_1.beforeEach)(() => (0, baseline_js_1.resetAllStoredBaselines)());
    (0, node_test_1.it)("0% is valid direct", () => {
        const r = (0, soc_energy_js_1.resolveVehicleSocAndEnergy)(baseInput({ directSocPct: 0 }));
        strict_1.default.equal(r.resolvedSocPct, 0);
        strict_1.default.equal(r.socSource, "direct");
        strict_1.default.equal(r.socQuality, "high");
        strict_1.default.equal(r.socEstimated, false);
    });
    (0, node_test_1.it)("100% is valid direct", () => {
        const r = (0, soc_energy_js_1.resolveVehicleSocAndEnergy)(baseInput({ directSocPct: 100 }));
        strict_1.default.equal(r.resolvedSocPct, 100);
        strict_1.default.equal(r.socSource, "direct");
    });
    (0, node_test_1.it)("53% is valid direct", () => {
        const r = (0, soc_energy_js_1.resolveVehicleSocAndEnergy)(baseInput({ directSocPct: 53 }));
        strict_1.default.equal(r.resolvedSocPct, 53);
    });
    (0, node_test_1.it)("negative SOC is invalid", () => {
        const r = (0, soc_energy_js_1.resolveVehicleSocAndEnergy)(baseInput({
            directSocPct: -5,
            rangeKm: null,
            sessionEnergyKwh: null,
            rollforwardAnchor: null,
            lastTrustedSnapshot: null,
            profile: baseProfile({ socFallbackMaxAgeMin: 0 }),
        }));
        strict_1.default.equal(r.resolvedSocPct, null);
        strict_1.default.equal(r.reasonCode, types_js_1.SOC_ENERGY_REASON_CODES.directSocInvalid);
    });
    (0, node_test_1.it)("SOC over 100 is invalid", () => {
        const r = (0, soc_energy_js_1.resolveVehicleSocAndEnergy)(baseInput({
            directSocPct: 105,
            rangeKm: null,
            sessionEnergyKwh: null,
            rollforwardAnchor: null,
            lastTrustedSnapshot: null,
            profile: baseProfile({ socFallbackMaxAgeMin: 0 }),
        }));
        strict_1.default.equal(r.resolvedSocPct, null);
        strict_1.default.equal(r.reasonCode, types_js_1.SOC_ENERGY_REASON_CODES.directSocInvalid);
    });
    (0, node_test_1.it)("NaN is invalid", () => {
        const r = (0, soc_energy_js_1.resolveVehicleSocAndEnergy)(baseInput({
            directSocPct: NaN,
            rangeKm: null,
            sessionEnergyKwh: null,
            rollforwardAnchor: null,
            lastTrustedSnapshot: null,
            profile: baseProfile({ socFallbackMaxAgeMin: 0 }),
        }));
        strict_1.default.equal(r.resolvedSocPct, null);
        strict_1.default.equal(r.reasonCode, types_js_1.SOC_ENERGY_REASON_CODES.directSocInvalid);
    });
    (0, node_test_1.it)("null is unknown", () => {
        const r = (0, soc_energy_js_1.resolveVehicleSocAndEnergy)(baseInput({
            directSocPct: null,
            rangeKm: null,
            sessionEnergyKwh: null,
            rollforwardAnchor: null,
            lastTrustedSnapshot: null,
            profile: baseProfile({ socFallbackMaxAgeMin: 0 }),
        }));
        strict_1.default.equal(r.resolvedSocPct, null);
        strict_1.default.equal(r.socSource, "unknown");
    });
    (0, node_test_1.it)("stale configured direct SOC is not used", () => {
        const r = (0, soc_energy_js_1.resolveVehicleSocAndEnergy)(baseInput({
            directSocPct: 50,
            directSocStale: true,
            directSocFromConfiguredState: true,
            rangeKm: null,
            sessionEnergyKwh: null,
            rollforwardAnchor: null,
            lastTrustedSnapshot: null,
            profile: baseProfile({ socFallbackMaxAgeMin: 0 }),
        }));
        strict_1.default.notEqual(r.socSource, "direct");
        strict_1.default.equal(r.reasonCode, types_js_1.SOC_ENERGY_REASON_CODES.directSocStale);
    });
    (0, node_test_1.it)("connected=false does not invalidate numeric SOC via resolver input", () => {
        const r = (0, soc_energy_js_1.resolveVehicleSocAndEnergy)(baseInput({ directSocPct: 0 }));
        strict_1.default.equal(r.resolvedSocPct, 0);
    });
    (0, node_test_1.it)("connected=false still blocks activeForCharging in resolution layer", () => {
        const res = (0, resolve_js_1.resolveActiveVehicle)({
            profiles: [baseProfile()],
            configuredManualVehicleId: "car_a",
            evccDetection: { evccVehicleId: null, evccVehicleName: null },
            evccConnected: false,
            nowIso: NOW.toISOString(),
        });
        strict_1.default.equal(res.activeForCharging, false);
        strict_1.default.equal(res.profileResolved, true);
    });
});
(0, node_test_1.describe)("resolveVehicleSocAndEnergy priority", () => {
    (0, node_test_1.beforeEach)(() => (0, baseline_js_1.resetAllStoredBaselines)());
    (0, node_test_1.it)("direct wins over all fallbacks", () => {
        const r = (0, soc_energy_js_1.resolveVehicleSocAndEnergy)(baseInput({
            directSocPct: 60,
            rollforwardAnchor: baselineCompat(),
            rangeKm: 100,
        }));
        strict_1.default.equal(r.socSource, "direct");
    });
    (0, node_test_1.it)("energy rollforward wins over range and last trusted", () => {
        const r = (0, soc_energy_js_1.resolveVehicleSocAndEnergy)(baseInput({
            directSocPct: null,
            rollforwardAnchor: baselineCompat({ baselineSocPct: 50, sessionEnergyKwh: 1 }),
            sessionEnergyKwh: 3,
            rangeKm: 200,
        }));
        strict_1.default.equal(r.socSource, "energy_rollforward");
    });
    (0, node_test_1.it)("range estimate wins over last trusted", () => {
        const r = (0, soc_energy_js_1.resolveVehicleSocAndEnergy)(baseInput({
            directSocPct: null,
            rollforwardAnchor: null,
            lastTrustedSnapshot: lastTrustedSnap(),
            rangeKm: 250,
            sessionEnergyKwh: null,
        }));
        strict_1.default.equal(r.socSource, "range_estimate");
    });
    (0, node_test_1.it)("unknown when no source usable", () => {
        const r = (0, soc_energy_js_1.resolveVehicleSocAndEnergy)(baseInput({
            directSocPct: null,
            rangeKm: null,
            sessionEnergyKwh: null,
            rollforwardAnchor: null,
            lastTrustedSnapshot: null,
            profile: baseProfile({ socFallbackMaxAgeMin: 0 }),
        }));
        strict_1.default.equal(r.socSource, "unknown");
        strict_1.default.equal(r.reasonCode, types_js_1.SOC_ENERGY_REASON_CODES.noUsableSocSource);
    });
});
(0, node_test_1.describe)("resolveVehicleSocAndEnergy energy rollforward", () => {
    (0, node_test_1.beforeEach)(() => (0, baseline_js_1.resetAllStoredBaselines)());
    (0, node_test_1.it)("computes rollforward from baseline, capacity, counter and efficiency", () => {
        const r = (0, soc_energy_js_1.resolveVehicleSocAndEnergy)(baseInput({
            directSocPct: null,
            rollforwardAnchor: baselineCompat({ baselineSocPct: 50, sessionEnergyKwh: 2 }),
            sessionEnergyKwh: 4,
            profile: baseProfile({ batteryCapacityNetKwh: 100, chargeEfficiencyPct: 90 }),
        }));
        strict_1.default.equal(r.socSource, "energy_rollforward");
        // baseline 50 kWh + (2 kWh in * 0.9) = 51.8 kWh => 51.8%
        strict_1.default.ok(Math.abs((r.resolvedSocPct ?? 0) - 51.8) < 0.01);
    });
    (0, node_test_1.it)("clamps at 100%", () => {
        const r = (0, soc_energy_js_1.resolveVehicleSocAndEnergy)(baseInput({
            directSocPct: null,
            rollforwardAnchor: baselineCompat({ baselineSocPct: 99, sessionEnergyKwh: 0 }),
            sessionEnergyKwh: 50,
            profile: baseProfile({ batteryCapacityNetKwh: 100, chargeEfficiencyPct: 100 }),
        }));
        strict_1.default.equal(r.resolvedSocPct, 100);
    });
    (0, node_test_1.it)("no rollforward without capacity", () => {
        const r = (0, soc_energy_js_1.resolveVehicleSocAndEnergy)(baseInput({
            directSocPct: null,
            rollforwardAnchor: baselineCompat(),
            profile: baseProfile({ batteryCapacityNetKwh: null }),
        }));
        strict_1.default.notEqual(r.socSource, "energy_rollforward");
    });
    (0, node_test_1.it)("no rollforward without efficiency", () => {
        const r = (0, soc_energy_js_1.resolveVehicleSocAndEnergy)(baseInput({
            directSocPct: null,
            rollforwardAnchor: baselineCompat(),
            profile: baseProfile({ chargeEfficiencyPct: null }),
        }));
        strict_1.default.notEqual(r.socSource, "energy_rollforward");
    });
    (0, node_test_1.it)("no rollforward without baseline", () => {
        const r = (0, soc_energy_js_1.resolveVehicleSocAndEnergy)(baseInput({ directSocPct: null, rollforwardAnchor: null,
            lastTrustedSnapshot: null, sessionEnergyKwh: 5 }));
        strict_1.default.notEqual(r.socSource, "energy_rollforward");
    });
    (0, node_test_1.it)("no rollforward for other vehicle baseline", () => {
        const r = (0, soc_energy_js_1.resolveVehicleSocAndEnergy)(baseInput({
            directSocPct: null,
            vehicleId: "car_b",
            profile: baseProfile({ vehicleId: "car_b" }),
            rollforwardAnchor: baselineCompat({ vehicleId: "car_a" }),
        }));
        strict_1.default.notEqual(r.socSource, "energy_rollforward");
    });
    (0, node_test_1.it)("no negative SOC jump on counter decrease", () => {
        const r = (0, soc_energy_js_1.resolveVehicleSocAndEnergy)(baseInput({
            directSocPct: null,
            rollforwardAnchor: baselineCompat({ baselineSocPct: 60, sessionEnergyKwh: 10 }),
            sessionEnergyKwh: 5,
            rangeKm: null,
            profile: baseProfile({ socFallbackMaxAgeMin: 0 }),
        }));
        strict_1.default.notEqual(r.socSource, "energy_rollforward");
        strict_1.default.equal(r.reasonCode, types_js_1.SOC_ENERGY_REASON_CODES.energyRollforwardCounterReset);
    });
    (0, node_test_1.it)("counter reset invalidates rollforward diff", () => {
        const r = (0, soc_energy_js_1.resolveVehicleSocAndEnergy)(baseInput({
            directSocPct: null,
            rollforwardAnchor: baselineCompat({ sessionEnergyKwh: 8 }),
            sessionEnergyKwh: 0.5,
        }));
        strict_1.default.notEqual(r.socSource, "energy_rollforward");
    });
    (0, node_test_1.it)("no cross-profile energy in rollforward", () => {
        (0, baseline_js_1.setRollforwardAnchor)(directAnchor({ vehicleId: "car_a", socPct: 80, sessionEnergyKwh: 1 }));
        const r = (0, soc_energy_js_1.resolveVehicleSocAndEnergy)(baseInput({
            vehicleId: "car_b",
            profile: baseProfile({ vehicleId: "car_b" }),
            directSocPct: null,
            sessionEnergyKwh: 5,
        }));
        strict_1.default.notEqual(r.socSource, "energy_rollforward");
    });
    (0, node_test_1.it)("only positive measured charge energy is applied", () => {
        const r = (0, soc_energy_js_1.resolveVehicleSocAndEnergy)(baseInput({
            directSocPct: null,
            rollforwardAnchor: baselineCompat({ baselineSocPct: 50, sessionEnergyKwh: 5 }),
            sessionEnergyKwh: 5,
        }));
        strict_1.default.equal(r.resolvedSocPct, 50);
    });
});
(0, node_test_1.describe)("resolveVehicleSocAndEnergy range estimate", () => {
    (0, node_test_1.beforeEach)(() => (0, baseline_js_1.resetAllStoredBaselines)());
    (0, node_test_1.it)("estimates SOC from range and reference", () => {
        const r = (0, soc_energy_js_1.resolveVehicleSocAndEnergy)(baseInput({
            directSocPct: null,
            rangeKm: 250,
            rollforwardAnchor: null,
            lastTrustedSnapshot: null,
            sessionEnergyKwh: null,
            profile: baseProfile({ referenceRangeAt100PctKm: 500, socFallbackMaxAgeMin: 0 }),
        }));
        strict_1.default.equal(r.socSource, "range_estimate");
        strict_1.default.equal(r.resolvedSocPct, 50);
    });
    (0, node_test_1.it)("clamps range estimate to 0..100", () => {
        const high = (0, soc_energy_js_1.resolveVehicleSocAndEnergy)(baseInput({
            directSocPct: null,
            rangeKm: 900,
            rollforwardAnchor: null,
            lastTrustedSnapshot: null,
            sessionEnergyKwh: null,
            profile: baseProfile({ referenceRangeAt100PctKm: 500, socFallbackMaxAgeMin: 0 }),
        }));
        strict_1.default.equal(high.resolvedSocPct, 100);
    });
    (0, node_test_1.it)("no estimate without reference range", () => {
        const r = (0, soc_energy_js_1.resolveVehicleSocAndEnergy)(baseInput({
            directSocPct: null,
            rangeKm: 200,
            rollforwardAnchor: null,
            lastTrustedSnapshot: null,
            sessionEnergyKwh: null,
            profile: baseProfile({ referenceRangeAt100PctKm: null, socFallbackMaxAgeMin: 0 }),
        }));
        strict_1.default.notEqual(r.socSource, "range_estimate");
    });
    (0, node_test_1.it)("no estimate with invalid reference range", () => {
        const r = (0, soc_energy_js_1.resolveVehicleSocAndEnergy)(baseInput({
            directSocPct: null,
            rangeKm: 200,
            rollforwardAnchor: null,
            lastTrustedSnapshot: null,
            sessionEnergyKwh: null,
            profile: baseProfile({ referenceRangeAt100PctKm: 0, socFallbackMaxAgeMin: 0 }),
        }));
        strict_1.default.notEqual(r.socSource, "range_estimate");
    });
    (0, node_test_1.it)("no estimate when range stale", () => {
        const r = (0, soc_energy_js_1.resolveVehicleSocAndEnergy)(baseInput({
            directSocPct: null,
            rangeKm: 200,
            rangeStale: true,
            rollforwardAnchor: null,
            lastTrustedSnapshot: null,
            sessionEnergyKwh: null,
            profile: baseProfile({ socFallbackMaxAgeMin: 0 }),
        }));
        strict_1.default.notEqual(r.socSource, "range_estimate");
    });
    (0, node_test_1.it)("negative range is invalid", () => {
        const r = (0, soc_energy_js_1.resolveVehicleSocAndEnergy)(baseInput({
            directSocPct: null,
            rangeKm: -10,
            rollforwardAnchor: null,
            lastTrustedSnapshot: null,
            sessionEnergyKwh: null,
            profile: baseProfile({ socFallbackMaxAgeMin: 0 }),
        }));
        strict_1.default.notEqual(r.socSource, "range_estimate");
    });
});
(0, node_test_1.describe)("resolveVehicleSocAndEnergy last trusted", () => {
    (0, node_test_1.beforeEach)(() => (0, baseline_js_1.resetAllStoredBaselines)());
    (0, node_test_1.it)("uses baseline within configured age", () => {
        const r = (0, soc_energy_js_1.resolveVehicleSocAndEnergy)(baseInput({
            directSocPct: null,
            rangeKm: null,
            sessionEnergyKwh: null,
            rollforwardAnchor: null,
            lastTrustedSnapshot: lastTrustedSnap({ socPct: 45 }),
            profile: baseProfile({ socFallbackMaxAgeMin: 120 }),
        }));
        strict_1.default.equal(r.socSource, "last_trusted");
        strict_1.default.equal(r.resolvedSocPct, 45);
    });
    (0, node_test_1.it)("expires after max age", () => {
        const r = (0, soc_energy_js_1.resolveVehicleSocAndEnergy)(baseInput({
            directSocPct: null,
            rangeKm: null,
            sessionEnergyKwh: null,
            rollforwardAnchor: null,
            lastTrustedSnapshot: lastTrustedSnap({
                socPct: 45,
                observedAtMs: NOW.getTime() - 200 * 60_000,
            }),
            profile: baseProfile({ socFallbackMaxAgeMin: 120 }),
        }));
        strict_1.default.notEqual(r.socSource, "last_trusted");
    });
    (0, node_test_1.it)("disabled without configured max age", () => {
        const r = (0, soc_energy_js_1.resolveVehicleSocAndEnergy)(baseInput({
            directSocPct: null,
            rangeKm: null,
            sessionEnergyKwh: null,
            rollforwardAnchor: null,
            lastTrustedSnapshot: lastTrustedSnap(),
            profile: baseProfile({ socFallbackMaxAgeMin: 0 }),
        }));
        strict_1.default.notEqual(r.socSource, "last_trusted");
    });
    (0, node_test_1.it)("stays profile isolated", () => {
        const r = (0, soc_energy_js_1.resolveVehicleSocAndEnergy)(baseInput({
            vehicleId: "car_b",
            profile: baseProfile({ vehicleId: "car_b" }),
            directSocPct: null,
            rangeKm: null,
            sessionEnergyKwh: null,
            rollforwardAnchor: null,
            lastTrustedSnapshot: lastTrustedSnap({ vehicleId: "car_a" }),
        }));
        strict_1.default.notEqual(r.socSource, "last_trusted");
    });
});
(0, node_test_1.describe)("resolveVehicleSocAndEnergy energy calculation", () => {
    (0, node_test_1.beforeEach)(() => (0, baseline_js_1.resetAllStoredBaselines)());
    (0, node_test_1.it)("computes current, target and required battery energy", () => {
        const r = (0, soc_energy_js_1.resolveVehicleSocAndEnergy)(baseInput({ directSocPct: 50 }));
        strict_1.default.equal(r.currentBatteryEnergyKwh, 38.5);
        strict_1.default.equal(r.targetBatteryEnergyKwh, 61.6);
        strict_1.default.equal(r.requiredBatteryEnergyKwh, 23.1);
    });
    (0, node_test_1.it)("required battery energy is 0 when target below current", () => {
        const r = (0, soc_energy_js_1.resolveVehicleSocAndEnergy)(baseInput({
            directSocPct: 90,
            profile: baseProfile({ defaultTargetSocPct: 80 }),
        }));
        strict_1.default.equal(r.requiredBatteryEnergyKwh, 0);
    });
    (0, node_test_1.it)("no negative required energy", () => {
        const r = (0, soc_energy_js_1.resolveVehicleSocAndEnergy)(baseInput({ directSocPct: 100, profile: baseProfile({ defaultTargetSocPct: 50 }) }));
        strict_1.default.equal(r.requiredBatteryEnergyKwh, 0);
    });
    (0, node_test_1.it)("input energy only with configured efficiency", () => {
        const withEff = (0, soc_energy_js_1.resolveVehicleSocAndEnergy)(baseInput({ directSocPct: 50 }));
        strict_1.default.ok(withEff.requiredInputEnergyKwh !== null);
        const withoutEff = (0, soc_energy_js_1.resolveVehicleSocAndEnergy)(baseInput({ directSocPct: 50, profile: baseProfile({ chargeEfficiencyPct: null }) }));
        strict_1.default.equal(withoutEff.requiredInputEnergyKwh, null);
    });
    (0, node_test_1.it)("missing capacity yields no invented energy", () => {
        const r = (0, soc_energy_js_1.resolveVehicleSocAndEnergy)(baseInput({ directSocPct: 50, profile: baseProfile({ batteryCapacityNetKwh: null }) }));
        strict_1.default.equal(r.currentBatteryEnergyKwh, null);
        strict_1.default.equal(r.ready, false);
    });
    (0, node_test_1.it)("missing target SOC yields no target energy", () => {
        const r = (0, soc_energy_js_1.resolveVehicleSocAndEnergy)(baseInput({ directSocPct: 50, profile: baseProfile({ defaultTargetSocPct: null }) }));
        strict_1.default.equal(r.targetBatteryEnergyKwh, null);
        strict_1.default.equal(r.ready, false);
    });
    (0, node_test_1.it)("results stay finite", () => {
        const r = (0, soc_energy_js_1.resolveVehicleSocAndEnergy)(baseInput({ directSocPct: 53 }));
        strict_1.default.ok(Number.isFinite(r.currentBatteryEnergyKwh ?? NaN));
        strict_1.default.ok(Number.isFinite(r.requiredBatteryEnergyKwh ?? NaN));
    });
});
(0, node_test_1.describe)("buildSocEnergyInput and profile isolation", () => {
    (0, node_test_1.beforeEach)(() => (0, baseline_js_1.resetAllStoredBaselines)());
    (0, node_test_1.it)("supports more than four profiles dynamically", () => {
        for (let i = 1; i <= 6; i++) {
            const p = baseProfile({ vehicleId: `car_${i}` });
            const input = (0, soc_energy_js_1.buildSocEnergyInput)(p.vehicleId, p, { socPct: 40 + i, rangeKm: null, sessionEnergyKwh: null }, { stale: false, socFromConfiguredState: true, socTs: FRESH_TS }, null, null, NOW);
            const r = (0, soc_energy_js_1.resolveVehicleSocAndEnergy)(input);
            strict_1.default.equal(r.resolvedSocPct, 40 + i);
        }
    });
    (0, node_test_1.it)("empty profile list input still valid at resolver level", () => {
        const r = (0, soc_energy_js_1.resolveVehicleSocAndEnergy)(baseInput({ directSocPct: null, rangeKm: null, sessionEnergyKwh: null, rollforwardAnchor: null, lastTrustedSnapshot: null }));
        strict_1.default.equal(r.socSource, "unknown");
    });
    (0, node_test_1.it)("profile switch uses only matching baseline", () => {
        (0, baseline_js_1.setRollforwardAnchor)(directAnchor({ vehicleId: "car_a", socPct: 70, sessionEnergyKwh: 1 }));
        (0, baseline_js_1.clearStoredBaseline)("car_b");
        const rB = (0, soc_energy_js_1.resolveVehicleSocAndEnergy)(baseInput({
            vehicleId: "car_b",
            profile: baseProfile({ vehicleId: "car_b" }),
            directSocPct: null,
            rangeKm: null,
            sessionEnergyKwh: 5,
        }));
        strict_1.default.notEqual(rB.socSource, "energy_rollforward");
        strict_1.default.equal(rB.socSource, "unknown");
    });
    (0, node_test_1.it)("stale telemetry timestamps mark field stale", () => {
        const input = (0, soc_energy_js_1.buildSocEnergyInput)("car_a", baseProfile(), { socPct: 40, rangeKm: null, sessionEnergyKwh: null }, { stale: false, socFromConfiguredState: true, socTs: STALE_TS }, null, null, NOW);
        const r = (0, soc_energy_js_1.resolveVehicleSocAndEnergy)(input);
        strict_1.default.notEqual(r.socSource, "direct");
    });
    (0, node_test_1.it)("active_vehicle_id can stay while charging blocked", () => {
        const res = (0, resolve_js_1.resolveActiveVehicle)({
            profiles: [baseProfile()],
            configuredManualVehicleId: "car_a",
            evccDetection: { evccVehicleId: null, evccVehicleName: null },
            evccConnected: false,
            nowIso: NOW.toISOString(),
        });
        strict_1.default.equal(res.vehicleId, "car_a");
        strict_1.default.equal(res.activeForCharging, false);
    });
});
(0, node_test_1.describe)("baseline provenance separation", () => {
    (0, node_test_1.beforeEach)(() => (0, baseline_js_1.resetAllStoredBaselines)());
    (0, node_test_1.it)("fresh direct SOC creates rollforward anchor", () => {
        const r = (0, soc_energy_js_1.resolveVehicleSocAndEnergy)(baseInput({ directSocPct: 55 }));
        (0, baseline_js_1.updateProfileSocPersistenceAfterResolution)("car_a", r, 3, NOW);
        const anchor = (0, baseline_js_1.getRollforwardAnchor)("car_a");
        strict_1.default.ok(anchor);
        strict_1.default.equal(anchor.rootSource, "direct");
        strict_1.default.equal(anchor.socPct, 55);
    });
    (0, node_test_1.it)("range estimate does not create rollforward anchor", () => {
        const r = (0, soc_energy_js_1.resolveVehicleSocAndEnergy)(baseInput({
            directSocPct: null,
            rangeKm: 250,
            sessionEnergyKwh: null,
            rollforwardAnchor: null,
            lastTrustedSnapshot: null,
            profile: baseProfile({ socFallbackMaxAgeMin: 0 }),
        }));
        (0, baseline_js_1.updateProfileSocPersistenceAfterResolution)("car_a", r, null, NOW);
        strict_1.default.equal(r.socSource, "range_estimate");
        strict_1.default.equal((0, baseline_js_1.getRollforwardAnchor)("car_a"), null);
    });
    (0, node_test_1.it)("last_trusted resolution does not create rollforward anchor", () => {
        const snap = lastTrustedSnap({ socPct: 45 });
        const r = (0, soc_energy_js_1.resolveVehicleSocAndEnergy)(baseInput({
            directSocPct: null,
            rangeKm: null,
            sessionEnergyKwh: null,
            rollforwardAnchor: null,
            lastTrustedSnapshot: snap,
        }));
        (0, baseline_js_1.updateProfileSocPersistenceAfterResolution)("car_a", r, null, NOW);
        strict_1.default.equal(r.socSource, "last_trusted");
        strict_1.default.equal((0, baseline_js_1.getRollforwardAnchor)("car_a"), null);
    });
    (0, node_test_1.it)("unknown does not create rollforward anchor", () => {
        const r = (0, soc_energy_js_1.resolveVehicleSocAndEnergy)(baseInput({
            directSocPct: null,
            rangeKm: null,
            sessionEnergyKwh: null,
            rollforwardAnchor: null,
            lastTrustedSnapshot: null,
            profile: baseProfile({ socFallbackMaxAgeMin: 0 }),
        }));
        (0, baseline_js_1.updateProfileSocPersistenceAfterResolution)("car_a", r, null, NOW);
        strict_1.default.equal((0, baseline_js_1.getRollforwardAnchor)("car_a"), null);
    });
    (0, node_test_1.it)("range estimate updates last-trusted snapshot", () => {
        const r = (0, soc_energy_js_1.resolveVehicleSocAndEnergy)(baseInput({
            directSocPct: null,
            rangeKm: 200,
            sessionEnergyKwh: null,
            rollforwardAnchor: null,
            lastTrustedSnapshot: null,
            profile: baseProfile({ socFallbackMaxAgeMin: 0 }),
        }));
        (0, baseline_js_1.updateProfileSocPersistenceAfterResolution)("car_a", r, null, NOW);
        const snap = (0, baseline_js_1.getLastTrustedSnapshot)("car_a");
        strict_1.default.ok(snap);
        strict_1.default.equal(snap.originalSource, "range_estimate");
    });
    (0, node_test_1.it)("energy rollforward updates last-trusted snapshot but not anchor root", () => {
        const anchor = directAnchor({ socPct: 50, sessionEnergyKwh: 1 });
        (0, baseline_js_1.setRollforwardAnchor)(anchor);
        const r = (0, soc_energy_js_1.resolveVehicleSocAndEnergy)(baseInput({ directSocPct: null, sessionEnergyKwh: 3, rollforwardAnchor: anchor }));
        (0, baseline_js_1.updateProfileSocPersistenceAfterResolution)("car_a", r, 3, NOW);
        strict_1.default.equal(r.socSource, "energy_rollforward");
        const anchorAfter = (0, baseline_js_1.getRollforwardAnchor)("car_a");
        strict_1.default.equal(anchorAfter.socPct, 50);
        strict_1.default.equal(anchorAfter.observedAtMs, anchor.observedAtMs);
        strict_1.default.equal((0, baseline_js_1.getLastTrustedSnapshot)("car_a").originalSource, "energy_rollforward");
    });
    (0, node_test_1.it)("last_trusted does not renew snapshot timestamp", () => {
        const originalMs = NOW.getTime() - 90 * 60_000;
        (0, baseline_js_1.setLastTrustedSnapshot)(lastTrustedSnap({ socPct: 42, observedAtMs: originalMs }));
        const r = (0, soc_energy_js_1.resolveVehicleSocAndEnergy)(baseInput({
            directSocPct: null,
            rangeKm: null,
            sessionEnergyKwh: null,
            rollforwardAnchor: null,
            lastTrustedSnapshot: lastTrustedSnap({ socPct: 42, observedAtMs: originalMs }),
        }));
        (0, baseline_js_1.updateProfileSocPersistenceAfterResolution)("car_a", r, null, NOW);
        strict_1.default.equal((0, baseline_js_1.getLastTrustedSnapshot)("car_a").observedAtMs, originalMs);
    });
    (0, node_test_1.it)("repeated last_trusted expires from original timestamp", () => {
        const originalMs = NOW.getTime() - 130 * 60_000;
        const snap = lastTrustedSnap({ socPct: 42, observedAtMs: originalMs });
        const r = (0, soc_energy_js_1.resolveVehicleSocAndEnergy)(baseInput({
            directSocPct: null,
            rangeKm: null,
            sessionEnergyKwh: null,
            rollforwardAnchor: null,
            lastTrustedSnapshot: snap,
            profile: baseProfile({ socFallbackMaxAgeMin: 120 }),
        }));
        strict_1.default.notEqual(r.socSource, "last_trusted");
    });
    (0, node_test_1.it)("range estimate cannot become energy_rollforward via session energy", () => {
        (0, baseline_js_1.setLastTrustedSnapshot)(lastTrustedSnap({ socPct: 40, originalSource: "range_estimate", quality: "low" }));
        const r = (0, soc_energy_js_1.resolveVehicleSocAndEnergy)(baseInput({
            directSocPct: null,
            rangeKm: null,
            sessionEnergyKwh: 10,
            rollforwardAnchor: null,
            lastTrustedSnapshot: lastTrustedSnap({
                socPct: 40,
                originalSource: "range_estimate",
                quality: "low",
            }),
            profile: baseProfile({ socFallbackMaxAgeMin: 0 }),
        }));
        strict_1.default.notEqual(r.socSource, "energy_rollforward");
    });
    (0, node_test_1.it)("last_trusted snapshot cannot seed energy_rollforward medium upgrade", () => {
        const r = (0, soc_energy_js_1.resolveVehicleSocAndEnergy)(baseInput({
            directSocPct: null,
            sessionEnergyKwh: 10,
            rollforwardAnchor: null,
            lastTrustedSnapshot: lastTrustedSnap({ socPct: 40 }),
            profile: baseProfile({ socFallbackMaxAgeMin: 0 }),
        }));
        strict_1.default.notEqual(r.socSource, "energy_rollforward");
    });
    (0, node_test_1.it)("direct/high can roll forward to energy_rollforward/medium", () => {
        const r = (0, soc_energy_js_1.resolveVehicleSocAndEnergy)(baseInput({
            directSocPct: null,
            sessionEnergyKwh: 4,
            rollforwardAnchor: directAnchor({ socPct: 50, sessionEnergyKwh: 2 }),
        }));
        strict_1.default.equal(r.socSource, "energy_rollforward");
        strict_1.default.equal(r.socQuality, "medium");
    });
    (0, node_test_1.it)("rollforward keeps root provenance direct across cycles", () => {
        (0, baseline_js_1.setRollforwardAnchor)(directAnchor({ socPct: 50, sessionEnergyKwh: 1 }));
        const first = (0, soc_energy_js_1.resolveVehicleSocAndEnergy)(baseInput({ directSocPct: null, sessionEnergyKwh: 3, rollforwardAnchor: (0, baseline_js_1.getRollforwardAnchor)("car_a") }));
        (0, baseline_js_1.updateProfileSocPersistenceAfterResolution)("car_a", first, 3, NOW);
        const second = (0, soc_energy_js_1.resolveVehicleSocAndEnergy)(baseInput({ directSocPct: null, sessionEnergyKwh: 5, rollforwardAnchor: (0, baseline_js_1.getRollforwardAnchor)("car_a") }));
        strict_1.default.equal(second.socSource, "energy_rollforward");
        strict_1.default.equal((0, baseline_js_1.getRollforwardAnchor)("car_a").rootSource, "direct");
        strict_1.default.equal((0, baseline_js_1.getRollforwardAnchor)("car_a").socPct, 50);
    });
    (0, node_test_1.it)("profile switch isolates rollforward anchor", () => {
        (0, baseline_js_1.setRollforwardAnchor)(directAnchor({ vehicleId: "car_a", socPct: 60, sessionEnergyKwh: 1 }));
        const r = (0, soc_energy_js_1.resolveVehicleSocAndEnergy)(baseInput({
            vehicleId: "car_b",
            profile: baseProfile({ vehicleId: "car_b" }),
            directSocPct: null,
            sessionEnergyKwh: 5,
            rollforwardAnchor: null,
        }));
        strict_1.default.notEqual(r.socSource, "energy_rollforward");
    });
    (0, node_test_1.it)("counter reset invalidates rollforward from direct anchor", () => {
        const r = (0, soc_energy_js_1.resolveVehicleSocAndEnergy)(baseInput({
            directSocPct: null,
            rangeKm: null,
            sessionEnergyKwh: 1,
            lastTrustedSnapshot: null,
            rollforwardAnchor: directAnchor({ socPct: 50, sessionEnergyKwh: 5 }),
            profile: baseProfile({ socFallbackMaxAgeMin: 0 }),
        }));
        strict_1.default.notEqual(r.socSource, "energy_rollforward");
        strict_1.default.equal(r.reasonCode, types_js_1.SOC_ENERGY_REASON_CODES.energyRollforwardCounterReset);
    });
    (0, node_test_1.it)("range update does not overwrite valid direct rollforward anchor", () => {
        (0, baseline_js_1.setRollforwardAnchor)(directAnchor({ socPct: 55, sessionEnergyKwh: 2 }));
        const r = (0, soc_energy_js_1.resolveVehicleSocAndEnergy)(baseInput({
            directSocPct: null,
            rangeKm: 300,
            sessionEnergyKwh: null,
            rollforwardAnchor: (0, baseline_js_1.getRollforwardAnchor)("car_a"),
            lastTrustedSnapshot: null,
            profile: baseProfile({ socFallbackMaxAgeMin: 0 }),
        }));
        (0, baseline_js_1.updateProfileSocPersistenceAfterResolution)("car_a", r, null, NOW);
        strict_1.default.equal((0, baseline_js_1.getRollforwardAnchor)("car_a").socPct, 55);
        strict_1.default.equal(r.socSource, "range_estimate");
    });
    (0, node_test_1.it)("restart hydration restores direct anchor only from baseline states", () => {
        (0, baseline_js_1.resetAllStoredBaselines)();
        (0, baseline_js_1.hydrateProfileSocPersistenceFromLegacyStates)("car_a", {
            baselineSocPct: 48,
            baselineSocSource: "direct",
            baselineAt: NOW.toISOString(),
            sessionEnergyKwh: 1.5,
        });
        strict_1.default.ok((0, baseline_js_1.getRollforwardAnchor)("car_a"));
    });
    (0, node_test_1.it)("connected=false does not change source semantics", () => {
        const r = (0, soc_energy_js_1.resolveVehicleSocAndEnergy)(baseInput({ directSocPct: 0 }));
        strict_1.default.equal(r.socSource, "direct");
        const res = (0, resolve_js_1.resolveActiveVehicle)({
            profiles: [baseProfile()],
            configuredManualVehicleId: "car_a",
            evccDetection: { evccVehicleId: null, evccVehicleName: null },
            evccConnected: false,
            nowIso: NOW.toISOString(),
        });
        strict_1.default.equal(res.activeForCharging, false);
    });
});
(0, node_test_1.describe)("runtime safety regression", () => {
    (0, node_test_1.it)("release gate remains closed", () => {
        strict_1.default.equal(execute_js_1.WALLBOX_LIVE_WRITE_RELEASED, false);
    });
    (0, node_test_1.it)("vehicle runtime module does not import dispatch or write execution", () => {
        const src = (0, node_fs_1.readFileSync)((0, node_path_1.join)(process.cwd(), "src/addons/wallbox/vehicles/runtime.ts"), "utf8");
        strict_1.default.ok(!src.includes("runWallboxDryrunDispatch"));
        strict_1.default.ok(!src.includes("executeWallboxWrite"));
        strict_1.default.ok(!src.includes("setForeignState"));
    });
});
