"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.effectiveRollupMode = exports.DEFAULT_RETENTION_DAYS = exports.POWER_ROLLUP_MODULE = exports.POWER_HOURLY_FILENAME = void 0;
exports.POWER_HOURLY_FILENAME = "power_hourly_v1.json";
exports.POWER_ROLLUP_MODULE = "power_hourly_rollup_v1";
exports.DEFAULT_RETENTION_DAYS = 120;
function effectiveRollupMode(source) {
    return source.rollupMode ?? "bidirectional_max";
}
exports.effectiveRollupMode = effectiveRollupMode;
