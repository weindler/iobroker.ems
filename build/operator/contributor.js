"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.addonContributorRef = addonContributorRef;
exports.systemContributorRef = systemContributorRef;
exports.contributorRefKey = contributorRefKey;
exports.serializeContributorRef = serializeContributorRef;
exports.parseContributorRef = parseContributorRef;
function addonContributorRef(addonId) {
    return { type: "addon", id: addonId, addonId };
}
function systemContributorRef(id) {
    return { type: "system", id, addonId: null };
}
function contributorRefKey(ref) {
    return `${ref.type}:${ref.id}`;
}
function serializeContributorRef(ref) {
    return JSON.stringify(ref);
}
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
