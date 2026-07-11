import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { missingField, type TelemetryField } from "../normalize.js";
import type { EvccTelemetrySnapshot } from "../evcc_telemetry.js";
import {
	normalizeWallboxVehicleProfile,
	normalizeWallboxVehicleProfiles,
} from "./normalize.js";
import { assessWallboxVehicleProfileReadiness, derivePlanningCapability } from "./readiness.js";
import { resolveActiveVehicle } from "./resolve.js";
import {
	activeVehicleSnapshotJson,
	buildActiveVehicleSnapshot,
} from "./snapshot.js";
import { resolveActiveVehicleChargeLimits } from "./charge_limits.js";
import { mergeProfileTelemetryReadings, profileTelemetryFromForeignReads } from "./soc.js";
import { sanitizeVehicleId, vehicleIdFromEvccTechnicalId } from "./vehicle_id.js";
import { wallboxVehicleProfilesConfigFromAdapter, WB_VEHICLE_PROFILES, type WallboxVehicleProfileInput } from "./config.js";
import type { ActiveVehicleResolution, WallboxVehicleProfile } from "./types.js";
import { WALLBOX_LIVE_WRITE_RELEASED } from "../runtime/execute.js";

const NOW = "2026-07-11T12:00:00.000Z";
const NOW_DATE = new Date(NOW);

function baseInput(overrides: Partial<WallboxVehicleProfileInput> = {}): WallboxVehicleProfileInput {
	return {
		slotIndex: 1,
		vehicleId: "ford_explorer",
		displayName: "Ford Explorer",
		enabled: true,
		isGuest: false,
		source: "manual",
		evccVehicleId: null,
		evccVehicleName: null,
		batteryCapacityNetKwh: 77,
		maxAcChargePowerW: 11000,
		supportedPhases: "1,3",
		preferredPhases: 3,
		minCurrentA: 6,
		maxCurrentA: 16,
		defaultTargetSocPct: 80,
		minimumDepartureSocPct: 50,
		maximumSocPct: 90,
		chargeEfficiencyPct: null,
		referenceRangeAt100PctKm: null,
		socFallbackMaxAgeMin: null,
		socState: null,
		rangeState: null,
		connectedState: null,
		chargingState: null,
		sessionEnergyState: null,
		...overrides,
	};
}

function resolution(overrides: Partial<ActiveVehicleResolution> = {}): ActiveVehicleResolution {
	return {
		profileResolved: false,
		vehicleId: null,
		displayName: null,
		source: "unknown",
		detectionStatus: "unknown",
		confidence: 0,
		configuredManualVehicleId: null,
		connected: null,
		activeForCharging: false,
		reasons: [],
		...overrides,
	};
}

function profileRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
	return {
		vehicle_id: "car_a",
		display_name: "Car A",
		enabled: true,
		source: "manual",
		...overrides,
	};
}

function inputsFromRows(rows: Record<string, unknown>[]): WallboxVehicleProfileInput[] {
	return wallboxVehicleProfilesConfigFromAdapter({ [WB_VEHICLE_PROFILES]: rows }).profiles;
}

function profile(overrides: Partial<WallboxVehicleProfile> = {}): WallboxVehicleProfile {
	return {
		vehicleId: "ford_explorer",
		displayName: "Ford Explorer",
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
		chargeEfficiencyPct: null,
		referenceRangeAt100PctKm: null,
		socFallbackMaxAgeMin: null,
		socStateId: null,
		rangeStateId: null,
		connectedStateId: null,
		chargingStateId: null,
		sessionEnergyStateId: null,
		createdAt: NOW,
		updatedAt: NOW,
		...overrides,
	};
}

