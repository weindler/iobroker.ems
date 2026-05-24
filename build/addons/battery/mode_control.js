"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ensureOperatingMode = exports.SONNEN_OPERATING_MODE_AUTO = exports.SONNEN_OPERATING_MODE_MANUAL = void 0;
const io_1 = require("./io");
/** Sonnen API v2: 1 = Manuell, 2 = Eigenverbrauch */
exports.SONNEN_OPERATING_MODE_MANUAL = 1;
exports.SONNEN_OPERATING_MODE_AUTO = 2;
async function ensureOperatingMode(adapter, mode, liveEnabled) {
    const { targetId } = await (0, io_1.mappedTargetId)(adapter, "operating_mode");
    if (!targetId) {
        return "operating_mode_mapping_missing";
    }
    const wrote = await (0, io_1.writeForeignIfLive)(adapter, targetId, mode, liveEnabled);
    return wrote ? null : "dryrun_mode";
}
exports.ensureOperatingMode = ensureOperatingMode;
