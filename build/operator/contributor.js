"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.parseContributorRef = exports.serializeContributorRef = exports.contributorRefKey = exports.systemContributorRef = exports.addonContributorRef = void 0;
function addonContributorRef(addonId) {
    return { type: "addon", id: addonId, addonId };
}
exports.addonContributorRef = addonContributorRef;
function systemContributorRef(id) {
    return { type: "system", id, addonId: null };
}
exports.systemContributorRef = systemContributorRef;
function contributorRefKey(ref) {
    return `${ref.type}:${ref.id}`;
}
exports.contributorRefKey = contributorRefKey;
function serializeContributorRef(ref) {
    return JSON.stringify(ref);
}
exports.serializeContributorRef = serializeContributorRef;
function parseContributorRef(raw) {
    try {
        const parsed = JSON.parse(raw);
        if (!parsed || typeof parsed !== "object")
            return null;
        if (parsed.type !== "addon" && parsed.type !== "system")
            return null;
        if (typeof parsed.id !== "string" || !parsed.id.trim())
            return null;
        if (parsed.addonId !== null && typeof parsed.addonId !== "string")
            return null;
        return parsed;
    }
    catch {
        return null;
    }
}
exports.parseContributorRef = parseContributorRef;
