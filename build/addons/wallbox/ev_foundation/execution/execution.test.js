"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const strict_1 = __importDefault(require("node:assert/strict"));
const node_fs_1 = require("node:fs");
const node_path_1 = require("node:path");
const node_test_1 = require("node:test");
const tree_paths_1 = require("../../../../tree_paths");
const evcc_telemetry_1 = require("../../evcc_telemetry");
const evcc_mode_control_1 = require("../../evcc_mode_control");
const write_allowlist_1 = require("../write_allowlist");
const ensure_states_1 = require("../ensure_states");
const index_1 = require("./index");
const SRC = (0, node_path_1.join)(__dirname, "..", "..", "..", "..", "..", "src", "addons", "wallbox");
const LP = "evcc.0.loadpoint.1";
const NOW = Date.parse("2026-08-15T08:00:00.000Z");
const BUTTON_CFG = {
    wb_control_model: "evcc",
    wb_evcc_mode_control: "buttons",
    wb_evcc_control_off_target: `${LP}.control.off`,
    wb_evcc_control_pv_target: `${LP}.control.pv`,
    wb_evcc_control_min_target: `${LP}.control.min`,
    wb_evcc_control_now_target: `${LP}.control.now`,
    wb_evcc_loadpoint_mode_state: `${LP}.status.mode`,
    wb_evcc_control_max_current_target: `${LP}.control.maxCurrent`,
    wb_evcc_control_phases_configured_target: `${LP}.control.phasesConfigured`,
};
function model(over = {}) {
    return {
        evccConnected: true,
        vehicleConnected: true,
        charging: false,
        chargePowerW: 0,
        evccMode: "pv",
        phasesConfigured: 3,
        phasesActive: 0,
        maxCurrentA: 16,
        minCurrentA: 6,
        effectiveMaxCurrentA: 16,
        offeredCurrentA: 16,
        vehicleSocPct: 50,
        targetSocPct: 90,
        minimumDepartureSocPct: null,
        departureAt: null,
        batteryCapacityKWh: 77,
        maxAcChargePowerKw: 11,
        chargingEfficiency: 0.9,
        safetyMarginMin: 15,
        vehicleAvailableUntil: null,
        externalControlEnabled: false,
        externalControlType: "none",
        externalControlActive: false,
        externalControlConfigured: false,
        externalSmartPlanAvailable: false,
        externalSmartPlanSlots: null,
        externalPlanRemainingEnergyKWh: null,
        externalPlanRemainingMinutes: null,
        externalPlanDeadlineUsed: false,
        gridRewardsActive: false,
        smartChargingActive: false,
        externalSourceQuality: "unconfigured",
        externalSourceUpdatedAt: null,
        externalSourceHealthy: true,
        manualOverrideActive: null,
        emsTakeoverActive: false,
        preparedEvState: "pv",
        recommendedEvState: "pv",
        externalAuthorityState: "inactive",
        takeoverSeverity: "none",
        takeoverRecommended: false,
        takeoverRequired: false,
        takeoverReason: null,
        vehicleDetectionActive: true,
        dataQuality: "ok",
        vehicleSocQuality: "valid",
        externalSmartChargingMinSocPct: null,
        externalSmartChargingMinSocQuality: "unconfigured",
        departureMinSocConfigured: false,
        vehicleModelSource: "ev_model_v1",
        vehicleModelReady: true,
        controlContractModel: "evcc_buttons",
        evccControlContractReady: true,
        legacyDirectControlPresent: false,
        evccModeControlVariant: "buttons",
        evccModeFeedbackState: `${LP}.status.mode`,
        evccModeButtonsReady: true,
        evccModeOffTargetReady: true,
        evccModePvTargetReady: true,
        evccModeMinTargetReady: true,
        evccModeNowTargetReady: true,
        ...over,
    };
}
function decision(over = {}) {
    return {
        connected: true,
        planValid: true,
        useDailyPlan: true,
        chargingAllowedByPlan: true,
        dailyPlanStatus: "daily_plan_valid",
        dailyPlanRevision: 1,
        slotStartIso: "2026-08-15T08:00:00.000Z",
        slotEndIso: "2026-08-15T08:15:00.000Z",
        allocatedPowerW: 11000,
        allocatedEnergyKwh: 2.75,
        requestedPowerW: 11000,
        requestedEnergyKwh: 2.75,
        pvPowerW: 0,
        gridPowerW: 11000,
        energySource: "grid",
        deadlineIso: null,
        estimatedCostCt: null,
        remainingEnergyKwh: 10,
        minChargePowerW: 1380,
        maxChargePowerW: 11000,
        plannedEnergyUntilDeadlineKwh: 10,
        plannedPvEnergyUntilDeadlineKwh: 0,
        plannedGridEnergyUntilDeadlineKwh: 10,
        plannedCostUntilDeadlineCt: null,
        deadlineReachable: true,
        firstPlannedSlot: "2026-08-15T08:00:00.000Z",
        lastPlannedSlot: "2026-08-15T08:00:00.000Z",
        activePlannedSlots: 1,
        maxPlannedPowerW: 11000,
        planExecutionStatus: "in_plan",
        decisionSource: "daily_plan",
        reasonDe: "test",
        externalPlanActive: false,
        externalPlanTime: null,
        runtimeControlAvailable: false,
        writeAllowed: false,
        ...over,
    };
}
function intent(over = {}) {
    return {
        action: "charge",
        enabled: true,
        targetPowerW: 11000,
        targetCurrentA: 16,
        phases: 3,
        source: "grid",
        deadlineIso: null,
        requestedEnergyKwh: 2.75,
        allocatedEnergyKwh: 2.75,
        generatedAt: "2026-08-15T08:00:00.000Z",
        validUntil: "2026-08-15T08:15:00.000Z",
        dailyPlanRevision: 1,
        reasonDe: "test",
        ...over,
    };
}
function greenGates(over) {
    return (0, index_1.evaluateEvExecutionGates)({
        featureEnabled: true,
        globalLive: true,
        addonLive: true,
        addonEnabled: true,
        governanceEnabled: true,
        authority: "ems",
        authorityFailsafeReason: "",
        buttonsReady: true,
        resolvedVariant: "buttons",
        desiredMode: "now",
        actualMissing: false,
        actualInvalid: false,
        sourceStale: false,
        sourceOffline: false,
        faultActive: false,
        restoreInProgress: false,
        ...over,
    });
}
function tickHost(opts) {
    const foreignWrites = [];
    const states = {
        [tree_paths_1.GLOBAL.executionMode]: { val: opts.global ?? "dryrun", ack: true, ts: NOW },
        [(0, tree_paths_1.addonMode)("wallbox")]: { val: opts.addon ?? "dryrun", ack: true, ts: NOW },
        [(0, tree_paths_1.addonEnabled)("wallbox")]: { val: opts.addonOn !== false, ack: true, ts: NOW },
    };
    const foreign = { ...(opts.foreign ?? { [`${LP}.status.mode`]: { val: "pv", ts: NOW } }) };
    const host = {
        config: BUTTON_CFG,
        async getStateAsync(id) {
            const st = states[id];
            if (!st)
                return null;
            return { val: st.val, ts: st.ts, ack: st.ack };
        },
        async setStateAsync(id, state) {
            const val = typeof state === "object" && state && "val" in state ? state.val : state;
            const ack = typeof state === "object" && state && "ack" in state ? Boolean(state.ack) : true;
            states[id] = { val, ack, ts: NOW };
        },
        async setObjectNotExistsAsync() {
            return;
        },
        async getForeignStateAsync(id) {
            const st = foreign[id];
            if (!st)
                return null;
            return { val: st.val, ts: st.ts ?? NOW, ack: true };
        },
        async setForeignStateAsync(id, state) {
            const val = typeof state === "object" && state && "val" in state ? state.val : state;
            foreignWrites.push({ id, val });
        },
        log: { debug() { }, info() { }, warn() { }, error() { } },
    };
    return {
        host,
        foreignWrites,
        foreign,
        setLocal(id, val, ack = true) {
            states[id] = { val, ack, ts: NOW };
        },
    };
}
(0, node_test_1.afterEach)(() => {
    (0, index_1.resetEvExecutionSession)();
});
(0, node_test_1.describe)("Phase 5A EV execution foundation", () => {
    (0, node_test_1.it)("T3: feature gate defaults false and blocks writes", async () => {
        strict_1.default.equal(write_allowlist_1.EV_EXECUTION_PHASE5_ENABLED, false);
        strict_1.default.equal(write_allowlist_1.EV_FOUNDATION_PHASE1_PLANNER_WRITES_ENABLED, false);
        const writes = [];
        const r = await (0, index_1.executeEvccButtonWrite)({
            async getForeignStateAsync() {
                return { val: false };
            },
            async setForeignStateAsync(id) {
                writes.push(id);
            },
        }, { contract: (0, evcc_mode_control_1.resolveEvccModeControlContract)(BUTTON_CFG), mode: "now", writeAllowed: true });
        strict_1.default.equal(r.written, false);
        strict_1.default.equal(r.blocked, true);
        strict_1.default.equal(r.reason, "feature_gate");
        strict_1.default.equal(writes.length, 0);
    });
    (0, node_test_1.it)("T1: global dryrun → no write", async () => {
        const { host, foreignWrites } = tickHost({ global: "dryrun", addon: "live" });
        const snap = (0, evcc_telemetry_1.emptyEvccTelemetrySnapshot)("2026-08-15T08:00:00.000Z");
        snap.loadpoint_mode = { value: "pv", status: "valid", raw: "pv" };
        await (0, index_1.tickEvExecution)(host, {
            nowMs: NOW,
            snap,
            model: model(),
            planDecision: decision(),
            intent: intent(),
            faultActive: false,
            addonEnabled: true,
            governanceEnabled: true,
        });
        strict_1.default.equal(foreignWrites.length, 0);
        strict_1.default.match(String((await host.getStateAsync(ensure_states_1.WALLBOX_EV_FOUNDATION_STATES.evExecutionExplain))?.val), /write_blocked=global_dryrun|feature_gate/);
    });
    (0, node_test_1.it)("T2: global live + addon dryrun → no write", async () => {
        const { host, foreignWrites } = tickHost({ global: "live", addon: "dryrun" });
        const snap = (0, evcc_telemetry_1.emptyEvccTelemetrySnapshot)("2026-08-15T08:00:00.000Z");
        snap.loadpoint_mode = { value: "pv", status: "valid", raw: "pv" };
        await (0, index_1.tickEvExecution)(host, {
            nowMs: NOW,
            snap,
            model: model(),
            planDecision: decision(),
            intent: intent(),
            faultActive: false,
            addonEnabled: true,
            governanceEnabled: true,
        });
        strict_1.default.equal(foreignWrites.length, 0);
        const g = greenGates({ globalLive: true, addonLive: false, featureEnabled: true });
        strict_1.default.equal(g.writeAllowed, false);
        strict_1.default.equal(g.blockReason, "addon_dryrun");
    });
    (0, node_test_1.it)("T4: external/Tibber authority → no EMS write", () => {
        const g = greenGates({ authority: "external" });
        strict_1.default.equal(g.writeAllowed, false);
        strict_1.default.equal(g.blockReason, "external_authority");
        const s = (0, index_1.stepEvExecution)((0, index_1.emptyEvExecutionSession)(), {
            nowMs: NOW,
            desiredMode: "now",
            actualMode: "pv",
            writeAllowed: false,
            blockReason: "external_authority",
            failsafeReason: "",
            authorityIsEms: false,
        });
        strict_1.default.equal(s.writeMode, null);
    });
    (0, node_test_1.it)("T5: external ends durably → EMS may take over", () => {
        const first = (0, index_1.stabilizeExecutionAuthority)({
            raw: "active",
            externalExpected: true,
            prevAuthority: "none",
            lastExternalHoldAtMs: null,
            lastInactiveSinceMs: null,
            nowMs: NOW,
        });
        strict_1.default.equal(first.authority, "external");
        const later = (0, index_1.stabilizeExecutionAuthority)({
            raw: "inactive",
            externalExpected: true,
            prevAuthority: "external",
            lastExternalHoldAtMs: first.lastExternalHoldAtMs,
            lastInactiveSinceMs: NOW + 1_000,
            nowMs: NOW + index_1.EV_AUTHORITY_HOLD_MS + 60_000,
        });
        strict_1.default.equal(later.authority, "ems");
    });
    (0, node_test_1.it)("T6: short external flicker → no authority ping-pong", () => {
        const a = (0, index_1.stabilizeExecutionAuthority)({
            raw: "active",
            externalExpected: true,
            prevAuthority: "none",
            lastExternalHoldAtMs: null,
            lastInactiveSinceMs: null,
            nowMs: NOW,
        });
        const flicker = (0, index_1.stabilizeExecutionAuthority)({
            raw: "inactive",
            externalExpected: true,
            prevAuthority: "external",
            lastExternalHoldAtMs: a.lastExternalHoldAtMs,
            lastInactiveSinceMs: NOW + 5_000,
            nowMs: NOW + 30_000,
        });
        strict_1.default.equal(flicker.authority, "external");
        const back = (0, index_1.stabilizeExecutionAuthority)({
            raw: "active",
            externalExpected: true,
            prevAuthority: flicker.authority,
            lastExternalHoldAtMs: flicker.lastExternalHoldAtMs,
            lastInactiveSinceMs: flicker.lastInactiveSinceMs,
            nowMs: NOW + 40_000,
        });
        strict_1.default.equal(back.authority, "external");
    });
    (0, node_test_1.it)("T7: EMS + green gates select the correct EVCC button", () => {
        strict_1.default.equal((0, index_1.projectDesiredEvccMode)({
            intentAction: "charge",
            energySource: "grid",
            chargingAllowed: true,
            allocatedPowerW: 11000,
        }).desired, "now");
        const contract = (0, evcc_mode_control_1.resolveEvccModeControlContract)(BUTTON_CFG);
        strict_1.default.equal((0, index_1.buttonStateId)(contract, "now"), `${LP}.control.now`);
        strict_1.default.equal((0, index_1.isAllowedEvccButtonWriteTarget)(`${LP}.control.now`, "now"), true);
        const stepped = (0, index_1.stepEvExecution)((0, index_1.emptyEvExecutionSession)(), {
            nowMs: NOW,
            desiredMode: "now",
            actualMode: "pv",
            writeAllowed: true,
            blockReason: "",
            failsafeReason: "",
            authorityIsEms: true,
        });
        strict_1.default.equal(stepped.writeMode, "now");
    });
    (0, node_test_1.it)("T8: status.mode confirms desired → success / no second write", () => {
        const sent = (0, index_1.stepEvExecution)((0, index_1.emptyEvExecutionSession)(), {
            nowMs: NOW,
            desiredMode: "now",
            actualMode: "pv",
            writeAllowed: true,
            blockReason: "",
            failsafeReason: "",
            authorityIsEms: true,
        });
        strict_1.default.equal(sent.writeMode, "now");
        const confirmed = (0, index_1.stepEvExecution)(sent.session, {
            nowMs: NOW + 20_000,
            desiredMode: "now",
            actualMode: "now",
            writeAllowed: true,
            blockReason: "",
            failsafeReason: "",
            authorityIsEms: true,
        });
        strict_1.default.equal(confirmed.session.phase, "confirmed");
        strict_1.default.equal(confirmed.writeMode, null);
        strict_1.default.equal(confirmed.session.retryCount, 0);
    });
    (0, node_test_1.it)("T9: wrong feedback → bounded retry", () => {
        let s = (0, index_1.emptyEvExecutionSession)();
        const first = (0, index_1.stepEvExecution)(s, {
            nowMs: NOW,
            desiredMode: "pv",
            actualMode: "off",
            writeAllowed: true,
            blockReason: "",
            failsafeReason: "",
            authorityIsEms: true,
        });
        strict_1.default.equal(first.writeMode, "pv");
        const retry = (0, index_1.stepEvExecution)(first.session, {
            nowMs: NOW + index_1.EV_FEEDBACK_TIMEOUT_MS,
            desiredMode: "pv",
            actualMode: "off",
            writeAllowed: true,
            blockReason: "",
            failsafeReason: "",
            authorityIsEms: true,
        });
        strict_1.default.equal(retry.writeMode, "pv");
        strict_1.default.equal(retry.session.retryCount, 1);
        strict_1.default.ok(retry.session.retryCount <= index_1.EV_MAX_RETRIES);
    });
    (0, node_test_1.it)("T10: no feedback → timeout / fail-safe", () => {
        let cur = (0, index_1.stepEvExecution)((0, index_1.emptyEvExecutionSession)(), {
            nowMs: NOW,
            desiredMode: "now",
            actualMode: "pv",
            writeAllowed: true,
            blockReason: "",
            failsafeReason: "",
            authorityIsEms: true,
        });
        for (let i = 0; i <= index_1.EV_MAX_RETRIES; i++) {
            cur = (0, index_1.stepEvExecution)(cur.session, {
                nowMs: NOW + index_1.EV_FEEDBACK_TIMEOUT_MS * (i + 1),
                desiredMode: "now",
                actualMode: "pv",
                writeAllowed: true,
                blockReason: "",
                failsafeReason: "",
                authorityIsEms: true,
            });
        }
        strict_1.default.equal(cur.session.phase, "failsafe");
        strict_1.default.equal(cur.session.failsafeReason, "feedback_timeout");
        strict_1.default.equal(cur.writeMode, null);
    });
    (0, node_test_1.it)("T11: EVCC source stale/offline → no write", () => {
        strict_1.default.equal((0, index_1.isEvccModeFeedbackStale)({ tsMs: NOW - 11 * 60_000, nowMs: NOW }), true);
        const stale = (0, index_1.evaluateEvccSourceFreshness)({
            connectionValue: true,
            connectionKnown: true,
            heartbeatTsMs: NOW - 11 * 60_000,
            heartbeatConfigured: true,
            nowMs: NOW,
        });
        strict_1.default.equal(stale.fresh, false);
        strict_1.default.equal(stale.reason, "evcc_source_stale");
        const g = greenGates({ sourceStale: true });
        strict_1.default.equal(g.writeAllowed, false);
        strict_1.default.equal(g.failsafeReason, "evcc_source_stale");
        const offline = greenGates({ sourceOffline: true });
        strict_1.default.equal(offline.writeAllowed, false);
        strict_1.default.equal(offline.failsafeReason, "evcc_source_offline");
    });
    (0, node_test_1.it)("T12: missing button contract → no write", () => {
        const g = greenGates({ buttonsReady: false, resolvedVariant: "buttons" });
        strict_1.default.equal(g.writeAllowed, false);
        strict_1.default.equal(g.failsafeReason, "button_contract_unavailable");
    });
    (0, node_test_1.it)("T13: already confirmed desired mode → no redundant write", () => {
        const r = (0, index_1.stepEvExecution)((0, index_1.emptyEvExecutionSession)(), {
            nowMs: NOW,
            desiredMode: "pv",
            actualMode: "pv",
            writeAllowed: true,
            blockReason: "",
            failsafeReason: "",
            authorityIsEms: true,
        });
        strict_1.default.equal(r.writeMode, null);
        strict_1.default.equal(r.session.lastResult, "already_confirmed");
    });
    (0, node_test_1.it)("T14: pending PV, desired switches to NOW → old command is not retried", () => {
        const sent = (0, index_1.stepEvExecution)((0, index_1.emptyEvExecutionSession)(), {
            nowMs: NOW,
            desiredMode: "pv",
            actualMode: "off",
            writeAllowed: true,
            blockReason: "",
            failsafeReason: "",
            authorityIsEms: true,
        });
        strict_1.default.equal(sent.session.pendingMode, "pv");
        const switched = (0, index_1.stepEvExecution)(sent.session, {
            nowMs: NOW + 5_000,
            desiredMode: "now",
            actualMode: "off",
            writeAllowed: true,
            blockReason: "",
            failsafeReason: "",
            authorityIsEms: true,
        });
        strict_1.default.equal(switched.writeMode, "now");
        strict_1.default.equal(switched.session.pendingMode, "now");
        strict_1.default.notEqual(switched.session.lastResult, "retry");
    });
    (0, node_test_1.it)("T15: pending EMS command, external becomes active → abort", () => {
        const sent = (0, index_1.stepEvExecution)((0, index_1.emptyEvExecutionSession)(), {
            nowMs: NOW,
            desiredMode: "now",
            actualMode: "pv",
            writeAllowed: true,
            blockReason: "",
            failsafeReason: "",
            authorityIsEms: true,
        });
        const aborted = (0, index_1.stepEvExecution)(sent.session, {
            nowMs: NOW + 5_000,
            desiredMode: "now",
            actualMode: "pv",
            writeAllowed: false,
            blockReason: "external_authority",
            failsafeReason: "",
            authorityIsEms: false,
        });
        strict_1.default.equal(aborted.writeMode, null);
        strict_1.default.equal(aborted.session.pendingMode, null);
        strict_1.default.equal(aborted.session.lastResult, "blocked");
    });
    (0, node_test_1.it)("T16: governance flips to dryrun during pending → no further writes", () => {
        const sent = (0, index_1.stepEvExecution)((0, index_1.emptyEvExecutionSession)(), {
            nowMs: NOW,
            desiredMode: "now",
            actualMode: "pv",
            writeAllowed: true,
            blockReason: "",
            failsafeReason: "",
            authorityIsEms: true,
        });
        const dry = (0, index_1.stepEvExecution)(sent.session, {
            nowMs: NOW + index_1.EV_FEEDBACK_TIMEOUT_MS,
            desiredMode: "now",
            actualMode: "pv",
            writeAllowed: false,
            blockReason: "global_dryrun",
            failsafeReason: "",
            authorityIsEms: true,
        });
        strict_1.default.equal(dry.writeMode, null);
        strict_1.default.equal(dry.session.pendingMode, null);
    });
    (0, node_test_1.it)("T17: addon live disabled during pending → no further writes", () => {
        const sent = (0, index_1.stepEvExecution)((0, index_1.emptyEvExecutionSession)(), {
            nowMs: NOW,
            desiredMode: "pv",
            actualMode: "off",
            writeAllowed: true,
            blockReason: "",
            failsafeReason: "",
            authorityIsEms: true,
        });
        const off = (0, index_1.stepEvExecution)(sent.session, {
            nowMs: NOW + index_1.EV_FEEDBACK_TIMEOUT_MS,
            desiredMode: "pv",
            actualMode: "off",
            writeAllowed: false,
            blockReason: "addon_dryrun",
            failsafeReason: "",
            authorityIsEms: true,
        });
        strict_1.default.equal(off.writeMode, null);
    });
    (0, node_test_1.it)("T18: unknown/inconsistent authority → fail-safe / no write", () => {
        const auth = (0, index_1.stabilizeExecutionAuthority)({
            raw: "unknown",
            externalExpected: true,
            prevAuthority: "none",
            lastExternalHoldAtMs: null,
            lastInactiveSinceMs: null,
            nowMs: NOW,
        });
        strict_1.default.equal(auth.authority, "none");
        strict_1.default.equal(auth.failsafeReason, "authority_unknown");
        const g = greenGates({ authority: "none", authorityFailsafeReason: "authority_unknown" });
        strict_1.default.equal(g.writeAllowed, false);
        strict_1.default.equal(g.failsafeReason, "authority_unknown");
    });
    (0, node_test_1.it)("T19: legacy pvControl is not used as a modern button write", async () => {
        strict_1.default.equal((0, index_1.isAllowedEvccButtonWriteTarget)(`${LP}.control.pvControl`, "pv"), false);
        const pvControlCfg = {
            ...BUTTON_CFG,
            wb_evcc_mode_control: "pv_control",
            wb_evcc_control_pv_control_target: `${LP}.control.pvControl`,
        };
        const writes = [];
        const r = await (0, index_1.executeEvccButtonWrite)({
            async getForeignStateAsync() {
                return { val: 1 };
            },
            async setForeignStateAsync(id) {
                writes.push(id);
            },
        }, { contract: (0, evcc_mode_control_1.resolveEvccModeControlContract)(pvControlCfg), mode: "pv", writeAllowed: true });
        strict_1.default.equal(r.written, false);
        strict_1.default.ok(r.reason === "feature_gate" || r.reason === "legacy_variant_blocked");
        strict_1.default.equal(writes.length, 0);
    });
    (0, node_test_1.it)("T20: EV execution adds no direct go-e / Ford / Tibber / Sonnen writes", () => {
        const writeSrc = (0, node_fs_1.readFileSync)((0, node_path_1.join)(SRC, "ev_foundation", "execution", "write.ts"), "utf8");
        const tickSrc = (0, node_fs_1.readFileSync)((0, node_path_1.join)(SRC, "ev_foundation", "execution", "tick.ts"), "utf8");
        for (const src of [writeSrc, tickSrc]) {
            strict_1.default.equal(/setForeignStateAsync\(\s*["'`]go-e\./.test(src), false);
            strict_1.default.equal(/setForeignStateAsync\(\s*["'`]ford/.test(src), false);
            strict_1.default.equal(/writeForeignIfChanged\([\s\S]*["'`]sonnen\./.test(src), false);
            strict_1.default.equal(/writeForeignIfChanged\([\s\S]*["'`]tibber\./i.test(src), false);
        }
        strict_1.default.equal((0, index_1.isAllowedEvccButtonWriteTarget)("go-e.0.allow_charging", "now"), false);
        strict_1.default.equal((0, index_1.isAllowedEvccButtonWriteTarget)("sonnen.0.control.batteryMode", "now"), false);
        strict_1.default.equal((0, index_1.isAllowedEvccButtonWriteTarget)("tibber.0.charge", "now"), false);
        strict_1.default.equal((0, index_1.isAllowedEvccButtonWriteTarget)("fordpass.0.startCharge", "now"), false);
        strict_1.default.equal(write_allowlist_1.EV_EXECUTION_PHASE5_ENABLED, false);
    });
    (0, node_test_1.it)("desired mode is a mechanical Unified translation", () => {
        strict_1.default.equal((0, index_1.projectDesiredEvccMode)({
            intentAction: "hold",
            energySource: "grid",
            chargingAllowed: false,
            allocatedPowerW: 0,
        }).desired, "off");
        strict_1.default.equal((0, index_1.projectDesiredEvccMode)({
            intentAction: "charge",
            energySource: "pv_surplus",
            chargingAllowed: true,
            allocatedPowerW: 4000,
        }).desired, "pv");
        strict_1.default.equal((0, index_1.projectDesiredEvccMode)({
            intentAction: "charge",
            energySource: "mixed",
            chargingAllowed: true,
            allocatedPowerW: 3000,
        }).desired, "min");
    });
    (0, node_test_1.it)("explain matches the Phase 5A contract", () => {
        strict_1.default.equal((0, index_1.formatEvExecutionExplain)({
            desired: "now",
            actual: "pv",
            authority: "external",
            phase: "idle",
            blockReason: "external_authority",
            failsafeReason: "",
            writeAllowed: false,
        }), "desired=now, authority=external, write_blocked=external_authority");
        strict_1.default.equal((0, index_1.formatEvExecutionExplain)({
            desired: "pv",
            actual: "pv",
            authority: "ems",
            phase: "idle",
            blockReason: "global_dryrun",
            failsafeReason: "",
            writeAllowed: false,
        }), "desired=pv, authority=ems, write_blocked=global_dryrun");
        strict_1.default.equal((0, index_1.formatEvExecutionExplain)({
            desired: "now",
            actual: "pv",
            authority: "ems",
            phase: "awaiting_feedback",
            blockReason: "",
            failsafeReason: "",
            writeAllowed: true,
        }), "desired=now, authority=ems, awaiting_feedback");
        strict_1.default.equal((0, index_1.formatEvExecutionExplain)({
            desired: "now",
            actual: "now",
            authority: "ems",
            phase: "confirmed",
            blockReason: "",
            failsafeReason: "",
            writeAllowed: true,
        }), "desired=now, actual=now, confirmed");
        strict_1.default.equal((0, index_1.formatEvExecutionExplain)({
            desired: "pv",
            actual: null,
            authority: "ems",
            phase: "failsafe",
            blockReason: "evcc_source_stale",
            failsafeReason: "evcc_source_stale",
            writeAllowed: false,
        }), "desired=pv, write_blocked=evcc_source_stale");
    });
    (0, node_test_1.it)("tick publishes diagnosis and never writes while the Phase 5A gate is closed", async () => {
        const { host, foreignWrites } = tickHost({ global: "live", addon: "live" });
        const snap = (0, evcc_telemetry_1.emptyEvccTelemetrySnapshot)("2026-08-15T08:00:00.000Z");
        snap.loadpoint_mode = { value: "pv", status: "valid", raw: "pv" };
        const s = await (0, index_1.tickEvExecution)(host, {
            nowMs: NOW,
            snap,
            model: model(),
            planDecision: decision(),
            intent: intent(),
            faultActive: false,
            addonEnabled: true,
            governanceEnabled: true,
        });
        strict_1.default.equal(foreignWrites.length, 0);
        strict_1.default.equal(s.authority, "ems");
        strict_1.default.equal((await host.getStateAsync(ensure_states_1.WALLBOX_EV_FOUNDATION_STATES.evExecutionEnabled))?.val, false);
        strict_1.default.equal((await host.getStateAsync(ensure_states_1.WALLBOX_EV_FOUNDATION_STATES.evExecutionDesiredMode))?.val, "now");
        strict_1.default.ok(String((await host.getStateAsync(ensure_states_1.WALLBOX_EV_FOUNDATION_STATES.evExecutionExplain))?.val).includes("desired=now"));
    });
});
(0, node_test_1.describe)("Phase 5B preflight: noop vs OFF and source freshness", () => {
    (0, node_test_1.it)("P1: hold with explicit 0 W stop → OFF", () => {
        const p = (0, index_1.projectDesiredEvccMode)({
            intentAction: "hold",
            energySource: "grid",
            chargingAllowed: false,
            allocatedPowerW: 0,
            dailyPlanStatus: "daily_plan_zero_allocation",
            useDailyPlan: true,
            planValid: true,
        });
        strict_1.default.equal(p.desired, "off");
        strict_1.default.equal(p.reason, "explicit_stop");
    });
    (0, node_test_1.it)("P2: hold with no consumer slot → No-Op", () => {
        const p = (0, index_1.projectDesiredEvccMode)({
            intentAction: "hold",
            energySource: "none",
            chargingAllowed: false,
            allocatedPowerW: null,
            dailyPlanStatus: "daily_plan_zero_allocation",
            useDailyPlan: true,
            planValid: true,
        });
        strict_1.default.equal(p.desired, "noop");
        strict_1.default.equal(p.reason, "no_planned_wallbox_action");
    });
    (0, node_test_1.it)("P3: none = no EMS action → No-Op / no write", () => {
        const p = (0, index_1.projectDesiredEvccMode)({
            intentAction: "none",
            energySource: "none",
            chargingAllowed: false,
            allocatedPowerW: null,
        });
        strict_1.default.equal(p.desired, "noop");
        strict_1.default.equal(p.reason, "no_wallbox_action");
        const stepped = (0, index_1.stepEvExecution)((0, index_1.emptyEvExecutionSession)(), {
            nowMs: NOW,
            desiredMode: "noop",
            actualMode: "pv",
            writeAllowed: true,
            blockReason: "",
            failsafeReason: "",
            authorityIsEms: true,
            desiredReason: "no_wallbox_action",
        });
        strict_1.default.equal(stepped.writeMode, null);
        strict_1.default.equal(stepped.session.pendingMode, null);
        strict_1.default.equal(stepped.session.lastResult, "noop");
    });
    (0, node_test_1.it)("P3b: disconnected vehicle → No-Op even with leftover charge intent / now", () => {
        const p = (0, index_1.projectDesiredEvccMode)({
            intentAction: "charge",
            energySource: "grid",
            chargingAllowed: true,
            allocatedPowerW: 11000,
            vehicleConnected: false,
            decisionSource: "vehicle_disconnected",
        });
        strict_1.default.equal(p.desired, "noop");
        strict_1.default.equal(p.reason, "vehicle_disconnected");
    });
    (0, node_test_1.it)("P4: no allocation → no automatic OFF", () => {
        const p = (0, index_1.projectDesiredEvccMode)({
            intentAction: "hold",
            energySource: "none",
            chargingAllowed: false,
            allocatedPowerW: null,
        });
        strict_1.default.notEqual(p.desired, "off");
        strict_1.default.equal(p.desired, "noop");
    });
    (0, node_test_1.it)("P5: explicit charge-stop (charge denied / 0 W) → OFF", () => {
        const p = (0, index_1.projectDesiredEvccMode)({
            intentAction: "charge",
            energySource: "grid",
            chargingAllowed: false,
            allocatedPowerW: 0,
        });
        strict_1.default.equal(p.desired, "off");
        strict_1.default.equal(p.reason, "explicit_stop");
    });
    (0, node_test_1.it)("P6: No-Op creates no pending", () => {
        const stepped = (0, index_1.stepEvExecution)((0, index_1.emptyEvExecutionSession)(), {
            nowMs: NOW,
            desiredMode: "noop",
            actualMode: "now",
            writeAllowed: true,
            blockReason: "",
            failsafeReason: "",
            authorityIsEms: true,
            desiredReason: "no_planned_wallbox_action",
        });
        strict_1.default.equal(stepped.session.pendingMode, null);
        strict_1.default.equal(stepped.session.pendingSinceMs, null);
        strict_1.default.equal(stepped.session.phase, "idle");
    });
    (0, node_test_1.it)("P7: No-Op creates no retry", () => {
        const sent = (0, index_1.stepEvExecution)((0, index_1.emptyEvExecutionSession)(), {
            nowMs: NOW,
            desiredMode: "pv",
            actualMode: "off",
            writeAllowed: true,
            blockReason: "",
            failsafeReason: "",
            authorityIsEms: true,
        });
        strict_1.default.equal(sent.session.pendingMode, "pv");
        const noop = (0, index_1.stepEvExecution)(sent.session, {
            nowMs: NOW + index_1.EV_FEEDBACK_TIMEOUT_MS,
            desiredMode: "noop",
            actualMode: "off",
            writeAllowed: true,
            blockReason: "",
            failsafeReason: "",
            authorityIsEms: true,
            desiredReason: "no_wallbox_action",
        });
        strict_1.default.equal(noop.writeMode, null);
        strict_1.default.equal(noop.session.pendingMode, null);
        strict_1.default.notEqual(noop.session.lastResult, "retry");
        strict_1.default.equal(noop.session.retryCount, 0);
    });
    (0, node_test_1.it)("P8: No-Op is not fail-safe", () => {
        const stepped = (0, index_1.stepEvExecution)((0, index_1.emptyEvExecutionSession)(), {
            nowMs: NOW,
            desiredMode: "noop",
            actualMode: null,
            writeAllowed: false,
            blockReason: "evcc_source_stale",
            failsafeReason: "evcc_source_stale",
            authorityIsEms: true,
            desiredReason: "no_wallbox_action",
        });
        strict_1.default.equal(stepped.session.phase, "idle");
        strict_1.default.equal(stepped.session.failsafeReason, "");
        strict_1.default.equal(stepped.session.lastResult, "noop");
        const g = greenGates({ desiredMode: "noop", sourceStale: true, actualMissing: true });
        strict_1.default.equal(g.failsafeReason, "");
        strict_1.default.equal(g.writeAllowed, false);
        strict_1.default.equal((0, index_1.formatEvExecutionExplain)({
            desired: "noop",
            actual: "pv",
            authority: "ems",
            phase: "idle",
            blockReason: "",
            failsafeReason: "",
            writeAllowed: false,
            desiredReason: "no_planned_wallbox_action",
        }), "desired=noop, reason=no_planned_wallbox_action");
    });
    (0, node_test_1.it)("P9: status.mode=off, ts older than 10 min, EVCC source fresh → valid", () => {
        const source = (0, index_1.evaluateEvccSourceFreshness)({
            connectionValue: true,
            connectionKnown: true,
            heartbeatTsMs: NOW - 30_000,
            heartbeatConfigured: true,
            nowMs: NOW,
        });
        strict_1.default.equal(source.fresh, true);
        const g = greenGates({
            desiredMode: "off",
            sourceStale: !source.fresh,
            sourceOffline: false,
            actualMissing: false,
            actualInvalid: false,
        });
        strict_1.default.equal(g.failsafeReason, "");
        strict_1.default.equal((0, index_1.formatEvExecutionExplain)({
            desired: "off",
            actual: "off",
            authority: "ems",
            phase: "confirmed",
            blockReason: "",
            failsafeReason: "",
            writeAllowed: true,
            sourceFresh: true,
        }), "desired=off, actual=off, source_fresh=true");
    });
    (0, node_test_1.it)("P10: status.mode=pv, ts older than 10 min, EVCC source fresh → valid", () => {
        const source = (0, index_1.evaluateEvccSourceFreshness)({
            connectionValue: true,
            connectionKnown: true,
            heartbeatTsMs: NOW,
            heartbeatConfigured: true,
            nowMs: NOW,
        });
        strict_1.default.equal(source.fresh, true);
        strict_1.default.equal((0, index_1.evaluateEvccSourceFreshness)({
            connectionValue: null,
            connectionKnown: false,
            heartbeatTsMs: null,
            heartbeatConfigured: false,
            nowMs: NOW,
        }).fresh, true, "missing heartbeat must not invent stale from status.mode.ts");
        const g = greenGates({ desiredMode: "pv", sourceStale: false });
        strict_1.default.equal(g.failsafeReason, "");
    });
    (0, node_test_1.it)("P11: EVCC source stale/offline blocks execution", () => {
        strict_1.default.equal((0, index_1.evaluateEvccSourceFreshness)({
            connectionValue: false,
            connectionKnown: true,
            heartbeatTsMs: NOW,
            heartbeatConfigured: true,
            nowMs: NOW,
        }).reason, "evcc_source_offline");
        const g = greenGates({ sourceOffline: true, desiredMode: "now" });
        strict_1.default.equal(g.writeAllowed, false);
        strict_1.default.equal(g.failsafeReason, "evcc_source_offline");
    });
    (0, node_test_1.it)("P12: new command, fresh feedback confirms success", () => {
        const sent = (0, index_1.stepEvExecution)((0, index_1.emptyEvExecutionSession)(), {
            nowMs: NOW,
            desiredMode: "now",
            actualMode: "pv",
            writeAllowed: true,
            blockReason: "",
            failsafeReason: "",
            authorityIsEms: true,
            modeTsMs: NOW - 30 * 60_000,
        });
        strict_1.default.equal(sent.writeMode, "now");
        const confirmed = (0, index_1.stepEvExecution)(sent.session, {
            nowMs: NOW + 20_000,
            desiredMode: "now",
            actualMode: "now",
            writeAllowed: true,
            blockReason: "",
            failsafeReason: "",
            authorityIsEms: true,
            modeTsMs: NOW + 18_000,
        });
        strict_1.default.equal(confirmed.session.phase, "confirmed");
        strict_1.default.equal(confirmed.writeMode, null);
        strict_1.default.equal(confirmed.session.lastResult, "confirmed");
    });
    (0, node_test_1.it)("P13: new command, old identical state without new ts → no fake success", () => {
        const sent = (0, index_1.stepEvExecution)((0, index_1.emptyEvExecutionSession)(), {
            nowMs: NOW,
            desiredMode: "now",
            actualMode: "pv",
            writeAllowed: true,
            blockReason: "",
            failsafeReason: "",
            authorityIsEms: true,
        });
        strict_1.default.equal((0, index_1.isCommandFeedbackConfirmed)({
            actualMode: "now",
            pendingMode: "now",
            lastCommandAtMs: sent.session.lastCommandAtMs,
            modeTsMs: NOW - 30 * 60_000,
        }), false);
        const fake = (0, index_1.stepEvExecution)(sent.session, {
            nowMs: NOW + 20_000,
            desiredMode: "now",
            actualMode: "now",
            writeAllowed: true,
            blockReason: "",
            failsafeReason: "",
            authorityIsEms: true,
            modeTsMs: NOW - 30 * 60_000,
        });
        strict_1.default.notEqual(fake.session.phase, "confirmed");
        strict_1.default.equal(fake.session.lastResult, "awaiting_feedback");
        strict_1.default.equal(fake.writeMode, null);
    });
    (0, node_test_1.it)("P14: already matching desired before command → no redundant write", () => {
        const r = (0, index_1.stepEvExecution)((0, index_1.emptyEvExecutionSession)(), {
            nowMs: NOW,
            desiredMode: "pv",
            actualMode: "pv",
            writeAllowed: true,
            blockReason: "",
            failsafeReason: "",
            authorityIsEms: true,
            modeTsMs: NOW - 40 * 60_000,
        });
        strict_1.default.equal(r.writeMode, null);
        strict_1.default.equal(r.session.lastResult, "already_confirmed");
    });
    (0, node_test_1.it)("P15: hold below min power is an explicit stop, power_limits_unknown is No-Op", () => {
        strict_1.default.equal((0, index_1.projectDesiredEvccMode)({
            intentAction: "hold",
            energySource: "grid",
            chargingAllowed: false,
            allocatedPowerW: 800,
            dailyPlanStatus: "allocation_below_min_power",
        }).desired, "off");
        strict_1.default.equal((0, index_1.projectDesiredEvccMode)({
            intentAction: "hold",
            energySource: "grid",
            chargingAllowed: false,
            allocatedPowerW: 4000,
            dailyPlanStatus: "power_limits_unknown",
        }).desired, "noop");
    });
    (0, node_test_1.it)("tick: none intent publishes noop diagnosis and never writes", async () => {
        const { host, foreignWrites } = tickHost({ global: "live", addon: "live" });
        const snap = (0, evcc_telemetry_1.emptyEvccTelemetrySnapshot)("2026-08-15T08:00:00.000Z");
        snap.loadpoint_mode = { value: "pv", status: "valid", raw: "pv" };
        snap.connection = { value: true, status: "valid", raw: true };
        const s = await (0, index_1.tickEvExecution)(host, {
            nowMs: NOW,
            snap,
            model: model(),
            planDecision: decision({
                chargingAllowedByPlan: false,
                allocatedPowerW: null,
                planValid: false,
                useDailyPlan: false,
                decisionSource: "no_plan",
            }),
            intent: intent({ action: "none", enabled: false, targetPowerW: 0, source: "none" }),
            faultActive: false,
            addonEnabled: true,
            governanceEnabled: true,
        });
        strict_1.default.equal(foreignWrites.length, 0);
        strict_1.default.equal(s.lastResult, "noop");
        strict_1.default.equal(s.failsafeReason, "");
        strict_1.default.equal(s.pendingMode, null);
        strict_1.default.equal((await host.getStateAsync(ensure_states_1.WALLBOX_EV_FOUNDATION_STATES.evExecutionDesiredMode))?.val, "noop");
        strict_1.default.equal((await host.getStateAsync(ensure_states_1.WALLBOX_EV_FOUNDATION_STATES.evExecutionDesiredReason))?.val, "no_wallbox_action");
        strict_1.default.match(String((await host.getStateAsync(ensure_states_1.WALLBOX_EV_FOUNDATION_STATES.evExecutionExplain))?.val), /desired=noop/);
    });
    (0, node_test_1.it)("tick: old status.mode ts stays valid when connection is up", async () => {
        const { host, foreignWrites } = tickHost({
            global: "live",
            addon: "live",
            foreign: { [`${LP}.status.mode`]: { val: "off", ts: NOW - 40 * 60_000 } },
        });
        const snap = (0, evcc_telemetry_1.emptyEvccTelemetrySnapshot)("2026-08-15T08:00:00.000Z");
        snap.loadpoint_mode = { value: "off", status: "valid", raw: "off" };
        snap.connection = { value: true, status: "valid", raw: true };
        const s = await (0, index_1.tickEvExecution)(host, {
            nowMs: NOW,
            snap,
            model: model(),
            planDecision: decision({
                chargingAllowedByPlan: false,
                allocatedPowerW: 0,
                dailyPlanStatus: "daily_plan_zero_allocation",
                decisionSource: "daily_plan_zero",
            }),
            intent: intent({ action: "hold", enabled: false, targetPowerW: 0, source: "none" }),
            faultActive: false,
            addonEnabled: true,
            governanceEnabled: true,
        });
        strict_1.default.equal(foreignWrites.length, 0);
        strict_1.default.equal(s.sourceFresh, true);
        strict_1.default.notEqual(s.failsafeReason, "status_mode_stale");
        strict_1.default.notEqual(s.failsafeReason, "evcc_source_stale");
        strict_1.default.equal((await host.getStateAsync(ensure_states_1.WALLBOX_EV_FOUNDATION_STATES.evExecutionDesiredMode))?.val, "off");
        strict_1.default.equal((await host.getStateAsync(ensure_states_1.WALLBOX_EV_FOUNDATION_STATES.evExecutionSourceFresh))?.val, true);
    });
});
function owningSession(mode) {
    return {
        ...(0, index_1.emptyEvExecutionSession)(),
        phase: "confirmed",
        authority: "ems",
        ownership: "ems",
        ownedMode: mode,
        ownedSinceMs: NOW,
        lastConfirmedMode: mode,
        lastResult: "confirmed",
    };
}
function noSlotProjection() {
    return (0, index_1.projectDesiredEvccMode)({
        intentAction: "hold",
        energySource: "none",
        chargingAllowed: false,
        allocatedPowerW: null,
        dailyPlanStatus: "daily_plan_zero_allocation",
        useDailyPlan: true,
        planValid: true,
    });
}
(0, node_test_1.describe)("Phase 5B ownership & release", () => {
    (0, node_test_1.it)("O1: pre-existing PV not owned by EMS → noop does not write OFF", () => {
        const projection = noSlotProjection();
        strict_1.default.equal(projection.desired, "noop");
        const resolved = (0, index_1.resolveDesiredWithOwnership)({
            projection,
            ownership: "unknown",
            ownedMode: null,
            planValid: true,
            useDailyPlan: true,
            authority: "ems",
        });
        strict_1.default.equal(resolved.desired, "noop");
        strict_1.default.equal(resolved.action, "noop");
        const stepped = (0, index_1.stepEvExecution)((0, index_1.emptyEvExecutionSession)(), {
            nowMs: NOW,
            desiredMode: resolved.desired,
            actualMode: "pv",
            writeAllowed: true,
            blockReason: "",
            failsafeReason: "",
            authorityIsEms: true,
            desiredReason: resolved.reason,
        });
        strict_1.default.equal(stepped.writeMode, null);
        strict_1.default.equal(stepped.session.ownership, "unknown");
    });
    (0, node_test_1.it)("O2: EMS write PV + confirmed feedback → ownership granted", () => {
        const sent = (0, index_1.stepEvExecution)((0, index_1.emptyEvExecutionSession)(), {
            nowMs: NOW,
            desiredMode: "pv",
            actualMode: "off",
            writeAllowed: true,
            blockReason: "",
            failsafeReason: "",
            authorityIsEms: true,
        });
        strict_1.default.equal(sent.writeMode, "pv");
        strict_1.default.notEqual(sent.session.ownership, "ems");
        const confirmed = (0, index_1.stepEvExecution)(sent.session, {
            nowMs: NOW + 20_000,
            desiredMode: "pv",
            actualMode: "pv",
            writeAllowed: true,
            blockReason: "",
            failsafeReason: "",
            authorityIsEms: true,
            modeTsMs: NOW + 18_000,
        });
        strict_1.default.equal(confirmed.session.ownership, "ems");
        strict_1.default.equal(confirmed.session.ownedMode, "pv");
        strict_1.default.ok(confirmed.session.ownedSinceMs);
    });
    (0, node_test_1.it)("O3: EMS owns PV + valid plan ends wallbox slot → release OFF", () => {
        const resolved = (0, index_1.resolveDesiredWithOwnership)({
            projection: noSlotProjection(),
            ownership: "ems",
            ownedMode: "pv",
            planValid: true,
            useDailyPlan: true,
            authority: "ems",
        });
        strict_1.default.equal(resolved.desired, "off");
        strict_1.default.equal(resolved.action, "release_off");
        strict_1.default.equal((0, index_1.shouldReleaseOwnedCharge)({
            projectedDesired: "noop",
            projectedReason: "no_planned_wallbox_action",
            ownership: "ems",
            ownedMode: "pv",
            planValid: true,
            useDailyPlan: true,
            authority: "ems",
        }), true);
        const stepped = (0, index_1.stepEvExecution)(owningSession("pv"), {
            nowMs: NOW,
            desiredMode: "off",
            actualMode: "pv",
            writeAllowed: true,
            blockReason: "",
            failsafeReason: "",
            authorityIsEms: true,
            desiredReason: "release_off",
        });
        strict_1.default.equal(stepped.writeMode, "off");
    });
    (0, node_test_1.it)("O4: release OFF confirmed → ownership ended", () => {
        const sent = (0, index_1.stepEvExecution)(owningSession("pv"), {
            nowMs: NOW,
            desiredMode: "off",
            actualMode: "pv",
            writeAllowed: true,
            blockReason: "",
            failsafeReason: "",
            authorityIsEms: true,
            desiredReason: "release_off",
        });
        const confirmed = (0, index_1.stepEvExecution)({ ...sent.session, releaseReason: "release_off" }, {
            nowMs: NOW + 20_000,
            desiredMode: "off",
            actualMode: "off",
            writeAllowed: true,
            blockReason: "",
            failsafeReason: "",
            authorityIsEms: true,
            modeTsMs: NOW + 18_000,
        });
        strict_1.default.equal(confirmed.session.phase, "confirmed");
        strict_1.default.equal(confirmed.session.ownership, "none");
        strict_1.default.equal(confirmed.session.ownedMode, null);
    });
    (0, node_test_1.it)("O5: EMS owns NOW + valid plan end → release OFF", () => {
        const resolved = (0, index_1.resolveDesiredWithOwnership)({
            projection: noSlotProjection(),
            ownership: "ems",
            ownedMode: "now",
            planValid: true,
            useDailyPlan: true,
            authority: "ems",
        });
        strict_1.default.equal(resolved.action, "release_off");
        strict_1.default.equal(resolved.desired, "off");
    });
    (0, node_test_1.it)("O6: EMS owns PV + planner uncertain → no release OFF", () => {
        const projection = (0, index_1.projectDesiredEvccMode)({
            intentAction: "hold",
            energySource: "grid",
            chargingAllowed: false,
            allocatedPowerW: 4000,
            dailyPlanStatus: "power_limits_unknown",
            planValid: true,
            useDailyPlan: true,
        });
        const resolved = (0, index_1.resolveDesiredWithOwnership)({
            projection,
            ownership: "ems",
            ownedMode: "pv",
            planValid: true,
            useDailyPlan: true,
            authority: "ems",
        });
        strict_1.default.equal(resolved.desired, "noop");
        strict_1.default.equal(resolved.action, "noop");
    });
    (0, node_test_1.it)("O7: EMS owns PV + plan missing/invalid → no release OFF", () => {
        const projection = (0, index_1.projectDesiredEvccMode)({
            intentAction: "none",
            energySource: "none",
            chargingAllowed: false,
            allocatedPowerW: null,
            decisionSource: "invalid_plan",
            planValid: false,
            useDailyPlan: false,
        });
        const resolved = (0, index_1.resolveDesiredWithOwnership)({
            projection,
            ownership: "ems",
            ownedMode: "pv",
            planValid: false,
            useDailyPlan: false,
            authority: "ems",
        });
        strict_1.default.equal(resolved.desired, "noop");
        strict_1.default.equal(resolved.action, "noop");
    });
    (0, node_test_1.it)("O8: EMS owns PV + external becomes active → no OFF, ownership released", () => {
        const dropped = (0, index_1.dropExecutionOwnership)(owningSession("pv"), {
            authority: "external",
            actualMode: "pv",
        });
        strict_1.default.equal(dropped.ownership, "none");
        strict_1.default.equal(dropped.releaseReason, "external_authority");
        const resolved = (0, index_1.resolveDesiredWithOwnership)({
            projection: noSlotProjection(),
            ownership: dropped.ownership,
            ownedMode: dropped.ownedMode,
            planValid: true,
            useDailyPlan: true,
            authority: "external",
        });
        strict_1.default.equal(resolved.action, "noop");
        const stepped = (0, index_1.stepEvExecution)(dropped, {
            nowMs: NOW,
            desiredMode: "noop",
            actualMode: "pv",
            writeAllowed: false,
            blockReason: "external_authority",
            failsafeReason: "",
            authorityIsEms: false,
        });
        strict_1.default.equal(stepped.writeMode, null);
    });
    (0, node_test_1.it)("O9: EMS owns PV + authority unknown → no OFF", () => {
        const dropped = (0, index_1.dropExecutionOwnership)(owningSession("pv"), {
            authority: "none",
            actualMode: "pv",
        });
        strict_1.default.equal(dropped.ownership, "none");
        strict_1.default.equal(dropped.releaseReason, "authority_unknown");
        strict_1.default.equal((0, index_1.resolveDesiredWithOwnership)({
            projection: noSlotProjection(),
            ownership: dropped.ownership,
            ownedMode: null,
            planValid: true,
            useDailyPlan: true,
            authority: "none",
        }).action, "noop");
    });
    (0, node_test_1.it)("O10: EMS owns PV + global dryrun → no release write", () => {
        const resolved = (0, index_1.resolveDesiredWithOwnership)({
            projection: noSlotProjection(),
            ownership: "ems",
            ownedMode: "pv",
            planValid: true,
            useDailyPlan: true,
            authority: "ems",
        });
        strict_1.default.equal(resolved.desired, "off");
        const g = greenGates({ desiredMode: "off", globalLive: false });
        strict_1.default.equal(g.writeAllowed, false);
        strict_1.default.equal(g.blockReason, "global_dryrun");
        const stepped = (0, index_1.stepEvExecution)(owningSession("pv"), {
            nowMs: NOW,
            desiredMode: "off",
            actualMode: "pv",
            writeAllowed: false,
            blockReason: "global_dryrun",
            failsafeReason: "",
            authorityIsEms: true,
        });
        strict_1.default.equal(stepped.writeMode, null);
        strict_1.default.equal(stepped.session.ownership, "ems");
    });
    (0, node_test_1.it)("O11: EMS owns PV + addon live off → no release write", () => {
        const g = greenGates({ desiredMode: "off", addonLive: false });
        strict_1.default.equal(g.writeAllowed, false);
        strict_1.default.equal(g.blockReason, "addon_dryrun");
        const stepped = (0, index_1.stepEvExecution)(owningSession("pv"), {
            nowMs: NOW,
            desiredMode: "off",
            actualMode: "pv",
            writeAllowed: false,
            blockReason: "addon_dryrun",
            failsafeReason: "",
            authorityIsEms: true,
        });
        strict_1.default.equal(stepped.writeMode, null);
        strict_1.default.equal(stepped.session.ownership, "ems");
    });
    (0, node_test_1.it)("O12: EMS owns PV + EVCC source stale → no release write", () => {
        const g = greenGates({ desiredMode: "off", sourceStale: true });
        strict_1.default.equal(g.writeAllowed, false);
        strict_1.default.equal(g.failsafeReason, "evcc_source_stale");
        const stepped = (0, index_1.stepEvExecution)(owningSession("pv"), {
            nowMs: NOW,
            desiredMode: "off",
            actualMode: "pv",
            writeAllowed: false,
            blockReason: "evcc_source_stale",
            failsafeReason: "evcc_source_stale",
            authorityIsEms: true,
        });
        strict_1.default.equal(stepped.writeMode, null);
    });
    (0, node_test_1.it)("O13: EMS owns PV + Unified switches to NOW → normal mode change, not release", () => {
        const projection = (0, index_1.projectDesiredEvccMode)({
            intentAction: "charge",
            energySource: "grid",
            chargingAllowed: true,
            allocatedPowerW: 11000,
        });
        const resolved = (0, index_1.resolveDesiredWithOwnership)({
            projection,
            ownership: "ems",
            ownedMode: "pv",
            planValid: true,
            useDailyPlan: true,
            authority: "ems",
        });
        strict_1.default.equal(resolved.desired, "now");
        strict_1.default.equal(resolved.action, "execute");
        const stepped = (0, index_1.stepEvExecution)(owningSession("pv"), {
            nowMs: NOW,
            desiredMode: "now",
            actualMode: "pv",
            writeAllowed: true,
            blockReason: "",
            failsafeReason: "",
            authorityIsEms: true,
        });
        strict_1.default.equal(stepped.writeMode, "now");
        strict_1.default.notEqual(stepped.session.lastResult, "noop");
    });
    (0, node_test_1.it)("O14: EMS owns NOW + Unified switches to PV → normal mode change", () => {
        const projection = (0, index_1.projectDesiredEvccMode)({
            intentAction: "charge",
            energySource: "pv_surplus",
            chargingAllowed: true,
            allocatedPowerW: 4000,
        });
        const resolved = (0, index_1.resolveDesiredWithOwnership)({
            projection,
            ownership: "ems",
            ownedMode: "now",
            planValid: true,
            useDailyPlan: true,
            authority: "ems",
        });
        strict_1.default.equal(resolved.desired, "pv");
        strict_1.default.equal(resolved.action, "execute");
    });
    (0, node_test_1.it)("O15: explicit planner OFF works without ownership", () => {
        const projection = (0, index_1.projectDesiredEvccMode)({
            intentAction: "hold",
            energySource: "grid",
            chargingAllowed: false,
            allocatedPowerW: 0,
            dailyPlanStatus: "daily_plan_zero_allocation",
            planValid: true,
            useDailyPlan: true,
        });
        const resolved = (0, index_1.resolveDesiredWithOwnership)({
            projection,
            ownership: "unknown",
            ownedMode: null,
            planValid: true,
            useDailyPlan: true,
            authority: "ems",
        });
        strict_1.default.equal(resolved.desired, "off");
        strict_1.default.equal(resolved.action, "explicit_stop");
        const stepped = (0, index_1.stepEvExecution)((0, index_1.emptyEvExecutionSession)(), {
            nowMs: NOW,
            desiredMode: "off",
            actualMode: "pv",
            writeAllowed: true,
            blockReason: "",
            failsafeReason: "",
            authorityIsEms: true,
            desiredReason: "explicit_stop",
        });
        strict_1.default.equal(stepped.writeMode, "off");
    });
    (0, node_test_1.it)("O16: manual/external mode change after EMS PV → ownership invalidated", () => {
        const dropped = (0, index_1.dropExecutionOwnership)(owningSession("pv"), {
            authority: "ems",
            actualMode: "now",
        });
        strict_1.default.equal(dropped.ownership, "none");
        strict_1.default.equal(dropped.releaseReason, "actual_mode_changed_externally");
        strict_1.default.equal((0, index_1.formatEvExecutionExplain)({
            desired: "noop",
            actual: "now",
            authority: "ems",
            phase: "idle",
            blockReason: "",
            failsafeReason: "",
            writeAllowed: false,
            ownership: "none",
            releaseReason: "actual_mode_changed_externally",
            action: "noop",
        }), "actual_mode_changed_externally, ownership_lost=true");
    });
    (0, node_test_1.it)("O17: restart with EVCC already on PV → no ownership assumption and no blind OFF", async () => {
        (0, index_1.resetEvExecutionSession)();
        const { host, foreignWrites } = tickHost({ global: "live", addon: "live" });
        const snap = (0, evcc_telemetry_1.emptyEvccTelemetrySnapshot)("2026-08-15T08:00:00.000Z");
        snap.loadpoint_mode = { value: "pv", status: "valid", raw: "pv" };
        snap.connection = { value: true, status: "valid", raw: true };
        const s = await (0, index_1.tickEvExecution)(host, {
            nowMs: NOW,
            snap,
            model: model(),
            planDecision: decision({
                chargingAllowedByPlan: false,
                allocatedPowerW: null,
                dailyPlanStatus: "daily_plan_zero_allocation",
                decisionSource: "daily_plan_zero",
                planValid: true,
                useDailyPlan: true,
            }),
            intent: intent({ action: "hold", enabled: false, targetPowerW: 0, source: "none" }),
            faultActive: false,
            addonEnabled: true,
            governanceEnabled: true,
        });
        strict_1.default.equal(s.ownership, "unknown");
        strict_1.default.equal(s.ownedMode, null);
        strict_1.default.equal((await host.getStateAsync(ensure_states_1.WALLBOX_EV_FOUNDATION_STATES.evExecutionDesiredMode))?.val, "noop");
        strict_1.default.equal(foreignWrites.length, 0);
        strict_1.default.notEqual(s.releaseReason, "release_off");
    });
    (0, node_test_1.it)("O18: No-Op without ownership creates neither pending nor retry", () => {
        const stepped = (0, index_1.stepEvExecution)((0, index_1.emptyEvExecutionSession)(), {
            nowMs: NOW,
            desiredMode: "noop",
            actualMode: "pv",
            writeAllowed: true,
            blockReason: "",
            failsafeReason: "",
            authorityIsEms: true,
            desiredReason: "no_planned_wallbox_action",
        });
        strict_1.default.equal(stepped.session.pendingMode, null);
        strict_1.default.equal(stepped.session.retryCount, 0);
        strict_1.default.equal(stepped.session.phase, "idle");
        strict_1.default.equal(stepped.session.lastResult, "noop");
        strict_1.default.equal(stepped.session.failsafeReason, "");
    });
    (0, node_test_1.it)("O19: release OFF uses only the EVCC button contract", () => {
        const contract = (0, evcc_mode_control_1.resolveEvccModeControlContract)(BUTTON_CFG);
        strict_1.default.equal((0, index_1.buttonStateId)(contract, "off"), `${LP}.control.off`);
        strict_1.default.equal((0, index_1.isAllowedEvccButtonWriteTarget)(`${LP}.control.off`, "off"), true);
        const writeSrc = (0, node_fs_1.readFileSync)((0, node_path_1.join)(SRC, "ev_foundation", "execution", "write.ts"), "utf8");
        const ownSrc = (0, node_fs_1.readFileSync)((0, node_path_1.join)(SRC, "ev_foundation", "execution", "ownership.ts"), "utf8");
        strict_1.default.equal(/setForeignStateAsync/.test(ownSrc), false);
        strict_1.default.equal(/go-e\.|fordpass\.|tibber\.|sonnen\./.test(ownSrc), false);
        strict_1.default.match(writeSrc, /Only EVCC button pulses/);
    });
    (0, node_test_1.it)("O20: no new go-e / Ford / Tibber / Sonnen write path", () => {
        const ownSrc = (0, node_fs_1.readFileSync)((0, node_path_1.join)(SRC, "ev_foundation", "execution", "ownership.ts"), "utf8");
        const tickSrc = (0, node_fs_1.readFileSync)((0, node_path_1.join)(SRC, "ev_foundation", "execution", "tick.ts"), "utf8");
        for (const src of [ownSrc, tickSrc]) {
            strict_1.default.equal(/setForeignStateAsync\(\s*["'`]go-e\./.test(src), false);
            strict_1.default.equal(/setForeignStateAsync\(\s*["'`]ford/.test(src), false);
            strict_1.default.equal(/writeForeignIfChanged\([\s\S]*["'`]sonnen\./.test(src), false);
            strict_1.default.equal(/writeForeignIfChanged\([\s\S]*["'`]tibber\./i.test(src), false);
        }
        strict_1.default.equal(write_allowlist_1.EV_EXECUTION_PHASE5_ENABLED, false);
    });
    (0, node_test_1.it)("tick: owned PV + valid no-slot plan publishes release diagnosis without writing", async () => {
        (0, index_1.replaceEvExecutionSession)(owningSession("pv"));
        const { host, foreignWrites } = tickHost({ global: "live", addon: "live" });
        const snap = (0, evcc_telemetry_1.emptyEvccTelemetrySnapshot)("2026-08-15T08:00:00.000Z");
        snap.loadpoint_mode = { value: "pv", status: "valid", raw: "pv" };
        snap.connection = { value: true, status: "valid", raw: true };
        const s = await (0, index_1.tickEvExecution)(host, {
            nowMs: NOW,
            snap,
            model: model(),
            planDecision: decision({
                chargingAllowedByPlan: false,
                allocatedPowerW: null,
                dailyPlanStatus: "daily_plan_zero_allocation",
                decisionSource: "daily_plan_zero",
                planValid: true,
                useDailyPlan: true,
            }),
            intent: intent({ action: "hold", enabled: false, targetPowerW: 0, source: "none" }),
            faultActive: false,
            addonEnabled: true,
            governanceEnabled: true,
        });
        strict_1.default.equal(foreignWrites.length, 0);
        strict_1.default.equal(s.releaseReason, "release_off");
        strict_1.default.equal((await host.getStateAsync(ensure_states_1.WALLBOX_EV_FOUNDATION_STATES.evExecutionOwnership))?.val, "ems");
        strict_1.default.equal((await host.getStateAsync(ensure_states_1.WALLBOX_EV_FOUNDATION_STATES.evExecutionOwnedMode))?.val, "pv");
        strict_1.default.match(String((await host.getStateAsync(ensure_states_1.WALLBOX_EV_FOUNDATION_STATES.evExecutionExplain))?.val), /action=release_off/);
    });
    (0, node_test_1.it)("already_confirmed matching mode does not invent ownership", () => {
        const r = (0, index_1.stepEvExecution)((0, index_1.emptyEvExecutionSession)(), {
            nowMs: NOW,
            desiredMode: "pv",
            actualMode: "pv",
            writeAllowed: true,
            blockReason: "",
            failsafeReason: "",
            authorityIsEms: true,
        });
        strict_1.default.equal(r.session.lastResult, "already_confirmed");
        strict_1.default.equal(r.session.ownership, "unknown");
        strict_1.default.equal(r.writeMode, null);
    });
});
function liveSnap(mode) {
    const snap = (0, evcc_telemetry_1.emptyEvccTelemetrySnapshot)("2026-08-15T08:00:00.000Z");
    snap.loadpoint_mode = { value: mode, status: "valid", raw: mode };
    snap.connection = { value: true, status: "valid", raw: true };
    return snap;
}
function pvChargeInput(nowMs = NOW, actual = "off") {
    return {
        nowMs,
        snap: liveSnap(actual),
        model: model(),
        planDecision: decision({
            energySource: "pv_surplus",
            allocatedPowerW: 4000,
            gridPowerW: 0,
            pvPowerW: 4000,
        }),
        intent: intent({ source: "pv_surplus", targetPowerW: 4000 }),
        faultActive: false,
        addonEnabled: true,
        governanceEnabled: true,
    };
}
function nowChargeInput(nowMs = NOW, actual = "off") {
    return {
        nowMs,
        snap: liveSnap(actual),
        model: model(),
        planDecision: decision(),
        intent: intent(),
        faultActive: false,
        addonEnabled: true,
        governanceEnabled: true,
    };
}
function noopInput(nowMs = NOW, actual = "pv") {
    return {
        nowMs,
        snap: liveSnap(actual),
        model: model(),
        planDecision: decision({
            chargingAllowedByPlan: false,
            allocatedPowerW: null,
            planValid: false,
            useDailyPlan: false,
            decisionSource: "no_plan",
        }),
        intent: intent({ action: "none", enabled: false, targetPowerW: 0, source: "none" }),
        faultActive: false,
        addonEnabled: true,
        governanceEnabled: true,
    };
}
function noSlotOwnedInput(nowMs = NOW, actual = "pv") {
    return {
        nowMs,
        snap: liveSnap(actual),
        model: model(),
        planDecision: decision({
            chargingAllowedByPlan: false,
            allocatedPowerW: null,
            dailyPlanStatus: "daily_plan_zero_allocation",
            decisionSource: "daily_plan_zero",
            planValid: true,
            useDailyPlan: true,
        }),
        intent: intent({ action: "hold", enabled: false, targetPowerW: 0, source: "none" }),
        faultActive: false,
        addonEnabled: true,
        governanceEnabled: true,
    };
}
async function bootThenArm(host, setLocal, input) {
    await (0, index_1.tickEvExecution)(host, input);
    setLocal(ensure_states_1.WALLBOX_EV_FOUNDATION_STATES.evExecutionLiveTestArmed, true, false);
}
(0, node_test_1.describe)("Phase 5B controlled live test", () => {
    (0, node_test_1.it)("L0: Dauerbetrieb gate stays false; one-shot permit is extra", () => {
        strict_1.default.equal(write_allowlist_1.EV_EXECUTION_PHASE5_ENABLED, false);
        const closed = greenGates({ featureEnabled: true });
        strict_1.default.equal(closed.writeAllowed, false);
        strict_1.default.equal(closed.blockReason, "feature_gate");
        const permitted = greenGates({ featureEnabled: false, liveTestPermit: true });
        strict_1.default.equal(permitted.writeAllowed, true);
        strict_1.default.equal(permitted.blockReason, "");
    });
    (0, node_test_1.it)("L1: not armed → no productive Phase-5 write", async () => {
        const { host, foreignWrites } = tickHost({ global: "live", addon: "live" });
        await (0, index_1.tickEvExecution)(host, pvChargeInput());
        strict_1.default.equal(foreignWrites.length, 0);
        strict_1.default.equal((0, index_1.peekEvLiveTestState)().consumed, false);
        strict_1.default.equal((await host.getStateAsync(ensure_states_1.WALLBOX_EV_FOUNDATION_STATES.evExecutionEnabled))?.val, false);
    });
    (0, node_test_1.it)("L2: armed + global dryrun → no write, not consumed", async () => {
        const { host, foreignWrites, setLocal } = tickHost({ global: "dryrun", addon: "live" });
        await bootThenArm(host, setLocal, pvChargeInput());
        const s = await (0, index_1.tickEvExecution)(host, pvChargeInput());
        strict_1.default.equal(foreignWrites.length, 0);
        strict_1.default.equal((0, index_1.peekEvLiveTestState)().consumed, false);
        strict_1.default.equal((0, index_1.peekEvLiveTestState)().armed, true);
        strict_1.default.match(s.explain, /live_test=armed/);
        strict_1.default.match(s.explain, /write_blocked=global_dryrun/);
    });
    (0, node_test_1.it)("L3: armed + addon not live → no write, not consumed", async () => {
        const { host, foreignWrites, setLocal } = tickHost({ global: "live", addon: "dryrun" });
        await bootThenArm(host, setLocal, pvChargeInput());
        await (0, index_1.tickEvExecution)(host, pvChargeInput());
        strict_1.default.equal(foreignWrites.length, 0);
        strict_1.default.equal((0, index_1.peekEvLiveTestState)().consumed, false);
    });
    (0, node_test_1.it)("L4: armed + external authority → no write, not consumed", async () => {
        const { host, foreignWrites, setLocal } = tickHost({ global: "live", addon: "live" });
        const input = {
            ...pvChargeInput(),
            model: model({
                externalControlConfigured: true,
                externalControlType: "vehicle",
                externalControlActive: true,
                externalAuthorityState: "active",
            }),
        };
        await bootThenArm(host, setLocal, input);
        const s = await (0, index_1.tickEvExecution)(host, input);
        strict_1.default.equal(foreignWrites.length, 0);
        strict_1.default.equal((0, index_1.peekEvLiveTestState)().consumed, false);
        strict_1.default.equal(s.explain, "live_test=armed, authority=external, blocked");
        strict_1.default.equal((await host.getStateAsync(ensure_states_1.WALLBOX_EV_FOUNDATION_STATES.evExecutionLiveTestBlockReason))?.val, "external_authority");
    });
    (0, node_test_1.it)("L5: armed + noop → no write, not consumed", async () => {
        const { host, foreignWrites, setLocal } = tickHost({ global: "live", addon: "live" });
        await bootThenArm(host, setLocal, noopInput());
        const s = await (0, index_1.tickEvExecution)(host, noopInput());
        strict_1.default.equal(foreignWrites.length, 0);
        strict_1.default.equal((0, index_1.peekEvLiveTestState)().consumed, false);
        strict_1.default.equal((0, index_1.peekEvLiveTestState)().armed, true);
        strict_1.default.equal(s.explain, "live_test=armed, desired=noop, no_command_sent");
    });
    (0, node_test_1.it)("L6: armed + already-confirmed → no write, not consumed, no ownership", async () => {
        const { host, foreignWrites, setLocal } = tickHost({
            global: "live",
            addon: "live",
            foreign: { [`${LP}.status.mode`]: { val: "pv", ts: NOW } },
        });
        await bootThenArm(host, setLocal, pvChargeInput(NOW, "pv"));
        const s = await (0, index_1.tickEvExecution)(host, pvChargeInput(NOW, "pv"));
        strict_1.default.equal(foreignWrites.length, 0);
        strict_1.default.equal((0, index_1.peekEvLiveTestState)().consumed, false);
        strict_1.default.equal(s.lastResult, "already_confirmed");
        strict_1.default.equal(s.ownership, "unknown");
        strict_1.default.equal(s.explain, "live_test=armed, desired=pv, already_confirmed");
    });
    (0, node_test_1.it)("L7: armed + valid pv → exactly one first button pulse, consumed", async () => {
        const { host, foreignWrites, setLocal } = tickHost({
            global: "live",
            addon: "live",
            foreign: { [`${LP}.status.mode`]: { val: "off", ts: NOW } },
        });
        await bootThenArm(host, setLocal, pvChargeInput());
        const s = await (0, index_1.tickEvExecution)(host, pvChargeInput());
        strict_1.default.deepEqual(foreignWrites, [{ id: `${LP}.control.pv`, val: true }]);
        strict_1.default.equal((0, index_1.peekEvLiveTestState)().consumed, true);
        strict_1.default.equal((0, index_1.peekEvLiveTestState)().armed, false);
        strict_1.default.equal((0, index_1.peekEvLiveTestState)().command, "pv");
        strict_1.default.equal(s.ownership, "unknown");
        strict_1.default.equal(s.explain, "live_test=consumed, command=pv, awaiting_feedback");
        strict_1.default.equal((await host.getStateAsync(ensure_states_1.WALLBOX_EV_FOUNDATION_STATES.evExecutionLiveTestArmed))?.val, false);
        strict_1.default.equal((await host.getStateAsync(ensure_states_1.WALLBOX_EV_FOUNDATION_STATES.evExecutionLiveTestConsumed))?.val, true);
        strict_1.default.equal((await host.getStateAsync(ensure_states_1.WALLBOX_EV_FOUNDATION_STATES.evExecutionLastCommand))?.val, "pv");
    });
    (0, node_test_1.it)("L8: armed + valid now → exactly one first button pulse, consumed", async () => {
        const { host, foreignWrites, setLocal } = tickHost({
            global: "live",
            addon: "live",
            foreign: { [`${LP}.status.mode`]: { val: "off", ts: NOW } },
        });
        await bootThenArm(host, setLocal, nowChargeInput());
        const s = await (0, index_1.tickEvExecution)(host, nowChargeInput());
        strict_1.default.deepEqual(foreignWrites, [{ id: `${LP}.control.now`, val: true }]);
        strict_1.default.equal((0, index_1.peekEvLiveTestState)().command, "now");
        strict_1.default.equal(s.explain, "live_test=consumed, command=now, awaiting_feedback");
    });
    (0, node_test_1.it)("L9: after consumed no second new desired command", async () => {
        const { host, foreignWrites, setLocal } = tickHost({
            global: "live",
            addon: "live",
            foreign: { [`${LP}.status.mode`]: { val: "off", ts: NOW } },
        });
        await bootThenArm(host, setLocal, pvChargeInput());
        await (0, index_1.tickEvExecution)(host, pvChargeInput());
        strict_1.default.equal(foreignWrites.length, 1);
        const s = await (0, index_1.tickEvExecution)(host, nowChargeInput(NOW + 5_000));
        strict_1.default.equal(foreignWrites.length, 1);
        strict_1.default.equal(s.blockReason, "live_test_consumed");
        strict_1.default.equal((0, index_1.peekEvLiveTestState)().command, "pv");
    });
    (0, node_test_1.it)("L10: retry of the same pending command stays allowed", async () => {
        const { host, foreignWrites, setLocal } = tickHost({
            global: "live",
            addon: "live",
            foreign: { [`${LP}.status.mode`]: { val: "off", ts: NOW } },
        });
        await bootThenArm(host, setLocal, pvChargeInput());
        await (0, index_1.tickEvExecution)(host, pvChargeInput());
        strict_1.default.equal(foreignWrites.length, 1);
        const retry = await (0, index_1.tickEvExecution)(host, pvChargeInput(NOW + index_1.EV_FEEDBACK_TIMEOUT_MS, "off"));
        strict_1.default.equal(foreignWrites.length, 2);
        strict_1.default.equal(foreignWrites[1]?.id, `${LP}.control.pv`);
        strict_1.default.equal(retry.retryCount, 1);
        strict_1.default.ok(retry.retryCount <= index_1.EV_MAX_RETRIES);
        strict_1.default.equal((0, index_1.peekEvLiveTestState)().consumed, true);
    });
    (0, node_test_1.it)("L11: external takeover during pending → no further retries", async () => {
        const { host, foreignWrites, setLocal } = tickHost({
            global: "live",
            addon: "live",
            foreign: { [`${LP}.status.mode`]: { val: "off", ts: NOW } },
        });
        await bootThenArm(host, setLocal, pvChargeInput());
        await (0, index_1.tickEvExecution)(host, pvChargeInput());
        const external = {
            ...pvChargeInput(NOW + index_1.EV_FEEDBACK_TIMEOUT_MS),
            model: model({
                externalControlConfigured: true,
                externalControlType: "vehicle",
                externalControlActive: true,
                externalAuthorityState: "active",
            }),
        };
        const s = await (0, index_1.tickEvExecution)(host, external);
        strict_1.default.equal(foreignWrites.length, 1);
        strict_1.default.equal(s.pendingMode, null);
        strict_1.default.equal((0, index_1.peekEvLiveTestState)().consumed, true);
        strict_1.default.notEqual(s.lastResult, "retry");
    });
    (0, node_test_1.it)("L12: disarm before first write → no write", async () => {
        const { host, foreignWrites, setLocal } = tickHost({
            global: "live",
            addon: "live",
            foreign: { [`${LP}.status.mode`]: { val: "off", ts: NOW } },
        });
        await bootThenArm(host, setLocal, pvChargeInput());
        setLocal(ensure_states_1.WALLBOX_EV_FOUNDATION_STATES.evExecutionLiveTestArmed, false, false);
        await (0, index_1.tickEvExecution)(host, pvChargeInput());
        strict_1.default.equal(foreignWrites.length, 0);
        strict_1.default.equal((0, index_1.peekEvLiveTestState)().armed, false);
        strict_1.default.equal((0, index_1.peekEvLiveTestState)().consumed, false);
    });
    (0, node_test_1.it)("L13: disarm after first pulse → no new retries", async () => {
        const { host, foreignWrites, setLocal } = tickHost({
            global: "live",
            addon: "live",
            foreign: { [`${LP}.status.mode`]: { val: "off", ts: NOW } },
        });
        await bootThenArm(host, setLocal, pvChargeInput());
        await (0, index_1.tickEvExecution)(host, pvChargeInput());
        strict_1.default.equal(foreignWrites.length, 1);
        setLocal(ensure_states_1.WALLBOX_EV_FOUNDATION_STATES.evExecutionLiveTestDisarm, true, false);
        const s = await (0, index_1.tickEvExecution)(host, pvChargeInput(NOW + index_1.EV_FEEDBACK_TIMEOUT_MS));
        strict_1.default.equal(foreignWrites.length, 1);
        strict_1.default.equal(s.lastResult, "live_test_disarmed");
        strict_1.default.equal((0, index_1.peekEvLiveTestState)().consumed, true);
        strict_1.default.equal((0, index_1.peekEvLiveTestState)().retriesBlocked, true);
    });
    (0, node_test_1.it)("L14: restart → armed=false and persisted true is not reconstructed", async () => {
        const { host, foreignWrites, setLocal } = tickHost({
            global: "live",
            addon: "live",
            foreign: { [`${LP}.status.mode`]: { val: "off", ts: NOW } },
        });
        (0, index_1.replaceEvLiveTestState)((0, index_1.armEvLiveTest)(NOW));
        setLocal(ensure_states_1.WALLBOX_EV_FOUNDATION_STATES.evExecutionLiveTestArmed, true, true);
        (0, index_1.resetEvExecutionSession)();
        const s = await (0, index_1.tickEvExecution)(host, pvChargeInput());
        strict_1.default.equal(foreignWrites.length, 0);
        strict_1.default.equal((0, index_1.peekEvLiveTestState)().armed, false);
        strict_1.default.equal((0, index_1.peekEvLiveTestState)().consumed, false);
        strict_1.default.equal((await host.getStateAsync(ensure_states_1.WALLBOX_EV_FOUNDATION_STATES.evExecutionLiveTestArmed))?.val, false);
        strict_1.default.equal(s.blockReason, "feature_gate");
    });
    (0, node_test_1.it)("L15: consumed test does not emit automatic release-OFF as a second command", async () => {
        const { host, foreignWrites, setLocal, foreign } = tickHost({
            global: "live",
            addon: "live",
            foreign: { [`${LP}.status.mode`]: { val: "off", ts: NOW } },
        });
        await bootThenArm(host, setLocal, pvChargeInput());
        await (0, index_1.tickEvExecution)(host, pvChargeInput());
        foreign[`${LP}.status.mode`] = { val: "pv", ts: NOW + 20_000 };
        await (0, index_1.tickEvExecution)(host, pvChargeInput(NOW + 20_000, "pv"));
        strict_1.default.equal((0, index_1.peekEvExecutionSession)().ownership, "ems");
        const after = await (0, index_1.tickEvExecution)(host, noSlotOwnedInput(NOW + 30_000, "pv"));
        strict_1.default.equal(foreignWrites.some((w) => w.id === `${LP}.control.off`), false);
        strict_1.default.equal(foreignWrites.length, 1);
        strict_1.default.equal(after.releaseReason, "release_off");
        strict_1.default.match(after.explain, /live_test=consumed/);
    });
    (0, node_test_1.it)("L16: manual EVCC change is not recaptured after consume", async () => {
        const { host, foreignWrites, setLocal, foreign } = tickHost({
            global: "live",
            addon: "live",
            foreign: { [`${LP}.status.mode`]: { val: "off", ts: NOW } },
        });
        await bootThenArm(host, setLocal, pvChargeInput());
        await (0, index_1.tickEvExecution)(host, pvChargeInput());
        foreign[`${LP}.status.mode`] = { val: "pv", ts: NOW + 20_000 };
        await (0, index_1.tickEvExecution)(host, pvChargeInput(NOW + 20_000, "pv"));
        strict_1.default.equal((0, index_1.peekEvExecutionSession)().ownership, "ems");
        foreign[`${LP}.status.mode`] = { val: "now", ts: NOW + 40_000 };
        const s = await (0, index_1.tickEvExecution)(host, pvChargeInput(NOW + 40_000, "now"));
        strict_1.default.equal(s.ownership, "none");
        strict_1.default.equal(s.releaseReason, "actual_mode_changed_externally");
        strict_1.default.equal(foreignWrites.length, 1);
    });
    (0, node_test_1.it)("L17: ownership is granted only after confirmed feedback", async () => {
        const { host, foreignWrites, setLocal, foreign } = tickHost({
            global: "live",
            addon: "live",
            foreign: { [`${LP}.status.mode`]: { val: "off", ts: NOW } },
        });
        await bootThenArm(host, setLocal, pvChargeInput());
        const sent = await (0, index_1.tickEvExecution)(host, pvChargeInput());
        strict_1.default.equal(sent.ownership, "unknown");
        strict_1.default.equal(foreignWrites.length, 1);
        foreign[`${LP}.status.mode`] = { val: "pv", ts: NOW + 18_000 };
        const confirmed = await (0, index_1.tickEvExecution)(host, pvChargeInput(NOW + 20_000, "pv"));
        strict_1.default.equal(confirmed.ownership, "ems");
        strict_1.default.equal(confirmed.ownedMode, "pv");
        strict_1.default.equal(confirmed.explain, "live_test=consumed, command=pv, feedback=confirmed");
        strict_1.default.equal(foreignWrites.length, 1);
    });
    (0, node_test_1.it)("L18: no go-e / Ford / Tibber / Sonnen direct write", () => {
        const writeSrc = (0, node_fs_1.readFileSync)((0, node_path_1.join)(SRC, "ev_foundation", "execution", "write.ts"), "utf8");
        const tickSrc = (0, node_fs_1.readFileSync)((0, node_path_1.join)(SRC, "ev_foundation", "execution", "tick.ts"), "utf8");
        const liveSrc = (0, node_fs_1.readFileSync)((0, node_path_1.join)(SRC, "ev_foundation", "execution", "live_test.ts"), "utf8");
        for (const src of [writeSrc, tickSrc, liveSrc]) {
            strict_1.default.equal(/setForeignStateAsync\(\s*["'`]go-e\./.test(src), false);
            strict_1.default.equal(/setForeignStateAsync\(\s*["'`]ford/.test(src), false);
            strict_1.default.equal(/writeForeignIfChanged\([\s\S]*["'`]sonnen\./.test(src), false);
            strict_1.default.equal(/writeForeignIfChanged\([\s\S]*["'`]tibber\./i.test(src), false);
        }
        strict_1.default.equal((0, index_1.isAllowedEvccButtonWriteTarget)("go-e.0.allow_charging", "now"), false);
        strict_1.default.equal((0, index_1.isAllowedEvccButtonWriteTarget)("fordpass.0.startCharge", "pv"), false);
    });
    (0, node_test_1.it)("L19: legacy pvControl stays excluded even with live-test permit", async () => {
        const pvControlCfg = {
            ...BUTTON_CFG,
            wb_evcc_mode_control: "pv_control",
            wb_evcc_control_pv_control_target: `${LP}.control.pvControl`,
        };
        const writes = [];
        const r = await (0, index_1.executeEvccButtonWrite)({
            async getForeignStateAsync() {
                return { val: 1 };
            },
            async setForeignStateAsync(id) {
                writes.push(id);
            },
        }, {
            contract: (0, evcc_mode_control_1.resolveEvccModeControlContract)(pvControlCfg),
            mode: "pv",
            writeAllowed: true,
            liveTestPermit: true,
        });
        strict_1.default.equal(r.written, false);
        strict_1.default.equal(r.reason, "legacy_variant_blocked");
        strict_1.default.equal(writes.length, 0);
        strict_1.default.equal((0, index_1.isAllowedEvccButtonWriteTarget)(`${LP}.control.pvControl`, "pv"), false);
    });
    (0, node_test_1.it)("L20: one-shot consume is the first successful button pulse, not feedback", () => {
        const armed = (0, index_1.armEvLiveTest)(NOW);
        const permit = (0, index_1.evaluateEvLiveTestPermit)({ liveTest: armed, desiredMode: "pv" });
        strict_1.default.equal(permit.permit, true);
        strict_1.default.equal(permit.consumeOnSuccessfulWrite, true);
        const consumed = (0, index_1.consumeEvLiveTest)(armed, "pv", NOW);
        strict_1.default.equal(consumed.consumed, true);
        strict_1.default.equal(consumed.armed, false);
        const retryPermit = (0, index_1.evaluateEvLiveTestPermit)({
            liveTest: consumed,
            desiredMode: "pv",
            pendingMode: "pv",
            pendingActive: true,
        });
        strict_1.default.equal(retryPermit.permit, true);
        strict_1.default.equal(retryPermit.consumeOnSuccessfulWrite, false);
        strict_1.default.equal((0, index_1.evaluateEvLiveTestPermit)({ liveTest: consumed, desiredMode: "pv", pendingActive: false }).permit, false);
        const nextPermit = (0, index_1.evaluateEvLiveTestPermit)({ liveTest: consumed, desiredMode: "now" });
        strict_1.default.equal(nextPermit.permit, false);
        strict_1.default.equal(nextPermit.blockReason, "live_test_consumed");
        const disarmed = (0, index_1.disarmEvLiveTest)(consumed);
        strict_1.default.equal(disarmed.retriesBlocked, true);
        strict_1.default.equal((0, index_1.evaluateEvLiveTestPermit)({ liveTest: disarmed, desiredMode: "pv" }).permit, false);
    });
    (0, node_test_1.it)("explain covers the Phase-5B live-test contract", () => {
        strict_1.default.equal((0, index_1.formatEvExecutionExplain)({
            desired: "pv",
            actual: "off",
            authority: "ems",
            phase: "idle",
            blockReason: "",
            failsafeReason: "",
            writeAllowed: true,
            liveTestArmed: true,
        }), "live_test=armed, desired=pv, waiting_for_execution");
        strict_1.default.equal((0, index_1.formatEvExecutionExplain)({
            desired: "noop",
            actual: "pv",
            authority: "ems",
            phase: "idle",
            blockReason: "",
            failsafeReason: "",
            writeAllowed: false,
            liveTestArmed: true,
        }), "live_test=armed, desired=noop, no_command_sent");
        strict_1.default.equal((0, index_1.formatEvExecutionExplain)({
            desired: "pv",
            actual: "off",
            authority: "external",
            phase: "idle",
            blockReason: "external_authority",
            failsafeReason: "",
            writeAllowed: false,
            liveTestArmed: true,
        }), "live_test=armed, authority=external, blocked");
        strict_1.default.equal((0, index_1.formatEvExecutionExplain)({
            desired: "pv",
            actual: "off",
            authority: "ems",
            phase: "awaiting_feedback",
            blockReason: "",
            failsafeReason: "",
            writeAllowed: true,
            liveTestConsumed: true,
            liveTestCommand: "pv",
        }), "live_test=consumed, command=pv, awaiting_feedback");
        strict_1.default.equal((0, index_1.formatEvExecutionExplain)({
            desired: "pv",
            actual: "pv",
            authority: "ems",
            phase: "confirmed",
            blockReason: "",
            failsafeReason: "",
            writeAllowed: false,
            liveTestConsumed: true,
            liveTestCommand: "pv",
        }), "live_test=consumed, command=pv, feedback=confirmed");
        strict_1.default.equal((0, index_1.formatEvExecutionExplain)({
            desired: "pv",
            actual: "off",
            authority: "ems",
            phase: "failsafe",
            blockReason: "feedback_timeout",
            failsafeReason: "feedback_timeout",
            writeAllowed: false,
            liveTestConsumed: true,
            liveTestCommand: "pv",
        }), "live_test=consumed, command=pv, feedback=failed");
    });
    (0, node_test_1.it)("empty live-test state is the restart default", () => {
        const empty = (0, index_1.emptyEvLiveTestState)();
        strict_1.default.equal(empty.armed, false);
        strict_1.default.equal(empty.consumed, false);
        strict_1.default.equal(empty.command, null);
    });
});
