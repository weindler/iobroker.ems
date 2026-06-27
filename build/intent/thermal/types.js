"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.emptyResolvedThermalIntent = void 0;
const constants_1 = require("../core/constants");
function emptyResolvedThermalIntent(now, targetId) {
    const iso = now.toISOString();
    const emptyOrigin = { source: "unknown", owner: "unknown", change_kind: "unknown" };
    const emptyField = () => ({
        value: null,
        status: "missing",
        origin: emptyOrigin,
        observed_at: iso,
    });
    return {
        schema_version: constants_1.INTENT_SCHEMA_VERSION,
        domain: "thermal",
        target: { id: targetId },
        revision: 0,
        intent_state: "disabled",
        resolved_at: iso,
        operating_request: emptyField(),
        target_temperature_c: emptyField(),
        ready_at: emptyField(),
        priority: emptyField(),
        manual_override: { active: false, scope: [], source: "unknown", owner: "unknown" },
        source_summary: [],
    };
}
exports.emptyResolvedThermalIntent = emptyResolvedThermalIntent;
