"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const strict_1 = __importDefault(require("node:assert/strict"));
const node_test_1 = require("node:test");
const execution_mode_1 = require("../execution_mode");
const types_1 = require("../operator/contributions/flexible/types");
const execute_1 = require("../addons/wallbox/runtime/execute");
const execution_display_1 = require("./execution_display");
const execution_effective_1 = require("./execution_effective");
const product_summary_1 = require("./product_summary");
const tick_1 = require("../operator/daily_plan/tick");
const reason_codes_1 = require("../operator/daily_plan/unified/reason_codes");
(0, node_test_1.describe)("Beta-Befund 005 — einheitliche Add-on-Modi off|dryrun|live", () => {
    (0, node_test_1.it)("parse: global never off; addon accepts off", () => {
        strict_1.default.equal((0, execution_mode_1.parseGlobalMode)("off"), "dryrun");
        strict_1.default.equal((0, execution_mode_1.parseAddonMode)("off"), "off");
        strict_1.default.equal((0, execution_mode_1.parseMode)("off"), "off");
        strict_1.default.equal((0, execution_mode_1.isAddonExecutionOff)("off"), true);
        strict_1.default.equal((0, execution_mode_1.isAddonExecutionOff)("dryrun"), false);
    });
    (0, node_test_1.it)("N: no global→addon cascade; O: direct addon off write sticks", async () => {
        const store = new Map([
            ["addons.immersion_heater.mode", { val: "live", ack: true }],
            ["addons.battery.mode", { val: "dryrun", ack: true }],
        ]);
        const adapter = {
            namespace: "ems.0",
            log: { info: () => { }, warn: () => { } },
            getStateAsync: async (id) => store.get(id) ?? null,
            setStateAsync: async (id, st) => {
                store.set(id, { val: st.val, ack: st.ack ?? false });
            },
            setObjectNotExistsAsync: async () => undefined,
        };
        await (0, execution_mode_1.handleExecutionModeStateChange)(adapter, "ems.0.global.execution_mode", {
            val: "live",
            ack: false,
        });
        strict_1.default.equal(store.get("addons.immersion_heater.mode")?.val, "live");
        await (0, execution_mode_1.handleExecutionModeStateChange)(adapter, "ems.0.addons.immersion_heater.mode", {
            val: "off",
            ack: false,
        });
        strict_1.default.equal(store.get("addons.immersion_heater.mode")?.val, "off");
        strict_1.default.equal(store.get("addons.immersion_heater.mode")?.ack, true);
    });
    (0, node_test_1.it)("A/E/H: participation gate blocks off addons", () => {
        const base = {
            addonEnabled: true,
            governanceEnabled: true,
            configured: true,
            mappingsReady: true,
            fault: false,
            lockout: false,
            globalModeOff: false,
        };
        strict_1.default.equal((0, types_1.evaluateParticipation)({ ...base, addonExecutionOff: true }).allowed, false);
        strict_1.default.match((0, types_1.evaluateParticipation)({ ...base, addonExecutionOff: true }).reasonDe, /Aus/);
        strict_1.default.equal((0, types_1.evaluateParticipation)({ ...base, addonExecutionOff: false }).allowed, true);
    });
    (0, node_test_1.it)("B/C/D: write authority hierarchy", async () => {
        const store = new Map([
            ["global.execution_mode", { val: "live", ack: true }],
            ["addons.immersion_heater.mode", { val: "dryrun", ack: true }],
        ]);
        const get = async (id) => store.get(id) ?? null;
        strict_1.default.equal(await (0, execution_mode_1.isLiveWriteAllowed)(get, "immersion_heater"), false);
        store.set("addons.immersion_heater.mode", { val: "live", ack: true });
        strict_1.default.equal(await (0, execution_mode_1.isLiveWriteAllowed)(get, "immersion_heater"), true);
        store.set("global.execution_mode", { val: "dryrun", ack: true });
        strict_1.default.equal(await (0, execution_mode_1.isLiveWriteAllowed)(get, "immersion_heater"), false);
        store.set("addons.immersion_heater.mode", { val: "off", ack: true });
        store.set("global.execution_mode", { val: "live", ack: true });
        strict_1.default.equal(await (0, execution_mode_1.isLiveWriteAllowed)(get, "immersion_heater"), false);
    });
    (0, node_test_1.it)("G/Q: wallbox off → observe (EVCC autonom, no EMS phase)", () => {
        strict_1.default.equal((0, execute_1.resolveWallboxRuntimePhase)({
            addonEnabled: true,
            governanceEnabled: true,
            liveRequested: true,
            addonExecutionOff: true,
        }), "observe");
        strict_1.default.equal((0, execute_1.resolveWallboxRuntimePhase)({
            addonEnabled: true,
            governanceEnabled: true,
            liveRequested: false,
            addonExecutionOff: false,
        }), "dryrun");
    });
    (0, node_test_1.it)("F/P: Klima live + außerhalb Zeitfenster ≠ AUS; Off = AUS", () => {
        strict_1.default.equal((0, execution_display_1.resolveExecutionAuthorityFromModes)("live", "live"), "live");
        strict_1.default.equal((0, execution_display_1.executionAuthorityBadge)("live").labelDe, "LIVE");
        const locked = (0, execution_display_1.resolveClimateUnitDisplay)({
            liveWriteAllowed: true,
            hardwareRunning: false,
            allocatedPowerW: 0,
            reasonDe: "Außerhalb Zeitfenster 08:00–20:00.",
            hasFuturePlan: true,
            nextPlanWindow: {
                startIso: "2026-08-09T09:00:00.000Z",
                endIso: "2026-08-09T11:00:00.000Z",
                startMs: Date.parse("2026-08-09T09:00:00.000Z"),
                endMs: Date.parse("2026-08-09T11:00:00.000Z"),
                powerW: 700,
                contributionId: "air_conditioning.unit_1",
            },
            timezone: "UTC",
        });
        strict_1.default.match(locked.operationLabelDe, /Gesperrt/);
        strict_1.default.notEqual(locked.badge.labelDe, "Aus");
        strict_1.default.equal((0, execution_display_1.resolveExecutionAuthorityFromModes)("live", "off"), "off");
        strict_1.default.equal((0, execution_display_1.executionAuthorityBadge)("off").labelDe, "AUS");
        strict_1.default.match((0, execution_display_1.addonOffSummaryDe)("wallbox"), /EVCC autonom/);
    });
    (0, node_test_1.it)("R: mixed modes in effective snapshot", () => {
        const snap = (0, execution_effective_1.buildEffectiveExecutionSnapshot)({
            globalMode: "live",
            addonModes: {
                immersion_heater: "off",
                air_conditioning: "live",
                battery: "dryrun",
                wallbox: "live",
            },
        });
        strict_1.default.equal(snap.addons.immersion_heater.configuredMode, "off");
        strict_1.default.equal(snap.addons.immersion_heater.liveWritesPossible, false);
        strict_1.default.equal(snap.addons.air_conditioning.liveWritesPossible, true);
        strict_1.default.equal(snap.addons.battery.effectiveWriteMode, "dryrun");
        strict_1.default.equal(snap.addons.wallbox.liveWritesPossible, true);
        strict_1.default.match(snap.summaryDe, /Aus: immersion_heater/);
    });
    (0, node_test_1.it)("P: product summary shows OFF lines, no fake windows", () => {
        const plan = {
            schemaVersion: 1,
            planId: "off-agenda",
            generation: 1,
            createdAtIso: "2026-08-09T06:00:00.000Z",
            date: "2026-08-09",
            timezone: "UTC",
            globalMode: "balanced",
            horizonStartIso: "2026-08-09T06:00:00.000Z",
            horizonEndIso: "2026-08-09T18:00:00.000Z",
            slotMinutes: 15,
            allocations: [
                {
                    kind: "immersion_heater",
                    contributionId: "immersion_heater.flexible",
                    slot: {
                        startIso: "2026-08-09T08:00:00.000Z",
                        endIso: "2026-08-09T08:15:00.000Z",
                    },
                    allocatedPowerW: 1700,
                    allocatedEnergyKwh: 0.4,
                    energySource: "pv",
                    reasonCodes: [],
                },
            ],
            constraints: [],
            reasonCodes: [],
            unallocated: [],
            totals: {},
        };
        const agenda = (0, product_summary_1.buildUnifiedDayAgendaDe)(plan, {
            immersion_heater: {
                liveWriteAllowed: false,
                hardwareActive: false,
                executionOff: true,
            },
        });
        strict_1.default.ok(agenda.some((l) => /Heizstab: AUS/.test(l)));
        strict_1.default.ok(!agenda.some((l) => /thermisch vorladen/.test(l)));
    });
    (0, node_test_1.it)("I/J: forced replan reason exists; request clears stale cache hook", () => {
        strict_1.default.equal(reason_codes_1.REASON.REPLAN_ADDON_EXECUTION_MODE, "replan_addon_execution_mode");
        (0, tick_1.resetDailyPlanRevisionForTest)();
        (0, tick_1.requestForcedUnifiedReplan)("test_mode_change");
        // request itself must not throw; next tick consumes reasons
        strict_1.default.ok(true);
    });
    (0, node_test_1.it)("effective live write helper rejects off", () => {
        strict_1.default.equal((0, execution_display_1.isEffectiveLiveWriteAllowed)("live", "off"), false);
        strict_1.default.equal((0, execution_display_1.isEffectiveLiveWriteAllowed)("live", "dryrun"), false);
        strict_1.default.equal((0, execution_display_1.isEffectiveLiveWriteAllowed)("live", "live"), true);
        strict_1.default.equal((0, execution_display_1.isEffectiveLiveWriteAllowed)("dryrun", "live"), false);
    });
    (0, node_test_1.it)("mixed-mode: IH off / AC+WB live / Battery dryrun authorities", () => {
        const snap = (0, execution_effective_1.buildEffectiveExecutionSnapshot)({
            globalMode: "live",
            addonModes: {
                immersion_heater: "off",
                air_conditioning: "live",
                battery: "dryrun",
                wallbox: "live",
            },
        });
        strict_1.default.equal((0, types_1.evaluateParticipation)({
            addonEnabled: true,
            governanceEnabled: true,
            configured: true,
            mappingsReady: true,
            fault: false,
            lockout: false,
            globalModeOff: false,
            addonExecutionOff: true,
        }).allowed, false);
        strict_1.default.equal(snap.addons.air_conditioning.liveWritesPossible, true);
        strict_1.default.equal(snap.addons.wallbox.liveWritesPossible, true);
        strict_1.default.equal(snap.addons.battery.liveWritesPossible, false);
        strict_1.default.equal(snap.addons.battery.effectiveWriteMode, "dryrun");
    });
});
