"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.modeSwitchDelaysFromConfig = void 0;
function modeSwitchDelaysFromConfig(config) {
    const pause = config.bat_mode_pause_grid_balance_sec;
    const after = config.bat_mode_wait_after_mode_sec;
    return {
        pauseGridBalanceSec: typeof pause === "number" && pause >= 0 ? Math.min(120, Math.floor(pause)) : 10,
        waitAfterModeSec: typeof after === "number" && after >= 0 ? Math.min(120, Math.floor(after)) : 5,
    };
}
exports.modeSwitchDelaysFromConfig = modeSwitchDelaysFromConfig;
