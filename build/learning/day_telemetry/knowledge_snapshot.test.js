"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const strict_1 = __importDefault(require("node:assert/strict"));
const knowledge_snapshot_js_1 = require("./knowledge_snapshot.js");
const fresh = {
    observedAtIso: "2026-06-15T08:00:00.000Z",
    ageSec: 0,
    quality: { status: "valid", confidencePct: 100, reasonDe: "" },
};
function minimalInput(overrides = {}) {
    return {
        schemaVersion: 1,
        planIntent: "unified_day",
        time: {
            nowIso: "2026-06-15T08:00:00.000Z",
            timezone: "Europe/Berlin",
            horizonStartIso: "2026-06-15T08:00:00.000Z",
            horizonEndIso: "2026-06-17T08:00:00.000Z",
            slotMinutes: 15,
            slots: [],
            freshness: fresh,
        },
        pv: {
            slots: [
                {
                    slot: { startIso: "2026-06-15T08:00:00.000Z", endIso: "2026-06-15T08:15:00.000Z" },
                    forecastPowerW: 1000,
                    observedPowerW: null,
                    energyKwh: 0.25,
                },
            ],
            expectedDayEnergyKwh: 20,
            previousExpectedDayEnergyKwh: null,
            biasCorrected: false,
            biasPct: null,
            uncertainty: { status: "valid", confidencePct: 80, reasonDe: "" },
            freshness: fresh,
        },
        prices: {
            slots: [
                {
                    slot: { startIso: "2026-06-15T08:00:00.000Z", endIso: "2026-06-15T08:15:00.000Z" },
                    importCtPerKwh: 25,
                    exportCtPerKwh: 8,
                    gridImportAllowed: true,
                },
            ],
            uncertainty: { status: "valid", confidencePct: 100, reasonDe: "" },
            freshness: fresh,
        },
        houseLoad: {
            slots: [],
            expectedDayEnergyKwh: 12,
            uncertainty: { status: "valid", confidencePct: 70, reasonDe: "" },
            freshness: fresh,
        },
        battery: {
            socPct: 55,
            usableCapacityKwh: 10,
            minSocPct: 10,
            maxSocPct: 100,
            maxChargePowerW: 3000,
            maxDischargePowerW: 3000,
            chargeEfficiency: 0.95,
            dischargeEfficiency: 0.95,
            allowedModes: ["charge"],
            reserveSocPct: 20,
            nightReserveKwh: 2,
            profileId: null,
            dischargeLiveSupported: false,
            passiveBatteryEnergyAvailable: true,
            requiredChargeEnergyKwh: null,
            endSocTargetPct: null,
            chargeDeadlineIso: null,
            gridChargeAllowed: true,
            uncertainty: { status: "valid", confidencePct: 90, reasonDe: "" },
            freshness: fresh,
        },
        wallbox: null,
        thermal: null,
        climate: null,
        otherFlex: [],
        contributionRevision: 1,
        globalMode: "balanced",
        ...overrides,
    };
}
(0, node_test_1.describe)("day_telemetry knowledge snapshot", () => {
    (0, node_test_1.it)("13) Snapshot-Dedup bei gleichem Inhalt", () => {
        const a = (0, knowledge_snapshot_js_1.withSnapshotId)((0, knowledge_snapshot_js_1.buildPlannerKnowledgeSnapshot)(minimalInput(), "2026-06-15T08:00:00.000Z"));
        const b = (0, knowledge_snapshot_js_1.withSnapshotId)((0, knowledge_snapshot_js_1.buildPlannerKnowledgeSnapshot)(minimalInput(), "2026-06-15T09:00:00.000Z"));
        strict_1.default.equal(a.id, b.id);
        const up1 = (0, knowledge_snapshot_js_1.upsertForecastSnapshot)([], a);
        const up2 = (0, knowledge_snapshot_js_1.upsertForecastSnapshot)(up1.list, b);
        strict_1.default.equal(up2.inserted, false);
        strict_1.default.equal(up2.list.length, 1);
    });
    (0, node_test_1.it)("12) Snapshot bleibt historisch unverändert bei Input-Änderung", () => {
        const first = (0, knowledge_snapshot_js_1.withSnapshotId)((0, knowledge_snapshot_js_1.buildPlannerKnowledgeSnapshot)(minimalInput(), "t1"));
        const list = [first];
        const changed = (0, knowledge_snapshot_js_1.withSnapshotId)((0, knowledge_snapshot_js_1.buildPlannerKnowledgeSnapshot)(minimalInput({
            pv: {
                ...minimalInput().pv,
                expectedDayEnergyKwh: 30,
            },
        }), "t2"));
        const up = (0, knowledge_snapshot_js_1.upsertForecastSnapshot)(list, changed);
        strict_1.default.equal(up.inserted, true);
        strict_1.default.equal(up.list.length, 2);
        strict_1.default.equal(up.list[0].pvExpectedDayKwh, 20);
        strict_1.default.equal(up.list[0].id, first.id);
        strict_1.default.notEqual(changed.id, first.id);
    });
});
