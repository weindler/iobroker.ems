"use strict";
/**
 * Grid-balance safety contract (v0.1.286).
 *
 * Price rule: current_price_ct_kwh >= configured_min_price_ct_kwh.
 * No median / relative factor, no second price-gate switch.
 *
 * Existing path (do not replace with a second optimiser):
 *   src/addons/battery/grid_balance.ts  — formula + legacy gates
 *   src/addons/battery/grid_balance_power.ts — EV-Abzug, Deadband 0, Mode-2 keepalive ≤8 s, Clamp, Ownership
 *   src/addons/battery/index.ts         — Sonnen Mode-2 control.discharge writes (never Mode 1 / charge)
 *   src/addons/battery/runtime/grid_balance_watch.ts — on-change 500 ms + keepalive ≤ 8 s
 *
 * Authority (lowest wins last): Safety/Fault/Restore → External EV → Battery Hold
 * → planned EMS battery action → grid balance.
 *
 * GRID_BALANCE_EXECUTION_ENABLED stays false: no Dauerbetrieb. Productive writes
 * only via one-shot `grid_balance.live_test_armed` (ack:false) after all gates.
 * One-shot is a session: first regular discharge setpoint, Mode-2 keepalives of
 * that session, then matching discharge=0. Unified with planned/grid_charge via
 * `runtime/setpoint_session.ts` (kind=discharge vs kind=charge).
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.withGridImportExplain = exports.evaluateGridBalanceSafety = exports.formatGridBalanceExplain = exports.classifyGridBalanceEvConflict = exports.normalizeLoadpointMode = exports.parseGridBalanceMaxPriceCt = exports.parseGridBalanceMinPriceCt = exports.GRID_BALANCE_MAX_PRICE_DEFAULT_CT = exports.GRID_BALANCE_MIN_PRICE_MAX_CT = exports.GRID_BALANCE_MIN_PRICE_MIN_CT = exports.GRID_BALANCE_MIN_PRICE_DEFAULT_CT = exports.GRID_BALANCE_EXECUTION_ENABLED = void 0;
exports.GRID_BALANCE_EXECUTION_ENABLED = false;
exports.GRID_BALANCE_MIN_PRICE_DEFAULT_CT = 30;
exports.GRID_BALANCE_MIN_PRICE_MIN_CT = 0;
exports.GRID_BALANCE_MIN_PRICE_MAX_CT = 200;
/** @deprecated same numeric default as min-price policy */
exports.GRID_BALANCE_MAX_PRICE_DEFAULT_CT = exports.GRID_BALANCE_MIN_PRICE_DEFAULT_CT;
function parseGridBalanceMinPriceCt(raw, fallback = exports.GRID_BALANCE_MIN_PRICE_DEFAULT_CT) {
    if (raw === null || raw === undefined || raw === "")
        return fallback;
    if (typeof raw === "boolean")
        return fallback;
    const n = typeof raw === "number" ? raw : parseFloat(String(raw).replace(",", "."));
    if (!Number.isFinite(n) || n < 0)
        return fallback;
    return Math.min(exports.GRID_BALANCE_MIN_PRICE_MAX_CT, Math.max(exports.GRID_BALANCE_MIN_PRICE_MIN_CT, n));
}
exports.parseGridBalanceMinPriceCt = parseGridBalanceMinPriceCt;
/** @deprecated alias — value is not inverted */
function parseGridBalanceMaxPriceCt(raw, fallback = exports.GRID_BALANCE_MIN_PRICE_DEFAULT_CT) {
    return parseGridBalanceMinPriceCt(raw, fallback);
}
exports.parseGridBalanceMaxPriceCt = parseGridBalanceMaxPriceCt;
function normalizeLoadpointMode(raw) {
    return String(raw ?? "")
        .trim()
        .toLowerCase()
        .replace(/\s+/g, "");
}
exports.normalizeLoadpointMode = normalizeLoadpointMode;
function classifyGridBalanceEvConflict(input) {
    if (input.externalAuthority || input.tibberRewardsActive) {
        return { conflict: true, kind: "ev_external" };
    }
    const mode = normalizeLoadpointMode(input.loadpointMode);
    if (input.batteryBoost || mode === "now" || input.wallboxHold) {
        return { conflict: true, kind: "ev_now" };
    }
    const energy = String(input.wallboxEnergySource ?? "")
        .trim()
        .toLowerCase();
    const gridAlloc = input.wallboxAllocatedGridW != null && input.wallboxAllocatedGridW > 0;
    if (energy === "grid" || gridAlloc) {
        return { conflict: true, kind: "ev_ems_grid" };
    }
    return { conflict: false, kind: "" };
}
exports.classifyGridBalanceEvConflict = classifyGridBalanceEvConflict;
function formatPriceCt(priceNowCt) {
    return priceNowCt != null && Number.isFinite(priceNowCt) ? priceNowCt.toFixed(1) : "?";
}
function formatGridBalanceExplain(input) {
    const reason = input.blockReason;
    if (!input.enabled || reason === "disabled") {
        return "grid_balance=blocked, reason=disabled";
    }
    if (reason) {
        return `grid_balance=blocked, reason=${reason}`;
    }
    if (input.active && input.mode2Confirmed && input.dischargeW != null && input.dischargeW > 0) {
        return `grid_balance=active, mode=2, discharge=${Math.round(input.dischargeW)}W`;
    }
    const importW = Number.isFinite(input.gridImportW) ? Math.round(input.gridImportW) : 0;
    return `grid_balance=ready, price=${formatPriceCt(input.priceNowCt)}ct, minimum=${input.priceMinCt.toFixed(1)}ct, grid_import=${importW}W`;
}
exports.formatGridBalanceExplain = formatGridBalanceExplain;
function firstBlock(input) {
    if (input.restoreInProgress)
        return { reason: "restore_in_progress", authority: "safety" };
    if (input.faultActive || input.lockoutActive)
        return { reason: "fault_lockout", authority: "safety" };
    if (!input.addonEnabled)
        return { reason: "addon_disabled", authority: "safety" };
    if (!input.governanceEnabled)
        return { reason: "governance", authority: "safety" };
    if (!input.globalLive)
        return { reason: "global_dryrun", authority: "safety" };
    if (!input.addonLive)
        return { reason: "addon_dryrun", authority: "safety" };
    if (input.sourceOffline)
        return { reason: "source_offline", authority: "safety" };
    if (input.sourceStale)
        return { reason: "source_stale", authority: "safety" };
    if (!input.adminEnabled)
        return { reason: "disabled", authority: "none" };
    if (input.externalEvAuthority || input.evConflictKind === "ev_external") {
        return { reason: "external_ev_authority", authority: "external_ev" };
    }
    if (input.holdPlanned || input.holdActive || input.evccBatteryModeHold) {
        return { reason: "battery_hold", authority: "battery_hold" };
    }
    if (input.evConflictKind === "ev_now" || input.evConflictKind === "ev_ems_grid") {
        return { reason: "ev_now_grid_charge", authority: "external_ev" };
    }
    if (input.evConflictKind) {
        return { reason: "ev_conflict", authority: "external_ev" };
    }
    if (input.plannedBatteryAction || input.ownershipActive || input.dailyPlanAuthoritative || input.mode1Active) {
        return { reason: "planned_battery_action", authority: "planned_battery" };
    }
    const priceKnown = input.priceNowCt != null && Number.isFinite(input.priceNowCt);
    if (!priceKnown)
        return { reason: "price_unknown", authority: "grid_balance" };
    if (input.priceNowCt < input.priceMinCt) {
        return { reason: "price_below_minimum", authority: "grid_balance" };
    }
    return { reason: "", authority: "grid_balance" };
}
function evaluateGridBalanceSafety(input) {
    const holdDetected = input.holdPlanned || input.holdActive || input.evccBatteryModeHold;
    const evConflict = input.externalEvAuthority || input.evConflictKind !== "";
    const { reason, authority } = firstBlock(input);
    const enabled = input.adminEnabled;
    const priceKnown = input.priceNowCt != null && Number.isFinite(input.priceNowCt);
    const priceAllowed = priceKnown && input.priceNowCt >= input.priceMinCt;
    const policyAllowed = reason === "";
    const ready = policyAllowed;
    const executionReleased = exports.GRID_BALANCE_EXECUTION_ENABLED || input.liveTestPermit === true;
    const writeAllowed = policyAllowed && executionReleased && input.globalLive && input.addonLive;
    const explain = formatGridBalanceExplain({
        enabled,
        blockReason: reason,
        priceNowCt: input.priceNowCt,
        priceMinCt: input.priceMinCt,
        gridImportW: 0,
    });
    return {
        enabled,
        ready,
        active: false,
        policyAllowed,
        writeAllowed,
        authority,
        blockReason: reason,
        holdDetected,
        evConflict,
        priceAllowed,
        explain,
    };
}
exports.evaluateGridBalanceSafety = evaluateGridBalanceSafety;
function withGridImportExplain(result, gridImportW, priceNowCt, priceMinCt) {
    return {
        ...result,
        explain: formatGridBalanceExplain({
            enabled: result.enabled,
            blockReason: result.blockReason,
            priceNowCt,
            priceMinCt,
            gridImportW,
        }),
    };
}
exports.withGridImportExplain = withGridImportExplain;
