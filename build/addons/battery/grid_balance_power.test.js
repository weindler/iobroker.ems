"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const strict_1 = __importDefault(require("node:assert/strict"));
const node_fs_1 = require("node:fs");
const node_path_1 = require("node:path");
const config_js_1 = require("./config.js");
const grid_balance_contract_js_1 = require("./grid_balance_contract.js");
const grid_balance_power_js_1 = require("./grid_balance_power.js");
const SRC = (0, node_path_1.join)(__dirname, "..", "..", "..", "src", "addons", "battery");
function safety(over = {}) {
    return {
        adminEnabled: true,
        emsMirrorEnabled: true,
        globalLive: true,
        addonLive: true,
        addonEnabled: true,
        governanceEnabled: true,
        faultActive: false,
        lockoutActive: false,
        restoreInProgress: false,
        sourceStale: false,
        sourceOffline: false,
        holdPlanned: false,
        holdActive: false,
        evccBatteryModeHold: false,
        plannedBatteryAction: false,
        ownershipActive: false,
        dailyPlanAuthoritative: false,
        mode1Active: false,
        priceNowCt: 50,
        priceMinCt: 30,
        evConflictKind: "",
        externalEvAuthority: false,
        liveTestPermit: true,
        ...over,
    };
}
function consumedLiveTest(nowMs = 8_000) {
    return {
        armed: false,
        consumed: true,
        armedAtMs: 1,
        consumedAtMs: nowMs,
        result: "consumed",
    };
}
function tick(over = {}) {
    return {
        nowMs: 10_000,
        safety: safety(),
        consumptionW: 2000,
        pvAcPowerW: 400,
        charging: false,
        chargePowerW: null,
        chargePowerAgeMs: null,
        deadbandW: grid_balance_power_js_1.GRID_BALANCE_DEADBAND_DEFAULT_W,
        offsetW: 25,
        configuredMaxW: 5000,
        hardwareMaxChargeW: 3300,
        hardwareMaxDischargeW: 3300,
        minChangeW: 50,
        lastWrittenW: null,
        lastWriteAtMs: null,
        ownsSetpoint: false,
        liveTest: { ...(0, grid_balance_power_js_1.emptyGridBalanceLiveTest)(), armed: true },
        controllerIsGridBalance: true,
        mode2Confirmed: true,
        keepaliveMaxMs: grid_balance_power_js_1.GRID_BALANCE_KEEPALIVE_MAX_MS,
        ...over,
    };
}
(0, node_test_1.describe)("grid balance live hardening v0.1.289", () => {
    (0, node_test_1.it)("L1: Admin disabled → kein Write", () => {
        const d = (0, grid_balance_power_js_1.evaluateGridBalanceTick)(tick({ safety: safety({ adminEnabled: false, liveTestPermit: true }) }));
        strict_1.default.equal(d.shouldWrite, false);
        strict_1.default.equal(d.blockReason, "disabled");
    });
    (0, node_test_1.it)("L2: Preis unter Mindestpreis → kein discharge", () => {
        const d = (0, grid_balance_power_js_1.evaluateGridBalanceTick)(tick({ safety: safety({ priceNowCt: 20, priceMinCt: 30 }) }));
        strict_1.default.equal(d.shouldWrite, false);
        strict_1.default.equal(d.priceAllowed, false);
        strict_1.default.equal(d.blockReason, "price_below_minimum");
        strict_1.default.equal(d.writeKind, "discharge");
        strict_1.default.match(d.explain, /reason=price_below_minimum/);
    });
    (0, node_test_1.it)("L3: Hold planned → block", () => {
        const d = (0, grid_balance_power_js_1.evaluateGridBalanceTick)(tick({ safety: safety({ holdPlanned: true }) }));
        strict_1.default.equal(d.blockReason, "battery_hold");
        strict_1.default.equal(d.shouldWrite, false);
        strict_1.default.equal(d.holdDetected, true);
    });
    (0, node_test_1.it)("L4: Hold active → block", () => {
        const d = (0, grid_balance_power_js_1.evaluateGridBalanceTick)(tick({ safety: safety({ holdActive: true }) }));
        strict_1.default.equal(d.blockReason, "battery_hold");
    });
    (0, node_test_1.it)("L5: batteryMode=hold → block", () => {
        const d = (0, grid_balance_power_js_1.evaluateGridBalanceTick)(tick({ safety: safety({ evccBatteryModeHold: true }) }));
        strict_1.default.equal(d.blockReason, "battery_hold");
    });
    (0, node_test_1.it)("L6: External Authority → block", () => {
        const d = (0, grid_balance_power_js_1.evaluateGridBalanceTick)(tick({ safety: safety({ externalEvAuthority: true, evConflictKind: "ev_external" }) }));
        strict_1.default.equal(d.blockReason, "external_ev_authority");
        strict_1.default.equal(d.shouldRelease, false);
    });
    (0, node_test_1.it)("L7: EV NOW → block, nicht als Hauslast", () => {
        const now = (0, grid_balance_contract_js_1.classifyGridBalanceEvConflict)({
            loadpointMode: "now",
            charging: true,
            chargePowerW: 11000,
            wallboxHold: false,
            batteryBoost: false,
            externalAuthority: false,
            tibberRewardsActive: false,
            wallboxEnergySource: "grid",
            wallboxAllocatedGridW: 11000,
        });
        strict_1.default.equal(now.kind, "ev_now");
        const d = (0, grid_balance_power_js_1.evaluateGridBalanceTick)(tick({ safety: safety({ evConflictKind: "ev_now" }), charging: true, chargePowerW: 11000, chargePowerAgeMs: 1000 }));
        strict_1.default.equal(d.blockReason, "ev_now_grid_charge");
        strict_1.default.equal(d.shouldWrite, false);
    });
    (0, node_test_1.it)("L8: EV charging + fresh chargePower → Abzug", () => {
        const ev = (0, grid_balance_power_js_1.adjustConsumptionForEv)({
            consumptionW: 4000,
            charging: true,
            chargePowerW: 3500,
            chargePowerAgeMs: 2000,
        });
        strict_1.default.equal(ev.blockReason, "");
        strict_1.default.equal(ev.adjustedConsumptionW, 500);
        const d = (0, grid_balance_power_js_1.evaluateGridBalanceTick)(tick({
            consumptionW: 4000,
            pvAcPowerW: 0,
            charging: true,
            chargePowerW: 3500,
            chargePowerAgeMs: 2000,
        }));
        strict_1.default.equal(d.adjustedConsumptionW, 500);
        strict_1.default.equal(d.rawGridDeltaW, 500);
        strict_1.default.equal(d.blockReason, "");
        strict_1.default.equal(d.shouldWrite, true);
        strict_1.default.equal(d.writeKind, "discharge");
    });
    (0, node_test_1.it)("L8b: disconnected leftover charging/power is not house-load EV", () => {
        const ev = (0, grid_balance_power_js_1.adjustConsumptionForEv)({
            consumptionW: 4000,
            charging: true,
            chargePowerW: 3500,
            chargePowerAgeMs: 2000,
            vehicleConnected: false,
        });
        strict_1.default.equal(ev.evActive, false);
        strict_1.default.equal(ev.adjustedConsumptionW, 4000);
        strict_1.default.equal(ev.blockReason, "");
        const d = (0, grid_balance_power_js_1.evaluateGridBalanceTick)(tick({
            consumptionW: 4000,
            pvAcPowerW: 0,
            charging: true,
            chargePowerW: 3500,
            chargePowerAgeMs: 2000,
            vehicleConnected: false,
        }));
        strict_1.default.equal(d.adjustedConsumptionW, 4000);
        strict_1.default.notEqual(d.blockReason, "ev_power_unknown");
    });
    (0, node_test_1.it)("L9: EV charging + stale chargePower → block", () => {
        const ev = (0, grid_balance_power_js_1.adjustConsumptionForEv)({
            consumptionW: 4000,
            charging: true,
            chargePowerW: 3500,
            chargePowerAgeMs: 60_000,
        });
        strict_1.default.equal(ev.blockReason, "ev_power_unknown");
        const d = (0, grid_balance_power_js_1.evaluateGridBalanceTick)(tick({ charging: true, chargePowerW: 3500, chargePowerAgeMs: 60_000 }));
        strict_1.default.equal(d.blockReason, "ev_power_unknown");
        strict_1.default.equal(d.shouldWrite, false);
    });
    (0, node_test_1.it)("L10: EV charging + fehlende chargePower → block", () => {
        const d = (0, grid_balance_power_js_1.evaluateGridBalanceTick)(tick({ charging: true, chargePowerW: null, chargePowerAgeMs: 500 }));
        strict_1.default.equal(d.blockReason, "ev_power_unknown");
        strict_1.default.equal(d.shouldWrite, false);
    });
    (0, node_test_1.it)("L11: optionales Deadband 250 W blockiert kleinen Restbezug", () => {
        const d = (0, grid_balance_power_js_1.evaluateGridBalanceTick)(tick({ consumptionW: 200, pvAcPowerW: 0, deadbandW: 250, offsetW: 0 }));
        strict_1.default.equal(d.blockReason, "inside_deadband");
        strict_1.default.equal(d.shouldWrite, false);
        strict_1.default.equal(d.requestedPowerW, 0);
    });
    (0, node_test_1.it)("L12: keine 8-s-Stabilisierung — Telemetriepunkt schreibt sofort", () => {
        const d = (0, grid_balance_power_js_1.evaluateGridBalanceTick)(tick({
            nowMs: 1000,
            consumptionW: 2000,
            pvAcPowerW: 0,
        }));
        strict_1.default.equal(d.blockReason, "");
        strict_1.default.equal(d.shouldWrite, true);
        strict_1.default.equal(d.writeKind, "discharge");
        strict_1.default.equal("stabilizationNext" in d, false);
    });
    (0, node_test_1.it)("L14: Maxleistung clamp auf Hardware-Discharge", () => {
        const max = (0, grid_balance_power_js_1.effectiveGridBalanceMaxW)({
            configuredMaxW: 5000,
            hardwareMaxChargeW: 3300,
            hardwareMaxDischargeW: 2800,
        });
        strict_1.default.equal(max.configuredMaxW, 5000);
        strict_1.default.equal(max.hardwareMaxW, 2800);
        strict_1.default.equal(max.effectiveMaxW, 2800);
        const d = (0, grid_balance_power_js_1.evaluateGridBalanceTick)(tick({ consumptionW: 8000, pvAcPowerW: 0, configuredMaxW: 5000, hardwareMaxDischargeW: 2800 }));
        strict_1.default.equal(d.effectiveMaxW, 2800);
        strict_1.default.equal(d.requestedPowerW, 2800);
        strict_1.default.equal(d.writeKind, "discharge");
    });
    (0, node_test_1.it)("L15: GB Ownership entsteht nur nach eigenem Write", () => {
        const idle = (0, grid_balance_power_js_1.evaluateGridBalanceTick)(tick({ ownsSetpoint: false, consumptionW: 100, pvAcPowerW: 100, offsetW: 0 }));
        strict_1.default.equal(idle.ownsSetpointNext, false);
        const written = (0, grid_balance_power_js_1.evaluateGridBalanceTick)(tick({ ownsSetpoint: false, consumptionW: 2000, pvAcPowerW: 0 }));
        strict_1.default.equal(written.shouldWrite, true);
        strict_1.default.equal(written.ownsSetpointNext, true);
    });
    (0, node_test_1.it)("L16: Exit ohne Ownership → kein Cleanup-Write", () => {
        const d = (0, grid_balance_power_js_1.evaluateGridBalanceTick)(tick({
            ownsSetpoint: false,
            safety: safety({ adminEnabled: false, liveTestPermit: true }),
        }));
        strict_1.default.equal(d.shouldRelease, false);
        strict_1.default.equal(d.shouldWrite, false);
    });
    (0, node_test_1.it)("L17: reguläres GB-Ende mit Ownership → genau ein discharge=0", () => {
        const ok = (0, grid_balance_power_js_1.evaluateGridBalanceTick)(tick({
            ownsSetpoint: true,
            lastWrittenW: 800,
            lastWriteAtMs: 1000,
            safety: safety({ adminEnabled: false, liveTestPermit: true }),
        }));
        strict_1.default.equal(ok.shouldRelease, true);
        strict_1.default.equal(ok.writePowerW, 0);
        strict_1.default.equal(ok.writeKind, "discharge");
        strict_1.default.equal(ok.ownsSetpointNext, false);
    });
    (0, node_test_1.it)("L18: Hold während GB aktiv → sofort discharge=0, keine Keepalives", () => {
        const d = (0, grid_balance_power_js_1.evaluateGridBalanceTick)(tick({
            ownsSetpoint: true,
            lastWrittenW: 800,
            lastWriteAtMs: 1000,
            safety: safety({ holdActive: true, liveTestPermit: true }),
        }));
        strict_1.default.equal(d.shouldWrite, false);
        strict_1.default.equal(d.shouldRelease, true);
        strict_1.default.equal(d.writePowerW, 0);
        strict_1.default.equal(d.ownsSetpointNext, false);
        strict_1.default.equal(d.keepaliveDue, false);
        strict_1.default.equal(d.blockReason, "battery_hold");
        strict_1.default.equal((0, grid_balance_power_js_1.gridBalanceCleanupAllowed)({ ownsSetpoint: true, holdDetected: true, authority: "battery_hold" }), true);
    });
    (0, node_test_1.it)("L19: External übernimmt → GB endet mit discharge=0, danach Mode-Wechsel", () => {
        const d = (0, grid_balance_power_js_1.evaluateGridBalanceTick)(tick({
            ownsSetpoint: true,
            lastWrittenW: 800,
            safety: safety({ externalEvAuthority: true, evConflictKind: "ev_external" }),
        }));
        strict_1.default.equal(d.shouldRelease, true);
        strict_1.default.equal(d.writePowerW, 0);
        strict_1.default.equal(d.shouldWrite, false);
        strict_1.default.equal(d.keepaliveDue, false);
        strict_1.default.equal(d.authority, "external_ev");
    });
    (0, node_test_1.it)("L20: kein EVCC/go-e/Ford/Tibber-Direktwrite", () => {
        for (const file of ["grid_balance_power.ts", "grid_balance.ts", "grid_balance_contract.ts", "index.ts"]) {
            const src = (0, node_fs_1.readFileSync)((0, node_path_1.join)(SRC, file), "utf8");
            strict_1.default.equal(/go-e\.|fordpass\.|tibber\.|evcc\./.test(src), false, file);
        }
        strict_1.default.equal(/setForeignStateAsync/.test((0, node_fs_1.readFileSync)((0, node_path_1.join)(SRC, "grid_balance_power.ts"), "utf8")), false);
    });
    (0, node_test_1.it)("L21: 30-ct-Mindestpreis nicht unterschreitbar", () => {
        const d = (0, grid_balance_power_js_1.evaluateGridBalanceTick)(tick({ safety: safety({ priceNowCt: 29.99, priceMinCt: 30 }) }));
        strict_1.default.equal(d.blockReason, "price_below_minimum");
        strict_1.default.equal((0, config_js_1.batteryConfigFromAdapter)({}).gridBalance.minPriceCtPerKwh, 30);
    });
    (0, node_test_1.it)("L22: Default Deadband = 0, keine minDuration", () => {
        const r = (0, grid_balance_contract_js_1.evaluateGridBalanceSafety)(safety({ adminEnabled: true, emsMirrorEnabled: false, liveTestPermit: true }));
        strict_1.default.equal(r.blockReason, "");
        strict_1.default.equal(r.policyAllowed, true);
        const cfg = (0, config_js_1.batteryConfigFromAdapter)({ bat_feature_grid_balance_enabled: true });
        strict_1.default.equal(cfg.gridBalance.enabled, true);
        strict_1.default.equal(cfg.gridBalance.deadbandW, 0);
        strict_1.default.equal(grid_balance_power_js_1.GRID_BALANCE_DEADBAND_DEFAULT_W, 0);
        strict_1.default.equal("minDurationSec" in cfg.gridBalance, false);
    });
    (0, node_test_1.it)("PV/MIN charging is not an automatic EV conflict", () => {
        const pv = (0, grid_balance_contract_js_1.classifyGridBalanceEvConflict)({
            loadpointMode: "pv",
            charging: true,
            chargePowerW: 2000,
            wallboxHold: false,
            batteryBoost: false,
            externalAuthority: false,
            tibberRewardsActive: false,
            wallboxEnergySource: "pv",
            wallboxAllocatedGridW: 0,
        });
        strict_1.default.equal(pv.conflict, false);
        const min = (0, grid_balance_contract_js_1.classifyGridBalanceEvConflict)({
            loadpointMode: "min",
            charging: true,
            chargePowerW: 1400,
            wallboxHold: false,
            batteryBoost: false,
            externalAuthority: false,
            tibberRewardsActive: false,
            wallboxEnergySource: "mixed",
            wallboxAllocatedGridW: 0,
        });
        strict_1.default.equal(min.conflict, false);
    });
    (0, node_test_1.it)("Dauerbetrieb writes without one-shot", () => {
        strict_1.default.equal(grid_balance_contract_js_1.GRID_BALANCE_EXECUTION_ENABLED, true);
        const d = (0, grid_balance_power_js_1.evaluateGridBalanceTick)(tick({ liveTest: (0, grid_balance_power_js_1.emptyGridBalanceLiveTest)(), safety: safety({ liveTestPermit: false }) }));
        strict_1.default.equal(d.shouldWrite, true);
        strict_1.default.equal(d.lastAction, "written");
        strict_1.default.equal(d.writeKind, "discharge");
    });
    (0, node_test_1.it)("one-shot session: keepalive and 0-release still work under Dauerbetrieb", () => {
        const armed = (0, grid_balance_power_js_1.applyGridBalanceLiveTestPulse)((0, grid_balance_power_js_1.emptyGridBalanceLiveTest)(), true, false, 1);
        strict_1.default.equal((0, grid_balance_power_js_1.gridBalanceSetpointPermit)(armed), true);
        const first = (0, grid_balance_power_js_1.evaluateGridBalanceTick)(tick({ liveTest: armed, consumptionW: 2000, pvAcPowerW: 0 }));
        strict_1.default.equal(first.shouldWrite, true);
        strict_1.default.equal(first.shouldRelease, false);
        strict_1.default.equal(first.ownsSetpointNext, true);
        strict_1.default.equal(first.writeKind, "discharge");
        const consumed = (0, grid_balance_power_js_1.consumeGridBalanceLiveTest)(armed, 2);
        strict_1.default.equal((0, grid_balance_power_js_1.gridBalanceSetpointPermit)(consumed), true);
        strict_1.default.equal((0, grid_balance_power_js_1.gridBalanceSetpointPermit)(consumed, true), true);
        strict_1.default.equal(consumed.consumed, true);
        const sameWIdle = (0, grid_balance_power_js_1.evaluateGridBalanceTick)(tick({
            nowMs: 10_000,
            liveTest: consumed,
            ownsSetpoint: true,
            lastWrittenW: first.writePowerW,
            lastWriteAtMs: 10_000,
            consumptionW: 2000,
            pvAcPowerW: 0,
            safety: safety({ liveTestPermit: false }),
        }));
        strict_1.default.equal(sameWIdle.shouldWrite, false);
        strict_1.default.equal(sameWIdle.keepaliveDue, false);
        strict_1.default.equal(sameWIdle.ownsSetpointNext, true);
        const keepalive = (0, grid_balance_power_js_1.evaluateGridBalanceTick)(tick({
            nowMs: 18_000,
            liveTest: consumed,
            ownsSetpoint: true,
            lastWrittenW: first.writePowerW,
            lastWriteAtMs: 10_000,
            consumptionW: 2000,
            pvAcPowerW: 0,
            safety: safety({ liveTestPermit: false }),
        }));
        strict_1.default.equal(keepalive.shouldWrite, true);
        strict_1.default.equal(keepalive.lastAction, "keepalive");
        strict_1.default.equal(keepalive.forceWrite, true);
        strict_1.default.equal(keepalive.writePowerW, first.writePowerW);
        const release = (0, grid_balance_power_js_1.evaluateGridBalanceTick)(tick({
            liveTest: consumed,
            ownsSetpoint: true,
            lastWrittenW: first.writePowerW,
            consumptionW: 100,
            pvAcPowerW: 100,
            offsetW: 0,
            safety: safety({ liveTestPermit: false }),
        }));
        strict_1.default.equal(release.shouldWrite, false);
        strict_1.default.equal(release.shouldRelease, true);
        strict_1.default.equal(release.writePowerW, 0);
        strict_1.default.equal(release.writeKind, "discharge");
        strict_1.default.equal(release.ownsSetpointNext, false);
        strict_1.default.equal((0, grid_balance_power_js_1.gridBalanceSessionReleasePermit)({
            ownsSetpoint: true,
            holdDetected: false,
            authority: "grid_balance",
            globalLive: true,
            addonLive: true,
            faultActive: false,
            lockoutActive: false,
            restoreInProgress: false,
        }), true);
    });
    (0, node_test_1.it)("Live→Dryrun with GB ownership: 0-release still allowed", () => {
        strict_1.default.equal((0, grid_balance_power_js_1.gridBalanceSessionReleasePermit)({
            ownsSetpoint: true,
            holdDetected: false,
            authority: "safety",
            blockReason: "global_dryrun",
            globalLive: false,
            addonLive: true,
            faultActive: false,
            lockoutActive: false,
            restoreInProgress: false,
            leavingLiveWithOwnership: true,
        }), true);
        const d = (0, grid_balance_power_js_1.evaluateGridBalanceTick)(tick({
            ownsSetpoint: true,
            lastWrittenW: 800,
            leavingLiveWithOwnership: true,
            safety: safety({ globalLive: false, liveTestPermit: false }),
        }));
        strict_1.default.equal(d.shouldRelease, true);
        strict_1.default.equal(d.writePowerW, 0);
        strict_1.default.equal(d.ownsSetpointNext, false);
    });
    (0, node_test_1.it)("Live→Dryrun + Hold: GB endet mit discharge=0", () => {
        const d = (0, grid_balance_power_js_1.evaluateGridBalanceTick)(tick({
            ownsSetpoint: true,
            lastWrittenW: 800,
            leavingLiveWithOwnership: true,
            safety: safety({ globalLive: false, holdActive: true, liveTestPermit: false }),
        }));
        strict_1.default.equal(d.shouldRelease, true);
        strict_1.default.equal(d.writePowerW, 0);
        strict_1.default.equal(d.shouldWrite, false);
        strict_1.default.equal(d.ownsSetpointNext, false);
    });
    (0, node_test_1.it)("one-shot session: Hold/External/Planned end GB with discharge=0 before mode switch", () => {
        const consumed = consumedLiveTest();
        const hold = (0, grid_balance_power_js_1.evaluateGridBalanceTick)(tick({
            liveTest: consumed,
            ownsSetpoint: true,
            lastWrittenW: 800,
            safety: safety({ holdActive: true, liveTestPermit: false }),
        }));
        strict_1.default.equal(hold.shouldRelease, true);
        strict_1.default.equal(hold.writePowerW, 0);
        strict_1.default.equal(hold.shouldWrite, false);
        strict_1.default.equal(hold.ownsSetpointNext, false);
        const ext = (0, grid_balance_power_js_1.evaluateGridBalanceTick)(tick({
            liveTest: consumed,
            ownsSetpoint: true,
            lastWrittenW: 800,
            safety: safety({ externalEvAuthority: true, evConflictKind: "ev_external", liveTestPermit: false }),
        }));
        strict_1.default.equal(ext.shouldRelease, true);
        strict_1.default.equal(ext.writePowerW, 0);
        strict_1.default.equal(ext.ownsSetpointNext, false);
        const planned = (0, grid_balance_power_js_1.evaluateGridBalanceTick)(tick({
            liveTest: consumed,
            ownsSetpoint: true,
            lastWrittenW: 800,
            safety: safety({ plannedBatteryAction: true, liveTestPermit: false }),
        }));
        strict_1.default.equal(planned.shouldRelease, true);
        strict_1.default.equal(planned.writePowerW, 0);
        strict_1.default.equal(planned.ownsSetpointNext, false);
        strict_1.default.equal(planned.authority, "planned_battery");
    });
    (0, node_test_1.it)("one-shot pulse arms in-memory only on ack:false", () => {
        const armed = (0, grid_balance_power_js_1.applyGridBalanceLiveTestPulse)((0, grid_balance_power_js_1.emptyGridBalanceLiveTest)(), true, false, 5);
        strict_1.default.equal(armed.armed, true);
        const ignored = (0, grid_balance_power_js_1.applyGridBalanceLiveTestPulse)((0, grid_balance_power_js_1.emptyGridBalanceLiveTest)(), true, true, 5);
        strict_1.default.equal(ignored.armed, false);
    });
});
(0, node_test_1.describe)("grid balance Mode-2 discharge contract v0.1.289", () => {
    (0, node_test_1.it)("writes only discharge, never charge, never Mode 1", () => {
        const d = (0, grid_balance_power_js_1.evaluateGridBalanceTick)(tick({ consumptionW: 188, pvAcPowerW: 140, offsetW: 0 }));
        strict_1.default.equal(d.writeKind, "discharge");
        strict_1.default.equal(d.shouldWrite, true);
        strict_1.default.equal(d.mode2Confirmed, true);
        const powerSrc = (0, node_fs_1.readFileSync)((0, node_path_1.join)(SRC, "grid_balance_power.ts"), "utf8");
        const idx = (0, node_fs_1.readFileSync)((0, node_path_1.join)(SRC, "index.ts"), "utf8");
        strict_1.default.equal(/writeKind: "charge"/.test(powerSrc), false);
        strict_1.default.match(idx, /kind: "discharge_power"/);
        strict_1.default.match(idx, /table\.set_discharge_power\.targetState/);
        strict_1.default.equal(/const gbState = table\.set_charge_power/.test(idx), false);
        strict_1.default.equal(/gridBalanceStabilization|minDurationMs|emptyStabilization/.test(idx), false);
        strict_1.default.equal(/GRID_BALANCE_KEEPALIVE_MAX_MS/.test(idx), true);
    });
    (0, node_test_1.it)("48 W Restnetzbezug → erster discharge-Write 48 W", () => {
        const d = (0, grid_balance_power_js_1.evaluateGridBalanceTick)(tick({ consumptionW: 188, pvAcPowerW: 140, offsetW: 0, minChangeW: 50, ownsSetpoint: false, lastWrittenW: null }));
        strict_1.default.equal(d.rawGridDeltaW, 48);
        strict_1.default.equal(d.requestedPowerW, 48);
        strict_1.default.equal(d.shouldWrite, true);
        strict_1.default.equal(d.writePowerW, 48);
        strict_1.default.equal(d.forceWrite, true);
        strict_1.default.equal(d.lastAction, "written");
        strict_1.default.match(d.explain, /discharge=48W/);
    });
    (0, node_test_1.it)("20 W Restnetzbezug → grundsätzlich möglich", () => {
        const d = (0, grid_balance_power_js_1.evaluateGridBalanceTick)(tick({ consumptionW: 160, pvAcPowerW: 140, offsetW: 0, minChangeW: 50 }));
        strict_1.default.equal(d.rawGridDeltaW, 20);
        strict_1.default.equal(d.requestedPowerW, 20);
        strict_1.default.equal(d.shouldWrite, true);
        strict_1.default.equal(d.writePowerW, 20);
    });
    (0, node_test_1.it)("erster kleiner Sollwert wird nicht von Write-Hysterese blockiert", () => {
        const d = (0, grid_balance_power_js_1.evaluateGridBalanceTick)(tick({
            consumptionW: 188,
            pvAcPowerW: 140,
            offsetW: 0,
            minChangeW: 50,
            ownsSetpoint: false,
            lastWrittenW: null,
        }));
        strict_1.default.equal(d.shouldWrite, true);
        strict_1.default.equal(d.writePowerW, 48);
    });
    (0, node_test_1.it)("Write-Hysterese filtert nur Änderungen eines aktiven Setpoints", () => {
        const d = (0, grid_balance_power_js_1.evaluateGridBalanceTick)(tick({
            nowMs: 10_000,
            consumptionW: 165,
            pvAcPowerW: 0,
            offsetW: 0,
            minChangeW: 50,
            ownsSetpoint: true,
            lastWrittenW: 150,
            lastWriteAtMs: 10_000,
        }));
        strict_1.default.equal(d.requestedPowerW, 165);
        strict_1.default.equal(d.shouldWrite, false);
        strict_1.default.equal(d.effectivePowerW, 150);
    });
    (0, node_test_1.it)("Keepalive desselben Setpoints wird nicht von Hysterese blockiert", () => {
        const d = (0, grid_balance_power_js_1.evaluateGridBalanceTick)(tick({
            nowMs: 18_000,
            consumptionW: 150,
            pvAcPowerW: 0,
            offsetW: 0,
            minChangeW: 50,
            ownsSetpoint: true,
            lastWrittenW: 150,
            lastWriteAtMs: 10_000,
        }));
        strict_1.default.equal(d.keepaliveDue, true);
        strict_1.default.equal(d.shouldWrite, true);
        strict_1.default.equal(d.forceWrite, true);
        strict_1.default.equal(d.writePowerW, 150);
        strict_1.default.equal(d.lastAction, "keepalive");
        strict_1.default.equal(grid_balance_power_js_1.GRID_BALANCE_KEEPALIVE_MAX_MS, 8000);
    });
    (0, node_test_1.it)("Mode 2 nicht bestätigt → kein discharge", () => {
        const d = (0, grid_balance_power_js_1.evaluateGridBalanceTick)(tick({ mode2Confirmed: false, consumptionW: 2000, pvAcPowerW: 0 }));
        strict_1.default.equal(d.shouldWrite, false);
        strict_1.default.equal(d.blockReason, "mode_not_self_consumption");
    });
    (0, node_test_1.it)("Haus 200 W / PV 0 → Entladeziel 200 W (nicht 30 W Smartmeter-Rest)", () => {
        const d = (0, grid_balance_power_js_1.evaluateGridBalanceTick)(tick({ consumptionW: 200, pvAcPowerW: 0, offsetW: 0 }));
        strict_1.default.equal(d.rawGridDeltaW, 200);
        strict_1.default.equal(d.requestedPowerW, 200);
        strict_1.default.equal(d.shouldWrite, true);
        strict_1.default.equal(d.writePowerW, 200);
        strict_1.default.equal(d.writeKind, "discharge");
    });
    (0, node_test_1.it)("Restore/Fault: kein GB-0 gegen Safety", () => {
        strict_1.default.equal((0, grid_balance_power_js_1.gridBalanceCleanupAllowed)({
            ownsSetpoint: true,
            holdDetected: false,
            authority: "safety",
            blockReason: "restore_in_progress",
        }), false);
        strict_1.default.equal((0, grid_balance_power_js_1.gridBalanceCleanupAllowed)({
            ownsSetpoint: true,
            holdDetected: false,
            authority: "safety",
            blockReason: "fault_lockout",
        }), false);
    });
    (0, node_test_1.it)("power module has no 8 s stabilization", () => {
        const src = (0, node_fs_1.readFileSync)((0, node_path_1.join)(SRC, "grid_balance_power.ts"), "utf8");
        strict_1.default.equal(/not_stable|stepStabilization|emptyStabilization|minDurationMs/.test(src), false);
        strict_1.default.equal(/GRID_BALANCE_MIN_DURATION/.test(src), false);
    });
});
