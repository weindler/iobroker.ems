"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.runWallboxFailsafeCheck = exports.recordWallboxPipelineResult = void 0;
const execution_mode_1 = require("../../execution_mode");
const failsafe_common_1 = require("../../failsafe_common");
const tree_paths_1 = require("../../tree_paths");
const status_wallbox_1 = require("../../status_wallbox");
const ADDON_ID = "wallbox";
let pending = null;
let lastEmsReachable = null;
let lastImmediateFail = false;
function maxChargeWFromConfig(config) {
    const n = Number(config.wb_max_charge_w);
    return Number.isFinite(n) && n > 0 ? n : 11000;
}
async function enableTargetId(adapter) {
    const base = (0, tree_paths_1.mappingBase)(ADDON_ID, "set_enabled");
    const en = await adapter.getStateAsync(`${base}.enabled`);
    if (en?.val === false)
        return "";
    const ts = await adapter.getStateAsync(`${base}.target_state`);
    return typeof ts?.val === "string" ? ts.val.trim() : "";
}
function powerFeedbackIdFromConfig(config) {
    const t = config.wb_feedback_power_target;
    return typeof t === "string" ? t.trim() : "";
}
/** Feedback-State kann W oder kW liefern (go-e: energy.neutral.power oft kW). */
function feedbackPowerToWatts(raw, config) {
    const unit = String(config.wb_feedback_power_unit ?? "w").toLowerCase();
    if (unit === "kw" || unit === "kwh") {
        return raw * 1000;
    }
    return raw;
}
async function readFeedbackPowerW(adapter, cfg) {
    const id = powerFeedbackIdFromConfig(cfg);
    if (!id)
        return null;
    const raw = await (0, failsafe_common_1.readForeignNumber)(adapter, id);
    if (raw == null)
        return null;
    return feedbackPowerToWatts(raw, cfg);
}
function recordWallboxPipelineResult(_config, intent, outcome) {
    lastImmediateFail = false;
    if (intent.addon_id !== ADDON_ID) {
        return;
    }
    if (outcome.result !== "success" || outcome.reason !== "live_write") {
        if (outcome.checks_failed.includes("live_write_failed")) {
            lastImmediateFail = true;
        }
        pending = null;
        return;
    }
    const target = outcome.target_state ?? "";
    const now = Date.now();
    if (intent.command === "set_enabled") {
        pending = {
            kind: "enable",
            expected: intent.value === true || intent.value === 1 || intent.value === "1",
            sinceMs: now,
            targetId: target,
        };
        return;
    }
    if (intent.command === "set_charge_power_w") {
        const planned = outcome.planned_value;
        let watts = typeof intent.value === "number" ? intent.value : 0;
        if (typeof planned === "object" && planned !== null && "watts" in planned) {
            const w = planned.watts;
            if (typeof w === "number")
                watts = w;
        }
        const cfg = _config;
        const maxW = maxChargeWFromConfig(cfg);
        pending = {
            kind: "power",
            expectedWatts: watts,
            sinceMs: now,
            enableTargetId: "",
            powerFeedbackId: powerFeedbackIdFromConfig(cfg),
            steadyMax: watts >= maxW * 0.85,
        };
    }
}
exports.recordWallboxPipelineResult = recordWallboxPipelineResult;
async function forceWallboxSafeOff(adapter, reason) {
    const live = await (0, execution_mode_1.isLiveWriteAllowed)((id) => adapter.getStateAsync(id), ADDON_ID);
    if (!live)
        return false;
    const targetId = await enableTargetId(adapter);
    if (!targetId) {
        adapter.log.warn(`wallbox failsafe (${reason}): no set_enabled mapping`);
        return false;
    }
    try {
        await adapter.setForeignStateAsync(targetId, { val: false, ack: true });
        adapter.log.warn(`wallbox failsafe (${reason}): charging disabled → ${targetId}`);
        return true;
    }
    catch (e) {
        adapter.log.error(`wallbox failsafe write failed: ${e}`);
        return false;
    }
}
async function verifyPending(adapter, cfg) {
    if (!pending)
        return true;
    const { verificationTimeoutSec } = (0, failsafe_common_1.failsafeTimeoutsFromConfig)(cfg, "wb");
    const elapsed = Date.now() - pending.sinceMs;
    if (elapsed < verificationTimeoutSec * 1000) {
        return true;
    }
    if (pending.kind === "enable") {
        const actual = await (0, failsafe_common_1.readForeignBool)(adapter, pending.targetId);
        if (actual === pending.expected)
            return true;
        return false;
    }
    if (pending.steadyMax) {
        return true;
    }
    const feedbackId = pending.powerFeedbackId;
    if (!feedbackId) {
        return true;
    }
    const actualW = await readFeedbackPowerW(adapter, cfg);
    if (actualW == null) {
        return false;
    }
    const tol = Number(cfg.wb_verification_tolerance_pct);
    const pct = Number.isFinite(tol) && tol > 0 ? tol / 100 : 0.15;
    const expected = pending.expectedWatts;
    if (expected <= 0) {
        return actualW < 200;
    }
    return Math.abs(actualW - expected) <= Math.max(500, expected * pct);
}
async function runWallboxFailsafeCheck(adapter) {
    const cfg = adapter.config && typeof adapter.config === "object"
        ? adapter.config
        : {};
    const liveAllowed = await (0, execution_mode_1.isLiveWriteAllowed)((id) => adapter.getStateAsync(id), ADDON_ID);
    const emsReachable = !(0, failsafe_common_1.isEmsUnreachable)(cfg, "wb");
    await (0, failsafe_common_1.setEdgeBool)(adapter, status_wallbox_1.WALLBOX_STATUS_STATES.emsReachable, emsReachable);
    if (lastEmsReachable !== emsReachable) {
        lastEmsReachable = emsReachable;
        adapter.log.info(`wallbox: ems_reachable=${emsReachable}`);
    }
    const verifyOk = lastImmediateFail ? false : await verifyPending(adapter, cfg);
    const shouldTrip = !emsReachable || !verifyOk || lastImmediateFail;
    await (0, failsafe_common_1.setEdgeBool)(adapter, status_wallbox_1.WALLBOX_STATUS_STATES.failsafeWouldTrip, shouldTrip && !liveAllowed);
    const ts = new Date().toISOString();
    await adapter.setStateAsync(status_wallbox_1.WALLBOX_STATUS_STATES.updatedAt, { val: ts, ack: true });
    if (!shouldTrip) {
        if (verifyOk && pending) {
            await (0, failsafe_common_1.setEdgeBool)(adapter, status_wallbox_1.WALLBOX_STATUS_STATES.actuatorReachable, true);
            await (0, failsafe_common_1.setEdgeBool)(adapter, status_wallbox_1.WALLBOX_STATUS_STATES.addonDead, false);
        }
        const active = await adapter.getStateAsync(status_wallbox_1.WALLBOX_STATUS_STATES.failsafeActive);
        if (active?.val === true && liveAllowed) {
            await adapter.setStateAsync(status_wallbox_1.WALLBOX_STATUS_STATES.failsafeActive, { val: false, ack: true });
        }
        return;
    }
    if (!liveAllowed) {
        return;
    }
    const reason = !emsReachable
        ? "ems_unreachable"
        : lastImmediateFail
            ? "live_write_failed"
            : "verification_timeout";
    const wrote = await forceWallboxSafeOff(adapter, reason);
    if (wrote) {
        await (0, failsafe_common_1.setEdgeBool)(adapter, status_wallbox_1.WALLBOX_STATUS_STATES.actuatorReachable, false);
        await (0, failsafe_common_1.setEdgeBool)(adapter, status_wallbox_1.WALLBOX_STATUS_STATES.addonDead, true);
        await adapter.setStateAsync(status_wallbox_1.WALLBOX_STATUS_STATES.failsafeActive, { val: true, ack: true });
        await adapter.setStateAsync(status_wallbox_1.WALLBOX_STATUS_STATES.lastFailsafeAt, { val: ts, ack: true });
        pending = null;
    }
}
exports.runWallboxFailsafeCheck = runWallboxFailsafeCheck;
