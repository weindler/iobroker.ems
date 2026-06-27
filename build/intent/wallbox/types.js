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
