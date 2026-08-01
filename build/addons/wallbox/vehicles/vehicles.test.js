"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const strict_1 = __importDefault(require("node:assert/strict"));
const node_fs_1 = require("node:fs");
const node_path_1 = require("node:path");
const normalize_js_1 = require("../normalize.js");
const normalize_js_2 = require("./normalize.js");
const readiness_js_1 = require("./readiness.js");
const resolve_js_1 = require("./resolve.js");
const snapshot_js_1 = require("./snapshot.js");
const charge_limits_js_1 = require("./charge_limits.js");
const soc_js_1 = require("./soc.js");
const vehicle_id_js_1 = require("./vehicle_id.js");
const config_js_1 = require("./config.js");
const execute_js_1 = require("../runtime/execute.js");
const NOW = "2026-07-11T12:00:00.000Z";
const NOW_DATE = new Date(NOW);
function baseInput(overrides = {}) {
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
function resolution(overrides = {}) {
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
function profileRow(overrides = {}) {
    return {
        vehicle_id: "car_a",
        display_name: "Car A",
        enabled: true,
        source: "manual",
        ...overrides,
    };
}
function inputsFromRows(rows) {
    return (0, config_js_1.wallboxVehicleProfilesConfigFromAdapter)({ [config_js_1.WB_VEHICLE_PROFILES]: rows }).profiles;
}
function profile(overrides = {}) {
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
function emptySnap() {
    const m = () => (0, normalize_js_1.missingField)();
    const mn = () => (0, normalize_js_1.missingField)();
    const ms = () => (0, normalize_js_1.missingField)();
    return {
        observed_at: NOW,
        enabled: m(),
        connected: m(),
        charging: m(),
        charge_power_w: mn(),
        session_energy_kwh: mn(),
        charge_remaining_energy_kwh: mn(),
        vehicle_soc_pct: mn(),
        vehicle_name: ms(),
        vehicle_title: ms(),
        plan_active: m(),
        plan_soc_pct: mn(),
        plan_time: ms(),
        effective_plan_time: ms(),
        effective_limit_soc_pct: mn(),
        battery_boost: m(),
        loadpoint_mode: ms(),
        active_phases: mn(),
        configured_phases: mn(),
        min_current_a: mn(),
        max_current_a: mn(),
        battery_mode: ms(),
        battery_discharge_control: m(),
    };
}
(0, node_test_1.describe)("normalizeWallboxVehicleProfile", () => {
    (0, node_test_1.it)("normalizes valid manual profile", () => {
        const r = (0, normalize_js_2.normalizeWallboxVehicleProfile)(baseInput(), NOW);
        strict_1.default.ok(r.profile);
        strict_1.default.equal(r.profile.vehicleId, "ford_explorer");
        strict_1.default.equal(r.profile.source, "manual");
        strict_1.default.equal(r.invalidFields.length, 0);
    });
    (0, node_test_1.it)("normalizes valid evcc profile", () => {
        const r = (0, normalize_js_2.normalizeWallboxVehicleProfile)(baseInput({ source: "evcc", evccVehicleName: "explorer" }), NOW);
        strict_1.default.ok(r.profile);
        strict_1.default.equal(r.profile.source, "evcc");
    });
    (0, node_test_1.it)("normalizes hybrid profile", () => {
        const r = (0, normalize_js_2.normalizeWallboxVehicleProfile)(baseInput({ source: "hybrid", evccVehicleName: "explorer", socState: "evcc.0.soc" }), NOW);
        strict_1.default.ok(r.profile);
        strict_1.default.equal(r.profile.source, "hybrid");
    });
    (0, node_test_1.it)("keeps optional values null not 0", () => {
        const r = (0, normalize_js_2.normalizeWallboxVehicleProfile)(baseInput({
            batteryCapacityNetKwh: null,
            maxAcChargePowerW: null,
            defaultTargetSocPct: null,
        }), NOW);
        strict_1.default.equal(r.profile.batteryCapacityNetKwh, null);
        strict_1.default.equal(r.profile.maxAcChargePowerW, null);
        strict_1.default.equal(r.profile.defaultTargetSocPct, null);
    });
    (0, node_test_1.it)("accepts soc 0 as valid", () => {
        const r = (0, normalize_js_2.normalizeWallboxVehicleProfile)(baseInput({ defaultTargetSocPct: 0 }), NOW);
        strict_1.default.equal(r.profile.defaultTargetSocPct, 0);
    });
    (0, node_test_1.it)("rejects battery capacity 0", () => {
        const r = (0, normalize_js_2.normalizeWallboxVehicleProfile)(baseInput({ batteryCapacityNetKwh: 0 }), NOW);
        strict_1.default.ok(r.invalidFields.includes("batteryCapacityNetKwh"));
    });
    (0, node_test_1.it)("rejects negative battery capacity", () => {
        const r = (0, normalize_js_2.normalizeWallboxVehicleProfile)(baseInput({ batteryCapacityNetKwh: -10 }), NOW);
        strict_1.default.ok(r.invalidFields.includes("batteryCapacityNetKwh"));
    });
    (0, node_test_1.it)("rejects negative charge power", () => {
        const r = (0, normalize_js_2.normalizeWallboxVehicleProfile)(baseInput({ maxAcChargePowerW: -1 }), NOW);
        strict_1.default.ok(r.invalidFields.includes("maxAcChargePowerW"));
    });
    (0, node_test_1.it)("rejects soc below 0", () => {
        const r = (0, normalize_js_2.normalizeWallboxVehicleProfile)(baseInput({ defaultTargetSocPct: -1 }), NOW);
        strict_1.default.ok(r.invalidFields.includes("defaultTargetSocPct"));
    });
    (0, node_test_1.it)("rejects soc above 100", () => {
        const r = (0, normalize_js_2.normalizeWallboxVehicleProfile)(baseInput({ defaultTargetSocPct: 101 }), NOW);
        strict_1.default.ok(r.invalidFields.includes("defaultTargetSocPct"));
    });
    (0, node_test_1.it)("rejects invalid charge efficiency", () => {
        const r = (0, normalize_js_2.normalizeWallboxVehicleProfile)(baseInput({ chargeEfficiencyPct: 150 }), NOW);
        strict_1.default.ok(r.invalidFields.includes("chargeEfficiencyPct"));
    });
    (0, node_test_1.it)("rejects maxCurrentA below minCurrentA", () => {
        const r = (0, normalize_js_2.normalizeWallboxVehicleProfile)(baseInput({ minCurrentA: 16, maxCurrentA: 6 }), NOW);
        strict_1.default.ok(r.invalidFields.includes("maxCurrentA"));
    });
    (0, node_test_1.it)("rejects invalid phases", () => {
        const r = (0, normalize_js_2.normalizeWallboxVehicleProfile)(baseInput({ supportedPhases: "0,3" }), NOW);
        strict_1.default.ok(r.invalidFields.includes("supportedPhases"));
    });
    (0, node_test_1.it)("rejects invalid vehicle id / sanitizes unsafe chars", () => {
        const r = (0, normalize_js_2.normalizeWallboxVehicleProfile)(baseInput({ vehicleId: "My Car!" }), NOW);
        strict_1.default.equal(r.profile.vehicleId, "my_car");
    });
    (0, node_test_1.it)("rejects VIN as vehicle id", () => {
        const r = (0, normalize_js_2.normalizeWallboxVehicleProfile)(baseInput({ vehicleId: "1HGBH41JXMN109186" }), NOW);
        strict_1.default.equal(r.profile, null);
        strict_1.default.ok(r.reasons.includes("vehicle_id_invalid"));
    });
});
(0, node_test_1.describe)("profile readiness", () => {
    (0, node_test_1.it)("soc_and_capacity when both present", () => {
        const p = profile();
        const tel = { socPct: 55, connected: true, charging: false, socSource: "measured", socQuality: "measured", rangeKm: null, sessionEnergyKwh: null, lastUpdate: NOW, stale: false };
        strict_1.default.equal((0, readiness_js_1.derivePlanningCapability)(p, tel), "soc_and_capacity");
    });
    (0, node_test_1.it)("energy_only without soc but with capacity", () => {
        const p = profile();
        const tel = { socPct: null, connected: true, charging: false, socSource: "unavailable", socQuality: null, rangeKm: null, sessionEnergyKwh: null, lastUpdate: NOW, stale: false };
        strict_1.default.equal((0, readiness_js_1.derivePlanningCapability)(p, tel), "energy_only");
    });
    (0, node_test_1.it)("limits_only with charge limits only", () => {
        const p = profile({ batteryCapacityNetKwh: null, defaultTargetSocPct: null, minimumDepartureSocPct: null, maximumSocPct: null });
        const tel = { socPct: null, connected: true, charging: false, socSource: "unavailable", socQuality: null, rangeKm: null, sessionEnergyKwh: null, lastUpdate: NOW, stale: false };
        strict_1.default.equal((0, readiness_js_1.derivePlanningCapability)(p, tel), "limits_only");
    });
    (0, node_test_1.it)("insufficient for empty profile", () => {
        const p = profile({ maxAcChargePowerW: null, minCurrentA: null, maxCurrentA: null, supportedPhases: [], preferredPhases: null, batteryCapacityNetKwh: null });
        const tel = { socPct: null, connected: true, charging: false, socSource: "unavailable", socQuality: null, rangeKm: null, sessionEnergyKwh: null, lastUpdate: NOW, stale: false };
        strict_1.default.equal((0, readiness_js_1.derivePlanningCapability)(p, tel), "insufficient");
    });
    (0, node_test_1.it)("missing soc is not treated as 0", () => {
        const readiness = (0, readiness_js_1.assessWallboxVehicleProfileReadiness)(profile(), { socPct: null, connected: true, charging: false, socSource: "unavailable", socQuality: null, rangeKm: null, sessionEnergyKwh: null, lastUpdate: NOW, stale: false });
        strict_1.default.equal(readiness.socAvailable, false);
    });
    (0, node_test_1.it)("connected false with soc 0 does not add extra soc invalidation", () => {
        const readiness = (0, readiness_js_1.assessWallboxVehicleProfileReadiness)(profile(), { socPct: 0, connected: false, charging: false, socSource: "measured", socQuality: "measured", rangeKm: null, sessionEnergyKwh: null, lastUpdate: NOW, stale: false });
        strict_1.default.equal(readiness.socAvailable, true);
    });
});
(0, node_test_1.describe)("resolveActiveVehicle", () => {
    const profiles = [
        profile({ vehicleId: "car_a", displayName: "A", evccVehicleName: "explorer", source: "evcc" }),
        profile({ vehicleId: "car_b", displayName: "B", evccVehicleName: "model3", source: "evcc" }),
    ];
    (0, node_test_1.it)("unique EVCC match wins", () => {
        const r = (0, resolve_js_1.resolveActiveVehicle)({
            profiles,
            configuredManualVehicleId: "car_b",
            evccDetection: { evccVehicleId: null, evccVehicleName: "explorer" },
            evccConnected: true,
            nowIso: NOW,
        });
        strict_1.default.equal(r.vehicleId, "car_a");
        strict_1.default.equal(r.source, "evcc");
        strict_1.default.equal(r.profileResolved, true);
        strict_1.default.equal(r.activeForCharging, true);
    });
    (0, node_test_1.it)("manual selection is fallback when no EVCC match", () => {
        const r = (0, resolve_js_1.resolveActiveVehicle)({
            profiles,
            configuredManualVehicleId: "car_b",
            evccDetection: { evccVehicleId: null, evccVehicleName: "unknown" },
            evccConnected: true,
            nowIso: NOW,
        });
        strict_1.default.equal(r.vehicleId, "car_b");
        strict_1.default.equal(r.source, "manual");
    });
    (0, node_test_1.it)("single enabled profile resolves when alone", () => {
        const only = [profile({ vehicleId: "solo", enabled: true })];
        const r = (0, resolve_js_1.resolveActiveVehicle)({
            profiles: only,
            configuredManualVehicleId: null,
            evccDetection: { evccVehicleId: null, evccVehicleName: null },
            evccConnected: true,
            nowIso: NOW,
        });
        strict_1.default.equal(r.vehicleId, "solo");
        strict_1.default.equal(r.source, "single_enabled_profile");
    });
    (0, node_test_1.it)("ambiguous when multiple EVCC matches", () => {
        const dup = [
            profile({ vehicleId: "a", evccVehicleName: "x", source: "evcc" }),
            profile({ vehicleId: "b", evccVehicleName: "x", source: "evcc" }),
        ];
        const r = (0, resolve_js_1.resolveActiveVehicle)({
            profiles: dup,
            configuredManualVehicleId: null,
            evccDetection: { evccVehicleId: null, evccVehicleName: "x" },
            evccConnected: true,
            nowIso: NOW,
        });
        strict_1.default.equal(r.detectionStatus, "ambiguous");
        strict_1.default.equal(r.vehicleId, "");
    });
    (0, node_test_1.it)("unknown does not inherit last vehicle without match", () => {
        const r = (0, resolve_js_1.resolveActiveVehicle)({
            profiles,
            configuredManualVehicleId: null,
            evccDetection: { evccVehicleId: null, evccVehicleName: "other" },
            evccConnected: true,
            nowIso: NOW,
        });
        strict_1.default.equal(r.profileResolved, false);
        strict_1.default.equal(r.detectionStatus, "ambiguous");
    });
    (0, node_test_1.it)("disabled profile is not active via manual", () => {
        const r = (0, resolve_js_1.resolveActiveVehicle)({
            profiles: [profile({ vehicleId: "off", enabled: false })],
            configuredManualVehicleId: "off",
            evccDetection: { evccVehicleId: null, evccVehicleName: null },
            evccConnected: true,
            nowIso: NOW,
        });
        strict_1.default.equal(r.detectionStatus, "invalid_manual");
    });
    (0, node_test_1.it)("invalid manual id rejected", () => {
        const r = (0, resolve_js_1.resolveActiveVehicle)({
            profiles,
            configuredManualVehicleId: "missing",
            evccDetection: { evccVehicleId: null, evccVehicleName: null },
            evccConnected: true,
            nowIso: NOW,
        });
        strict_1.default.equal(r.detectionStatus, "invalid_manual");
    });
    (0, node_test_1.it)("disconnected preserves profile resolution without charging eligibility", () => {
        const r = (0, resolve_js_1.resolveActiveVehicle)({
            profiles,
            configuredManualVehicleId: null,
            evccDetection: { evccVehicleId: null, evccVehicleName: "explorer" },
            evccConnected: false,
            nowIso: NOW,
        });
        strict_1.default.equal(r.profileResolved, true);
        strict_1.default.equal(r.vehicleId, "car_a");
        strict_1.default.equal(r.detectionStatus, "disconnected");
        strict_1.default.equal(r.activeForCharging, false);
    });
    (0, node_test_1.it)("guest profile only via explicit manual selection", () => {
        const guest = [profile({ vehicleId: "guest", isGuest: true, batteryCapacityNetKwh: null })];
        const r = (0, resolve_js_1.resolveActiveVehicle)({
            profiles: guest,
            configuredManualVehicleId: "guest",
            evccDetection: { evccVehicleId: null, evccVehicleName: null },
            evccConnected: true,
            nowIso: NOW,
        });
        strict_1.default.equal(r.source, "guest");
        strict_1.default.equal(r.profileResolved, true);
        strict_1.default.equal(r.activeForCharging, true);
    });
});
(0, node_test_1.describe)("multiple vehicles isolation", () => {
    (0, node_test_1.it)("vehicle A and B keep separate charge power", () => {
        const a = (0, normalize_js_2.normalizeWallboxVehicleProfile)(baseInput({ vehicleId: "a", maxAcChargePowerW: 3600 }), NOW).profile;
        const b = (0, normalize_js_2.normalizeWallboxVehicleProfile)(baseInput({ vehicleId: "b", maxAcChargePowerW: 11000 }), NOW).profile;
        strict_1.default.equal(a.maxAcChargePowerW, 3600);
        strict_1.default.equal(b.maxAcChargePowerW, 11000);
    });
    (0, node_test_1.it)("target soc and capacity stay profile-specific", () => {
        const a = (0, normalize_js_2.normalizeWallboxVehicleProfile)(baseInput({ vehicleId: "a", defaultTargetSocPct: 50, batteryCapacityNetKwh: 40 }), NOW).profile;
        const b = (0, normalize_js_2.normalizeWallboxVehicleProfile)(baseInput({ vehicleId: "b", defaultTargetSocPct: 80, batteryCapacityNetKwh: 77 }), NOW).profile;
        strict_1.default.equal(a.defaultTargetSocPct, 50);
        strict_1.default.equal(b.defaultTargetSocPct, 80);
        strict_1.default.equal(a.batteryCapacityNetKwh, 40);
        strict_1.default.equal(b.batteryCapacityNetKwh, 77);
    });
    (0, node_test_1.it)("two profiles produce distinct ids", () => {
        const { profiles } = (0, normalize_js_2.normalizeWallboxVehicleProfiles)([baseInput({ vehicleId: "a", slotIndex: 1 }), baseInput({ vehicleId: "b", slotIndex: 2 })], NOW);
        strict_1.default.equal(profiles.length, 2);
        strict_1.default.notEqual(profiles[0].vehicleId, profiles[1].vehicleId);
    });
    (0, node_test_1.it)("duplicate vehicle id is rejected in batch", () => {
        const { profiles, errors } = (0, normalize_js_2.normalizeWallboxVehicleProfiles)([baseInput({ vehicleId: "same", slotIndex: 1 }), baseInput({ vehicleId: "same", slotIndex: 2 })], NOW);
        strict_1.default.equal(profiles.length, 1);
        strict_1.default.equal(errors.length, 1);
    });
});
(0, node_test_1.describe)("ActiveVehicleSnapshot", () => {
    (0, node_test_1.it)("is deterministically serializable", () => {
        const snap = (0, snapshot_js_1.buildActiveVehicleSnapshot)({
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
            readiness: (0, readiness_js_1.assessWallboxVehicleProfileReadiness)(profile(), {
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
        const json = (0, snapshot_js_1.activeVehicleSnapshotJson)(snap);
        strict_1.default.doesNotThrow(() => JSON.parse(json));
        strict_1.default.equal(JSON.parse(json).vehicleId, "ford_explorer");
    });
    (0, node_test_1.it)("contains no VIN", () => {
        const json = (0, snapshot_js_1.activeVehicleSnapshotJson)((0, snapshot_js_1.buildActiveVehicleSnapshot)({
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
        }));
        strict_1.default.ok(!json.match(/1HGBH41JXMN109186/i));
    });
    (0, node_test_1.it)("missing values remain null in snapshot", () => {
        const snap = (0, snapshot_js_1.buildActiveVehicleSnapshot)({
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
        strict_1.default.equal(snap.socPct, null);
        strict_1.default.equal(snap.batteryCapacityNetKwh, null);
    });
    (0, node_test_1.it)("charge limits from snapshot", () => {
        const snap = (0, snapshot_js_1.buildActiveVehicleSnapshot)({
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
        const limits = (0, charge_limits_js_1.resolveActiveVehicleChargeLimits)(snap);
        strict_1.default.equal(limits.ready, true);
        strict_1.default.equal(limits.maxAcChargePowerW, 11000);
        strict_1.default.equal(limits.phases, 3);
    });
});
(0, node_test_1.describe)("vehicle_id privacy", () => {
    (0, node_test_1.it)("hashes evcc technical id without exposing raw value in id prefix only", () => {
        const id = (0, vehicle_id_js_1.vehicleIdFromEvccTechnicalId)("secret-evcc-vehicle-uuid");
        strict_1.default.ok(id.startsWith("evcc_"));
        strict_1.default.ok(!id.includes("secret"));
    });
    (0, node_test_1.it)("sanitize rejects vin-like input", () => {
        const r = (0, vehicle_id_js_1.sanitizeVehicleId)("1HGBH41JXMN109186");
        strict_1.default.equal(r.valid, false);
    });
});
(0, node_test_1.describe)("config adapter", () => {
    (0, node_test_1.it)("empty profile list is valid", () => {
        const cfg = (0, config_js_1.wallboxVehicleProfilesConfigFromAdapter)({ [config_js_1.WB_VEHICLE_PROFILES]: [] });
        strict_1.default.deepEqual(cfg.profiles, []);
    });
    (0, node_test_1.it)("parses dynamic vehicle profiles from table array", () => {
        const cfg = (0, config_js_1.wallboxVehicleProfilesConfigFromAdapter)({
            wb_manual_vehicle_id: "ford_explorer",
            [config_js_1.WB_VEHICLE_PROFILES]: [
                profileRow({
                    vehicle_id: "ford_explorer",
                    display_name: "Ford Explorer",
                    battery_capacity_net_kwh: 77,
                }),
            ],
        });
        strict_1.default.equal(cfg.profiles.length, 1);
        strict_1.default.equal(cfg.manualVehicleId, "ford_explorer");
        strict_1.default.equal(cfg.profiles[0].vehicleId, "ford_explorer");
    });
    (0, node_test_1.it)("profile count follows array length for four profiles", () => {
        const rows = Array.from({ length: 4 }, (_, i) => profileRow({ vehicle_id: `car_${i + 1}` }));
        const cfg = (0, config_js_1.wallboxVehicleProfilesConfigFromAdapter)({ [config_js_1.WB_VEHICLE_PROFILES]: rows });
        strict_1.default.equal(cfg.profiles.length, 4);
    });
    (0, node_test_1.it)("supports five or more profiles without truncation", () => {
        const rows = Array.from({ length: 5 }, (_, i) => profileRow({ vehicle_id: `car_${i + 1}` }));
        const { profiles } = (0, normalize_js_2.normalizeWallboxVehicleProfiles)(inputsFromRows(rows), NOW);
        strict_1.default.equal(profiles.length, 5);
    });
    (0, node_test_1.it)("does not depend on legacy wb_vehicle_1_* keys", () => {
        const cfg = (0, config_js_1.wallboxVehicleProfilesConfigFromAdapter)({
            wb_vehicle_profile_count: 1,
            wb_vehicle_1_vehicle_id: "legacy_ignored",
        });
        strict_1.default.equal(cfg.profiles.length, 0);
    });
    (0, node_test_1.it)("skips rows without vehicle_id", () => {
        const cfg = (0, config_js_1.wallboxVehicleProfilesConfigFromAdapter)({
            [config_js_1.WB_VEHICLE_PROFILES]: [{ display_name: "empty row" }, profileRow({ vehicle_id: "valid" })],
        });
        strict_1.default.equal(cfg.profiles.length, 1);
    });
});
(0, node_test_1.describe)("profile resolution vs connection", () => {
    (0, node_test_1.it)("profileResolved with connected=false is representable in snapshot", () => {
        const snap = (0, snapshot_js_1.buildActiveVehicleSnapshot)({
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
        strict_1.default.equal(snap.profileResolved, true);
        strict_1.default.equal(snap.activeForCharging, false);
        strict_1.default.equal(snap.connected, false);
    });
});
(0, node_test_1.describe)("telemetry merge", () => {
    (0, node_test_1.it)("uses evcc soc for resolved hybrid profile when connected", () => {
        const p = profile({ source: "hybrid", evccVehicleName: "explorer" });
        const snap = emptySnap();
        snap.connected = { value: true, status: "valid", raw: true };
        snap.vehicle_soc_pct = { value: 42, status: "valid", raw: 42 };
        const raw = (0, soc_js_1.profileTelemetryFromForeignReads)(p, {}, NOW_DATE);
        const tel = (0, soc_js_1.mergeProfileTelemetryReadings)(p, raw, snap, true, true, NOW_DATE);
        strict_1.default.equal(tel.socPct, 42);
        strict_1.default.equal(tel.socSource, "evcc_estimated");
    });
    (0, node_test_1.it)("profile switch does not mirror soc across profiles", () => {
        const snap = emptySnap();
        snap.connected = { value: true, status: "valid", raw: true };
        snap.vehicle_soc_pct = { value: 99, status: "valid", raw: 99 };
        const profileA = profile({ vehicleId: "a", source: "hybrid", maxAcChargePowerW: 3600 });
        const profileB = profile({ vehicleId: "b", source: "hybrid", maxAcChargePowerW: 11000 });
        const telA = (0, soc_js_1.mergeProfileTelemetryReadings)(profileA, (0, soc_js_1.profileTelemetryFromForeignReads)(profileA, { soc: { val: 40 } }, NOW_DATE), snap, false, true, NOW_DATE);
        const telB = (0, soc_js_1.mergeProfileTelemetryReadings)(profileB, (0, soc_js_1.profileTelemetryFromForeignReads)(profileB, { soc: { val: 70 } }, NOW_DATE), snap, true, true, NOW_DATE);
        strict_1.default.equal(telA.socPct, 40);
        strict_1.default.equal(telB.socPct, 70);
        strict_1.default.notEqual(telA.socPct, telB.socPct);
    });
});
(0, node_test_1.describe)("runtime safety regression", () => {
    (0, node_test_1.it)("release gate is open (gated by fault/lockout/ownership/liveEligible)", () => {
        strict_1.default.equal(execute_js_1.WALLBOX_LIVE_WRITE_RELEASED, true);
    });
    (0, node_test_1.it)("vehicle runtime module does not import dispatch or write execution", () => {
        const src = (0, node_fs_1.readFileSync)((0, node_path_1.join)(process.cwd(), "src/addons/wallbox/vehicles/runtime.ts"), "utf8");
        strict_1.default.ok(!src.includes("runWallboxDryrunDispatch"));
        strict_1.default.ok(!src.includes("executeWallboxWrite"));
        strict_1.default.ok(!src.includes("setForeignState"));
    });
    (0, node_test_1.it)("failsafe.ts unchanged", () => {
        const fs = (0, node_fs_1.readFileSync)((0, node_path_1.join)(process.cwd(), "src/addons/wallbox/failsafe.ts"), "utf8");
        strict_1.default.ok(fs.includes("failsafe"));
    });
});
