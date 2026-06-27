"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.shouldRerunAfterExpiry = exports.nextExpiryDelayMs = exports.collectExpiryTimes = void 0;
const validation_1 = require("./validation");
const MIN_EXPIRY_MS = 5_000;
const MAX_EXPIRY_MS = 24 * 60 * 60 * 1000;
function collectExpiryTimes(now, overrides) {
    const times = [];
    for (const o of overrides) {
        if (!o?.active || !o.valid_until)
            continue;
        const t = Date.parse(o.valid_until);
        if (Number.isFinite(t) && t > now.getTime()) {
            times.push(t);
        }
    }
    return times;
}
exports.collectExpiryTimes = collectExpiryTimes;
function nextExpiryDelayMs(now, expiryTimes) {
    if (expiryTimes.length === 0)
        return null;
    const next = Math.min(...expiryTimes);
    const delay = next - now.getTime();
    if (delay <= 0)
        return MIN_EXPIRY_MS;
    return Math.min(Math.max(delay, MIN_EXPIRY_MS), MAX_EXPIRY_MS);
}
exports.nextExpiryDelayMs = nextExpiryDelayMs;
function shouldRerunAfterExpiry(validUntil, now) {
    if (!validUntil)
        return false;
    return (0, validation_1.isExpiredAt)(validUntil, now);
}
exports.shouldRerunAfterExpiry = shouldRerunAfterExpiry;
