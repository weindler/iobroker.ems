"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ChallengeReplayCache = void 0;
const constants_1 = require("./constants");
/**
 * In-memory consumed-challenge replay cache — session only, size-bounded.
 */
class ChallengeReplayCache {
    maxEntries;
    entries = [];
    constructor(maxEntries = constants_1.TAKEOVER_REPLAY_CACHE_MAX_ENTRIES) {
        this.maxEntries = maxEntries;
    }
    remember(challengeId, expiresAtMs) {
        this.entries.push({ challengeId, expiresAtMs });
        while (this.entries.length > this.maxEntries) {
            this.entries.shift();
        }
    }
    has(challengeId, nowMs) {
        this.prune(nowMs);
        return this.entries.some((e) => e.challengeId === challengeId);
    }
    prune(nowMs) {
        for (let i = this.entries.length - 1; i >= 0; i--) {
            if (this.entries[i].expiresAtMs <= nowMs) {
                this.entries.splice(i, 1);
            }
        }
    }
    clear() {
        this.entries.length = 0;
    }
    size() {
        return this.entries.length;
    }
}
exports.ChallengeReplayCache = ChallengeReplayCache;
