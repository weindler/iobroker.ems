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
        priceNowCt: 22,
        priceLimitCt: 30,
        priceGateEnabled: true,
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
        minDurationMs: 0,
        offsetW: 25,
        configuredMaxW: 5000,
        hardwareMaxChargeW: 3300,
        hardwareMaxDischargeW: 3300,
        minChangeW: 50,
        lastWrittenW: null,
        ownsSetpoint: false,
        stabilization: (0, grid_balance_power_js_1.emptyStabilization)(),
        liveTest: { ...(0, grid_balance_power_js_1.emptyGridBalanceLiveTest)(), armed: true },
        controllerIsGridBalance: true,
        forecastBlockReason: "",
        ...over,
    };
}
(0, node_test_1.describe)("grid balance live hardening v0.1.284", () => {
    (0, node_test_1.it)("L1: Admin disabled → kein Write", () => {
        const d = (0, grid_balance_power_js_1.evaluateGridBalanceTick)(tick({ safety: safety({ adminEnabled: false, liveTestPermit: true }) }));
        strict_1.default.equal(d.shouldWrite, false);
        strict_1.default.equal(d.blockReason, "disabled");
    });
    (0, node_test_1.it)("L2: Preis > limit → block, kein Median-Bypass", () => {
        const d = (0, grid_balance_power_js_1.evaluateGridBalanceTick)(tick({ safety: safety({ priceNowCt: 42, priceLimitCt: 30 }) }));
        strict_1.default.equal(d.shouldWrite, false);
        strict_1.default.equal(d.priceAllowed, false);
        strict_1.default.equal(d.blockReason, "price_above_limit");
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
    (0, node_test_1.it)("L11: Deadband nicht überschritten → kein Write", () => {
        const d = (0, grid_balance_power_js_1.evaluateGridBalanceTick)(tick({ consumptionW: 200, pvAcPowerW: 0, deadbandW: 250 }));
        strict_1.default.equal(d.blockReason, "inside_deadband");
        strict_1.default.equal(d.shouldWrite, false);
        strict_1.default.equal(d.requestedPowerW, 0);
    });
    (0, node_test_1.it)("L12: Deadband überschritten, Stabilisierung fehlt → kein Write", () => {
        const d = (0, grid_balance_power_js_1.evaluateGridBalanceTick)(tick({
            nowMs: 1000,
            minDurationMs: 8000,
            stabilization: (0, grid_balance_power_js_1.emptyStabilization)(),
            consumptionW: 2000,
            pvAcPowerW: 0,
        }));
        strict_1.default.equal(d.blockReason, "not_stable");
        strict_1.default.equal(d.shouldWrite, false);
        strict_1.default.ok(d.stabilizationNext.excessSinceMs === 1000);
    });
    (0, node_test_1.it)("L13: Stabilisierung erfüllt → eligible", () => {
        const d = (0, grid_balance_power_js_1.evaluateGridBalanceTick)(tick({
            nowMs: 10_000,
            minDurationMs: 8000,
            stabilization: { excessSinceMs: 1000 },
            consumptionW: 2000,
            pvAcPowerW: 0,
        }));
        strict_1.default.equal(d.blockReason, "");
        strict_1.default.equal(d.ready, true);
        strict_1.default.equal(d.shouldWrite, true);
    });
    (0, node_test_1.it)("L14: Maxleistung clamp auf Hardware", () => {
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
    });
    (0, node_test_1.it)("L15: GB Ownership entsteht nur nach eigenem Write", () => {
        const idle = (0, grid_balance_power_js_1.evaluateGridBalanceTick)(tick({ ownsSetpoint: false, consumptionW: 100, pvAcPowerW: 0 }));
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
    (0, node_test_1.it)("L17: Exit mit Ownership → Release nur wenn erlaubt", () => {
        const ok = (0, grid_balance_power_js_1.evaluateGridBalanceTick)(tick({
            ownsSetpoint: true,
            safety: safety({ adminEnabled: false, liveTestPermit: true }),
        }));
        strict_1.default.equal(ok.shouldRelease, true);
        strict_1.default.equal(ok.writePowerW, 0);
        strict_1.default.equal(ok.ownsSetpointNext, false);
    });
    (0, node_test_1.it)("L18: Hold während GB aktiv → keine konkurrierenden Writes", () => {
        const d = (0, grid_balance_power_js_1.evaluateGridBalanceTick)(tick({
            ownsSetpoint: true,
            safety: safety({ holdActive: true, liveTestPermit: true }),
        }));
        strict_1.default.equal(d.shouldWrite, false);
        strict_1.default.equal(d.shouldRelease, false);
        strict_1.default.equal(d.blockReason, "battery_hold");
        strict_1.default.equal((0, grid_balance_power_js_1.gridBalanceCleanupAllowed)({ ownsSetpoint: true, holdDetected: true, authority: "battery_hold" }), false);
    });
    (0, node_test_1.it)("L19: External übernimmt → kein Cleanup gegen External", () => {
        const d = (0, grid_balance_power_js_1.evaluateGridBalanceTick)(tick({
            ownsSetpoint: true,
            safety: safety({ externalEvAuthority: true, evConflictKind: "ev_external" }),
        }));
        strict_1.default.equal(d.shouldRelease, false);
        strict_1.default.equal(d.authority, "external_ev");
    });
    (0, node_test_1.it)("L20: kein EVCC/go-e/Ford/Tibber-Direktwrite", () => {
        const src = (0, node_fs_1.readFileSync)((0, node_path_1.join)(SRC, "grid_balance_power.ts"), "utf8");
        strict_1.default.equal(/setForeignStateAsync/.test(src), false);
        strict_1.default.equal(/go-e\.|fordpass\.|tibber\.|evcc\./.test(src), false);
    });
    (0, node_test_1.it)("L21: 30-ct-Limit nicht umgehbar", () => {
        const d = (0, grid_balance_power_js_1.evaluateGridBalanceTick)(tick({ safety: safety({ priceNowCt: 30.1, priceLimitCt: 30 }) }));
        strict_1.default.equal(d.blockReason, "price_above_limit");
        strict_1.default.equal((0, config_js_1.batteryConfigFromAdapter)({}).gridBalance.maxPriceCtPerKwh, 30);
    });
    (0, node_test_1.it)("L22: Mirror/Admin-Gate konsistent — nur Admin zählt", () => {
        const r = (0, grid_balance_contract_js_1.evaluateGridBalanceSafety)(safety({ adminEnabled: true, emsMirrorEnabled: false, liveTestPermit: true }));
        strict_1.default.equal(r.blockReason, "");
        strict_1.default.equal(r.policyAllowed, true);
        const cfg = (0, config_js_1.batteryConfigFromAdapter)({ bat_feature_grid_balance_enabled: true });
        strict_1.default.equal(cfg.gridBalance.enabled, true);
        strict_1.default.equal(cfg.gridBalance.deadbandW, grid_balance_power_js_1.GRID_BALANCE_DEADBAND_DEFAULT_W);
        strict_1.default.equal(cfg.gridBalance.minDurationSec, grid_balance_power_js_1.GRID_BALANCE_MIN_DURATION_DEFAULT_S);
    });
    (0, node_test_1.it)("L23: 0,8-kWh-Mikroregelung liegt im Deadband", () => {
        const d = (0, grid_balance_power_js_1.evaluateGridBalanceTick)(tick({ consumptionW: 80, pvAcPowerW: 0, deadbandW: 250 }));
        strict_1.default.equal(d.shouldWrite, false);
        strict_1.default.equal(d.blockReason, "inside_deadband");
        strict_1.default.equal(80 * 24 / 1000 < 2, true);
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
    (0, node_test_1.it)("execution stays locked without one-shot", () => {
        strict_1.default.equal(grid_balance_contract_js_1.GRID_BALANCE_EXECUTION_ENABLED, false);
        const locked = (0, grid_balance_power_js_1.evaluateGridBalanceTick)(tick({ liveTest: (0, grid_balance_power_js_1.emptyGridBalanceLiveTest)(), safety: safety({ liveTestPermit: false }) }));
        strict_1.default.equal(locked.shouldWrite, false);
        strict_1.default.equal(locked.lastAction, "diagnosis_only");
    });
    (0, node_test_1.it)("one-shot session: second setpoint blocked after consume, 0-release still allowed", () => {
        const armed = (0, grid_balance_power_js_1.applyGridBalanceLiveTestPulse)((0, grid_balance_power_js_1.emptyGridBalanceLiveTest)(), true, false, 1);
        strict_1.default.equal((0, grid_balance_power_js_1.gridBalanceSetpointPermit)(armed), true);
        const first = (0, grid_balance_power_js_1.evaluateGridBalanceTick)(tick({ liveTest: armed, consumptionW: 2000, pvAcPowerW: 0 }));
        strict_1.default.equal(first.shouldWrite, true);
        strict_1.default.equal(first.shouldRelease, false);
        strict_1.default.equal(first.ownsSetpointNext, true);
        const consumed = (0, grid_balance_power_js_1.consumeGridBalanceLiveTest)(armed, 2);
        strict_1.default.equal((0, grid_balance_power_js_1.gridBalanceSetpointPermit)(consumed), false);
        strict_1.default.equal(consumed.consumed, true);
        const second = (0, grid_balance_power_js_1.evaluateGridBalanceTick)(tick({
            liveTest: consumed,
            ownsSetpoint: true,
            lastWrittenW: first.writePowerW,
            consumptionW: 2000,
            pvAcPowerW: 0,
            safety: safety({ liveTestPermit: false }),
        }));
        strict_1.default.equal(second.shouldWrite, false);
        strict_1.default.equal(second.shouldRelease, false);
        strict_1.default.equal(second.ownsSetpointNext, true);
        const release = (0, grid_balance_power_js_1.evaluateGridBalanceTick)(tick({
            liveTest: consumed,
            ownsSetpoint: true,
            lastWrittenW: first.writePowerW,
            consumptionW: 100,
            pvAcPowerW: 0,
            safety: safety({ liveTestPermit: false }),
        }));
        strict_1.default.equal(release.shouldWrite, false);
        strict_1.default.equal(release.shouldRelease, true);
        strict_1.default.equal(release.writePowerW, 0);
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
    (0, node_test_1.it)("Live→Dryrun + Hold: no competing 0-write", () => {
        const d = (0, grid_balance_power_js_1.evaluateGridBalanceTick)(tick({
            ownsSetpoint: true,
            lastWrittenW: 800,
            leavingLiveWithOwnership: true,
            safety: safety({ globalLive: false, holdActive: true, liveTestPermit: false }),
        }));
        strict_1.default.equal(d.shouldRelease, false);
        strict_1.default.equal(d.shouldWrite, false);
        strict_1.default.equal(d.ownsSetpointNext, false);
    });
    (0, node_test_1.it)("one-shot session: Hold/External/Planned drop ownership without 0-write", () => {
        const consumed = consumedLiveTest();
        const hold = (0, grid_balance_power_js_1.evaluateGridBalanceTick)(tick({
            liveTest: consumed,
            ownsSetpoint: true,
            lastWrittenW: 800,
            safety: safety({ holdActive: true, liveTestPermit: false }),
        }));
        strict_1.default.equal(hold.shouldRelease, false);
        strict_1.default.equal(hold.shouldWrite, false);
        strict_1.default.equal(hold.ownsSetpointNext, false);
        const ext = (0, grid_balance_power_js_1.evaluateGridBalanceTick)(tick({
            liveTest: consumed,
            ownsSetpoint: true,
            lastWrittenW: 800,
            safety: safety({ externalEvAuthority: true, evConflictKind: "ev_external", liveTestPermit: false }),
        }));
        strict_1.default.equal(ext.shouldRelease, false);
        strict_1.default.equal(ext.ownsSetpointNext, false);
        const planned = (0, grid_balance_power_js_1.evaluateGridBalanceTick)(tick({
            liveTest: consumed,
            ownsSetpoint: true,
            lastWrittenW: 800,
            safety: safety({ plannedBatteryAction: true, liveTestPermit: false }),
        }));
        strict_1.default.equal(planned.shouldRelease, false);
        strict_1.default.equal(planned.ownsSetpointNext, false);
        strict_1.default.equal(planned.authority, "planned_battery");
    });
    (0, node_test_1.it)("one-shot pulse arms in-memory only on ack:false", () => {
        const armed = (0, grid_balance_power_js_1.applyGridBalanceLiveTestPulse)((0, grid_balance_power_js_1.emptyGridBalanceLiveTest)(), true, false, 5);
        strict_1.default.equal(armed.armed, true);
        const ignored = (0, grid_balance_power_js_1.applyGridBalanceLiveTestPulse)((0, grid_balance_power_js_1.emptyGridBalanceLiveTest)(), true, true, 5);
        strict_1.default.equal(ignored.armed, false);
    });
    (0, node_test_1.it)("stabilization resets when load drops into deadband", () => {
        const s = (0, grid_balance_power_js_1.stepStabilization)({ excessSinceMs: 1000 }, 5000, false, 8000);
        strict_1.default.equal(s.next.excessSinceMs, null);
        strict_1.default.equal(s.stable, false);
    });
});
