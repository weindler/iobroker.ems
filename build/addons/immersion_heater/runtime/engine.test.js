"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const strict_1 = __importDefault(require("node:assert/strict"));
const engine_js_1 = require("./engine.js");
const types_js_1 = require("./types.js");
const states_js_1 = require("../../../operator/daily_plan/states.js");
const contribution_ids_js_1 = require("../../../operator/contribution_ids.js");
const contributor_js_1 = require("../../../operator/contributor.js");
const slots_js_1 = require("../../../operator/daily_plan/slots.js");
const time_js_1 = require("../../../operator/time.js");
const tree_paths_js_1 = require("../../../tree_paths.js");
const safety_js_1 = require("./safety.js");
const device_config_js_1 = require("../device_config.js");
const barrier_js_1 = require("../../../restore/barrier.js");
const feedback_js_1 = require("./feedback.js");
/**
 * Roadmap Block 3.1: `runImmersionRuntimeTick` darf im Auto-Modus nur noch den Daily Plan oder
 * (wenn dieser nicht verwendbar ist) einen lokalen Sicherheits-Default nutzen — nie mehr
 * `planner.intent.thermal.*` (alter Realtime-Planner). Jeder Testfall seedet bewusst abweichende
 * Legacy-Planner-Werte, um zu belegen, dass sie ignoriert werden.
 */
const TZ = "UTC";
// Slot/Datum werden bewusst zur Testlaufzeit aus der echten Uhrzeit abgeleitet, weil
// `runImmersionRuntimeTick` selbst `new Date()` verwendet (keine injizierbare Uhr).
function realNow() {
    return new Date();
}
const CONFIG = {
    intent_timezone: TZ,
    ih_stage_count: 1,
    ih_stage_1_set_state: "immersion.stage1",
    ih_stage_1_enabled: true,
    ih_stage_1_nominal_power_w: 2000,
    ih_buffer_temp_c_enabled: true,
    ih_buffer_temp_c_target: "buffer.temp",
    ih_boiler_temp_c_enabled: true,
    ih_boiler_temp_c_target: "boiler.temp",
    ih_boiler_min_temp_c: 50,
    ih_planning_min_temp_c: 48,
    ih_planning_max_temp_c: 60,
    ih_force_default_stage: 1,
};
const LEGACY_PLANNER_STAGE = 3;
const LEGACY_PLANNER_TARGET_TEMP_C = 5;
function allocationEntry(slotStartIso, slotEndIso, allocatedPowerW) {
    return {
        contributionId: contribution_ids_js_1.CONTRIBUTION_IDS.IMMERSION_MANDATORY,
        contributor: (0, contributor_js_1.addonContributorRef)("immersion_heater"),
        slot: { startIso: slotStartIso, endIso: slotEndIso },
        status: "allocated",
        energySource: "pv_surplus",
        requestedPowerW: allocatedPowerW,
        allocatedPowerW,
        requestedEnergyKwh: null,
        allocatedEnergyKwh: null,
        gridPowerW: 0,
        pvPowerW: allocatedPowerW,
        mandatory: true,
        priorityRank: 1,
        deadlineIso: null,
        estimatedCostCt: null,
        reasonDe: "test",
    };
}
/**
 * Alle Methoden sind Arrow-Function-Properties (nicht Prototype-Methoden), weil
 * `engine.ts` sie teils entbunden aufruft (`const reader = host.getForeignStateAsync ??
 * host.getStateAsync; await reader(id)`) — Prototype-Methoden würden dabei `this` verlieren.
 */