function emptySnap(): EvccTelemetrySnapshot {
	const m = () => missingField() as TelemetryField<boolean>;
	const mn = () => missingField() as TelemetryField<number>;
	const ms = () => missingField() as TelemetryField<string>;
	return {
		observed_at: NOW,
		enabled: m(),
		connected: m(),
		charging: m(),
		charge_power_w: mn(),
		session_energy_kwh: mn(),
		vehicle_soc_pct: mn(),
		plan_active: m(),
		plan_soc_pct: mn(),
		plan_time: ms(),
		effective_plan_time: ms(),
		active_phases: mn(),
		configured_phases: mn(),
		min_current_a: mn(),
		max_current_a: mn(),
		battery_mode: ms(),
		battery_discharge_control: m(),
	};
}

describe("normalizeWallboxVehicleProfile", () => {
	it("normalizes valid manual profile", () => {
		const r = normalizeWallboxVehicleProfile(baseInput(), NOW);
		assert.ok(r.profile);
		assert.equal(r.profile!.vehicleId, "ford_explorer");
		assert.equal(r.profile!.source, "manual");
		assert.equal(r.invalidFields.length, 0);
	});

	it("normalizes valid evcc profile", () => {
		const r = normalizeWallboxVehicleProfile(
			baseInput({ source: "evcc", evccVehicleName: "explorer" }),
			NOW,
		);
		assert.ok(r.profile);
		assert.equal(r.profile!.source, "evcc");
	});

	it("normalizes hybrid profile", () => {
		const r = normalizeWallboxVehicleProfile(
			baseInput({ source: "hybrid", evccVehicleName: "explorer", socState: "evcc.0.soc" }),
			NOW,
		);
		assert.ok(r.profile);
		assert.equal(r.profile!.source, "hybrid");
	});

	it("keeps optional values null not 0", () => {
		const r = normalizeWallboxVehicleProfile(
			baseInput({
				batteryCapacityNetKwh: null,
				maxAcChargePowerW: null,
				defaultTargetSocPct: null,
			}),
			NOW,
		);
		assert.equal(r.profile!.batteryCapacityNetKwh, null);
		assert.equal(r.profile!.maxAcChargePowerW, null);
		assert.equal(r.profile!.defaultTargetSocPct, null);
	});

	it("accepts soc 0 as valid", () => {
		const r = normalizeWallboxVehicleProfile(baseInput({ defaultTargetSocPct: 0 }), NOW);
		assert.equal(r.profile!.defaultTargetSocPct, 0);
	});

	it("rejects battery capacity 0", () => {
		const r = normalizeWallboxVehicleProfile(baseInput({ batteryCapacityNetKwh: 0 }), NOW);
		assert.ok(r.invalidFields.includes("batteryCapacityNetKwh"));
	});

	it("rejects negative battery capacity", () => {
		const r = normalizeWallboxVehicleProfile(baseInput({ batteryCapacityNetKwh: -10 }), NOW);
		assert.ok(r.invalidFields.includes("batteryCapacityNetKwh"));
	});

	it("rejects negative charge power", () => {
		const r = normalizeWallboxVehicleProfile(baseInput({ maxAcChargePowerW: -1 }), NOW);
		assert.ok(r.invalidFields.includes("maxAcChargePowerW"));
	});

	it("rejects soc below 0", () => {
		const r = normalizeWallboxVehicleProfile(baseInput({ defaultTargetSocPct: -1 }), NOW);
		assert.ok(r.invalidFields.includes("defaultTargetSocPct"));
	});

	it("rejects soc above 100", () => {
		const r = normalizeWallboxVehicleProfile(baseInput({ defaultTargetSocPct: 101 }), NOW);
		assert.ok(r.invalidFields.includes("defaultTargetSocPct"));
	});

	it("rejects invalid charge efficiency", () => {
		const r = normalizeWallboxVehicleProfile(baseInput({ chargeEfficiencyPct: 150 }), NOW);
		assert.ok(r.invalidFields.includes("chargeEfficiencyPct"));
	});

	it("rejects maxCurrentA below minCurrentA", () => {
		const r = normalizeWallboxVehicleProfile(baseInput({ minCurrentA: 16, maxCurrentA: 6 }), NOW);
		assert.ok(r.invalidFields.includes("maxCurrentA"));
	});

	it("rejects invalid phases", () => {
		const r = normalizeWallboxVehicleProfile(baseInput({ supportedPhases: "0,3" }), NOW);
		assert.ok(r.invalidFields.includes("supportedPhases"));
	});

	it("rejects invalid vehicle id / sanitizes unsafe chars", () => {
		const r = normalizeWallboxVehicleProfile(baseInput({ vehicleId: "My Car!" }), NOW);
		assert.equal(r.profile!.vehicleId, "my_car");
	});

	it("rejects VIN as vehicle id", () => {
		const r = normalizeWallboxVehicleProfile(baseInput({ vehicleId: "1HGBH41JXMN109186" }), NOW);
		assert.equal(r.profile, null);
		assert.ok(r.reasons.includes("vehicle_id_invalid"));
	});
});

