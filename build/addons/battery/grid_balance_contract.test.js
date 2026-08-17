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
const grid_balance_contract_js_1 = require("./grid_balance_contract.js");
const SRC = (0, node_path_1.join)(__dirname, "..", "..", "..", "src", "addons", "battery");
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
        priceNowCt: 22,
        priceLimitCt: 30,
        priceGateEnabled: true,
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
    });
    (0, node_test_1.it)("L2: Admin switch is activatable", () => {
        const c = (0, config_js_1.batteryConfigFromAdapter)({ bat_feature_grid_balance_enabled: true });
        strict_1.default.equal(c.gridBalance.enabled, true);
    });
    (0, node_test_1.it)("L3: price limit default = 30 ct/kWh", () => {
        const c = (0, config_js_1.batteryConfigFromAdapter)({});
        strict_1.default.equal(c.gridBalance.maxPriceCtPerKwh, grid_balance_contract_js_1.GRID_BALANCE_MAX_PRICE_DEFAULT_CT);
        strict_1.default.equal(grid_balance_contract_js_1.GRID_BALANCE_MAX_PRICE_DEFAULT_CT, 30);
    });
    (0, node_test_1.it)("L4: price limit is configurable", () => {
        const c = (0, config_js_1.batteryConfigFromAdapter)({ bat_grid_balance_max_price_ct_per_kwh: 18.5 });
        strict_1.default.equal(c.gridBalance.maxPriceCtPerKwh, 18.5);
    });
    (0, node_test_1.it)("L5: negative/invalid price values are rejected", () => {
        strict_1.default.equal((0, grid_balance_contract_js_1.parseGridBalanceMaxPriceCt)(-5), 30);
        strict_1.default.equal((0, grid_balance_contract_js_1.parseGridBalanceMaxPriceCt)(Number.NaN), 30);
        strict_1.default.equal((0, grid_balance_contract_js_1.parseGridBalanceMaxPriceCt)("abc"), 30);
        strict_1.default.equal((0, grid_balance_contract_js_1.parseGridBalanceMaxPriceCt)(""), 30);
        strict_1.default.equal((0, grid_balance_contract_js_1.parseGridBalanceMaxPriceCt)(null), 30);
        strict_1.default.equal((0, config_js_1.batteryConfigFromAdapter)({ bat_grid_balance_max_price_ct_per_kwh: -10 }).gridBalance.maxPriceCtPerKwh, 30);
    });
    (0, node_test_1.it)("L6: price > limit → blocked", () => {
        const r = (0, grid_balance_contract_js_1.evaluateGridBalanceSafety)(baseSafety({ priceNowCt: 42.1, priceLimitCt: 30 }));
        strict_1.default.equal(r.policyAllowed, false);
        strict_1.default.equal(r.priceAllowed, false);
        strict_1.default.equal(r.blockReason, "price_above_limit");
        strict_1.default.equal(r.explain, "grid_balance=blocked, price=42.1ct, limit=30.0ct");
        strict_1.default.equal(r.writeAllowed, false);
    });
    (0, node_test_1.it)("L7: price <= limit → price allowed", () => {
        const r = (0, grid_balance_contract_js_1.evaluateGridBalanceSafety)(baseSafety({ priceNowCt: 30, priceLimitCt: 30 }));
        strict_1.default.equal(r.priceAllowed, true);
        strict_1.default.equal(r.policyAllowed, true);
        strict_1.default.equal(r.blockReason, "");
    });
    (0, node_test_1.it)("L8: hold planned → blocked", () => {
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
    (0, node_test_1.it)("L10: external EV authority → blocked", () => {
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
    (0, node_test_1.it)("L12: planned battery action has priority", () => {
        const r = (0, grid_balance_contract_js_1.evaluateGridBalanceSafety)(baseSafety({ plannedBatteryAction: true }));
        strict_1.default.equal(r.blockReason, "planned_battery_action");
        strict_1.default.equal(r.authority, "planned_battery");
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
    (0, node_test_1.it)("absolute max price cannot be bypassed by median", () => {
        const r = (0, grid_balance_js_1.evaluateGridBalancePriceGate)({
            gate: { enabled: true, maxPriceCtPerKwh: 30, medianFactor: 1.05 },
            priceNowCt: 42,
            referenceMedianCt: 50,
        });
        strict_1.default.equal(r.passed, false);
    });
    (0, node_test_1.it)("explain ready includes grid import", () => {
        strict_1.default.equal((0, grid_balance_contract_js_1.formatGridBalanceExplain)({
            enabled: true,
            blockReason: "",
            priceNowCt: 22,
            priceLimitCt: 30,
            gridImportW: 850,
        }), "grid_balance=ready, grid_import=850W");
    });
});
