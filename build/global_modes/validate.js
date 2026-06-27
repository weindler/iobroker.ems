"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.validateGlobalModeProfile = void 0;
function validateGlobalModeProfile(profile) {
    return (typeof profile.economyWeight === "number" &&
        typeof profile.comfortWeight === "number" &&
        Number.isFinite(profile.economyWeight) &&
        Number.isFinite(profile.comfortWeight));
}
exports.validateGlobalModeProfile = validateGlobalModeProfile;