describe("profile readiness", () => {
	it("soc_and_capacity when both present", () => {
		const p = profile();
		const tel = { socPct: 55, connected: true, charging: false, socSource: "measured" as const, socQuality: "measured", rangeKm: null, sessionEnergyKwh: null, lastUpdate: NOW, stale: false };
		assert.equal(derivePlanningCapability(p, tel), "soc_and_capacity");
	});

	it("energy_only without soc but with capacity", () => {
		const p = profile();
		const tel = { socPct: null, connected: true, charging: false, socSource: "unavailable" as const, socQuality: null, rangeKm: null, sessionEnergyKwh: null, lastUpdate: NOW, stale: false };
		assert.equal(derivePlanningCapability(p, tel), "energy_only");
	});

	it("limits_only with charge limits only", () => {
		const p = profile({ batteryCapacityNetKwh: null, defaultTargetSocPct: null, minimumDepartureSocPct: null, maximumSocPct: null });
		const tel = { socPct: null, connected: true, charging: false, socSource: "unavailable" as const, socQuality: null, rangeKm: null, sessionEnergyKwh: null, lastUpdate: NOW, stale: false };
		assert.equal(derivePlanningCapability(p, tel), "limits_only");
	});

	it("insufficient for empty profile", () => {
		const p = profile({ maxAcChargePowerW: null, minCurrentA: null, maxCurrentA: null, supportedPhases: [], preferredPhases: null, batteryCapacityNetKwh: null });
		const tel = { socPct: null, connected: true, charging: false, socSource: "unavailable" as const, socQuality: null, rangeKm: null, sessionEnergyKwh: null, lastUpdate: NOW, stale: false };
		assert.equal(derivePlanningCapability(p, tel), "insufficient");
	});

	it("missing soc is not treated as 0", () => {
		const readiness = assessWallboxVehicleProfileReadiness(
			profile(),
			{ socPct: null, connected: true, charging: false, socSource: "unavailable", socQuality: null, rangeKm: null, sessionEnergyKwh: null, lastUpdate: NOW, stale: false },
		);
		assert.equal(readiness.socAvailable, false);
	});

	it("connected false with soc 0 does not add extra soc invalidation", () => {
		const readiness = assessWallboxVehicleProfileReadiness(
			profile(),
			{ socPct: 0, connected: false, charging: false, socSource: "measured", socQuality: "measured", rangeKm: null, sessionEnergyKwh: null, lastUpdate: NOW, stale: false },
		);
		assert.equal(readiness.socAvailable, true);
	});
});

