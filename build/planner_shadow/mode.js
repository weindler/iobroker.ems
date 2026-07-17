"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.initialSessionShadowFromNative = exports.resolveEffectivePlannerMode = void 0;
const planner_config_1 = require("../planner_config");
/**
 * Resolve durable native mode + optional session override.
 * - Native config is authoritative after restart.
 * - Persisted shadow_enabled=true never activates when native is off.
 * - Session override may temporarily disable when native allows shadow.
 * - Session override cannot elevate above native off.
 */
function resolveEffectivePlannerMode(input) {
    const parsed = (0, planner_config_1.plannerRuntimeModeFromConfig)(input.config);
    const configuredMode = parsed.mode;
    const sessionShadowEnabled = input.sessionShadowEnabled === true;
    let effectiveMode = configuredMode;
    if (configuredMode === "off") {
        effectiveMode = "off";
    }
    else if (!sessionShadowEnabled) {
        // Native allows shadow, but session gate is off → treat as off for this session
        effectiveMode = "off";
    }
    // On first init after start, caller sets sessionShadowEnabled=true when native is shadow_*
    // so effective matches configured. Session user can later set false to pause.
    const allowsManual = (0, planner_config_1.plannerRuntimeModeAllowsManual)(effectiveMode);
    const allowsAuto = (0, planner_config_1.plannerRuntimeModeAllowsAuto)(effectiveMode);
    return {
        configuredMode,
        effectiveMode,
        sessionShadowEnabled,
        configClamped: parsed.clamped,
        coordinatorEnabled: allowsManual,
        allowsManual,
        allowsAuto,
    };
}
exports.resolveEffectivePlannerMode = resolveEffectivePlannerMode;
/**
 * After adapter start: discard session override, apply native mode.
 * When native is shadow_manual/auto, session is auto-armed true for this process.
 */
function initialSessionShadowFromNative(configuredMode) {
    return configuredMode === "shadow_manual" || configuredMode === "shadow_auto";
}
exports.initialSessionShadowFromNative = initialSessionShadowFromNative;
