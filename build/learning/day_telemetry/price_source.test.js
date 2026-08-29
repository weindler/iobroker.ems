"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const strict_1 = __importDefault(require("node:assert/strict"));
const grid_states_js_1 = require("../../operator/supply/grid_states.js");
const constants_js_1 = require("../price_learning/constants.js");
const knowledge_snapshot_js_1 = require("./knowledge_snapshot.js");
const sources_js_1 = require("./sources.js");
class FakeHost {
    states = new Map();
    config = {};
    async getStateAsync(id) {
        const s = this.states.get(id);
        if (!s)
            return null;
        return { val: s.val, ack: true, ts: Date.now(), lc: Date.now(), from: "", q: 0 };
    }
}
const fresh = {
    observedAtIso: "2026-06-15T08:00:00.000Z",
    ageSec: 0,
    quality: { status: "valid", confidencePct: 100, reasonDe: "" },
};
function minimalInput(priceCt) {
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
            slots: [],
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
                    importCtPerKwh: priceCt,
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
    };
}
(0, node_test_1.describe)("day_telemetry price source", () => {
    (0, node_test_1.it)("kein Plan publiziert, Tarifpreis vorhanden → Telemetriepreis vorhanden", async () => {
        const host = new FakeHost();
        const nowMs = Date.parse("2026-06-15T10:07:00.000Z");
        host.states.set(grid_states_js_1.GRID_SUPPLY_STATE_IDS.slotsJson, {
            val: JSON.stringify([
                {
                    startIso: "2026-06-15T10:00:00.000Z",
                    endIso: "2026-06-15T10:15:00.000Z",
                    priceCtPerKwh: 24.5,
                },
            ]),
        });
        /* plan_json absichtlich fehlt / anders */
        host.states.set("planner.intent.daily_plan.plan_json", {
            val: JSON.stringify({
                slots: [
                    {
                        startIso: "2026-06-15T10:00:00.000Z",
                        endIso: "2026-06-15T10:15:00.000Z",
                        importCtPerKwh: 99.9,
                    },
                ],
            }),
        });
        const ct = await (0, sources_js_1.resolveTelemetryPriceCtPerKwh)(host, nowMs);
        strict_1.default.equal(ct, 24.5);
    });
    (0, node_test_1.it)("live.price Fallback wenn keine Slots", async () => {
        const host = new FakeHost();
        host.states.set(constants_js_1.DEFAULT_PRICE_STATE_ID, { val: 31.2 });
        const ct = await (0, sources_js_1.resolveTelemetryPriceCtPerKwh)(host, Date.now());
        strict_1.default.equal(ct, 31.2);
    });
    (0, node_test_1.it)("Tarifpreis fehlt → null (PRICE missing)", async () => {
        const host = new FakeHost();
        host.states.set("planner.intent.daily_plan.plan_json", {
            val: JSON.stringify({
                slots: [{ startIso: "2026-06-15T10:00:00.000Z", endIso: "2026-06-15T10:15:00.000Z", importCtPerKwh: 50 }],
            }),
        });
        const ct = await (0, sources_js_1.resolveTelemetryPriceCtPerKwh)(host, Date.parse("2026-06-15T10:07:00.000Z"));
        strict_1.default.equal(ct, null);
    });
    (0, node_test_1.it)("Planner-Snapshot behält damaligen Preisforecast unverändert", () => {
        const snapA = (0, knowledge_snapshot_js_1.withSnapshotId)((0, knowledge_snapshot_js_1.buildPlannerKnowledgeSnapshot)(minimalInput(22), "t1"));
        const list1 = (0, knowledge_snapshot_js_1.upsertForecastSnapshot)([], snapA).list;
        const snapB = (0, knowledge_snapshot_js_1.withSnapshotId)((0, knowledge_snapshot_js_1.buildPlannerKnowledgeSnapshot)(minimalInput(40), "t2"));
        const list2 = (0, knowledge_snapshot_js_1.upsertForecastSnapshot)(list1, snapB).list;
        strict_1.default.equal(list2.length, 2);
        strict_1.default.deepEqual(list2[0].priceSlots, [[Date.parse("2026-06-15T08:00:00.000Z"), 22]]);
        strict_1.default.deepEqual(list2[1].priceSlots, [[Date.parse("2026-06-15T08:00:00.000Z"), 40]]);
    });
});