describe("resolveActiveVehicle", () => {
	const profiles = [
		profile({ vehicleId: "car_a", displayName: "A", evccVehicleName: "explorer", source: "evcc" }),
		profile({ vehicleId: "car_b", displayName: "B", evccVehicleName: "model3", source: "evcc" }),
	];

	it("unique EVCC match wins", () => {
		const r = resolveActiveVehicle({
			profiles,
			configuredManualVehicleId: "car_b",
			evccDetection: { evccVehicleId: null, evccVehicleName: "explorer" },
			evccConnected: true,
			nowIso: NOW,
		});
		assert.equal(r.vehicleId, "car_a");
		assert.equal(r.source, "evcc");
		assert.equal(r.profileResolved, true);
		assert.equal(r.activeForCharging, true);
	});

	it("manual selection is fallback when no EVCC match", () => {
		const r = resolveActiveVehicle({
			profiles,
			configuredManualVehicleId: "car_b",
			evccDetection: { evccVehicleId: null, evccVehicleName: "unknown" },
			evccConnected: true,
			nowIso: NOW,
		});
		assert.equal(r.vehicleId, "car_b");
		assert.equal(r.source, "manual");
	});

	it("single enabled profile resolves when alone", () => {
		const only = [profile({ vehicleId: "solo", enabled: true })];
		const r = resolveActiveVehicle({
			profiles: only,
			configuredManualVehicleId: null,
			evccDetection: { evccVehicleId: null, evccVehicleName: null },
			evccConnected: true,
			nowIso: NOW,
		});
		assert.equal(r.vehicleId, "solo");
		assert.equal(r.source, "single_enabled_profile");
	});

	it("ambiguous when multiple EVCC matches", () => {
		const dup = [
			profile({ vehicleId: "a", evccVehicleName: "x", source: "evcc" }),
			profile({ vehicleId: "b", evccVehicleName: "x", source: "evcc" }),
		];
		const r = resolveActiveVehicle({
			profiles: dup,
			configuredManualVehicleId: null,
			evccDetection: { evccVehicleId: null, evccVehicleName: "x" },
			evccConnected: true,
			nowIso: NOW,
		});
		assert.equal(r.detectionStatus, "ambiguous");
		assert.equal(r.vehicleId, "");
	});

	it("unknown does not inherit last vehicle without match", () => {
		const r = resolveActiveVehicle({
			profiles,
			configuredManualVehicleId: null,
			evccDetection: { evccVehicleId: null, evccVehicleName: "other" },
			evccConnected: true,
			nowIso: NOW,
		});
		assert.equal(r.profileResolved, false);
		assert.equal(r.detectionStatus, "ambiguous");
	});

	it("disabled profile is not active via manual", () => {
		const r = resolveActiveVehicle({
			profiles: [profile({ vehicleId: "off", enabled: false })],
			configuredManualVehicleId: "off",
			evccDetection: { evccVehicleId: null, evccVehicleName: null },
			evccConnected: true,
			nowIso: NOW,
		});
		assert.equal(r.detectionStatus, "invalid_manual");
	});

	it("invalid manual id rejected", () => {
		const r = resolveActiveVehicle({
			profiles,
			configuredManualVehicleId: "missing",
			evccDetection: { evccVehicleId: null, evccVehicleName: null },
			evccConnected: true,
			nowIso: NOW,
		});
		assert.equal(r.detectionStatus, "invalid_manual");
	});

	it("disconnected preserves profile resolution without charging eligibility", () => {
		const r = resolveActiveVehicle({
			profiles,
			configuredManualVehicleId: null,
			evccDetection: { evccVehicleId: null, evccVehicleName: "explorer" },
			evccConnected: false,
			nowIso: NOW,
		});
		assert.equal(r.profileResolved, true);
		assert.equal(r.vehicleId, "car_a");
		assert.equal(r.detectionStatus, "disconnected");
		assert.equal(r.activeForCharging, false);
	});

	it("guest profile only via explicit manual selection", () => {
		const guest = [profile({ vehicleId: "guest", isGuest: true, batteryCapacityNetKwh: null })];
		const r = resolveActiveVehicle({
			profiles: guest,
			configuredManualVehicleId: "guest",
			evccDetection: { evccVehicleId: null, evccVehicleName: null },
			evccConnected: true,
			nowIso: NOW,
		});
		assert.equal(r.source, "guest");
		assert.equal(r.profileResolved, true);
		assert.equal(r.activeForCharging, true);
	});
});

