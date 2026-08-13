"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const strict_1 = __importDefault(require("node:assert/strict"));
const node_fs_1 = require("node:fs");
const node_path_1 = require("node:path");
const node_test_1 = require("node:test");
const execution_mode_1 = require("../../../../execution_mode");
const tree_paths_1 = require("../../../../tree_paths");
const evcc_config_1 = require("../../evcc_config");
const evcc_telemetry_1 = require("../../evcc_telemetry");
const catalog_1 = require("../catalog");
const capabilities_1 = require("../capabilities");
const config_1 = require("../config");
const index_1 = require("./index");
const smart_plan_parse_1 = require("./smart_plan_parse");
const remaining_energy_1 = require("./remaining_energy");
const model_1 = require("../model");
const write_allowlist_1 = require("../write_allowlist");
const NOW = new Date("2026-08-13T10:00:00.000Z");
const SRC = (0, node_path_1.join)(__dirname, "..", "..", "..", "..", "..", "src", "addons", "wallbox");
function minEvccAdminConfig(over = {}) {
    return {
        wb_evcc_connection_state: catalog_1.EVCC_READ_CATALOG.connection,
        wb_evcc_connected_state: catalog_1.EVCC_READ_CATALOG.connected,
        wb_evcc_charging_state: catalog_1.EVCC_READ_CATALOG.charging,
        wb_evcc_charge_power_w_state: catalog_1.EVCC_READ_CATALOG.chargePower,
        wb_evcc_loadpoint_mode_state: catalog_1.EVCC_READ_CATALOG.mode,
        wb_evcc_active_phases_state: catalog_1.EVCC_READ_CATALOG.phasesActive,
        wb_evcc_configured_phases_state: catalog_1.EVCC_READ_CATALOG.phasesConfigured,
        wb_evcc_max_current_a_state: catalog_1.EVCC_READ_CATALOG.maxCurrent,
        wb_evcc_min_current_a_state: catalog_1.EVCC_READ_CATALOG.minCurrent,
        ...over,
    };
}
function minForeign(over = {}) {
    return {
        [catalog_1.EVCC_READ_CATALOG.connection]: true,
        [catalog_1.EVCC_READ_CATALOG.connected]: true,
        [catalog_1.EVCC_READ_CATALOG.charging]: false,
        [catalog_1.EVCC_READ_CATALOG.chargePower]: 0,
        [catalog_1.EVCC_READ_CATALOG.mode]: "pv",
        [catalog_1.EVCC_READ_CATALOG.phasesActive]: 1,
        [catalog_1.EVCC_READ_CATALOG.phasesConfigured]: 3,
        [catalog_1.EVCC_READ_CATALOG.maxCurrent]: 16,
        [catalog_1.EVCC_READ_CATALOG.minCurrent]: 6,
        ...over,
    };
}
function mockHost(states, ts = NOW.getTime()) {
    return {
        async getForeignStateAsync(id) {
            if (!(id in states))
                return null;
            return { val: states[id], ts, lc: ts, ack: true };
        },
        async getStateAsync() {
            return null;
        },
        async setStateAsync() {
            return;
        },
        async setObjectNotExistsAsync() {
            return;
        },
    };
}
async function load(admin, foreign) {
    const telemetryCfg = (0, evcc_config_1.wallboxEvccTelemetryConfigFromAdapter)(admin);
    const snap = await (0, evcc_telemetry_1.readEvccTelemetrySnapshot)(mockHost(foreign), telemetryCfg, NOW);
    const foundation = (0, config_1.evFoundationConfigFromAdapter)(admin);
    const host = mockHost(foreign);
    const external = await (0, index_1.readExternalEvInformation)(host, foundation, {
        now: NOW,
        fallbackMaxAcKw: foundation.maxAcChargePowerKw,
        configDepartureAt: foundation.departureAt,
        timezone: "UTC",
    });
    const capabilities = (0, capabilities_1.resolveEvCapabilities)(telemetryCfg, snap, foundation, external);
    const model = (0, model_1.buildEvModelV1)({ snap, foundation, capabilities, adapterConfig: admin, external });
    return { model, capabilities, external, foundation };
}
const SLOT_PAST = {
    start: "2026-08-13T08:00:00.000Z",
    end: "2026-08-13T09:00:00.000Z",
    plannedPowerKw: 11,
};
const SLOT_CURRENT = {
    start: "2026-08-13T09:30:00.000Z",
    end: "2026-08-13T10:30:00.000Z",
    plannedPowerKw: 11,
};
const SLOT_FUTURE = {
    start: "2026-08-13T12:00:00.000Z",
    end: "2026-08-13T14:00:00.000Z",
    plannedPowerKw: 11,
};
(0, node_test_1.describe)("EV foundation Phase 2 — external control & smart plan (read-only)", () => {
    (0, node_test_1.it)("T1: EVCC only remains functional without external sources", async () => {
        const { model, capabilities, external } = await load(minEvccAdminConfig(), minForeign());
        strict_1.default.equal(capabilities.evccAvailable, true);
        strict_1.default.equal(model.vehicleConnected, true);
        strict_1.default.equal(model.preparedEvState, "pv");
        strict_1.default.equal(external.externalControlConfigured, false);
        strict_1.default.equal(external.externalSourceQuality, "unconfigured");
        strict_1.default.equal(capabilities.externalSmartPlanAvailable, false);
        strict_1.default.equal(model.externalControlActive, null);
        strict_1.default.equal(model.gridRewardsActive, null);
        strict_1.default.equal(model.externalSmartPlanSlots, null);
        strict_1.default.equal(model.emsTakeoverActive, false);
    });
    (0, node_test_1.it)("T2: external-control mapped but state missing → unknown, not fake false", async () => {
        const { model, external } = await load(minEvccAdminConfig({
            wb_external_control_active_state: "ha.0.control_active",
        }), minForeign());
        strict_1.default.equal(external.externalControlConfigured, true);
        strict_1.default.equal(model.externalControlActive, null);
        strict_1.default.notEqual(model.externalControlActive, false);
        strict_1.default.equal(external.externalSourceQuality, "unknown");
    });
    (0, node_test_1.it)("T3: externalControlEnabled=true with active=null is valid", async () => {
        const { model } = await load(minEvccAdminConfig({
            wb_external_control_type: "vehicle",
            wb_tibber_grid_rewards_vehicle_enabled: true,
        }), minForeign());
        strict_1.default.equal(model.externalControlEnabled, true);
        strict_1.default.equal(model.externalControlActive, null);
    });
    (0, node_test_1.it)("T4: grid-rewards true maps neutrally", async () => {
        const { model } = await load(minEvccAdminConfig({
            wb_external_grid_rewards_active_state: "ha.0.grid_rewards",
        }), minForeign({ "ha.0.grid_rewards": true }));
        strict_1.default.equal(model.gridRewardsActive, true);
        strict_1.default.equal(model.externalControlActive, null);
    });
    (0, node_test_1.it)("T5: JSON array smart plan parses", async () => {
        const { model, capabilities } = await load(minEvccAdminConfig({
            wb_external_smart_plan_state: "ha.0.plan",
        }), minForeign({
            "ha.0.plan": [SLOT_FUTURE],
        }));
        strict_1.default.equal(capabilities.externalSmartPlanAvailable, true);
        strict_1.default.equal(model.externalSmartPlanSlots?.length, 1);
        strict_1.default.equal(model.externalSmartPlanSlots?.[0].start, SLOT_FUTURE.start);
        strict_1.default.equal(model.externalSmartPlanSlots?.[0].plannedPowerKw, 11);
    });
    (0, node_test_1.it)("T6: stringified JSON parses", async () => {
        const parsed = (0, smart_plan_parse_1.parseSmartPlanPayload)(JSON.stringify({ schedule: [SLOT_FUTURE] }));
        strict_1.default.equal(parsed.parseable, true);
        strict_1.default.equal(parsed.slots.length, 1);
        strict_1.default.equal(parsed.slots[0].end, SLOT_FUTURE.end);
    });
    (0, node_test_1.it)("T7: invalid plan is degraded/invalid without crash", async () => {
        const { external, capabilities } = await load(minEvccAdminConfig({
            wb_external_smart_plan_state: "ha.0.plan",
        }), minForeign({ "ha.0.plan": "not-json-and-not-a-plan" }));
        strict_1.default.equal(external.smartPlan.payloadParseable, false);
        strict_1.default.equal(capabilities.externalSmartPlanAvailable, false);
        strict_1.default.ok(["invalid", "degraded"].includes(external.externalSourceQuality));
        strict_1.default.equal(external.smartPlan.rawPreview, "not-json-and-not-a-plan");
    });
    (0, node_test_1.it)("T8: past slots do not count toward remaining energy", () => {
        const r = (0, remaining_energy_1.computeExternalPlanRemainingEnergy)({
            slots: [
                {
                    start: SLOT_PAST.start,
                    end: SLOT_PAST.end,
                    plannedPowerKw: 11,
                    plannedEnergyKWh: null,
                    source: null,
                    quality: "ok",
                },
                {
                    start: SLOT_FUTURE.start,
                    end: SLOT_FUTURE.end,
                    plannedPowerKw: 11,
                    plannedEnergyKWh: null,
                    source: null,
                    quality: "ok",
                },
            ],
            nowMs: NOW.getTime(),
            deadlineMs: null,
            fallbackMaxAcKw: null,
        });
        strict_1.default.equal(r.remainingEnergyKWh, 22);
    });
    (0, node_test_1.it)("T9: running slot counts remaining duration only", () => {
        const r = (0, remaining_energy_1.computeExternalPlanRemainingEnergy)({
            slots: [
                {
                    start: SLOT_CURRENT.start,
                    end: SLOT_CURRENT.end,
                    plannedPowerKw: 11,
                    plannedEnergyKWh: null,
                    source: null,
                    quality: "ok",
                },
            ],
            nowMs: NOW.getTime(),
            deadlineMs: null,
            fallbackMaxAcKw: null,
        });
        strict_1.default.equal(r.remainingEnergyKWh, 5.5);
        strict_1.default.equal(r.remainingMinutes, 30);
    });
    (0, node_test_1.it)("T10: slots after departureAt do not count", async () => {
        const { model } = await load(minEvccAdminConfig({
            wb_external_smart_plan_state: "ha.0.plan",
            wb_ev_departure_at: "2026-08-13T11:00:00.000Z",
        }), minForeign({ "ha.0.plan": [SLOT_FUTURE] }));
        strict_1.default.equal(model.externalPlanDeadlineUsed, true);
        strict_1.default.equal(model.externalPlanRemainingEnergyKWh, 0);
    });
    (0, node_test_1.it)("T11: overlapping slots are not double-counted", () => {
        const r = (0, remaining_energy_1.computeExternalPlanRemainingEnergy)({
            slots: [
                {
                    start: "2026-08-13T10:00:00.000Z",
                    end: "2026-08-13T11:00:00.000Z",
                    plannedPowerKw: 11,
                    plannedEnergyKWh: null,
                    source: null,
                    quality: "ok",
                },
                {
                    start: "2026-08-13T10:30:00.000Z",
                    end: "2026-08-13T11:30:00.000Z",
                    plannedPowerKw: 11,
                    plannedEnergyKWh: null,
                    source: null,
                    quality: "ok",
                },
            ],
            nowMs: NOW.getTime(),
            deadlineMs: null,
            fallbackMaxAcKw: null,
        });
        strict_1.default.equal(r.remainingEnergyKWh, 16.5);
    });
    (0, node_test_1.it)("T12: plannedEnergyKWh wins over power estimate", () => {
        const r = (0, remaining_energy_1.computeExternalPlanRemainingEnergy)({
            slots: [
                {
                    start: "2026-08-13T10:00:00.000Z",
                    end: "2026-08-13T11:00:00.000Z",
                    plannedPowerKw: 11,
                    plannedEnergyKWh: 4,
                    source: null,
                    quality: "ok",
                },
            ],
            nowMs: NOW.getTime(),
            deadlineMs: null,
            fallbackMaxAcKw: 22,
        });
        strict_1.default.equal(r.remainingEnergyKWh, 4);
        strict_1.default.equal(r.estimated, false);
    });
    (0, node_test_1.it)("T13: missing slot power uses max AC as marked estimate", async () => {
        const { model, external } = await load(minEvccAdminConfig({
            wb_external_smart_plan_state: "ha.0.plan",
            wb_ev_max_ac_charge_power_kw: 11,
        }), minForeign({
            "ha.0.plan": [{ start: SLOT_FUTURE.start, end: "2026-08-13T13:00:00.000Z" }],
        }));
        strict_1.default.equal(model.externalPlanRemainingEnergyKWh, 11);
        strict_1.default.equal(external.smartPlan.remainingEnergyEstimated, true);
    });
    (0, node_test_1.it)("T14: no slot energy and no usable power → remaining null", () => {
        const r = (0, remaining_energy_1.computeExternalPlanRemainingEnergy)({
            slots: [
                {
                    start: SLOT_FUTURE.start,
                    end: SLOT_FUTURE.end,
                    plannedPowerKw: null,
                    plannedEnergyKWh: null,
                    source: null,
                    quality: "degraded",
                },
            ],
            nowMs: NOW.getTime(),
            deadlineMs: null,
            fallbackMaxAcKw: null,
        });
        strict_1.default.equal(r.remainingEnergyKWh, null);
        strict_1.default.notEqual(r.remainingEnergyKWh, 0);
    });
    (0, node_test_1.it)("T15: smart-plan mapped without valid slot → capability false", async () => {
        const { capabilities, external } = await load(minEvccAdminConfig({
            wb_external_smart_plan_state: "ha.0.plan",
        }), minForeign({ "ha.0.plan": [SLOT_PAST] }));
        strict_1.default.equal(external.smartPlan.mappingConfigured, true);
        strict_1.default.equal(external.smartPlan.payloadParseable, true);
        strict_1.default.equal(external.smartPlan.validPlanPresent, false);
        strict_1.default.equal(capabilities.externalSmartPlanAvailable, false);
    });
    (0, node_test_1.it)("T16: Ford pause alone does not activate external control", async () => {
        const { model, external } = await load(minEvccAdminConfig({
            wb_external_vehicle_charge_state: "ford.0.pause",
        }), minForeign({ "ford.0.pause": true }));
        strict_1.default.equal(external.vehicleChargePauseDiagnostic, true);
        strict_1.default.notEqual(model.externalControlActive, true);
        strict_1.default.equal(model.externalControlActive, null);
        strict_1.default.equal(model.emsTakeoverActive, false);
    });
    (0, node_test_1.it)("T17: no takeover state transition", async () => {
        const { model } = await load(minEvccAdminConfig({
            wb_external_control_type: "vehicle",
            wb_external_control_active_state: "ha.0.control_active",
            wb_external_smart_plan_state: "ha.0.plan",
        }), minForeign({
            "ha.0.control_active": true,
            "ha.0.plan": [SLOT_FUTURE],
        }));
        strict_1.default.equal(model.externalControlActive, true);
        strict_1.default.equal(model.preparedEvState, "pv");
        strict_1.default.equal(model.emsTakeoverActive, false);
        strict_1.default.equal(model.takeoverReason, null);
        strict_1.default.ok(!["external", "ems_takeover", "manual_override"].includes(model.preparedEvState));
        strict_1.default.equal((0, model_1.derivePreparedEvModuleState)("now"), "planned_now");
    });
    (0, node_test_1.it)("T18: no new EVCC writes", () => {
        strict_1.default.equal(write_allowlist_1.EV_FOUNDATION_PHASE1_PLANNER_WRITES_ENABLED, false);
        strict_1.default.equal(write_allowlist_1.EV_FOUNDATION_PLANNER_WRITES_ENABLED, false);
        const executeSrc = (0, node_fs_1.readFileSync)((0, node_path_1.join)(SRC, "runtime", "execute.ts"), "utf8");
        const extSrc = (0, node_fs_1.readFileSync)((0, node_path_1.join)(SRC, "ev_foundation", "external", "index.ts"), "utf8");
        strict_1.default.equal(executeSrc.includes("control.pvControl"), false);
        strict_1.default.equal(extSrc.includes("writeForeignIfChanged"), false);
        strict_1.default.equal(extSrc.includes("setForeignState"), false);
    });
    (0, node_test_1.it)("T19: no HA/Tibber writes", () => {
        const files = [
            (0, node_path_1.join)(SRC, "ev_foundation", "external", "index.ts"),
            (0, node_path_1.join)(SRC, "ev_foundation", "publish.ts"),
            (0, node_path_1.join)(SRC, "ev_foundation", "model.ts"),
        ];
        for (const f of files) {
            const src = (0, node_fs_1.readFileSync)(f, "utf8");
            strict_1.default.equal(src.includes("writeForeignIfChanged"), false);
            strict_1.default.equal(src.includes("setForeignStateAsync"), false);
        }
    });
    (0, node_test_1.it)("T20: governance unchanged", async () => {
        const store = {
            [tree_paths_1.GLOBAL.executionMode]: "dryrun",
            [(0, tree_paths_1.addonMode)("wallbox")]: "live",
        };
        const get = async (id) => ({ val: store[id] });
        strict_1.default.equal(await (0, execution_mode_1.isLiveWriteAllowed)(get, "wallbox"), false);
        store[tree_paths_1.GLOBAL.executionMode] = "live";
        store[(0, tree_paths_1.addonMode)("wallbox")] = "dryrun";
        strict_1.default.equal(await (0, execution_mode_1.isLiveWriteAllowed)(get, "wallbox"), false);
        store[(0, tree_paths_1.addonMode)("wallbox")] = "live";
        strict_1.default.equal(await (0, execution_mode_1.isLiveWriteAllowed)(get, "wallbox"), true);
    });
});
(0, node_test_1.describe)("smart-plan parser formats", () => {
    (0, node_test_1.it)("parses start/end pair objects and nested dateTime", () => {
        const parsed = (0, smart_plan_parse_1.parseSmartPlanPayload)({
            slots: [
                {
                    start: { dateTime: "2026-08-13T12:00:00.000Z" },
                    end: { dateTime: "2026-08-13T13:00:00.000Z" },
                    powerKw: 7.4,
                },
            ],
        });
        strict_1.default.equal(parsed.parseable, true);
        strict_1.default.equal(parsed.slots[0].plannedPowerKw, 7.4);
    });
    (0, node_test_1.it)("ignores unparseable windows instead of inventing them", () => {
        const parsed = (0, smart_plan_parse_1.parseSmartPlanPayload)([{ foo: 1 }, SLOT_FUTURE]);
        strict_1.default.equal(parsed.parseable, true);
        strict_1.default.equal(parsed.slots.length, 1);
        strict_1.default.equal(parsed.ignoredCount, 1);
    });
});
