"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.evaluateStopCondition = void 0;
/**
 * Liefert den ersten zutreffenden Stopgrund einer aktiven Ladeaktion oder null.
 * Reihenfolge nach Sicherheitsrelevanz.
 */
function evaluateStopCondition(input) {
    if (input.fault)
        return "fault";
    if (input.communicationLost)
        return "communication_lost";
    if (input.unloading)
        return "adapter_unload";
    if (input.addonDisabled)
        return "addon_disabled";
    if (input.globalLeftLive)
        return "global_left_live";
    if (input.safetyBlocked)
        return "safety_blocked";
    if (input.telemetryStale)
        return "telemetry_stale";
    if (input.intentRevoked)
        return "intent_revoked";
    if (input.intentExpired)
        return "intent_expired";
    if (input.targetSocReached)
        return "target_soc_reached";
    if (input.higherPriorityIntent)
        return "higher_priority_intent";
    return null;
}
exports.evaluateStopCondition = evaluateStopCondition;