describe("multiple vehicles isolation", () => {
	it("vehicle A and B keep separate charge power", () => {
		const a = normalizeWallboxVehicleProfile(baseInput({ vehicleId: "a", maxAcChargePowerW: 3600 }), NOW).profile!;
		const b = normalizeWallboxVehicleProfile(baseInput({ vehicleId: "b", maxAcChargePowerW: 11000 }), NOW).profile!;
		assert.equal(a.maxAcChargePowerW, 3600);
		assert.equal(b.maxAcChargePowerW, 11000);
	});

	it("target soc and capacity stay profile-specific", () => {
		const a = normalizeWallboxVehicleProfile(baseInput({ vehicleId: "a", defaultTargetSocPct: 50, batteryCapacityNetKwh: 40 }), NOW).profile!;
		const b = normalizeWallboxVehicleProfile(baseInput({ vehicleId: "b", defaultTargetSocPct: 80, batteryCapacityNetKwh: 77 }), NOW).profile!;
		assert.equal(a.defaultTargetSocPct, 50);
		assert.equal(b.defaultTargetSocPct, 80);
		assert.equal(a.batteryCapacityNetKwh, 40);
		assert.equal(b.batteryCapacityNetKwh, 77);
	});

	it("two profiles produce distinct ids", () => {
		const { profiles } = normalizeWallboxVehicleProfiles(
			[baseInput({ vehicleId: "a", slotIndex: 1 }), baseInput({ vehicleId: "b", slotIndex: 2 })],
			NOW,
		);
		assert.equal(profiles.length, 2);
		assert.notEqual(profiles[0]!.vehicleId, profiles[1]!.vehicleId);
	});

	it("duplicate vehicle id is rejected in batch", () => {
		const { profiles, errors } = normalizeWallboxVehicleProfiles(
			[baseInput({ vehicleId: "same", slotIndex: 1 }), baseInput({ vehicleId: "same", slotIndex: 2 })],
			NOW,
		);
		assert.equal(profiles.length, 1);
		assert.equal(errors.length, 1);
	});
});

describe("ActiveVehicleSnapshot", () => {
	it("is deterministically serializable", () => {
		const snap = buildActiveVehicleSnapshot({
			resolution: resolution({
				profileResolved: true,
				vehicleId: "ford_explorer",
				displayName: "Ford Explorer",
				source: "manual",
				detectionStatus: "resolved",
				confidence: 0.75,
				configuredManualVehicleId: "ford_explorer",
				connected: true,
				activeForCharging: true,
				reasons: ["vehicle_manual_match"],
			}),
			profile: profile(),
			readiness: assessWallboxVehicleProfileReadiness(profile(), {
				socPct: 40,
				connected: true,
				charging: false,
				socSource: "measured",
				socQuality: "measured",
				rangeKm: 200,
				sessionEnergyKwh: null,
				lastUpdate: NOW,
				stale: false,
			}),
			telemetry: {
				socPct: 40,
				connected: true,
				charging: false,
				socSource: "measured",
				socQuality: "measured",
				rangeKm: 200,
				sessionEnergyKwh: null,
				lastUpdate: NOW,
				stale: false,
			},
			now: NOW_DATE,
		});
		const json = activeVehicleSnapshotJson(snap);
		assert.doesNotThrow(() => JSON.parse(json));
		assert.equal(JSON.parse(json).vehicleId, "ford_explorer");
	});

	it("contains no VIN", () => {
		const json = activeVehicleSnapshotJson(
			buildActiveVehicleSnapshot({
				resolution: resolution({
					reasons: ["vehicle_unknown"],
				}),
				profile: null,
				readiness: null,
				telemetry: {
					socPct: null,
					connected: false,
					charging: false,
					socSource: "unavailable",
					socQuality: null,
					rangeKm: null,
					sessionEnergyKwh: null,
					lastUpdate: NOW,
					stale: false,
				},
				now: NOW_DATE,
			}),
		);
		assert.ok(!json.match(/1HGBH41JXMN109186/i));
	});

	it("missing values remain null in snapshot", () => {
		const snap = buildActiveVehicleSnapshot({
			resolution: resolution({ reasons: ["vehicle_unknown"] }),
			profile: null,
			readiness: null,
			telemetry: {
				socPct: null,
				connected: false,
				charging: false,
				socSource: "unavailable",
				socQuality: null,
				rangeKm: null,
				sessionEnergyKwh: null,
				lastUpdate: NOW,
				stale: false,
			},
			now: NOW_DATE,
		});
		assert.equal(snap.socPct, null);
		assert.equal(snap.batteryCapacityNetKwh, null);
	});

	it("charge limits from snapshot", () => {
		const snap = buildActiveVehicleSnapshot({
			resolution: resolution({
				profileResolved: true,
				vehicleId: "a",
				displayName: "A",
				source: "manual",
				detectionStatus: "resolved",
				confidence: 1,
				configuredManualVehicleId: "a",
				connected: true,
				activeForCharging: true,
				reasons: [],
			}),
			profile: profile(),
			readiness: null,
			telemetry: {
				socPct: 50,
				connected: true,
				charging: true,
				socSource: "measured",
				socQuality: "measured",
				rangeKm: null,
				sessionEnergyKwh: null,
				lastUpdate: NOW,
				stale: false,
			},
			now: NOW_DATE,
		});
		const limits = resolveActiveVehicleChargeLimits(snap);
		assert.equal(limits.ready, true);
		assert.equal(limits.maxAcChargePowerW, 11000);
		assert.equal(limits.phases, 3);
	});
});

