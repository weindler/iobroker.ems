"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.batteryProfileIds = exports.getBatteryProfile = exports.BATTERY_PROFILES = void 0;
const generic_readonly_1 = require("./generic_readonly");
const sonnen_em_1 = require("./sonnen_em");
exports.BATTERY_PROFILES = [
    generic_readonly_1.GENERIC_READONLY_PROFILE,
    sonnen_em_1.SONNEN_EM_PROFILE,
];
function getBatteryProfile(id) {
    const found = exports.BATTERY_PROFILES.find((p) => p.id === id);
    return found ?? generic_readonly_1.GENERIC_READONLY_PROFILE;
}
exports.getBatteryProfile = getBatteryProfile;
function batteryProfileIds() {
    return exports.BATTERY_PROFILES.map((p) => p.id);
}
exports.batteryProfileIds = batteryProfileIds;
