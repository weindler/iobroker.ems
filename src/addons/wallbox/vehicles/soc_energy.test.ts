import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { resolveActiveVehicle } from "./resolve.js";
import {
	buildSocEnergyInput,
	isValidDirectSocPct,
	resolveVehicleSocAndEnergy,
	type ResolveVehicleSocAndEnergyInput,
} from "./soc_energy.js";
import {
	clearStoredBaseline,
	getLastTrustedSnapshot,
	getRollforwardAnchor,
	hydrateProfileSocPersistenceFromLegacyStates,
	resetAllStoredBaselines,
	setLastTrustedSnapshot,
	setRollforwardAnchor,
	setStoredBaseline,
	updateProfileSocPersistenceAfterResolution,
} from "./baseline.js";
import { SOC_ENERGY_REASON_CODES } from "./types.js";
import type {
	VehicleLastTrustedSnapshot,
	VehicleRollforwardAnchor,
	WallboxVehicleProfile,
} from "./types.js";
import { WALLBOX_LIVE_WRITE_RELEASED } from "../runtime/execute.js";

const NOW = new Date("2026-07-11T12:00:00.000Z");
const FRESH_TS = NOW.getTime() - 60_000;
const STALE_TS = NOW.getTime() - 20 * 60_000;

function baseProfile(overrides: Partial<WallboxVehicleProfile> = {}): WallboxVehicleProfile {
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

function baseInput(overrides: Partial<ResolveVehicleSocAndEnergyInput> = {}): ResolveVehicleSocAndEnergyInput {
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

function directAnchor(
	overrides: Partial<VehicleRollforwardAnchor> = {},
): VehicleRollforwardAnchor {
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

function lastTrustedSnap(
	overrides: Partial<VehicleLastTrustedSnapshot> = {},
): VehicleLastTrustedSnapshot {
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

function baselineCompat(overrides: {
	vehicleId?: string;
	baselineSocPct?: number;
	sessionEnergyKwh?: number | null;
	baselineAt?: string;
} = {}): VehicleRollforwardAnchor {
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

describe("isValidDirectSocPct", () => {
	it("accepts 0 and 100", () => {
		assert.equal(isValidDirectSocPct(0), true);
		assert.equal(isValidDirectSocPct(100), true);
	});

	it("rejects invalid values", () => {
		assert.equal(isValidDirectSocPct(-1), false);
		assert.equal(isValidDirectSocPct(101), false);
		assert.equal(isValidDirectSocPct(NaN), false);
		assert.equal(isValidDirectSocPct(null), false);
		assert.equal(isValidDirectSocPct(undefined), false);
	});
});

describe("resolveVehicleSocAndEnergy direct SOC", () => {
	beforeEach(() => resetAllStoredBaselines());

	it("0% is valid direct", () => {
		const r = resolveVehicleSocAndEnergy(baseInput({ directSocPct: 0 }));
		assert.equal(r.resolvedSocPct, 0);
		assert.equal(r.socSource, "direct");
		assert.equal(r.socQuality, "high");
		assert.equal(r.socEstimated, false);
	});

	it("100% is valid direct", () => {
		const r = resolveVehicleSocAndEnergy(baseInput({ directSocPct: 100 }));
		assert.equal(r.resolvedSocPct, 100);
		assert.equal(r.socSource, "direct");
	});

	it("53% is valid direct", () => {
		const r = resolveVehicleSocAndEnergy(baseInput({ directSocPct: 53 }));
		assert.equal(r.resolvedSocPct, 53);
	});

	it("negative SOC is invalid", () => {
		const r = resolveVehicleSocAndEnergy(
			baseInput({
				directSocPct: -5,
				rangeKm: null,
				sessionEnergyKwh: null,
				rollforwardAnchor: null,
				lastTrustedSnapshot: null,
				profile: baseProfile({ socFallbackMaxAgeMin: 0 }),
			}),
		);
		assert.equal(r.resolvedSocPct, null);
		assert.equal(r.reasonCode, SOC_ENERGY_REASON_CODES.directSocInvalid);
	});

	it("SOC over 100 is invalid", () => {
		const r = resolveVehicleSocAndEnergy(
			baseInput({
				directSocPct: 105,
				rangeKm: null,
				sessionEnergyKwh: null,
				rollforwardAnchor: null,
				lastTrustedSnapshot: null,
				profile: baseProfile({ socFallbackMaxAgeMin: 0 }),
			}),
		);
		assert.equal(r.resolvedSocPct, null);
		assert.equal(r.reasonCode, SOC_ENERGY_REASON_CODES.directSocInvalid);
	});

	it("NaN is invalid", () => {
		const r = resolveVehicleSocAndEnergy(
			baseInput({
				directSocPct: NaN,
				rangeKm: null,
				sessionEnergyKwh: null,
				rollforwardAnchor: null,
				lastTrustedSnapshot: null,
				profile: baseProfile({ socFallbackMaxAgeMin: 0 }),
			}),
		);
		assert.equal(r.resolvedSocPct, null);
		assert.equal(r.reasonCode, SOC_ENERGY_REASON_CODES.directSocInvalid);
	});

	it("null is unknown", () => {
		const r = resolveVehicleSocAndEnergy(
			baseInput({
				directSocPct: null,
				rangeKm: null,
				sessionEnergyKwh: null,
				rollforwardAnchor: null,
				lastTrustedSnapshot: null,
				profile: baseProfile({ socFallbackMaxAgeMin: 0 }),
			}),
		);
		assert.equal(r.resolvedSocPct, null);
		assert.equal(r.socSource, "unknown");
	});

	it("stale configured direct SOC is not used", () => {
		const r = resolveVehicleSocAndEnergy(
			baseInput({
				directSocPct: 50,
				directSocStale: true,
				directSocFromConfiguredState: true,
				rangeKm: null,
				sessionEnergyKwh: null,
				rollforwardAnchor: null,
				lastTrustedSnapshot: null,
				profile: baseProfile({ socFallbackMaxAgeMin: 0 }),
			}),
		);
		assert.notEqual(r.socSource, "direct");
		assert.equal(r.reasonCode, SOC_ENERGY_REASON_CODES.directSocStale);
	});

	it("connected=false does not invalidate numeric SOC via resolver input", () => {
		const r = resolveVehicleSocAndEnergy(baseInput({ directSocPct: 0 }));
		assert.equal(r.resolvedSocPct, 0);
	});

	it("connected=false still blocks activeForCharging in resolution layer", () => {
		const res = resolveActiveVehicle({
			profiles: [baseProfile()],
			configuredManualVehicleId: "car_a",
			evccDetection: { evccVehicleId: null, evccVehicleName: null },
			evccConnected: false,
			nowIso: NOW.toISOString(),
		});
		assert.equal(res.activeForCharging, false);
		assert.equal(res.profileResolved, true);
	});
});

describe("resolveVehicleSocAndEnergy priority", () => {
	beforeEach(() => resetAllStoredBaselines());

	it("direct wins over all fallbacks", () => {
		const r = resolveVehicleSocAndEnergy(
			baseInput({
				directSocPct: 60,
				rollforwardAnchor: baselineCompat(),
				rangeKm: 100,
			}),
		);
		assert.equal(r.socSource, "direct");
	});

	it("energy rollforward wins over range and last trusted", () => {
		const r = resolveVehicleSocAndEnergy(
			baseInput({
				directSocPct: null,
				rollforwardAnchor: baselineCompat({ baselineSocPct: 50, sessionEnergyKwh: 1 }),
				sessionEnergyKwh: 3,
				rangeKm: 200,
			}),
		);
		assert.equal(r.socSource, "energy_rollforward");
	});

	it("range estimate wins over last trusted", () => {
		const r = resolveVehicleSocAndEnergy(
			baseInput({
				directSocPct: null,
				rollforwardAnchor: null,
				lastTrustedSnapshot: lastTrustedSnap(),
				rangeKm: 250,
				sessionEnergyKwh: null,
			}),
		);
		assert.equal(r.socSource, "range_estimate");
	});

	it("unknown when no source usable", () => {
		const r = resolveVehicleSocAndEnergy(
			baseInput({
				directSocPct: null,
				rangeKm: null,
				sessionEnergyKwh: null,
				rollforwardAnchor: null,
				lastTrustedSnapshot: null,
				profile: baseProfile({ socFallbackMaxAgeMin: 0 }),
			}),
		);
		assert.equal(r.socSource, "unknown");
		assert.equal(r.reasonCode, SOC_ENERGY_REASON_CODES.noUsableSocSource);
	});
});

describe("resolveVehicleSocAndEnergy energy rollforward", () => {
	beforeEach(() => resetAllStoredBaselines());

	it("computes rollforward from baseline, capacity, counter and efficiency", () => {
		const r = resolveVehicleSocAndEnergy(
			baseInput({
				directSocPct: null,
				rollforwardAnchor: baselineCompat({ baselineSocPct: 50, sessionEnergyKwh: 2 }),
				sessionEnergyKwh: 4,
				profile: baseProfile({ batteryCapacityNetKwh: 100, chargeEfficiencyPct: 90 }),
			}),
		);
		assert.equal(r.socSource, "energy_rollforward");
		// baseline 50 kWh + (2 kWh in * 0.9) = 51.8 kWh => 51.8%
		assert.ok(Math.abs((r.resolvedSocPct ?? 0) - 51.8) < 0.01);
	});

	it("clamps at 100%", () => {
		const r = resolveVehicleSocAndEnergy(
			baseInput({
				directSocPct: null,
				rollforwardAnchor: baselineCompat({ baselineSocPct: 99, sessionEnergyKwh: 0 }),
				sessionEnergyKwh: 50,
				profile: baseProfile({ batteryCapacityNetKwh: 100, chargeEfficiencyPct: 100 }),
			}),
		);
		assert.equal(r.resolvedSocPct, 100);
	});

	it("no rollforward without capacity", () => {
		const r = resolveVehicleSocAndEnergy(
			baseInput({
				directSocPct: null,
				rollforwardAnchor: baselineCompat(),
				profile: baseProfile({ batteryCapacityNetKwh: null }),
			}),
		);
		assert.notEqual(r.socSource, "energy_rollforward");
	});

	it("no rollforward without efficiency", () => {
		const r = resolveVehicleSocAndEnergy(
			baseInput({
				directSocPct: null,
				rollforwardAnchor: baselineCompat(),
				profile: baseProfile({ chargeEfficiencyPct: null }),
			}),
		);
		assert.notEqual(r.socSource, "energy_rollforward");
	});

	it("no rollforward without baseline", () => {
		const r = resolveVehicleSocAndEnergy(
			baseInput({ directSocPct: null, rollforwardAnchor: null,
				lastTrustedSnapshot: null, sessionEnergyKwh: 5 }),
		);
		assert.notEqual(r.socSource, "energy_rollforward");
	});

	it("no rollforward for other vehicle baseline", () => {
		const r = resolveVehicleSocAndEnergy(
			baseInput({
				directSocPct: null,
				vehicleId: "car_b",
				profile: baseProfile({ vehicleId: "car_b" }),
				rollforwardAnchor: baselineCompat({ vehicleId: "car_a" }),
			}),
		);
		assert.notEqual(r.socSource, "energy_rollforward");
	});

	it("no negative SOC jump on counter decrease", () => {
		const r = resolveVehicleSocAndEnergy(
			baseInput({
				directSocPct: null,
				rollforwardAnchor: baselineCompat({ baselineSocPct: 60, sessionEnergyKwh: 10 }),
				sessionEnergyKwh: 5,
				rangeKm: null,
				profile: baseProfile({ socFallbackMaxAgeMin: 0 }),
			}),
		);
		assert.notEqual(r.socSource, "energy_rollforward");
		assert.equal(r.reasonCode, SOC_ENERGY_REASON_CODES.energyRollforwardCounterReset);
	});

	it("counter reset invalidates rollforward diff", () => {
		const r = resolveVehicleSocAndEnergy(
			baseInput({
				directSocPct: null,
				rollforwardAnchor: baselineCompat({ sessionEnergyKwh: 8 }),
				sessionEnergyKwh: 0.5,
			}),
		);
		assert.notEqual(r.socSource, "energy_rollforward");
	});

	it("no cross-profile energy in rollforward", () => {
		setRollforwardAnchor(directAnchor({ vehicleId: "car_a", socPct: 80, sessionEnergyKwh: 1 }));
		const r = resolveVehicleSocAndEnergy(
			baseInput({
				vehicleId: "car_b",
				profile: baseProfile({ vehicleId: "car_b" }),
				directSocPct: null,
				sessionEnergyKwh: 5,
			}),
		);
		assert.notEqual(r.socSource, "energy_rollforward");
	});

	it("only positive measured charge energy is applied", () => {
		const r = resolveVehicleSocAndEnergy(
			baseInput({
				directSocPct: null,
				rollforwardAnchor: baselineCompat({ baselineSocPct: 50, sessionEnergyKwh: 5 }),
				sessionEnergyKwh: 5,
			}),
		);
		assert.equal(r.resolvedSocPct, 50);
	});
});

describe("resolveVehicleSocAndEnergy range estimate", () => {
	beforeEach(() => resetAllStoredBaselines());

	it("estimates SOC from range and reference", () => {
		const r = resolveVehicleSocAndEnergy(
			baseInput({
				directSocPct: null,
				rangeKm: 250,
				rollforwardAnchor: null,
				lastTrustedSnapshot: null,
				sessionEnergyKwh: null,
				profile: baseProfile({ referenceRangeAt100PctKm: 500, socFallbackMaxAgeMin: 0 }),
			}),
		);
		assert.equal(r.socSource, "range_estimate");
		assert.equal(r.resolvedSocPct, 50);
	});

	it("clamps range estimate to 0..100", () => {
		const high = resolveVehicleSocAndEnergy(
			baseInput({
				directSocPct: null,
				rangeKm: 900,
				rollforwardAnchor: null,
				lastTrustedSnapshot: null,
				sessionEnergyKwh: null,
				profile: baseProfile({ referenceRangeAt100PctKm: 500, socFallbackMaxAgeMin: 0 }),
			}),
		);
		assert.equal(high.resolvedSocPct, 100);
	});

	it("no estimate without reference range", () => {
		const r = resolveVehicleSocAndEnergy(
			baseInput({
				directSocPct: null,
				rangeKm: 200,
				rollforwardAnchor: null,
				lastTrustedSnapshot: null,
				sessionEnergyKwh: null,
				profile: baseProfile({ referenceRangeAt100PctKm: null, socFallbackMaxAgeMin: 0 }),
			}),
		);
		assert.notEqual(r.socSource, "range_estimate");
	});

	it("no estimate with invalid reference range", () => {
		const r = resolveVehicleSocAndEnergy(
			baseInput({
				directSocPct: null,
				rangeKm: 200,
				rollforwardAnchor: null,
				lastTrustedSnapshot: null,
				sessionEnergyKwh: null,
				profile: baseProfile({ referenceRangeAt100PctKm: 0, socFallbackMaxAgeMin: 0 }),
			}),
		);
		assert.notEqual(r.socSource, "range_estimate");
	});

	it("no estimate when range stale", () => {
		const r = resolveVehicleSocAndEnergy(
			baseInput({
				directSocPct: null,
				rangeKm: 200,
				rangeStale: true,
				rollforwardAnchor: null,
				lastTrustedSnapshot: null,
				sessionEnergyKwh: null,
				profile: baseProfile({ socFallbackMaxAgeMin: 0 }),
			}),
		);
		assert.notEqual(r.socSource, "range_estimate");
	});

	it("negative range is invalid", () => {
		const r = resolveVehicleSocAndEnergy(
			baseInput({
				directSocPct: null,
				rangeKm: -10,
				rollforwardAnchor: null,
				lastTrustedSnapshot: null,
				sessionEnergyKwh: null,
				profile: baseProfile({ socFallbackMaxAgeMin: 0 }),
			}),
		);
		assert.notEqual(r.socSource, "range_estimate");
	});
});

describe("resolveVehicleSocAndEnergy last trusted", () => {
	beforeEach(() => resetAllStoredBaselines());

	it("uses baseline within configured age", () => {
		const r = resolveVehicleSocAndEnergy(
			baseInput({
				directSocPct: null,
				rangeKm: null,
				sessionEnergyKwh: null,
				rollforwardAnchor: null,
				lastTrustedSnapshot: lastTrustedSnap({ socPct: 45 }),
				profile: baseProfile({ socFallbackMaxAgeMin: 120 }),
			}),
		);
		assert.equal(r.socSource, "last_trusted");
		assert.equal(r.resolvedSocPct, 45);
	});

	it("expires after max age", () => {
		const r = resolveVehicleSocAndEnergy(
			baseInput({
				directSocPct: null,
				rangeKm: null,
				sessionEnergyKwh: null,
				rollforwardAnchor: null,
				lastTrustedSnapshot: lastTrustedSnap({
					socPct: 45,
					observedAtMs: NOW.getTime() - 200 * 60_000,
				}),
				profile: baseProfile({ socFallbackMaxAgeMin: 120 }),
			}),
		);
		assert.notEqual(r.socSource, "last_trusted");
	});

	it("disabled without configured max age", () => {
		const r = resolveVehicleSocAndEnergy(
			baseInput({
				directSocPct: null,
				rangeKm: null,
				sessionEnergyKwh: null,
				rollforwardAnchor: null,
				lastTrustedSnapshot: lastTrustedSnap(),
				profile: baseProfile({ socFallbackMaxAgeMin: 0 }),
			}),
		);
		assert.notEqual(r.socSource, "last_trusted");
	});

	it("stays profile isolated", () => {
		const r = resolveVehicleSocAndEnergy(
			baseInput({
				vehicleId: "car_b",
				profile: baseProfile({ vehicleId: "car_b" }),
				directSocPct: null,
				rangeKm: null,
				sessionEnergyKwh: null,
				rollforwardAnchor: null,
				lastTrustedSnapshot: lastTrustedSnap({ vehicleId: "car_a" }),
			}),
		);
		assert.notEqual(r.socSource, "last_trusted");
	});
});

describe("resolveVehicleSocAndEnergy energy calculation", () => {
	beforeEach(() => resetAllStoredBaselines());

	it("computes current, target and required battery energy", () => {
		const r = resolveVehicleSocAndEnergy(baseInput({ directSocPct: 50 }));
		assert.equal(r.currentBatteryEnergyKwh, 38.5);
		assert.equal(r.targetBatteryEnergyKwh, 61.6);
		assert.equal(r.requiredBatteryEnergyKwh, 23.1);
	});

	it("required battery energy is 0 when target below current", () => {
		const r = resolveVehicleSocAndEnergy(
			baseInput({
				directSocPct: 90,
				profile: baseProfile({ defaultTargetSocPct: 80 }),
			}),
		);
		assert.equal(r.requiredBatteryEnergyKwh, 0);
	});

	it("no negative required energy", () => {
		const r = resolveVehicleSocAndEnergy(
			baseInput({ directSocPct: 100, profile: baseProfile({ defaultTargetSocPct: 50 }) }),
		);
		assert.equal(r.requiredBatteryEnergyKwh, 0);
	});

	it("input energy only with configured efficiency", () => {
		const withEff = resolveVehicleSocAndEnergy(baseInput({ directSocPct: 50 }));
		assert.ok(withEff.requiredInputEnergyKwh !== null);
		const withoutEff = resolveVehicleSocAndEnergy(
			baseInput({ directSocPct: 50, profile: baseProfile({ chargeEfficiencyPct: null }) }),
		);
		assert.equal(withoutEff.requiredInputEnergyKwh, null);
	});

	it("missing capacity yields no invented energy", () => {
		const r = resolveVehicleSocAndEnergy(
			baseInput({ directSocPct: 50, profile: baseProfile({ batteryCapacityNetKwh: null }) }),
		);
		assert.equal(r.currentBatteryEnergyKwh, null);
		assert.equal(r.ready, false);
	});

	it("missing target SOC yields no target energy", () => {
		const r = resolveVehicleSocAndEnergy(
			baseInput({ directSocPct: 50, profile: baseProfile({ defaultTargetSocPct: null }) }),
		);
		assert.equal(r.targetBatteryEnergyKwh, null);
		assert.equal(r.ready, false);
	});

	it("results stay finite", () => {
		const r = resolveVehicleSocAndEnergy(baseInput({ directSocPct: 53 }));
		assert.ok(Number.isFinite(r.currentBatteryEnergyKwh ?? NaN));
		assert.ok(Number.isFinite(r.requiredBatteryEnergyKwh ?? NaN));
	});
});

describe("buildSocEnergyInput and profile isolation", () => {
	beforeEach(() => resetAllStoredBaselines());

	it("supports more than four profiles dynamically", () => {
		for (let i = 1; i <= 6; i++) {
			const p = baseProfile({ vehicleId: `car_${i}` });
			const input = buildSocEnergyInput(
				p.vehicleId,
				p,
				{ socPct: 40 + i, rangeKm: null, sessionEnergyKwh: null },
				{ stale: false, socFromConfiguredState: true, socTs: FRESH_TS },
				null,
				null,
				NOW,
			);
			const r = resolveVehicleSocAndEnergy(input);
			assert.equal(r.resolvedSocPct, 40 + i);
		}
	});

	it("empty profile list input still valid at resolver level", () => {
		const r = resolveVehicleSocAndEnergy(
			baseInput({ directSocPct: null, rangeKm: null, sessionEnergyKwh: null, rollforwardAnchor: null, lastTrustedSnapshot: null }),
		);
		assert.equal(r.socSource, "unknown");
	});

	it("profile switch uses only matching baseline", () => {
		setRollforwardAnchor(directAnchor({ vehicleId: "car_a", socPct: 70, sessionEnergyKwh: 1 }));
		clearStoredBaseline("car_b");
		const rB = resolveVehicleSocAndEnergy(
			baseInput({
				vehicleId: "car_b",
				profile: baseProfile({ vehicleId: "car_b" }),
				directSocPct: null,
				rangeKm: null,
				sessionEnergyKwh: 5,
			}),
		);
		assert.notEqual(rB.socSource, "energy_rollforward");
		assert.equal(rB.socSource, "unknown");
	});

	it("stale telemetry timestamps mark field stale", () => {
		const input = buildSocEnergyInput(
			"car_a",
			baseProfile(),
			{ socPct: 40, rangeKm: null, sessionEnergyKwh: null },
			{ stale: false, socFromConfiguredState: true, socTs: STALE_TS },
			null,
			null,
			NOW,
		);
		const r = resolveVehicleSocAndEnergy(input);
		assert.notEqual(r.socSource, "direct");
	});

	it("active_vehicle_id can stay while charging blocked", () => {
		const res = resolveActiveVehicle({
			profiles: [baseProfile()],
			configuredManualVehicleId: "car_a",
			evccDetection: { evccVehicleId: null, evccVehicleName: null },
			evccConnected: false,
			nowIso: NOW.toISOString(),
		});
		assert.equal(res.vehicleId, "car_a");
		assert.equal(res.activeForCharging, false);
	});
});

describe("baseline provenance separation", () => {
	beforeEach(() => resetAllStoredBaselines());

	it("fresh direct SOC creates rollforward anchor", () => {
		const r = resolveVehicleSocAndEnergy(baseInput({ directSocPct: 55 }));
		updateProfileSocPersistenceAfterResolution("car_a", r, 3, NOW);
		const anchor = getRollforwardAnchor("car_a");
		assert.ok(anchor);
		assert.equal(anchor!.rootSource, "direct");
		assert.equal(anchor!.socPct, 55);
	});

	it("range estimate does not create rollforward anchor", () => {
		const r = resolveVehicleSocAndEnergy(
			baseInput({
				directSocPct: null,
				rangeKm: 250,
				sessionEnergyKwh: null,
				rollforwardAnchor: null,
				lastTrustedSnapshot: null,
				profile: baseProfile({ socFallbackMaxAgeMin: 0 }),
			}),
		);
		updateProfileSocPersistenceAfterResolution("car_a", r, null, NOW);
		assert.equal(r.socSource, "range_estimate");
		assert.equal(getRollforwardAnchor("car_a"), null);
	});

	it("last_trusted resolution does not create rollforward anchor", () => {
		const snap = lastTrustedSnap({ socPct: 45 });
		const r = resolveVehicleSocAndEnergy(
			baseInput({
				directSocPct: null,
				rangeKm: null,
				sessionEnergyKwh: null,
				rollforwardAnchor: null,
				lastTrustedSnapshot: snap,
			}),
		);
		updateProfileSocPersistenceAfterResolution("car_a", r, null, NOW);
		assert.equal(r.socSource, "last_trusted");
		assert.equal(getRollforwardAnchor("car_a"), null);
	});

	it("unknown does not create rollforward anchor", () => {
		const r = resolveVehicleSocAndEnergy(
			baseInput({
				directSocPct: null,
				rangeKm: null,
				sessionEnergyKwh: null,
				rollforwardAnchor: null,
				lastTrustedSnapshot: null,
				profile: baseProfile({ socFallbackMaxAgeMin: 0 }),
			}),
		);
		updateProfileSocPersistenceAfterResolution("car_a", r, null, NOW);
		assert.equal(getRollforwardAnchor("car_a"), null);
	});

	it("range estimate updates last-trusted snapshot", () => {
		const r = resolveVehicleSocAndEnergy(
			baseInput({
				directSocPct: null,
				rangeKm: 200,
				sessionEnergyKwh: null,
				rollforwardAnchor: null,
				lastTrustedSnapshot: null,
				profile: baseProfile({ socFallbackMaxAgeMin: 0 }),
			}),
		);
		updateProfileSocPersistenceAfterResolution("car_a", r, null, NOW);
		const snap = getLastTrustedSnapshot("car_a");
		assert.ok(snap);
		assert.equal(snap!.originalSource, "range_estimate");
	});

	it("energy rollforward updates last-trusted snapshot but not anchor root", () => {
		const anchor = directAnchor({ socPct: 50, sessionEnergyKwh: 1 });
		setRollforwardAnchor(anchor);
		const r = resolveVehicleSocAndEnergy(
			baseInput({ directSocPct: null, sessionEnergyKwh: 3, rollforwardAnchor: anchor }),
		);
		updateProfileSocPersistenceAfterResolution("car_a", r, 3, NOW);
		assert.equal(r.socSource, "energy_rollforward");
		const anchorAfter = getRollforwardAnchor("car_a");
		assert.equal(anchorAfter!.socPct, 50);
		assert.equal(anchorAfter!.observedAtMs, anchor.observedAtMs);
		assert.equal(getLastTrustedSnapshot("car_a")!.originalSource, "energy_rollforward");
	});

	it("last_trusted does not renew snapshot timestamp", () => {
		const originalMs = NOW.getTime() - 90 * 60_000;
		setLastTrustedSnapshot(lastTrustedSnap({ socPct: 42, observedAtMs: originalMs }));
		const r = resolveVehicleSocAndEnergy(
			baseInput({
				directSocPct: null,
				rangeKm: null,
				sessionEnergyKwh: null,
				rollforwardAnchor: null,
				lastTrustedSnapshot: lastTrustedSnap({ socPct: 42, observedAtMs: originalMs }),
			}),
		);
		updateProfileSocPersistenceAfterResolution("car_a", r, null, NOW);
		assert.equal(getLastTrustedSnapshot("car_a")!.observedAtMs, originalMs);
	});

	it("repeated last_trusted expires from original timestamp", () => {
		const originalMs = NOW.getTime() - 130 * 60_000;
		const snap = lastTrustedSnap({ socPct: 42, observedAtMs: originalMs });
		const r = resolveVehicleSocAndEnergy(
			baseInput({
				directSocPct: null,
				rangeKm: null,
				sessionEnergyKwh: null,
				rollforwardAnchor: null,
				lastTrustedSnapshot: snap,
				profile: baseProfile({ socFallbackMaxAgeMin: 120 }),
			}),
		);
		assert.notEqual(r.socSource, "last_trusted");
	});

	it("range estimate cannot become energy_rollforward via session energy", () => {
		setLastTrustedSnapshot(
			lastTrustedSnap({ socPct: 40, originalSource: "range_estimate", quality: "low" }),
		);
		const r = resolveVehicleSocAndEnergy(
			baseInput({
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
			}),
		);
		assert.notEqual(r.socSource, "energy_rollforward");
	});

	it("last_trusted snapshot cannot seed energy_rollforward medium upgrade", () => {
		const r = resolveVehicleSocAndEnergy(
			baseInput({
				directSocPct: null,
				sessionEnergyKwh: 10,
				rollforwardAnchor: null,
				lastTrustedSnapshot: lastTrustedSnap({ socPct: 40 }),
				profile: baseProfile({ socFallbackMaxAgeMin: 0 }),
			}),
		);
		assert.notEqual(r.socSource, "energy_rollforward");
	});

	it("direct/high can roll forward to energy_rollforward/medium", () => {
		const r = resolveVehicleSocAndEnergy(
			baseInput({
				directSocPct: null,
				sessionEnergyKwh: 4,
				rollforwardAnchor: directAnchor({ socPct: 50, sessionEnergyKwh: 2 }),
			}),
		);
		assert.equal(r.socSource, "energy_rollforward");
		assert.equal(r.socQuality, "medium");
	});

	it("rollforward keeps root provenance direct across cycles", () => {
		setRollforwardAnchor(directAnchor({ socPct: 50, sessionEnergyKwh: 1 }));
		const first = resolveVehicleSocAndEnergy(
			baseInput({ directSocPct: null, sessionEnergyKwh: 3, rollforwardAnchor: getRollforwardAnchor("car_a") }),
		);
		updateProfileSocPersistenceAfterResolution("car_a", first, 3, NOW);
		const second = resolveVehicleSocAndEnergy(
			baseInput({ directSocPct: null, sessionEnergyKwh: 5, rollforwardAnchor: getRollforwardAnchor("car_a") }),
		);
		assert.equal(second.socSource, "energy_rollforward");
		assert.equal(getRollforwardAnchor("car_a")!.rootSource, "direct");
		assert.equal(getRollforwardAnchor("car_a")!.socPct, 50);
	});

	it("profile switch isolates rollforward anchor", () => {
		setRollforwardAnchor(directAnchor({ vehicleId: "car_a", socPct: 60, sessionEnergyKwh: 1 }));
		const r = resolveVehicleSocAndEnergy(
			baseInput({
				vehicleId: "car_b",
				profile: baseProfile({ vehicleId: "car_b" }),
				directSocPct: null,
				sessionEnergyKwh: 5,
				rollforwardAnchor: null,
			}),
		);
		assert.notEqual(r.socSource, "energy_rollforward");
	});

	it("counter reset invalidates rollforward from direct anchor", () => {
		const r = resolveVehicleSocAndEnergy(
			baseInput({
				directSocPct: null,
				rangeKm: null,
				sessionEnergyKwh: 1,
				lastTrustedSnapshot: null,
				rollforwardAnchor: directAnchor({ socPct: 50, sessionEnergyKwh: 5 }),
				profile: baseProfile({ socFallbackMaxAgeMin: 0 }),
			}),
		);
		assert.notEqual(r.socSource, "energy_rollforward");
		assert.equal(r.reasonCode, SOC_ENERGY_REASON_CODES.energyRollforwardCounterReset);
	});

	it("range update does not overwrite valid direct rollforward anchor", () => {
		setRollforwardAnchor(directAnchor({ socPct: 55, sessionEnergyKwh: 2 }));
		const r = resolveVehicleSocAndEnergy(
			baseInput({
				directSocPct: null,
				rangeKm: 300,
				sessionEnergyKwh: null,
				rollforwardAnchor: getRollforwardAnchor("car_a"),
				lastTrustedSnapshot: null,
				profile: baseProfile({ socFallbackMaxAgeMin: 0 }),
			}),
		);
		updateProfileSocPersistenceAfterResolution("car_a", r, null, NOW);
		assert.equal(getRollforwardAnchor("car_a")!.socPct, 55);
		assert.equal(r.socSource, "range_estimate");
	});

	it("restart hydration restores direct anchor only from baseline states", () => {
		resetAllStoredBaselines();
		hydrateProfileSocPersistenceFromLegacyStates("car_a", {
			baselineSocPct: 48,
			baselineSocSource: "direct",
			baselineAt: NOW.toISOString(),
			sessionEnergyKwh: 1.5,
		});
		assert.ok(getRollforwardAnchor("car_a"));
	});

	it("connected=false does not change source semantics", () => {
		const r = resolveVehicleSocAndEnergy(baseInput({ directSocPct: 0 }));
		assert.equal(r.socSource, "direct");
		const res = resolveActiveVehicle({
			profiles: [baseProfile()],
			configuredManualVehicleId: "car_a",
			evccDetection: { evccVehicleId: null, evccVehicleName: null },
			evccConnected: false,
			nowIso: NOW.toISOString(),
		});
		assert.equal(res.activeForCharging, false);
	});
});

describe("runtime safety regression", () => {
	it("release gate is open (gated by fault/lockout/ownership/liveEligible)", () => {
		assert.equal(WALLBOX_LIVE_WRITE_RELEASED, true);
	});

	it("vehicle runtime module does not import dispatch or write execution", () => {
		const src = readFileSync(join(process.cwd(), "src/addons/wallbox/vehicles/runtime.ts"), "utf8");
		assert.ok(!src.includes("runWallboxDryrunDispatch"));
		assert.ok(!src.includes("executeWallboxWrite"));
		assert.ok(!src.includes("setForeignState"));
	});
});
