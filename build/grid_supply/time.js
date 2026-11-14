"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.isoFromMs = isoFromMs;
exports.slotEndMsFromStart = slotEndMsFromStart;
exports.isValidIsoTimestamp = isValidIsoTimestamp;
const tibber_parse_1 = require("../learning/price_forecast/tibber_parse");
function isoFromMs(ms) {
    return new Date(ms).toISOString();
}
function slotEndMsFromStart(startMs) {
    return startMs + tibber_parse_1.MS_PER_15MIN;
}
function isValidIsoTimestamp(iso) {
    if (!iso.trim())
        return false;
    const ms = Date.parse(iso);
    return Number.isFinite(ms);
}
