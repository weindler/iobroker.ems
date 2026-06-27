"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.emptyResolvedBatteryIntent = void 0;
const constants_1 = require("../core/constants");
function emptyResolvedBatteryIntent(now, targetId) {
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
        domain: "battery",
        target: { id: targetId },
        revision: 0,
        intent_state: "disabled",
        resolved_at: iso,
        operating_request: emptyField(),
        target_soc_pct: emptyField(),
        grid_charge_request: emptyField(),
        ev_discharge_allowed: emptyField(),
        top_off_requested: emptyField(),
        manual_override: { active: false, scope: [], source: "unknown", owner: "unknown" },
        source_summary: [],
    };
}
exports.emptyResolvedBatteryIntent = emptyResolvedBatteryIntent;
