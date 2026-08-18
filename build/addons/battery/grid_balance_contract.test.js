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
const grid_balance_js_1 = require("./grid_balance.js");
const write_allowlist_js_1 = require("../wallbox/ev_foundation/write_allowlist.js");
const grid_balance_contract_js_1 = require("./grid_balance_contract.js");
const SRC = (0, node_path_1.join)(__dirname, "..", "..", "..", "src", "addons", "battery");
const ADMIN_JSON = (0, node_path_1.join)(__dirname, "..", "..", "..", "admin", "jsonConfig.json");
function baseSafety(over = {}) {
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
        ...over,
    };
}
(0, node_test_1.describe)("grid balance safety contract v0.1.284", () => {
    (0, node_test_1.it)("L1: Netzausgleich default = aus", () => {
        const c = (0, config_js_1.batteryConfigFromAdapter)({});
        strict_1.default.equal(c.gridBalance.enabled, false);
        strict_1.default.equal(grid_balance_contract_js_1.GRID_BALANCE_EXECUTION_ENABLED, false);
        strict_1.default.equal(write_allowlist_js_1.EV_EXECUTION_PHASE5_ENABLED, false);
    });
    (0, node_test_1.it)("L2: Admin switch is activatable", () => {
        const c = (0, config_js_1.batteryConfigFromAdapter)({ bat_feature_grid_balance_enabled: true });
        strict_1.default.equal(c.gridBalance.enabled, true);
    });
    (0, node_test_1.it)("L3: min price default = 30 ct/kWh", () => {
        const c = (0, config_js_1.batteryConfigFromAdapter)({});
        strict_1.default.equal(c.gridBalance.minPriceCtPerKwh, grid_balance_contract_js_1.GRID_BALANCE_MIN_PRICE_DEFAULT_CT);
        strict_1.default.equal(grid_balance_contract_js_1.GRID_BALANCE_MIN_PRICE_DEFAULT_CT, 30);
    });
    (0, node_test_1.it)("L4: min price is configurable", () => {
        const c = (0, config_js_1.batteryConfigFromAdapter)({ bat_grid_balance_min_price_ct_per_kwh: 18.5 });
        strict_1.default.equal(c.gridBalance.minPriceCtPerKwh, 18.5);
    });
    (0, node_test_1.it)("L5: negative/invalid price values are rejected", () => {
        strict_1.default.equal((0, grid_balance_contract_js_1.parseGridBalanceMinPriceCt)(-5), 30);
        strict_1.default.equal((0, grid_balance_contract_js_1.parseGridBalanceMinPriceCt)(Number.NaN), 30);
        strict_1.default.equal((0, grid_balance_contract_js_1.parseGridBalanceMinPriceCt)("abc"), 30);
        strict_1.default.equal((0, grid_balance_contract_js_1.parseGridBalanceMinPriceCt)(""), 30);
        strict_1.default.equal((0, grid_balance_contract_js_1.parseGridBalanceMinPriceCt)(null), 30);
        strict_1.default.equal((0, config_js_1.batteryConfigFromAdapter)({ bat_grid_balance_min_price_ct_per_kwh: -10 }).gridBalance.minPriceCtPerKwh, 30);
    });
    (0, node_test_1.it)("20 ct → price_allowed=false", () => {
        const r = (0, grid_balance_contract_js_1.evaluateGridBalanceSafety)(baseSafety({ priceNowCt: 20, priceMinCt: 30 }));
        strict_1.default.equal(r.priceAllowed, false);
        strict_1.default.equal(r.policyAllowed, false);
        strict_1.default.equal(r.blockReason, "price_below_minimum");
        strict_1.default.equal(r.explain, "grid_balance=blocked, reason=price_below_minimum");
        strict_1.default.equal(r.writeAllowed, false);
    });
    (0, node_test_1.it)("29.99 ct → price_allowed=false", () => {
        const r = (0, grid_balance_contract_js_1.evaluateGridBalanceSafety)(baseSafety({ priceNowCt: 29.99, priceMinCt: 30 }));
        strict_1.default.equal(r.priceAllowed, false);
        strict_1.default.equal(r.blockReason, "price_below_minimum");
    });
    (0, node_test_1.it)("30.0 ct → price_allowed=true", () => {
        const r = (0, grid_balance_contract_js_1.evaluateGridBalanceSafety)(baseSafety({ priceNowCt: 30, priceMinCt: 30 }));
        strict_1.default.equal(r.priceAllowed, true);
        strict_1.default.equal(r.policyAllowed, true);
        strict_1.default.equal(r.blockReason, "");
    });
    (0, node_test_1.it)("36.7 ct → price_allowed=true", () => {
        const r = (0, grid_balance_contract_js_1.evaluateGridBalanceSafety)(baseSafety({ priceNowCt: 36.7, priceMinCt: 30 }));
        strict_1.default.equal(r.priceAllowed, true);
        strict_1.default.equal(r.policyAllowed, true);
        strict_1.default.match(r.explain, /grid_balance=ready, price=36\.7ct, minimum=30\.0ct/);
    });
    (0, node_test_1.it)("50 ct → price_allowed=true", () => {
        const r = (0, grid_balance_contract_js_1.evaluateGridBalanceSafety)(baseSafety({ priceNowCt: 50, priceMinCt: 30 }));
        strict_1.default.equal(r.priceAllowed, true);
        strict_1.default.equal(r.blockReason, "");
    });
    (0, node_test_1.it)("legacy max-price key 30 migrates to min-price 30", () => {
        const c = (0, config_js_1.batteryConfigFromAdapter)({ bat_grid_balance_max_price_ct_per_kwh: 30 });
        strict_1.default.equal(c.gridBalance.minPriceCtPerKwh, 30);
    });
    (0, node_test_1.it)("new min-price key wins over legacy max-price key", () => {
        const c = (0, config_js_1.batteryConfigFromAdapter)({
            bat_grid_balance_max_price_ct_per_kwh: 18,
            bat_grid_balance_min_price_ct_per_kwh: 40,
        });
        strict_1.default.equal(c.gridBalance.minPriceCtPerKwh, 40);
    });
    (0, node_test_1.it)("L8: hold planned → blocked even at 50 ct", () => {
        const r = (0, grid_balance_contract_js_1.evaluateGridBalanceSafety)(baseSafety({ holdPlanned: true }));
        strict_1.default.equal(r.policyAllowed, false);
        strict_1.default.equal(r.holdDetected, true);
        strict_1.default.equal(r.blockReason, "battery_hold");
        strict_1.default.equal(r.authority, "battery_hold");
    });
    (0, node_test_1.it)("L9: hold active → blocked", () => {
        const r = (0, grid_balance_contract_js_1.evaluateGridBalanceSafety)(baseSafety({ holdActive: true }));
        strict_1.default.equal(r.blockReason, "battery_hold");
        strict_1.default.equal(r.holdDetected, true);
        strict_1.default.equal((0, grid_balance_contract_js_1.evaluateGridBalanceSafety)(baseSafety({ evccBatteryModeHold: true })).blockReason, "battery_hold");
    });
    (0, node_test_1.it)("L10: external EV authority → blocked even at 50 ct", () => {
        const r = (0, grid_balance_contract_js_1.evaluateGridBalanceSafety)(baseSafety({ externalEvAuthority: true, evConflictKind: "ev_external" }));
        strict_1.default.equal(r.blockReason, "external_ev_authority");
        strict_1.default.equal(r.authority, "external_ev");
        strict_1.default.equal(r.explain, "grid_balance=blocked, reason=external_ev_authority");
    });
    (0, node_test_1.it)("L11: EV NOW / grid charge is not treated as house load", () => {
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
        strict_1.default.equal(now.conflict, true);
        strict_1.default.equal(now.kind, "ev_now");
        const r = (0, grid_balance_contract_js_1.evaluateGridBalanceSafety)(baseSafety({ evConflictKind: "ev_now" }));
        strict_1.default.equal(r.blockReason, "ev_now_grid_charge");
        strict_1.default.equal(r.evConflict, true);
        strict_1.default.equal(r.writeAllowed, false);
    });
    (0, node_test_1.it)("L11b: disconnected leftover now is not an EV conflict", () => {
        const leftover = (0, grid_balance_contract_js_1.classifyGridBalanceEvConflict)({
            loadpointMode: "now",
            charging: false,
            chargePowerW: 0,
            wallboxHold: true,
            batteryBoost: true,
            externalAuthority: false,
            tibberRewardsActive: false,
            wallboxEnergySource: "none",
            wallboxAllocatedGridW: 0,
            vehicleConnected: false,
        });
        strict_1.default.equal(leftover.conflict, false);
        strict_1.default.equal(leftover.kind, "");
    });
    (0, node_test_1.it)("L12: planned battery action has priority", () => {
        const r = (0, grid_balance_contract_js_1.evaluateGridBalanceSafety)(baseSafety({ plannedBatteryAction: true }));
        strict_1.default.equal(r.blockReason, "planned_battery_action");
        strict_1.default.equal(r.authority, "planned_battery");
    });
    (0, node_test_1.it)("authoritative 0 W Daily Plan is not a competing battery action", () => {
        const r = (0, grid_balance_contract_js_1.evaluateGridBalanceSafety)(baseSafety({
            dailyPlanAuthoritative: true,
            plannedBatteryAction: false,
            ownershipActive: false,
            mode1Active: false,
        }));
        strict_1.default.equal((0, grid_balance_contract_js_1.isCompetingEmsBatteryAction)(baseSafety({ dailyPlanAuthoritative: true })), false);
        strict_1.default.equal(r.blockReason, "");
        strict_1.default.notEqual(r.blockReason, "planned_battery_action");
        strict_1.default.equal(r.holdDetected, false);
        strict_1.default.equal(r.evConflict, false);
        strict_1.default.equal(r.priceAllowed, true);
        strict_1.default.equal(r.policyAllowed, true);
    });
    (0, node_test_1.it)("real EMS ownership / charge setpoint still blocks as planned_battery_action", () => {
        strict_1.default.equal((0, grid_balance_contract_js_1.evaluateGridBalanceSafety)(baseSafety({ plannedBatteryAction: true, ownershipActive: true })).blockReason, "planned_battery_action");
        strict_1.default.equal((0, grid_balance_contract_js_1.evaluateGridBalanceSafety)(baseSafety({ ownershipActive: true })).blockReason, "planned_battery_action");
        strict_1.default.equal((0, grid_balance_contract_js_1.evaluateGridBalanceSafety)(baseSafety({ mode1Active: true })).blockReason, "planned_battery_action");
        strict_1.default.equal((0, grid_balance_contract_js_1.isCompetingEmsBatteryAction)(baseSafety({ plannedBatteryAction: true })), true);
        strict_1.default.equal((0, grid_balance_contract_js_1.isCompetingEmsBatteryAction)(baseSafety({ ownershipActive: true })), true);
    });
    (0, node_test_1.it)("L13: fault/restore has priority", () => {
        strict_1.default.equal((0, grid_balance_contract_js_1.evaluateGridBalanceSafety)(baseSafety({ restoreInProgress: true })).blockReason, "restore_in_progress");
        strict_1.default.equal((0, grid_balance_contract_js_1.evaluateGridBalanceSafety)(baseSafety({ faultActive: true })).blockReason, "fault_lockout");
        strict_1.default.equal((0, grid_balance_contract_js_1.evaluateGridBalanceSafety)(baseSafety({ restoreInProgress: true, holdActive: true })).authority, "safety");
    });
    (0, node_test_1.it)("L14: global dryrun → no productive writes", () => {
        const r = (0, grid_balance_contract_js_1.evaluateGridBalanceSafety)(baseSafety({ globalLive: false }));
        strict_1.default.equal(r.writeAllowed, false);
        strict_1.default.equal(r.blockReason, "global_dryrun");
    });
    (0, node_test_1.it)("L15: battery add-on dryrun → no productive writes", () => {
        const r = (0, grid_balance_contract_js_1.evaluateGridBalanceSafety)(baseSafety({ addonLive: false }));
        strict_1.default.equal(r.writeAllowed, false);
        strict_1.default.equal(r.blockReason, "addon_dryrun");
    });
    (0, node_test_1.it)("L16: disabled → no productive writes", () => {
        const r = (0, grid_balance_contract_js_1.evaluateGridBalanceSafety)(baseSafety({ adminEnabled: false }));
        strict_1.default.equal(r.writeAllowed, false);
        strict_1.default.equal(r.blockReason, "disabled");
        strict_1.default.equal(r.explain, "grid_balance=blocked, reason=disabled");
    });
    (0, node_test_1.it)("L17: no new direct EVCC / go-e / Ford / Tibber write", () => {
        const contractSrc = (0, node_fs_1.readFileSync)((0, node_path_1.join)(SRC, "grid_balance_contract.ts"), "utf8");
        const gbSrc = (0, node_fs_1.readFileSync)((0, node_path_1.join)(SRC, "grid_balance.ts"), "utf8");
        for (const src of [contractSrc, gbSrc]) {
            strict_1.default.equal(/setForeignStateAsync/.test(src), false);
            strict_1.default.equal(/go-e\.|fordpass\.|tibber\.|evcc\./.test(src), false);
        }
        strict_1.default.equal(grid_balance_contract_js_1.GRID_BALANCE_EXECUTION_ENABLED, false);
        strict_1.default.equal(write_allowlist_js_1.EV_EXECUTION_PHASE5_ENABLED, false);
    });
    (0, node_test_1.it)("L18: execution stays locked even when policy would allow", () => {
        const r = (0, grid_balance_contract_js_1.evaluateGridBalanceSafety)(baseSafety());
        strict_1.default.equal(r.policyAllowed, true);
        strict_1.default.equal(r.ready, true);
        strict_1.default.equal(r.writeAllowed, false);
        strict_1.default.equal(grid_balance_contract_js_1.GRID_BALANCE_EXECUTION_ENABLED, false);
        strict_1.default.match(r.explain, /grid_balance=ready/);
    });
    (0, node_test_1.it)("one-shot permit unlocks writes without Dauerbetrieb flag", () => {
        const r = (0, grid_balance_contract_js_1.evaluateGridBalanceSafety)(baseSafety({ liveTestPermit: true }));
        strict_1.default.equal(grid_balance_contract_js_1.GRID_BALANCE_EXECUTION_ENABLED, false);
        strict_1.default.equal(r.policyAllowed, true);
        strict_1.default.equal(r.writeAllowed, true);
    });
    (0, node_test_1.it)("admin switch is the only feature gate — mirror off does not block", () => {
        const r = (0, grid_balance_contract_js_1.evaluateGridBalanceSafety)(baseSafety({ adminEnabled: true, emsMirrorEnabled: false }));
        strict_1.default.equal(r.blockReason, "");
        strict_1.default.equal(r.policyAllowed, true);
    });
    (0, node_test_1.it)("no median / relative price gate in grid-balance contract", () => {
        const contractSrc = (0, node_fs_1.readFileSync)((0, node_path_1.join)(SRC, "grid_balance_contract.ts"), "utf8");
        const gbSrc = (0, node_fs_1.readFileSync)((0, node_path_1.join)(SRC, "grid_balance.ts"), "utf8");
        const cfgSrc = (0, node_fs_1.readFileSync)((0, node_path_1.join)(SRC, "config.ts"), "utf8");
        for (const src of [contractSrc, gbSrc, cfgSrc]) {
            strict_1.default.equal(/priceMedianFactor|medianFactor|Median×|price_median_factor/.test(src), false);
            strict_1.default.equal(/price_above_limit/.test(src), false);
            strict_1.default.equal(/bat_grid_balance_price_gate_enabled/.test(src), false);
        }
        const r = (0, grid_balance_js_1.evaluateGridBalanceMinPrice)({ minPriceCtPerKwh: 30, priceNowCt: 42 });
        strict_1.default.equal(r.passed, true);
    });
    (0, node_test_1.it)("explain active uses Mode-2 discharge, never charge", () => {
        strict_1.default.equal((0, grid_balance_contract_js_1.formatGridBalanceExplain)({
            enabled: true,
            blockReason: "",
            priceNowCt: 36.7,
            priceMinCt: 30,
            gridImportW: 48,
            active: true,
            mode2Confirmed: true,
            dischargeW: 48,
        }), "grid_balance=active, mode=2, discharge=48W");
        strict_1.default.equal((0, grid_balance_contract_js_1.formatGridBalanceExplain)({
            enabled: true,
            blockReason: "battery_hold",
            priceNowCt: 36.7,
            priceMinCt: 30,
            gridImportW: 48,
        }), "grid_balance=blocked, reason=battery_hold");
    });
    (0, node_test_1.it)("explain ready includes price, minimum and grid import", () => {
        strict_1.default.equal((0, grid_balance_contract_js_1.formatGridBalanceExplain)({
            enabled: true,
            blockReason: "",
            priceNowCt: 36.7,
            priceMinCt: 30,
            gridImportW: 850,
        }), "grid_balance=ready, price=36.7ct, minimum=30.0ct, grid_import=850W");
    });
    (0, node_test_1.it)("admin jsonConfig has min price and dropped price-gate/median fields", () => {
        const cfg = (0, node_fs_1.readFileSync)(ADMIN_JSON, "utf8");
        strict_1.default.equal(/bat_grid_balance_price_gate_enabled/.test(cfg), false);
        strict_1.default.equal(/bat_grid_balance_price_median_factor/.test(cfg), false);
        strict_1.default.equal(/Preisgate aktiv/.test(cfg), false);
        strict_1.default.equal(/Preis relativ/.test(cfg), false);
        strict_1.default.equal(/bat_grid_balance_max_price_ct_per_kwh/.test(cfg), false);
        strict_1.default.match(cfg, /bat_grid_balance_min_price_ct_per_kwh/);
        strict_1.default.match(cfg, /Mindeststrompreis für Netzausgleich/);
        strict_1.default.match(cfg, /bat_feature_grid_balance_enabled/);
        strict_1.default.match(cfg, /bat_offset_soc_threshold_pct/);
        strict_1.default.match(cfg, /bat_offset_high_soc_w/);
        strict_1.default.match(cfg, /bat_offset_low_soc_w/);
        strict_1.default.match(cfg, /bat_grid_balance_min_change_w/);
        strict_1.default.match(cfg, /bat_grid_balance_deadband_w/);
        strict_1.default.equal(/bat_grid_balance_min_duration_s/.test(cfg), false);
        strict_1.default.match(cfg, /bat_battery_discharging_target/);
        strict_1.default.match(cfg, /control\.discharge/);
        strict_1.default.match(cfg, /"bat_grid_balance_deadband_w"[\s\S]*?"default": 0/);
        strict_1.default.match(cfg, /bat_grid_balance_max_w/);
        strict_1.default.match(cfg, /bat_grid_balance_update_interval_sec/);
    });
});
