"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const strict_1 = __importDefault(require("node:assert/strict"));
const node_fs_1 = require("node:fs");
const node_path_1 = require("node:path");
const battery_consumers_1 = require("../../policy/battery_consumers");
const tick_1 = require("./tick");
const quality_1 = require("../quality");
const contribution_ids_1 = require("../contribution_ids");
const types_1 = require("../contributions/types");
const contributor_1 = require("../contributor");
const TICK_SRC = (0, node_path_1.join)(__dirname, "..", "..", "..", "src", "operator", "daily_plan", "tick.ts");
function forecastForTick(now) {
    const start = "2026-08-19T10:00:00.000Z";
    const end = "2026-08-19T10:15:00.000Z";
    return {
        generatedAt: now.toISOString(),
        validUntil: null,
        revision: 1,
        timezone: "UTC",
        horizonStart: start,
        horizonEnd: "2026-08-21T10:00:00.000Z",
        slotMinutes: 15,
        status: "ready",
        activeContributors: [],
        excludedContributors: [],
        days: [
            {
                date: "2026-08-19",
                pvEnergyKwh: 20,
                houseLoadEnergyKwh: 10,
                renewableBalanceKwh: 10,
                weatherMinTempC: null,
                weatherMaxTempC: null,
                quality: (0, quality_1.operatorQuality)("valid", "OK"),
                reasonDe: "OK",
            },
        ],
        slots: [
            {
                slot: { startIso: start, endIso: end },
                pvPowerW: 3000,
                houseLoadPowerW: 500,
                fixedBalancePowerW: 2500,
                gridPriceCtPerKwh: 20,
                gridImportAllowed: true,
                gridMaxImportPowerW: 11000,
                outdoorTempC: null,
                quality: (0, quality_1.operatorQuality)("valid", "OK"),
                reasonDe: "OK",
            },
        ],
        contributions: [
            (0, types_1.baseContribution)(contribution_ids_1.CONTRIBUTION_IDS.PV_SUPPLY, (0, types_1.pvContributorRef)(), "provide", ["supply"], {
                generatedAt: now.toISOString(),
                validUntil: null,
                revision: 1,
                enabled: true,
                flexible: false,
                gridEligible: false,
                quality: (0, quality_1.operatorQuality)("valid", "PV", 80),
                reasonDe: "PV",
                details: {
                    correctedTodayKwh: 20,
                    rawTodayKwh: 20,
                    lastUpdateTs: now.toISOString(),
                    status: "ready",
                },
                slots: [],
            }),
            (0, types_1.baseContribution)(contribution_ids_1.CONTRIBUTION_IDS.HOUSE_LOAD_FIXED, (0, contributor_1.systemContributorRef)("house_load"), "consume", ["demand_fixed"], {
                generatedAt: now.toISOString(),
                validUntil: null,
                revision: 1,
                enabled: true,
                flexible: false,
                gridEligible: false,
                quality: (0, quality_1.operatorQuality)("valid", "load", 70),
                reasonDe: "load",
                details: {},
                slots: [],
            }),
            (0, types_1.baseContribution)(contribution_ids_1.CONTRIBUTION_IDS.GRID_SUPPLY, (0, contributor_1.systemContributorRef)("grid_supply"), "provide", ["supply"], {
                generatedAt: now.toISOString(),
                validUntil: null,
                revision: 1,
                enabled: true,
                flexible: false,
                gridEligible: true,
                quality: (0, quality_1.operatorQuality)("valid", "grid", 90),
                reasonDe: "grid",
                details: {},
                slots: [],
            }),
            (0, types_1.baseContribution)(contribution_ids_1.CONTRIBUTION_IDS.BATTERY_CHARGE, (0, contributor_1.addonContributorRef)("battery"), "consume", ["storage"], {
                generatedAt: now.toISOString(),
                validUntil: null,
                revision: 1,
                enabled: true,
                flexible: true,
                gridEligible: false,
                quality: (0, quality_1.operatorQuality)("valid", "bat", 80),
                reasonDe: "bat",
                details: { socPct: 80, maxChargePowerW: 5000, requiredEnergyKwh: 2 },
                slots: [],
            }),
        ],
        quality: (0, quality_1.operatorQuality)("valid", "OK"),
        reasonDe: "OK",
    };
}
function mockHost(config = {}) {
    const states = new Map();
    const writeCounts = new Map();
    const cfg = {
        intent_timezone: "UTC",
        bat_hw_max_charge_w: 5000,
        bat_hw_min_soc_pct: 10,
        bat_hw_max_soc_pct: 100,
        ...config,
    };
    return {
        config: cfg,
        states,
        writeCounts,
        log: { warn: () => { }, debug: () => { } },
        async getStateAsync(id) {
            if (!states.has(id))
                return null;
            return { val: states.get(id), ts: Date.now() };
        },
        async setStateAsync(id, state) {
            const val = state && typeof state === "object" && "val" in state
                ? state.val
                : state;
            states.set(id, val);
            writeCounts.set(id, (writeCounts.get(id) ?? 0) + 1);
        },
        async getForeignStateAsync() {
            return null;
        },
    };
}
(0, node_test_1.describe)("batteryConsumerConstraintStateWrites", () => {
    (0, node_test_1.it)("maps all three consumers to Admin live-status ids", () => {
        const access = (0, battery_consumers_1.resolveAllBatteryConsumerAccess)({
            config: (0, battery_consumers_1.batteryConsumersConfigFromAdapter)({
                bat_consumer_immersion_may_use_battery: true,
                bat_consumer_immersion_only_when_critical: false,
                bat_consumer_climate_may_use_battery: true,
                bat_consumer_climate_only_when_critical: false,
                bat_consumer_wallbox_may_use_battery: true,
            }),
            batteryHoldActive: false,
            socPct: 80,
            criticalByConsumer: {
                immersion_heater: false,
                air_conditioning: false,
                wallbox: false,
            },
        });
        const writes = (0, battery_consumers_1.batteryConsumerConstraintStateWrites)(access);
        strict_1.default.equal(writes.length, 6);
        const byId = Object.fromEntries(writes.map((w) => [w.id, w.val]));
        strict_1.default.equal(byId[battery_consumers_1.BATTERY_CONSUMER_CONSTRAINT_STATES.immersion_heater.allowed], true);
        strict_1.default.equal(byId[battery_consumers_1.BATTERY_CONSUMER_CONSTRAINT_STATES.air_conditioning.allowed], true);
        strict_1.default.equal(byId[battery_consumers_1.BATTERY_CONSUMER_CONSTRAINT_STATES.wallbox.allowed], true);
    });
});
(0, node_test_1.describe)("Daily Plan publishes planner.constraints from Admin config", () => {
    (0, node_test_1.it)("always refreshes consumer + hold + planner heartbeat via setStateAsync", () => {
        const tick = (0, node_fs_1.readFileSync)(TICK_SRC, "utf8");
        const publishSrc = (0, node_path_1.join)(__dirname, "..", "..", "..", "src", "policy", "battery_consumers", "publish.ts");
        const publish = (0, node_fs_1.readFileSync)(publishSrc, "utf8");
        for (const id of [
            "planner.constraints.battery_hold_active",
            "planner.constraints.evcc_battery_hold",
            "planner.global_mode.active",
            "planner.last_run_at",
            "planner.status",
        ]) {
            strict_1.default.match(tick, new RegExp(id.replace(/\./g, "\\.")));
            strict_1.default.equal(tick.includes(`setStateIfChanged(host, "${id}"`), false, id);
        }
        strict_1.default.match(tick, /batteryConsumerConstraintStateWrites/);
        for (const id of [
            battery_consumers_1.BATTERY_CONSUMER_CONSTRAINT_STATES.immersion_heater.allowed,
            battery_consumers_1.BATTERY_CONSUMER_CONSTRAINT_STATES.immersion_heater.reasonDe,
            battery_consumers_1.BATTERY_CONSUMER_CONSTRAINT_STATES.air_conditioning.allowed,
            battery_consumers_1.BATTERY_CONSUMER_CONSTRAINT_STATES.air_conditioning.reasonDe,
            battery_consumers_1.BATTERY_CONSUMER_CONSTRAINT_STATES.wallbox.allowed,
            battery_consumers_1.BATTERY_CONSUMER_CONSTRAINT_STATES.wallbox.reasonDe,
        ]) {
            strict_1.default.match(publish, new RegExp(id.replace(/\./g, "\\.")));
        }
    });
    (0, node_test_1.it)("Admin: Heizstab darf Batterie (ohne nur-kritisch) → allowed true on next tick", async () => {
        (0, tick_1.resetDailyPlanRevisionForTest)();
        const host = mockHost();
        host.states.set("live.battery.soc_pct", 80);
        host.states.set("live.thermal.buffer_temp_c", 44);
        host.states.set("global_modes.active", "balanced");
        const now = new Date("2026-08-19T10:07:00.000Z");
        const fp = forecastForTick(now);
        await (0, tick_1.runDailyPlanTick)(host, fp);
        strict_1.default.equal(host.states.get("planner.constraints.battery_consumer_immersion_allowed"), false);
        strict_1.default.match(String(host.states.get("planner.constraints.battery_consumer_immersion_reason_de")), /nicht erlaubt/);
        host.config.bat_consumer_immersion_may_use_battery = true;
        host.config.bat_consumer_immersion_only_when_critical = false;
        host.config.bat_consumer_climate_may_use_battery = true;
        host.config.bat_consumer_climate_only_when_critical = false;
        host.config.bat_consumer_wallbox_may_use_battery = true;
        await (0, tick_1.runDailyPlanTick)(host, fp);
        strict_1.default.equal(host.states.get("planner.constraints.battery_consumer_immersion_allowed"), true);
        strict_1.default.match(String(host.states.get("planner.constraints.battery_consumer_immersion_reason_de")), /freigegeben/);
        strict_1.default.equal(host.states.get("planner.constraints.battery_consumer_climate_allowed"), true);
        strict_1.default.equal(host.states.get("planner.constraints.battery_consumer_wallbox_allowed"), true);
        strict_1.default.equal(host.states.get("planner.global_mode.active"), "balanced");
        strict_1.default.equal(host.states.get("planner.status"), "running");
        strict_1.default.equal(typeof host.states.get("planner.last_run_at"), "string");
        strict_1.default.ok((host.writeCounts.get("planner.constraints.battery_consumer_immersion_allowed") ?? 0) >= 2, "same value must still be rewritten so ts stays current");
    });
    (0, node_test_1.it)("Admin: nur-kritisch bleibt sichtbar, wenn Puffer nicht kritisch", async () => {
        (0, tick_1.resetDailyPlanRevisionForTest)();
        const host = mockHost({
            bat_consumer_immersion_may_use_battery: true,
            bat_consumer_immersion_only_when_critical: true,
            ih_planning_min_temp_c: 48,
            bat_consumer_immersion_critical_margin_k: 2,
        });
        host.states.set("live.battery.soc_pct", 80);
        host.states.set("live.thermal.buffer_temp_c", 55);
        const now = new Date("2026-08-19T10:07:00.000Z");
        await (0, tick_1.runDailyPlanTick)(host, forecastForTick(now));
        strict_1.default.equal(host.states.get("planner.constraints.battery_consumer_immersion_allowed"), false);
        strict_1.default.match(String(host.states.get("planner.constraints.battery_consumer_immersion_reason_de")), /Nur-kritisch/);
    });
});
