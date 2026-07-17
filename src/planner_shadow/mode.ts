import type { PlannerRuntimeMode } from "../planner_config";
import {
	plannerRuntimeModeAllowsAuto,
	plannerRuntimeModeAllowsManual,
	plannerRuntimeModeFromConfig,
} from "../planner_config";

export interface EffectivePlannerMode {
	configuredMode: PlannerRuntimeMode;
	effectiveMode: PlannerRuntimeMode;
	/** Session-only gate; discarded on adapter start. Never writes back to native config. */
	sessionShadowEnabled: boolean;
	configClamped: boolean;
	/** Coordinator should accept jobs. */
	coordinatorEnabled: boolean;
	allowsManual: boolean;
	allowsAuto: boolean;
}

/**
 * Resolve durable native mode + optional session override.
 * - Native config is authoritative after restart.
 * - Persisted shadow_enabled=true never activates when native is off.
 * - Session override may temporarily disable when native allows shadow.
 * - Session override cannot elevate above native off.
 */
export function resolveEffectivePlannerMode(input: {
	config: unknown;
	sessionShadowEnabled: boolean;
}): EffectivePlannerMode {
	const parsed = plannerRuntimeModeFromConfig(input.config);
	const configuredMode = parsed.mode;
	const sessionShadowEnabled = input.sessionShadowEnabled === true;

	let effectiveMode: PlannerRuntimeMode = configuredMode;
	if (configuredMode === "off") {
		effectiveMode = "off";
	} else if (!sessionShadowEnabled) {
		// Native allows shadow, but session gate is off → treat as off for this session
		effectiveMode = "off";
	}

	// On first init after start, caller sets sessionShadowEnabled=true when native is shadow_*
	// so effective matches configured. Session user can later set false to pause.

	const allowsManual = plannerRuntimeModeAllowsManual(effectiveMode);
	const allowsAuto = plannerRuntimeModeAllowsAuto(effectiveMode);

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

/**
 * After adapter start: discard session override, apply native mode.
 * When native is shadow_manual/auto, session is auto-armed true for this process.
 */
export function initialSessionShadowFromNative(configuredMode: PlannerRuntimeMode): boolean {
	return configuredMode === "shadow_manual" || configuredMode === "shadow_auto";
}
