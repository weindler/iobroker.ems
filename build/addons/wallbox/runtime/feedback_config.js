"use strict";
/** Wallbox-Feedback-Timing — analog Batterie-Defaults (wait 5 s / timeout 30 s). */
Object.defineProperty(exports, "__esModule", { value: true });
exports.validateWallboxFeedbackTiming = exports.wallboxFeedbackConfigFromAdapter = exports.WB_FEEDBACK_MAX_CURRENT_TOLERANCE_A = exports.WB_FEEDBACK_TIMEOUT_MS_DEFAULT = exports.WB_FEEDBACK_SETTLE_MS_DEFAULT = void 0;
exports.WB_FEEDBACK_SETTLE_MS_DEFAULT = 5_000;
exports.WB_FEEDBACK_TIMEOUT_MS_DEFAULT = 30_000;
/** Exakter numerischer Vergleich — keine willkürliche Ampere-Toleranz. */
exports.WB_FEEDBACK_MAX_CURRENT_TOLERANCE_A = 0;
function numField(c, key) {
    const v = c[key];
    if (v === null || v === undefined || v === "")
        return null;
    const n = typeof v === "number" ? v : parseFloat(String(v).replace(",", ".").trim());
    return Number.isFinite(n) ? n : null;
}
function pickMs(sec, defSec, minSec, maxSec) {
    const v = sec !== null && sec >= minSec ? sec : defSec;
    return Math.min(maxSec, Math.max(minSec, v)) * 1000;
}
/**
 * Liest optionale Feedback-Timing aus Adapter-Config.
 * Fallback auf interne Defaults — keine neuen Pflicht-Admin-Felder in v0.1.137.
 */
function wallboxFeedbackConfigFromAdapter(config) {
    const c = config && typeof config === "object" ? config : {};
    const settleSec = numField(c, "wb_feedback_settle_sec");
    const timeoutSec = numField(c, "wb_feedback_timeout_sec");
    const globalVerSec = numField(c, "global_verification_timeout_sec");
    const wbVerSec = numField(c, "wb_verification_timeout_sec");
    const timeoutFallbackSec = timeoutSec ??
        (wbVerSec !== null && wbVerSec >= 60 ? wbVerSec : null) ??
        (globalVerSec !== null && globalVerSec >= 60 ? globalVerSec : null);
    const settleTimeMs = pickMs(settleSec, exports.WB_FEEDBACK_SETTLE_MS_DEFAULT / 1000, 0, 120);
    let timeoutMs = pickMs(timeoutFallbackSec, exports.WB_FEEDBACK_TIMEOUT_MS_DEFAULT / 1000, 5, 900);
    if (timeoutMs <= settleTimeMs) {
        timeoutMs = settleTimeMs + 1000;
    }
    return {
        settleTimeMs,
        timeoutMs,
        maxCurrentToleranceA: exports.WB_FEEDBACK_MAX_CURRENT_TOLERANCE_A,
    };
}
exports.wallboxFeedbackConfigFromAdapter = wallboxFeedbackConfigFromAdapter;
function validateWallboxFeedbackTiming(config) {
    if (config.settleTimeMs < 0) {
        return { valid: false, reason: "invalid_feedback_timing" };
    }
    if (config.timeoutMs <= config.settleTimeMs) {
        return { valid: false, reason: "invalid_feedback_timing" };
    }
    return { valid: true, reason: null };
}
exports.validateWallboxFeedbackTiming = validateWallboxFeedbackTiming;
