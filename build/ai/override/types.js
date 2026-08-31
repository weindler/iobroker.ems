"use strict";
/**
 * PHASE 6 — KI Validator & Controlled Optimization.
 *
 * Architektur (verbindlich, siehe .cursor/rules/ems-light-development.mdc):
 *   KI → strukturierte Empfehlung → deterministischer Validator →
 *   zeitlich begrenzter validierter Planner-Override → normaler EMS-Planner → Safety → Gerät.
 *
 * KI schreibt niemals direkt auf Geräte, ändert niemals dauerhaft die Nutzer-Konfiguration.
 * Nach Ablauf der TTL fällt automatisch auf die normale Konfiguration zurück (kein Rollback-Code
 * nötig — ein abgelaufener Override wird von `resolveActiveOverrideValue` einfach nicht mehr
 * zurückgegeben; der Aufrufer verwendet dann automatisch wieder `originalValue`/baseConfig).
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.isSafetyImmutableParameter = exports.AI_OVERRIDE_SAFETY_DENYLIST_PATTERNS = void 0;
exports.AI_OVERRIDE_SAFETY_DENYLIST_PATTERNS = [
    /soc_hard_min/i,
    /hw_max_charge/i,
    /hw_max_discharge/i,
    /hw_min_soc/i,
    /hw_max_soc/i,
    /^safety\./i,
    /safety_limit/i,
    /hygiene/i,
    /^forced\./i,
    /forced_mode/i,
    /user_override/i,
    /external_override/i,
    /hard_off/i,
    /hard_stop/i,
    /temperature_hardlimit/i,
    /temp_hardlimit/i,
    /battery_hold/i,
    /^hold\./i,
];
function isSafetyImmutableParameter(parameter) {
    return exports.AI_OVERRIDE_SAFETY_DENYLIST_PATTERNS.some((re) => re.test(parameter));
}
exports.isSafetyImmutableParameter = isSafetyImmutableParameter;