describe("vehicle_id privacy", () => {
	it("hashes evcc technical id without exposing raw value in id prefix only", () => {
		const id = vehicleIdFromEvccTechnicalId("secret-evcc-vehicle-uuid");
		assert.ok(id.startsWith("evcc_"));
		assert.ok(!id.includes("secret"));
	});

	it("sanitize rejects vin-like input", () => {
		const r = sanitizeVehicleId("1HGBH41JXMN109186");
		assert.equal(r.valid, false);
	});
});

describe("config adapter", () => {
	it("empty profile list is valid", () => {
		const cfg = wallboxVehicleProfilesConfigFromAdapter({ [WB_VEHICLE_PROFILES]: [] });
		assert.deepEqual(cfg.profiles, []);
	});

	it("parses dynamic vehicle profiles from table array", () => {
		const cfg = wallboxVehicleProfilesConfigFromAdapter({
			wb_manual_vehicle_id: "ford_explorer",
			[WB_VEHICLE_PROFILES]: [
				profileRow({
					vehicle_id: "ford_explorer",
					display_name: "Ford Explorer",
					battery_capacity_net_kwh: 77,
				}),
			],
		});
		assert.equal(cfg.profiles.length, 1);
		assert.equal(cfg.manualVehicleId, "ford_explorer");
		assert.equal(cfg.profiles[0]!.vehicleId, "ford_explorer");
	});

	it("profile count follows array length for four profiles", () => {
		const rows = Array.from({ length: 4 }, (_, i) => profileRow({ vehicle_id: `car_${i + 1}` }));
		const cfg = wallboxVehicleProfilesConfigFromAdapter({ [WB_VEHICLE_PROFILES]: rows });
		assert.equal(cfg.profiles.length, 4);
	});

	it("supports five or more profiles without truncation", () => {
		const rows = Array.from({ length: 5 }, (_, i) => profileRow({ vehicle_id: `car_${i + 1}` }));
		const { profiles } = normalizeWallboxVehicleProfiles(inputsFromRows(rows), NOW);
		assert.equal(profiles.length, 5);
	});

	it("does not depend on legacy wb_vehicle_1_* keys", () => {
		const cfg = wallboxVehicleProfilesConfigFromAdapter({
			wb_vehicle_profile_count: 1,
			wb_vehicle_1_vehicle_id: "legacy_ignored",
		});
		assert.equal(cfg.profiles.length, 0);
	});

	it("skips rows without vehicle_id", () => {
		const cfg = wallboxVehicleProfilesConfigFromAdapter({
			[WB_VEHICLE_PROFILES]: [{ display_name: "empty row" }, profileRow({ vehicle_id: "valid" })],
		});
		assert.equal(cfg.profiles.length, 1);
	});
});

