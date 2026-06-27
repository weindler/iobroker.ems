"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.globalModeDefaultFromConfig = exports.isGlobalMode = void 0;
const constants_1 = require("./constants");
const constants_2 = require("./constants");
function strField(config, key) {
    const v = config[key];
    return typeof v === "string" ? v.trim().toLowerCase() : "";
}
function isGlobalMode(raw) {
    return constants_2.GLOBAL_MODES.includes(raw);
}
exports.isGlobalMode = isGlobalMode;
function globalModeDefaultFromConfig(config) {
    if (!config || typeof config !== "object") {
        return constants_1.DEFAULT_GLOBAL_MODE;
    }
    const raw = strField(config, constants_1.ADMIN_CONFIG_KEY_DEFAULT);
    if (raw && isGlobalMode(raw)) {
        return raw;
    }
    return constants_1.DEFAULT_GLOBAL_MODE;
}
exports.globalModeDefaultFromConfig = globalModeDefaultFromConfig;
