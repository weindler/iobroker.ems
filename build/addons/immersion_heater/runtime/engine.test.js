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
    log = { info: () => undefined, warn: () => undefined, debug: () => undefined, error: () => undefined };
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
function baseHost(bufferTempC) {
    const host = new FakeHost();
    host.set((0, tree_paths_js_1.addonEnabled)("immersion_heater"), true);
    host.set((0, tree_paths_js_1.addonAvailable)("immersion_heater"), true);
    host.set("buffer.temp", bufferTempC);
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
    (0, node_test_1.it)("daily_plan_missing: kein Daily Plan initialisiert -> lokaler Sicherheits-Default, Legacy-Planner ignoriert", async () => {
        const host = baseHost(40); // unter planningMinTempC (48) -> Heizen erwartet
        host.set(states_js_1.DAILY_PLAN_STATE_IDS.status, "");
        await (0, engine_js_1.runImmersionRuntimeTick)(host);
        strict_1.default.equal(await decisionState(host, types_js_1.IMMERSION_RUNTIME_STATES.dailyPlanStatus), "daily_plan_missing");
        strict_1.default.equal(await decisionState(host, types_js_1.IMMERSION_RUNTIME_STATES.decisionSource), "thermal_fallback");
        // Sicherheits-Default: ih_force_default_stage (1), NICHT der Legacy-Wert (3).
        strict_1.default.equal(await decisionState(host, types_js_1.IMMERSION_RUNTIME_STATES.commandedStage), 1);
        strict_1.default.notEqual(await decisionState(host, types_js_1.IMMERSION_RUNTIME_STATES.commandedStage), LEGACY_PLANNER_STAGE);
    });
    (0, node_test_1.it)("daily_plan_expired: abgelaufener Plan -> lokaler Sicherheits-Default, Legacy-Planner ignoriert", async () => {
        const now = realNow();
        const host = baseHost(40);
        host.set(states_js_1.DAILY_PLAN_STATE_IDS.status, "ready");
        host.set(states_js_1.DAILY_PLAN_STATE_IDS.date, (0, time_js_1.localDateKeyInTimezone)(now, TZ));
        host.set(states_js_1.DAILY_PLAN_STATE_IDS.revision, 1);
        host.set(states_js_1.DAILY_PLAN_STATE_IDS.validUntil, "2020-01-01T00:00:00.000Z");
        await (0, engine_js_1.runImmersionRuntimeTick)(host);
        strict_1.default.equal(await decisionState(host, types_js_1.IMMERSION_RUNTIME_STATES.dailyPlanStatus), "daily_plan_expired");
        strict_1.default.equal(await decisionState(host, types_js_1.IMMERSION_RUNTIME_STATES.decisionSource), "thermal_fallback");
        strict_1.default.equal(await decisionState(host, types_js_1.IMMERSION_RUNTIME_STATES.commandedStage), 1);
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
    (0, node_test_1.it)("Sicherheits-Default heizt nur bis planningMinTempC, nicht bis planningMaxTempC (Pflicht-Untergrenze, kein Komfortziel)", async () => {
        // Puffer bereits über der Pflicht-Untergrenze (48), aber unter der Komfort-Obergrenze (60):
        // der Sicherheits-Default darf hier NICHT weiterheizen.
        const host = baseHost(50);
        host.set(states_js_1.DAILY_PLAN_STATE_IDS.status, "");
        await (0, engine_js_1.runImmersionRuntimeTick)(host);
        strict_1.default.equal(await decisionState(host, types_js_1.IMMERSION_RUNTIME_STATES.commandedStage), 0);
        strict_1.default.equal((0, engine_js_1.getImmersionPersistForTest)().commandedStage, 0);
    });
});