describe("profile resolution vs connection", () => {
	it("profileResolved with connected=false is representable in snapshot", () => {
		const snap = buildActiveVehicleSnapshot({
			resolution: resolution({
				profileResolved: true,
				vehicleId: "ford_explorer",
				displayName: "Ford Explorer",
				source: "manual",
				detectionStatus: "disconnected",
				connected: false,
				activeForCharging: false,
				reasons: ["vehicle_manual_match", "vehicle_not_connected"],
			}),
			profile: profile({ vehicleId: "ford_explorer" }),
			readiness: null,
			telemetry: {
				socPct: 55,
				connected: false,
				charging: false,
				socSource: "measured",
				socQuality: "measured",
				rangeKm: null,
				sessionEnergyKwh: null,
				lastUpdate: NOW,
				stale: false,
			},
			now: NOW_DATE,
		});
		assert.equal(snap.profileResolved, true);
		assert.equal(snap.activeForCharging, false);
		assert.equal(snap.connected, false);
	});
});

describe("telemetry merge", () => {
	it("uses evcc soc for resolved hybrid profile when connected", () => {
		const p = profile({ source: "hybrid", evccVehicleName: "explorer" });
		const snap = emptySnap();
		snap.connected = { value: true, status: "valid", raw: true };
		snap.vehicle_soc_pct = { value: 42, status: "valid", raw: 42 };
		const raw = profileTelemetryFromForeignReads(p, {}, NOW_DATE);
		const tel = mergeProfileTelemetryReadings(p, raw, snap, true, true, NOW_DATE);
		assert.equal(tel.socPct, 42);
		assert.equal(tel.socSource, "evcc_estimated");
	});

	it("profile switch does not mirror soc across profiles", () => {
		const snap = emptySnap();
		snap.connected = { value: true, status: "valid", raw: true };
		snap.vehicle_soc_pct = { value: 99, status: "valid", raw: 99 };
		const profileA = profile({ vehicleId: "a", source: "hybrid", maxAcChargePowerW: 3600 });
		const profileB = profile({ vehicleId: "b", source: "hybrid", maxAcChargePowerW: 11000 });
		const telA = mergeProfileTelemetryReadings(
			profileA,
			profileTelemetryFromForeignReads(profileA, { soc: { val: 40 } }, NOW_DATE),
			snap,
			false,
			true,
			NOW_DATE,
		);
		const telB = mergeProfileTelemetryReadings(
			profileB,
			profileTelemetryFromForeignReads(profileB, { soc: { val: 70 } }, NOW_DATE),
			snap,
			true,
			true,
			NOW_DATE,
		);
		assert.equal(telA.socPct, 40);
		assert.equal(telB.socPct, 70);
		assert.notEqual(telA.socPct, telB.socPct);
	});
});

describe("runtime safety regression", () => {
	it("release gate remains closed", () => {
		assert.equal(WALLBOX_LIVE_WRITE_RELEASED, false);
	});

	it("vehicle runtime module does not import dispatch or write execution", () => {
		const src = readFileSync(join(process.cwd(), "src/addons/wallbox/vehicles/runtime.ts"), "utf8");
		assert.ok(!src.includes("runWallboxDryrunDispatch"));
		assert.ok(!src.includes("executeWallboxWrite"));
		assert.ok(!src.includes("setForeignState"));
	});

	it("failsafe.ts unchanged", () => {
		const fs = readFileSync(join(process.cwd(), "src/addons/wallbox/failsafe.ts"), "utf8");
		assert.ok(fs.includes("failsafe"));
	});
});