class FakeHost {
    config = CONFIG;
    log = {
        info: () => undefined,
        warn: () => undefined,
        debug: () => undefined,
        error: () => undefined,
    };
    states = new Map();
    set = (id, val) => {
        this.states.set(id, { val, ack: true, ts: Date.now(), lc: Date.now(), from: "test", q: 0 });
    };
    setObjectNotExistsAsync = async () => {
        return undefined;
    };
    getStateAsync = async (id) => {
        return this.states.get(id) ?? null;
    };
    getForeignStateAsync = async (id) => {
        return this.states.get(id) ?? null;
    };
    setStateAsync = async (id, state) => {
        const val = state && typeof state === "object" && "val" in state ? state.val : null;
        this.set(id, val ?? null);
        return undefined;
    };
    setForeignStateAsync = async (id, state) => {
        return this.setStateAsync(id, state);
    };
    subscribeStatesAsync = async () => { };
    subscribeForeignStatesAsync = async () => { };
    unsubscribeStatesAsync = async () => { };
    unsubscribeForeignStatesAsync = async () => { };
}
function baseHost(bufferTempC, boilerTempC = 58) {
    const host = new FakeHost();
    host.set((0, tree_paths_js_1.addonEnabled)("immersion_heater"), true);
    host.set((0, tree_paths_js_1.addonAvailable)("immersion_heater"), true);
    host.set("buffer.temp", bufferTempC);
    host.set("boiler.temp", boilerTempC);
    // Auslaufender Realtime-Planner (Legacy) — engine.ts darf diese Werte seit Block 3.1 nicht
    // mehr lesen. Absichtlich auf Werte gesetzt, die ein anderes Ergebnis erzeugen würden,
    // falls sie doch (fälschlich) gelesen würden.
    host.set("planner.intent.thermal.commanded_stage", LEGACY_PLANNER_STAGE);
    host.set("planner.intent.thermal.target_temp_c", LEGACY_PLANNER_TARGET_TEMP_C);
    return host;
}
async function decisionState(host, id) {
    const st = await host.getStateAsync(id);
    return st?.val;
}
(0, node_test_1.describe)("immersion runtime engine — Daily Plan vs. Sicherheits-Default (Roadmap Block 3.1)", () => {
    (0, node_test_1.beforeEach)(() => {
        (0, engine_js_1.resetImmersionRuntimeForTest)();
    });
    (0, node_test_1.it)("daily_plan_missing: kalter Puffer + warmer Boiler → kein Hard-Heizen nur wegen Puffer", async () => {
        const host = baseHost(40, 58);
        host.set(states_js_1.DAILY_PLAN_STATE_IDS.status, "");
        await (0, engine_js_1.runImmersionRuntimeTick)(host);
        strict_1.default.equal(await decisionState(host, types_js_1.IMMERSION_RUNTIME_STATES.dailyPlanStatus), "daily_plan_missing");
        strict_1.default.equal(await decisionState(host, types_js_1.IMMERSION_RUNTIME_STATES.decisionSource), "thermal_fallback");
        strict_1.default.equal(await decisionState(host, types_js_1.IMMERSION_RUNTIME_STATES.commandedStage), 0);
        strict_1.default.notEqual(await decisionState(host, types_js_1.IMMERSION_RUNTIME_STATES.commandedStage), LEGACY_PLANNER_STAGE);
    });
    (0, node_test_1.it)("daily_plan_missing: Boiler unter Min → ohne Plan kein lokales Heizen", async () => {
        const host = baseHost(40, 48);
        host.set(states_js_1.DAILY_PLAN_STATE_IDS.status, "");
        await (0, engine_js_1.runImmersionRuntimeTick)(host);
        strict_1.default.equal(await decisionState(host, types_js_1.IMMERSION_RUNTIME_STATES.decisionSource), "thermal_fallback");
        strict_1.default.equal(await decisionState(host, types_js_1.IMMERSION_RUNTIME_STATES.commandedStage), 0);
        strict_1.default.notEqual(await decisionState(host, types_js_1.IMMERSION_RUNTIME_STATES.commandedStage), LEGACY_PLANNER_STAGE);
    });
    (0, node_test_1.it)("daily_plan_expired: Boiler unter Min → ohne Plan kein lokales Heizen", async () => {
        const now = realNow();
        const host = baseHost(40, 48);
        host.set(states_js_1.DAILY_PLAN_STATE_IDS.status, "ready");
        host.set(states_js_1.DAILY_PLAN_STATE_IDS.date, (0, time_js_1.localDateKeyInTimezone)(now, TZ));
        host.set(states_js_1.DAILY_PLAN_STATE_IDS.revision, 1);
        host.set(states_js_1.DAILY_PLAN_STATE_IDS.validUntil, "2020-01-01T00:00:00.000Z");
        await (0, engine_js_1.runImmersionRuntimeTick)(host);
        strict_1.default.equal(await decisionState(host, types_js_1.IMMERSION_RUNTIME_STATES.dailyPlanStatus), "daily_plan_expired");
        strict_1.default.equal(await decisionState(host, types_js_1.IMMERSION_RUNTIME_STATES.decisionSource), "thermal_fallback");
        strict_1.default.equal(await decisionState(host, types_js_1.IMMERSION_RUNTIME_STATES.commandedStage), 0);
    });
    (0, node_test_1.it)("daily_plan_zero_allocation (gültiger Plan, 0 W im Slot) -> Plan aus, kein Sicherheits-Default-Heizen", async () => {
        const now = realNow();
        // Unter planningMinTempC — früher hätte der Fallback geheizt; mit Plan-Ownership bleibt aus.
        const host = baseHost(40);
        host.set(states_js_1.DAILY_PLAN_STATE_IDS.status, "degraded");
        host.set(states_js_1.DAILY_PLAN_STATE_IDS.date, (0, time_js_1.localDateKeyInTimezone)(now, TZ));
        host.set(states_js_1.DAILY_PLAN_STATE_IDS.revision, 1);
        host.set(states_js_1.DAILY_PLAN_STATE_IDS.validUntil, "");
        host.set(states_js_1.ALLOCATION_ADDON_STATE_IDS.immersion_heater.planJson, "[]");
        await (0, engine_js_1.runImmersionRuntimeTick)(host);
        strict_1.default.equal(await decisionState(host, types_js_1.IMMERSION_RUNTIME_STATES.dailyPlanStatus), "daily_plan_zero_allocation");
        strict_1.default.equal(await decisionState(host, types_js_1.IMMERSION_RUNTIME_STATES.decisionSource), "daily_plan");
        strict_1.default.equal(await decisionState(host, types_js_1.IMMERSION_RUNTIME_STATES.commandedStage), 0);
    });
    (0, node_test_1.it)("Mikro-Allocation unter kleinster Stufe -> Daily Plan aus (Stage 0)", async () => {
        const now = realNow();
        const slotStartIso = (0, slots_js_1.slotStartIsoFloored)(now, TZ);
        const slotEndIso = new Date(Date.parse(slotStartIso) + slots_js_1.DAILY_PLAN_SLOT_MS).toISOString();
        const host = baseHost(40);
        host.set(states_js_1.DAILY_PLAN_STATE_IDS.status, "ready");
        host.set(states_js_1.DAILY_PLAN_STATE_IDS.date, (0, time_js_1.localDateKeyInTimezone)(now, TZ));
        host.set(states_js_1.DAILY_PLAN_STATE_IDS.revision, 1);
        host.set(states_js_1.DAILY_PLAN_STATE_IDS.validUntil, "");
        host.set(states_js_1.ALLOCATION_ADDON_STATE_IDS.immersion_heater.planJson, JSON.stringify([allocationEntry(slotStartIso, slotEndIso, 8)]));
        await (0, engine_js_1.runImmersionRuntimeTick)(host);
        strict_1.default.equal(await decisionState(host, types_js_1.IMMERSION_RUNTIME_STATES.dailyPlanStatus), "daily_plan_zero_allocation");
        strict_1.default.equal(await decisionState(host, types_js_1.IMMERSION_RUNTIME_STATES.decisionSource), "daily_plan");
        strict_1.default.equal(await decisionState(host, types_js_1.IMMERSION_RUNTIME_STATES.commandedStage), 0);
    });
    (0, node_test_1.it)("daily_plan_valid: Allocation im aktuellen Slot -> Daily Plan steuert, Legacy-Planner bleibt irrelevant", async () => {
        const now = realNow();
        const slotStartIso = (0, slots_js_1.slotStartIsoFloored)(now, TZ);
        const slotEndIso = new Date(Date.parse(slotStartIso) + slots_js_1.DAILY_PLAN_SLOT_MS).toISOString();
        const host = baseHost(40);
        host.set(states_js_1.DAILY_PLAN_STATE_IDS.status, "ready");
        host.set(states_js_1.DAILY_PLAN_STATE_IDS.date, (0, time_js_1.localDateKeyInTimezone)(now, TZ));
        host.set(states_js_1.DAILY_PLAN_STATE_IDS.revision, 1);
        host.set(states_js_1.DAILY_PLAN_STATE_IDS.validUntil, "");
        host.set(states_js_1.ALLOCATION_ADDON_STATE_IDS.immersion_heater.planJson, JSON.stringify([allocationEntry(slotStartIso, slotEndIso, 2000)]));
        await (0, engine_js_1.runImmersionRuntimeTick)(host);
        strict_1.default.equal(await decisionState(host, types_js_1.IMMERSION_RUNTIME_STATES.dailyPlanStatus), "daily_plan_valid");
        strict_1.default.equal(await decisionState(host, types_js_1.IMMERSION_RUNTIME_STATES.decisionSource), "daily_plan");
        strict_1.default.equal(await decisionState(host, types_js_1.IMMERSION_RUNTIME_STATES.commandedStage), 1);
        strict_1.default.notEqual(await decisionState(host, types_js_1.IMMERSION_RUNTIME_STATES.commandedStage), LEGACY_PLANNER_STAGE);
    });
    (0, node_test_1.it)("Sicherheits-Default: Boiler über Min → kein Fallback-Heizen trotz Puffer unter Max", async () => {
        const host = baseHost(50, 58);
        host.set(states_js_1.DAILY_PLAN_STATE_IDS.status, "");
        await (0, engine_js_1.runImmersionRuntimeTick)(host);
        strict_1.default.equal(await decisionState(host, types_js_1.IMMERSION_RUNTIME_STATES.commandedStage), 0);
        strict_1.default.equal((0, engine_js_1.getImmersionPersistForTest)().commandedStage, 0);
    });
    (0, node_test_1.it)("Admin Mindestpause (ih_minimum_pause_sec) bleibt nach Aus-Schalt erhalten", async () => {
        const now = realNow();
        const slotStartIso = (0, slots_js_1.slotStartIsoFloored)(now, TZ);
        const slotEndIso = new Date(Date.parse(slotStartIso) + slots_js_1.DAILY_PLAN_SLOT_MS).toISOString();
        const host = baseHost(40);
        host.config = {
            ...CONFIG,
            ih_minimum_runtime_sec: 1,
            ih_minimum_pause_sec: 600,
        };
        host.set("global.execution_mode", "live");
        host.set("addons.immersion_heater.mode", "live");
        host.set("addons.immersion_heater.governance.enabled", true);
        host.set("immersion.stage1", false);
        host.set(states_js_1.DAILY_PLAN_STATE_IDS.status, "ready");
        host.set(states_js_1.DAILY_PLAN_STATE_IDS.date, (0, time_js_1.localDateKeyInTimezone)(now, TZ));
        host.set(states_js_1.DAILY_PLAN_STATE_IDS.revision, 1);
        host.set(states_js_1.DAILY_PLAN_STATE_IDS.validUntil, "");
        host.set(states_js_1.ALLOCATION_ADDON_STATE_IDS.immersion_heater.planJson, JSON.stringify([allocationEntry(slotStartIso, slotEndIso, 2000)]));
        await (0, engine_js_1.runImmersionRuntimeTick)(host);
        strict_1.default.equal(await decisionState(host, types_js_1.IMMERSION_RUNTIME_STATES.commandedStage), 1);
        strict_1.default.equal(await decisionState(host, types_js_1.IMMERSION_RUNTIME_STATES.configMinimumPauseSec), 600);
        // Mindestlaufzeit ablaufen lassen, damit Plan-OFF die Pause setzt (nicht weiter hält).
        (0, engine_js_1.getImmersionPersistForTest)().minRuntimeUntilMs = Date.now() - 1;
        host.set(states_js_1.ALLOCATION_ADDON_STATE_IDS.immersion_heater.status, "ready");
        host.set(states_js_1.ALLOCATION_ADDON_STATE_IDS.immersion_heater.planJson, "[]");
        await (0, engine_js_1.runImmersionRuntimeTick)(host);
        strict_1.default.equal(await decisionState(host, types_js_1.IMMERSION_RUNTIME_STATES.commandedStage), 0);
        const pauseUntil = (0, engine_js_1.getImmersionPersistForTest)().pauseUntilMs;
        strict_1.default.ok(pauseUntil != null, "pauseUntilMs gesetzt");
        const remSec = Math.ceil((pauseUntil - Date.now()) / 1000);
        strict_1.default.ok(remSec >= 590 && remSec <= 600, `Admin-Pause ~600s erwartet, got ${remSec}`);
    });
});
(0, node_test_1.describe)("immersion runtime — BETA-GATE-003 effective live reconcile", () => {
    (0, node_test_1.beforeEach)(() => {
        (0, engine_js_1.resetImmersionRuntimeForTest)();
    });
    function seedStage1Plan(host) {
        const now = realNow();
        const slotStartIso = (0, slots_js_1.slotStartIsoFloored)(now, TZ);
        const slotEndIso = new Date(Date.parse(slotStartIso) + slots_js_1.DAILY_PLAN_SLOT_MS).toISOString();
        host.set("addons.immersion_heater.governance.enabled", true);
        host.set("immersion.stage1", false);
        host.set(states_js_1.DAILY_PLAN_STATE_IDS.status, "ready");
        host.set(states_js_1.DAILY_PLAN_STATE_IDS.date, (0, time_js_1.localDateKeyInTimezone)(now, TZ));
        host.set(states_js_1.DAILY_PLAN_STATE_IDS.revision, 1);
        host.set(states_js_1.DAILY_PLAN_STATE_IDS.validUntil, "");
        host.set(states_js_1.ALLOCATION_ADDON_STATE_IDS.immersion_heater.planJson, JSON.stringify([allocationEntry(slotStartIso, slotEndIso, 2000)]));
        return { slotStartIso, slotEndIso };
    }
    function trackWrites(host) {
        const foreignWrites = [];
        const origSetForeign = host.setForeignStateAsync;
        host.setForeignStateAsync = async (id, state) => {
            const val = state && typeof state === "object" && "val" in state
                ? state.val
                : state;
            foreignWrites.push({ id, val });
            return origSetForeign(id, state);
        };
        return foreignWrites;
    }
    (0, node_test_1.it)("global edge: global dryrun→live with IH already live reconciles once", async () => {
        const host = baseHost(40);
        host.set("global.execution_mode", "dryrun");
        host.set("addons.immersion_heater.mode", "live");
        seedStage1Plan(host);
        const foreignWrites = trackWrites(host);
        await (0, engine_js_1.runImmersionRuntimeTick)(host);
        strict_1.default.equal(await decisionState(host, types_js_1.IMMERSION_RUNTIME_STATES.commandedStage), 1);
        strict_1.default.equal(foreignWrites.filter((w) => w.id === "immersion.stage1").length, 0);
        host.set("global.execution_mode", "live");
        await (0, engine_js_1.runImmersionRuntimeTick)(host);
        const liveWrites = foreignWrites.filter((w) => w.id === "immersion.stage1");
        strict_1.default.equal(liveWrites.length, 1);
        strict_1.default.equal(liveWrites[0].val, true);
        const beforeSecond = foreignWrites.length;
        await (0, engine_js_1.runImmersionRuntimeTick)(host);
        strict_1.default.equal(foreignWrites.length, beforeSecond);
    });
    (0, node_test_1.it)("addon edge: IH dryrun→live with global already live reconciles once", async () => {
        const host = baseHost(40);
        host.set("global.execution_mode", "live");
        host.set("addons.immersion_heater.mode", "dryrun");
        seedStage1Plan(host);
        const foreignWrites = trackWrites(host);
        await (0, engine_js_1.runImmersionRuntimeTick)(host);
        strict_1.default.equal(await decisionState(host, types_js_1.IMMERSION_RUNTIME_STATES.commandedStage), 1);
        strict_1.default.equal(foreignWrites.filter((w) => w.id === "immersion.stage1").length, 0);
        host.set("addons.immersion_heater.mode", "live");
        await (0, engine_js_1.runImmersionRuntimeTick)(host);
        const liveWrites = foreignWrites.filter((w) => w.id === "immersion.stage1");
        strict_1.default.equal(liveWrites.length, 1);
        strict_1.default.equal(liveWrites[0].val, true);
    });
    (0, node_test_1.it)("live→dryrun (global) blocks subsequent hardware writes", async () => {
        const host = baseHost(40);
        host.set("global.execution_mode", "live");
        host.set("addons.immersion_heater.mode", "live");
        const { slotStartIso, slotEndIso } = seedStage1Plan(host);
        const foreignWrites = trackWrites(host);
        await (0, engine_js_1.runImmersionRuntimeTick)(host);
        strict_1.default.ok(foreignWrites.some((w) => w.id === "immersion.stage1" && w.val === true));
        host.set("global.execution_mode", "dryrun");
        host.set(states_js_1.ALLOCATION_ADDON_STATE_IDS.immersion_heater.planJson, JSON.stringify([allocationEntry(slotStartIso, slotEndIso, 0)]));
        const n = foreignWrites.length;
        await (0, engine_js_1.runImmersionRuntimeTick)(host);
        strict_1.default.equal(foreignWrites.length, n, "global dryrun must block further writes");
    });
});
(0, node_test_1.describe)("immersion runtime — Root Cause A write apply confirmation", () => {
    (0, node_test_1.beforeEach)(() => {
        (0, engine_js_1.resetImmersionRuntimeForTest)();
        (0, barrier_js_1.resetRestoreBarrierForTest)();
    });
    function seedLiveStage1(host) {
        const now = realNow();
        const slotStartIso = (0, slots_js_1.slotStartIsoFloored)(now, TZ);
        const slotEndIso = new Date(Date.parse(slotStartIso) + slots_js_1.DAILY_PLAN_SLOT_MS).toISOString();
        host.set("global.execution_mode", "live");
        host.set("addons.immersion_heater.mode", "live");
        host.set("addons.immersion_heater.governance.enabled", true);
        host.set("immersion.stage1", false);
        host.set(states_js_1.DAILY_PLAN_STATE_IDS.status, "ready");
        host.set(states_js_1.DAILY_PLAN_STATE_IDS.date, (0, time_js_1.localDateKeyInTimezone)(now, TZ));
        host.set(states_js_1.DAILY_PLAN_STATE_IDS.revision, 1);
        host.set(states_js_1.DAILY_PLAN_STATE_IDS.validUntil, "");
        host.set(states_js_1.ALLOCATION_ADDON_STATE_IDS.immersion_heater.planJson, JSON.stringify([allocationEntry(slotStartIso, slotEndIso, 2000)]));
    }
    function trackWrites(host) {
        const foreignWrites = [];
        const origSetForeign = host.setForeignStateAsync;
        host.setForeignStateAsync = async (id, state) => {
            const val = state && typeof state === "object" && "val" in state
                ? state.val
                : state;
            foreignWrites.push({ id, val });
            return origSetForeign(id, state);
        };
        return foreignWrites;
    }
    (0, node_test_1.it)("A) governance blocked → no write, no apply markers; later retry when allowed", async () => {
        const host = baseHost(40);
        seedLiveStage1(host);
        host.set("addons.immersion_heater.governance.enabled", false);
        const foreignWrites = trackWrites(host);
        await (0, engine_js_1.runImmersionRuntimeTick)(host);
        strict_1.default.equal(await decisionState(host, types_js_1.IMMERSION_RUNTIME_STATES.commandedStage), 1);
        strict_1.default.equal(foreignWrites.filter((w) => w.id === "immersion.stage1").length, 0);
        strict_1.default.equal((0, engine_js_1.getImmersionLastCommandedStageForTest)(), -1);
        strict_1.default.equal((0, engine_js_1.getImmersionEmsOnWriteAtMsForTest)(), null);
        host.set("addons.immersion_heater.governance.enabled", true);
        await (0, engine_js_1.runImmersionRuntimeTick)(host);
        const onWrites = foreignWrites.filter((w) => w.id === "immersion.stage1" && w.val === true);
        strict_1.default.equal(onWrites.length, 1);
        strict_1.default.equal((0, engine_js_1.getImmersionLastCommandedStageForTest)(), 1);
        strict_1.default.ok((0, engine_js_1.getImmersionEmsOnWriteAtMsForTest)() !== null);
    });
    (0, node_test_1.it)("B) restore blocked → no apply markers", async () => {
        const host = baseHost(40);
        seedLiveStage1(host);
        const foreignWrites = trackWrites(host);
        (0, barrier_js_1.setRestoreInProgress)(true);
        try {
            await (0, engine_js_1.runImmersionRuntimeTick)(host);
            strict_1.default.equal(foreignWrites.filter((w) => w.id === "immersion.stage1").length, 0);
            strict_1.default.equal((0, engine_js_1.getImmersionLastCommandedStageForTest)(), -1);
            strict_1.default.equal((0, engine_js_1.getImmersionEmsOnWriteAtMsForTest)(), null);
        }
        finally {
            (0, barrier_js_1.resetRestoreBarrierForTest)();
        }
    });
    (0, node_test_1.it)("C) skip without confirmed readback → not applied; next tick retries write", async () => {
        const host = baseHost(40);
        seedLiveStage1(host);
        const foreignWrites = trackWrites(host);
        let stageReads = 0;
        const origGetForeign = host.getForeignStateAsync;
        host.getForeignStateAsync = async (id) => {
            if (id === "immersion.stage1") {
                stageReads += 1;
                // 1st read (write helper): pretend already ON → skip; 2nd (readback): OFF → reject
                const val = stageReads === 1;
                return { val, ack: true, ts: Date.now(), lc: Date.now(), from: "test", q: 0 };
            }
            return origGetForeign(id);
        };
        await (0, engine_js_1.runImmersionRuntimeTick)(host);
        strict_1.default.equal(foreignWrites.filter((w) => w.id === "immersion.stage1").length, 0);
        strict_1.default.equal((0, engine_js_1.getImmersionLastCommandedStageForTest)(), -1);
        strict_1.default.equal((0, engine_js_1.getImmersionEmsOnWriteAtMsForTest)(), null);
        // Stable OFF → next tick must write ON
        host.getForeignStateAsync = origGetForeign;
        host.set("immersion.stage1", false);
        await (0, engine_js_1.runImmersionRuntimeTick)(host);
        strict_1.default.ok(foreignWrites.some((w) => w.id === "immersion.stage1" && w.val === true));
        strict_1.default.equal((0, engine_js_1.getImmersionLastCommandedStageForTest)(), 1);
        strict_1.default.ok((0, engine_js_1.getImmersionEmsOnWriteAtMsForTest)() !== null);
    });
    (0, node_test_1.it)("D) skip with readback already ON → accept as applied without new write", async () => {
        const host = baseHost(40);
        seedLiveStage1(host);
        host.set("immersion.stage1", true);
        const foreignWrites = trackWrites(host);
        await (0, engine_js_1.runImmersionRuntimeTick)(host);
        strict_1.default.equal(foreignWrites.filter((w) => w.id === "immersion.stage1").length, 0);
        strict_1.default.equal((0, engine_js_1.getImmersionLastCommandedStageForTest)(), 1);
        strict_1.default.ok((0, engine_js_1.getImmersionEmsOnWriteAtMsForTest)() !== null);
    });
    (0, node_test_1.it)("E) successful ON write → lastCommandedStage=1 and emsOnWriteAtMs set", async () => {
        const host = baseHost(40);
        seedLiveStage1(host);
        const foreignWrites = trackWrites(host);
        await (0, engine_js_1.runImmersionRuntimeTick)(host);
        strict_1.default.ok(foreignWrites.some((w) => w.id === "immersion.stage1" && w.val === true));
        strict_1.default.equal((0, engine_js_1.getImmersionLastCommandedStageForTest)(), 1);
        strict_1.default.ok((0, engine_js_1.getImmersionEmsOnWriteAtMsForTest)() !== null);
    });
    (0, node_test_1.it)("F) write error → write_failed lockout unchanged", async () => {
        const host = baseHost(40);
        seedLiveStage1(host);
        host.setForeignStateAsync = async () => {
            throw new Error("bus offline");
        };
        await (0, engine_js_1.runImmersionRuntimeTick)(host);
        strict_1.default.equal((0, engine_js_1.getImmersionPersistForTest)().faultCode, "write_failed");
        strict_1.default.equal((0, engine_js_1.getImmersionPersistForTest)().faultLockout, true);
        strict_1.default.equal((0, engine_js_1.getImmersionLastCommandedStageForTest)(), -1);
        strict_1.default.equal((0, engine_js_1.getImmersionEmsOnWriteAtMsForTest)(), null);
    });
    (0, node_test_1.it)("G) successful ON write + fresh measured 0 → no_power_when_on still locks", async () => {
        const host = baseHost(40);
        seedLiveStage1(host);
        host.config = {
            ...CONFIG,
            ih_actual_power_state: "immersion.power",
            ih_switch_on_check_delay_sec: 1,
        };
        host.set("immersion.power", 0);
        await (0, engine_js_1.runImmersionRuntimeTick)(host);
        strict_1.default.equal((0, engine_js_1.getImmersionLastCommandedStageForTest)(), 1);
        const onAt = (0, engine_js_1.getImmersionEmsOnWriteAtMsForTest)();
        strict_1.default.ok(onAt !== null);
        // Safety-Pfad unverändert: nach Delay + frischem 0-W-Sample → Lockout
        const cfg = (0, device_config_js_1.immersionDeviceConfigFromAdapter)(host.config);
        const fault = (0, safety_js_1.checkPowerFault)({
            nowMs: onAt + 5_000,
            executionLive: true,
            commandedOn: true,
            commandedStage: 1,
            nominalPowerW: 2000,
            measuredPowerW: 0,
            hasPowerMeasurement: true,
            feedbackActive: false,
            emsOnWriteAtMs: onAt,
            emsOffWriteAtMs: null,
            powerObservedAtMs: onAt + 1_000,
            mismatchSinceMs: null,
            config: cfg,
        });
        strict_1.default.equal(fault.faultCode, "no_power_when_on");
        strict_1.default.equal(fault.lockout, true);
    });
});
(0, node_test_1.describe)("immersion runtime — Klima-/Ownership-Block: Manual Override", () => {
    (0, node_test_1.beforeEach)(() => {
        (0, engine_js_1.resetImmersionRuntimeForTest)();
    });
    function liveHostNoDemand() {
        // Warmer Puffer/Boiler + kein Daily Plan → EMS will Stufe 0 (kein Heizbedarf).
        const host = baseHost(58, 58);
        host.set("global.execution_mode", "live");
        host.set("addons.immersion_heater.mode", "live");
        host.set("addons.immersion_heater.governance.enabled", true);
        host.set(states_js_1.DAILY_PLAN_STATE_IDS.status, "");
        // Feedback = dieselbe State-ID wie set_state (kombiniertes Relais mit Rückmeldung).
        host.config = { ...CONFIG, ih_stage_1_feedback_state: "immersion.stage1" };
        host.set("immersion.stage1", false);
        return host;
    }
    function trackForeignWrites(host) {
        const writes = [];
        const orig = host.setForeignStateAsync;
        host.setForeignStateAsync = async (id, state) => {
            const val = state && typeof state === "object" && "val" in state ? state.val : state;
            writes.push({ id, val });
            return orig(id, state);
        };
        return writes;
    }
    (0, node_test_1.it)("manueller Heizstab-Eingriff (Relais manuell EIN) → EMS respektiert Override, kein sofortiges Zurückschalten", async () => {
        const host = liveHostNoDemand();
        // Takt 1: Baseline — EMS will 0, Relais startet false → kein Mismatch, kein Override.
        await (0, engine_js_1.runImmersionRuntimeTick)(host);
        strict_1.default.equal(await decisionState(host, types_js_1.IMMERSION_RUNTIME_STATES.commandedStage), 0);
        strict_1.default.equal(await decisionState(host, types_js_1.IMMERSION_RUNTIME_STATES.ownershipOwner), "ems");
        // Settle-Fenster (IMMERSION_OWNERSHIP_SETTLE_MS) simuliert verstrichen — sonst blockiert
        // der Eigen-Write-Schutz aus Takt 1 die Erkennung in den folgenden (im Test sehr schnellen) Takten.
        (0, engine_js_1.getImmersionPersistForTest)().lastOffAtMs = Date.now() - 5 * 60_000;
        (0, engine_js_1.getImmersionPersistForTest)().lastSwitchAtMs = Date.now() - 5 * 60_000;
        // Manueller Eingriff zwischen den Takten: Relais wird von Hand eingeschaltet.
        host.set("immersion.stage1", true);
        await (0, engine_js_1.runImmersionRuntimeTick)(host); // Takt 2: Mismatch wird erkannt (Erkennung mit 1 Takt Verzögerung)
        const writes = trackForeignWrites(host);
        await (0, engine_js_1.runImmersionRuntimeTick)(host); // Takt 3: Override sollte jetzt aktiv sein
        strict_1.default.equal(await decisionState(host, types_js_1.IMMERSION_RUNTIME_STATES.ownershipOwner), "user");
        strict_1.default.ok((await decisionState(host, types_js_1.IMMERSION_RUNTIME_STATES.ownershipOverrideUntilIso)) !== "", "Override-Frist muss gesetzt sein");
        // EMS darf das manuell eingeschaltete Relais während des Overrides NICHT zurückschalten.
        strict_1.default.equal(writes.some((w) => w.id === "immersion.stage1"), false, "EMS darf während Manual-Override nicht auf das Relais schreiben");
    });
    (0, node_test_1.it)("Safety/kritischer Zustand (Fault-Lockout) übersteuert einen aktiven Manual Override", async () => {
        const host = liveHostNoDemand();
        await (0, engine_js_1.runImmersionRuntimeTick)(host);
        (0, engine_js_1.getImmersionPersistForTest)().lastOffAtMs = Date.now() - 5 * 60_000;
        (0, engine_js_1.getImmersionPersistForTest)().lastSwitchAtMs = Date.now() - 5 * 60_000;
        host.set("immersion.stage1", true);
        await (0, engine_js_1.runImmersionRuntimeTick)(host);
        await (0, engine_js_1.runImmersionRuntimeTick)(host);
        strict_1.default.equal(await decisionState(host, types_js_1.IMMERSION_RUNTIME_STATES.ownershipOwner), "user");
        // Fault-Lockout auslösen (Safety) — muss den Override sofort beenden.
        (0, engine_js_1.getImmersionPersistForTest)().faultLockout = true;
        (0, engine_js_1.getImmersionPersistForTest)().faultCode = "relay_chatter";
        await (0, engine_js_1.runImmersionRuntimeTick)(host);
        strict_1.default.equal(await decisionState(host, types_js_1.IMMERSION_RUNTIME_STATES.ownershipOwner), "ems");
        strict_1.default.equal(await decisionState(host, types_js_1.IMMERSION_RUNTIME_STATES.ownershipOverrideUntilIso), "");
    });
    function expireSettle() {
        (0, engine_js_1.getImmersionPersistForTest)().lastOffAtMs = Date.now() - 5 * 60_000;
        (0, engine_js_1.getImmersionPersistForTest)().lastSwitchAtMs = Date.now() - 5 * 60_000;
    }
    function captureInfo(host) {
        const lines = [];
        host.log.info = (msg) => {
            lines.push(msg);
        };
        return lines;
    }
    function liveHostNoDemandSplitFeedback() {
        const host = liveHostNoDemand();
        host.config = { ...CONFIG, ih_stage_1_feedback_state: "immersion.fb" };
        host.set("immersion.stage1", false);
        host.set("immersion.fb", false);
        return host;
    }
    async function reachManualOnOverride(host, feedbackId = "immersion.stage1") {
        await (0, engine_js_1.runImmersionRuntimeTick)(host);
        expireSettle();
        host.set("immersion.stage1", true);
        if (feedbackId !== "immersion.stage1")
            host.set(feedbackId, true);
        await (0, engine_js_1.runImmersionRuntimeTick)(host);
        await (0, engine_js_1.runImmersionRuntimeTick)(host);
    }
    (0, node_test_1.it)("extern OFF→ON: genau ein Override, paused_until = now + konfigurierte Dauer", async () => {
        const host = liveHostNoDemand();
        await reachManualOnOverride(host);
        strict_1.default.equal(await decisionState(host, types_js_1.IMMERSION_RUNTIME_STATES.ownershipOwner), "user");
        const untilIso = String(await decisionState(host, types_js_1.IMMERSION_RUNTIME_STATES.ownershipOverrideUntilIso));
        const delta = Date.parse(untilIso) - Date.now();
        strict_1.default.ok(delta > feedback_js_1.IMMERSION_MANUAL_OVERRIDE_DURATION_MS_DEFAULT - 15_000, `paused_until zu früh: delta=${delta}`);
        strict_1.default.ok(delta <= feedback_js_1.IMMERSION_MANUAL_OVERRIDE_DURATION_MS_DEFAULT + 5_000, `paused_until zu weit: delta=${delta}`);
    });
    (0, node_test_1.it)("100 Polls mit unverändertem ON verlängern paused_until nicht", async () => {
        const host = liveHostNoDemand();
        await reachManualOnOverride(host);
        const untilIso = await decisionState(host, types_js_1.IMMERSION_RUNTIME_STATES.ownershipOverrideUntilIso);
        for (let i = 0; i < 100; i++) {
            await (0, engine_js_1.runImmersionRuntimeTick)(host);
            strict_1.default.equal(await decisionState(host, types_js_1.IMMERSION_RUNTIME_STATES.ownershipOverrideUntilIso), untilIso, `Poll ${i + 1}: paused_until darf nicht wandern`);
            strict_1.default.equal(await decisionState(host, types_js_1.IMMERSION_RUNTIME_STATES.ownershipOwner), "user");
        }
    });
    (0, node_test_1.it)("EMS selbst schaltet ON → kein Manual Override", async () => {
        const now = realNow();
        const slotStartIso = (0, slots_js_1.slotStartIsoFloored)(now, TZ);
        const slotEndIso = new Date(Date.parse(slotStartIso) + slots_js_1.DAILY_PLAN_SLOT_MS).toISOString();
        const host = baseHost(40);
        host.config = { ...CONFIG, ih_stage_1_feedback_state: "immersion.stage1" };
        host.set("global.execution_mode", "live");
        host.set("addons.immersion_heater.mode", "live");
        host.set("addons.immersion_heater.governance.enabled", true);
        host.set("immersion.stage1", false);
        host.set(states_js_1.DAILY_PLAN_STATE_IDS.status, "ready");
        host.set(states_js_1.DAILY_PLAN_STATE_IDS.date, (0, time_js_1.localDateKeyInTimezone)(now, TZ));
        host.set(states_js_1.DAILY_PLAN_STATE_IDS.revision, 1);
        host.set(states_js_1.DAILY_PLAN_STATE_IDS.validUntil, "");
        host.set(states_js_1.ALLOCATION_ADDON_STATE_IDS.immersion_heater.planJson, JSON.stringify([allocationEntry(slotStartIso, slotEndIso, 2000)]));
        await (0, engine_js_1.runImmersionRuntimeTick)(host);
        strict_1.default.equal(await decisionState(host, types_js_1.IMMERSION_RUNTIME_STATES.commandedStage), 1);
        strict_1.default.equal(await decisionState(host, types_js_1.IMMERSION_RUNTIME_STATES.ownershipOwner), "ems");
        expireSettle();
        for (let i = 0; i < 5; i++) {
            await (0, engine_js_1.runImmersionRuntimeTick)(host);
            strict_1.default.equal(await decisionState(host, types_js_1.IMMERSION_RUNTIME_STATES.ownershipOwner), "ems");
            strict_1.default.equal(await decisionState(host, types_js_1.IMMERSION_RUNTIME_STATES.ownershipOverrideUntilIso), "");
        }
    });
    (0, node_test_1.it)("Override aktiv, Planner will OFF: Write blockiert, Timer unverändert", async () => {
        const host = liveHostNoDemand();
        await reachManualOnOverride(host);
        const untilIso = await decisionState(host, types_js_1.IMMERSION_RUNTIME_STATES.ownershipOverrideUntilIso);
        strict_1.default.equal(await decisionState(host, types_js_1.IMMERSION_RUNTIME_STATES.commandedStage), 0);
        const writes = trackForeignWrites(host);
        await (0, engine_js_1.runImmersionRuntimeTick)(host);
        strict_1.default.equal(writes.some((w) => w.id === "immersion.stage1"), false, "EMS-Write bleibt bis Ablauf blockiert");
        strict_1.default.equal(await decisionState(host, types_js_1.IMMERSION_RUNTIME_STATES.ownershipOverrideUntilIso), untilIso);
        strict_1.default.equal(await decisionState(host, types_js_1.IMMERSION_RUNTIME_STATES.ownershipOwner), "user");
    });
    (0, node_test_1.it)("Override läuft ab, Feedback noch ON → kein Sofort-Retrigger, EMS übernimmt", async () => {
        const host = liveHostNoDemandSplitFeedback();
        await reachManualOnOverride(host, "immersion.fb");
        strict_1.default.equal(await decisionState(host, types_js_1.IMMERSION_RUNTIME_STATES.ownershipOwner), "user");
        (0, engine_js_1.getImmersionPersistForTest)().ownership = {
            ...(0, engine_js_1.getImmersionPersistForTest)().ownership,
            overrideUntilIso: new Date(Date.now() - 1000).toISOString(),
        };
        const writes = trackForeignWrites(host);
        await (0, engine_js_1.runImmersionRuntimeTick)(host);
        strict_1.default.equal(await decisionState(host, types_js_1.IMMERSION_RUNTIME_STATES.ownershipOwner), "ems");
        strict_1.default.equal(await decisionState(host, types_js_1.IMMERSION_RUNTIME_STATES.ownershipOverrideUntilIso), "");
        strict_1.default.ok(writes.some((w) => w.id === "immersion.stage1"), "EMS darf nach Ablauf wieder schreiben");
        expireSettle();
        host.set("immersion.fb", true);
        for (let i = 0; i < 5; i++) {
            await (0, engine_js_1.runImmersionRuntimeTick)(host);
            strict_1.default.equal(await decisionState(host, types_js_1.IMMERSION_RUNTIME_STATES.ownershipOwner), "ems", `Poll ${i + 1} nach Ablauf: kein neuer Override nur wegen gehaltenem ON`);
        }
    });
    (0, node_test_1.it)("echtes neues manuelles OFF→ON nach Ablauf startet neuen Override", async () => {
        const host = liveHostNoDemandSplitFeedback();
        await reachManualOnOverride(host, "immersion.fb");
        (0, engine_js_1.getImmersionPersistForTest)().ownership = {
            ...(0, engine_js_1.getImmersionPersistForTest)().ownership,
            overrideUntilIso: new Date(Date.now() - 1000).toISOString(),
        };
        await (0, engine_js_1.runImmersionRuntimeTick)(host);
        strict_1.default.equal(await decisionState(host, types_js_1.IMMERSION_RUNTIME_STATES.ownershipOwner), "ems");
        expireSettle();
        host.set("immersion.fb", false);
        await (0, engine_js_1.runImmersionRuntimeTick)(host);
        host.set("immersion.fb", true);
        await (0, engine_js_1.runImmersionRuntimeTick)(host);
        await (0, engine_js_1.runImmersionRuntimeTick)(host);
        strict_1.default.equal(await decisionState(host, types_js_1.IMMERSION_RUNTIME_STATES.ownershipOwner), "user");
        strict_1.default.ok((await decisionState(host, types_js_1.IMMERSION_RUNTIME_STATES.ownershipOverrideUntilIso)) !== "");
    });
    (0, node_test_1.it)("identischer aktiver Override erzeugt keinen Info-Log-Spam", async () => {
        const host = liveHostNoDemand();
        const info = captureInfo(host);
        await reachManualOnOverride(host);
        const detected = info.filter((l) => l.includes("manual override detected"));
        strict_1.default.equal(detected.length, 1, "genau eine Detected-Zeile");
        strict_1.default.equal(info.filter((l) => l.includes("manual override active")).length, 0, "kein altes Active-Spam-Log");
        const before = info.length;
        for (let i = 0; i < 20; i++) {
            await (0, engine_js_1.runImmersionRuntimeTick)(host);
        }
        const added = info.slice(before);
        strict_1.default.equal(added.filter((l) => l.includes("manual override")).length, 0, "kein Override-Info bei unverändertem Override");
    });
});
