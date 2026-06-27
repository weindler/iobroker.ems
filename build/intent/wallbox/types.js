"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.emptyResolvedWallboxIntent = void 0;
const constants_1 = require("../core/constants");
function emptyResolvedWallboxIntent(now) {
    const iso = now.toISOString();
    const emptyOrigin = {
        source: "unknown",
        owner: "unknown",
        change_kind: "unknown",
    };
    const emptyField = () => ({
        value: null,
        status: "missing",
        origin: emptyOrigin,
        observed_at: iso,
    });
    return {
        schema_version: constants_1.INTENT_SCHEMA_VERSION,
        domain: "wallbox",
        target: { id: constants_1.WALLBOX_TARGET_ID },
        revision: 0,
        intent_state: "none",
        resolved_at: iso,
        charge_strategy: emptyField(),
        target_soc_pct: emptyField(),
        deadline: emptyField(),
        external_planner_plan: {
            state: "none",
            plan_type: "unknown",
            target_soc_pct: null,
            target_energy_kwh: null,
            ready_at: null,
            source: "evcc",
            observed_at: iso,
        },
        manual_override: {
            active: false,
            scope: [],
            source: "unknown",
            owner: "unknown",
        },
        source_summary: [],
    };
}
exports.emptyResolvedWallboxIntent = emptyResolvedWallboxIntent;
