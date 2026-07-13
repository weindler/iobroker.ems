"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const strict_1 = __importDefault(require("node:assert/strict"));
const node_crypto_1 = require("node:crypto");
const canonical_js_1 = require("./canonical.js");
const constants_js_1 = require("./constants.js");
function minimalSnapshot(overrides = {}) {
    const base = {
        schemaVersion: 2,
        capturedAt: "2026-07-01T12:00:00.000Z",
        timezone: "Europe/Berlin",
        inputRevision: "",
        sourceRevision: null,
        general: {
            globalMode: "balanced",
            executionMode: "dryrun",
            globalModePolicyLabel: "Ausgewogen",
            snowCoverSuspected: false,
        },
        policy: {
            revision: "rev1",
            status: "ready",
            gridImportAllowed: true,
            maxGridImportW: 5000,
            houseFuseLimitW: 11000,
            energyPriority: ["pv"],
            mutualExclusions: [],
        },
        live: {
            pvPowerW: 1200,
            houseLoadW: 800,
            socPct: 55,
            bufferTempC: 42,
            outdoorTempC: 18,
            cloudPct: 30,
            currentPriceCtPerKwh: 28.5,
            fixedPriceCtPerKwh: null,
        },
        learning: {
            pvBias: {
                correctedTodayKwh: 12,
                correctedTomorrowKwh: 14,
                rawTodayKwh: 11,
                rawTomorrowKwh: 13,
                confidencePct: 80,
                status: "ready",
                lastUpdateTs: "2026-07-01T11:00:00.000Z",
            },
            pvHorizon: [],
            houseLoad: {
                status: "ready",
                confidence: 0.7,
                lastUpdate: "2026-07-01T10:00:00.000Z",
                forecastToday: null,
                forecastTomorrow: null,
            },
            weather: {
                status: "ready",
                health: "ok",
                confidencePct: 75,
                lastUpdate: "2026-07-01T09:00:00.000Z",
                forecastSource: "openmeteo",
                actualSource: "sensor",
            },
            thermalRuntime: {
                status: "ready",
                health: "ok",
                samples: 12,
                runtimeHoursAvg: 4,
                runtimeHoursMedian: 3.5,
                coolingRateCPerHAvg: 1.2,
                coolingKPerH: 0.08,
                coolingAsymptoteC: 20,
                coolingAsymptoteSource: "fitted",
                currentTemperatureC: 42,
                estimatedRemainingHours: 6,
                estimatedEmptyAt: "2026-07-01T18:00:00.000Z",
                generatedAt: "2026-07-01T08:00:00.000Z",
                bySeason: null,
                byDayType: null,
                history: [],
            },
        },
        prices: { slots15Min: [] },
        intents: {
            thermal: { mode: "auto", operatingRequestStatus: "valid" },
            battery: {
                operatingRequest: null,
                operatingRequestStatus: "valid",
                topOffRequested: false,
                hold: false,
                charge: false,
            },
        },
        battery: {
            socPct: 55,
            capacityEffectiveKwh: 10,
            capacityNetKwh: 10,
            capacitySource: "manual",
            minSocPct: 10,
            maxSocPct: 100,
            maxChargeW: 5000,
            chargeCapable: true,
            dischargeCapable: true,
            fault: false,
            lockout: false,
            telemetryValid: true,
            telemetryStale: false,
            telemetryReady: true,
            ownershipActive: false,
            winterGridActive: false,
        },
        wallbox: {
            connected: false,
            charging: false,
            vehicleSocPct: null,
            planSocPct: null,
            planActive: false,
            sessionEnergyKwh: null,
            deadlineIso: null,
            activePhases: null,
            maxCurrentA: null,
            evccConfigured: true,
            batteryMode: "normal",
            batteryDischargeControl: false,
        },
        thermal: {
            bufferTempC: 42,
            runtimeState: "auto_ready",
            faultActive: false,
            config: {
                forecastModeEnabled: true,
                planningMaxTempC: 55,
                stages: [{ index: 1, enabled: true, nominalPowerW: 2000, label: "Stufe 1" }],
                minRuntimeMin: 30,
                minPauseMin: 15,
            },
        },
        airConditioning: { units: [] },
        governance: { addons: [] },
        consumerStats: [],
        batteryWinter: {
            config: { enabled: true, horizonDays: 7, socTargetMinPct: 30, socTargetMaxPct: 80 },
            days: [],
        },
    };
    const merged = { ...base, ...overrides };
    merged.inputRevision = (0, canonical_js_1.computeInputRevision)({ ...merged, inputRevision: "" });
    return merged;
}
(0, node_test_1.describe)("planner_snapshot canonical", () => {
    (0, node_test_1.it)("excludes capturedAt and inputRevision from semantic payload", () => {
        const a = minimalSnapshot({ capturedAt: "2026-07-01T12:00:00.000Z" });
        const b = minimalSnapshot({ capturedAt: "2026-07-02T00:00:00.000Z" });
        strict_1.default.equal((0, canonical_js_1.canonicalSnapshotJson)(a), (0, canonical_js_1.canonicalSnapshotJson)(b));
        for (const key of constants_js_1.INPUT_REVISION_EXCLUDED_KEYS) {
            const payload = (0, canonical_js_1.canonicalSnapshotPayload)(a);
            strict_1.default.equal(payload[key], undefined);
        }
    });
    (0, node_test_1.it)("same inputs yield same inputRevision", () => {
        const a = minimalSnapshot();
        const b = minimalSnapshot();
        strict_1.default.equal((0, canonical_js_1.computeInputRevision)(a), (0, canonical_js_1.computeInputRevision)(b));
    });
    (0, node_test_1.it)("semantic change changes inputRevision", () => {
        const a = minimalSnapshot();
        const b = minimalSnapshot({ live: { ...a.live, pvPowerW: 999 } });
        strict_1.default.notEqual((0, canonical_js_1.computeInputRevision)(a), (0, canonical_js_1.computeInputRevision)(b));
    });
    (0, node_test_1.it)("sortKeysDeep is deterministic", () => {
        const unsorted = { z: 1, a: { y: 2, b: 3 } };
        const once = JSON.stringify((0, canonical_js_1.sortKeysDeep)(unsorted));
        const twice = JSON.stringify((0, canonical_js_1.sortKeysDeep)({ a: { b: 3, y: 2 }, z: 1 }));
        strict_1.default.equal(once, twice);
    });
    (0, node_test_1.it)("inputRevision is sha256 hex", () => {
        const snap = minimalSnapshot();
        const expected = (0, node_crypto_1.createHash)("sha256").update((0, canonical_js_1.canonicalSnapshotJson)(snap)).digest("hex");
        strict_1.default.equal(snap.inputRevision, expected);
        strict_1.default.equal(snap.inputRevision.length, 64);
    });
});
