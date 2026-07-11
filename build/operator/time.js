"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.isValidIsoTimestamp = exports.slotEndMsFromStart = exports.isoFromMs = exports.OPERATOR_MS_PER_15MIN = void 0;
const tibber_parse_1 = require("../learning/price_forecast/tibber_parse");
exports.OPERATOR_MS_PER_15MIN = tibber_parse_1.MS_PER_15MIN;
function isoFromMs(ms) {
    return new Date(ms).toISOString();
}
exports.isoFromMs = isoFromMs;
function slotEndMsFromStart(startMs) {
    return startMs + exports.OPERATOR_MS_PER_15MIN;
}
exports.slotEndMsFromStart = slotEndMsFromStart;
function isValidIsoTimestamp(iso) {
    if (!iso.trim())
        return false;
    const ms = Date.parse(iso);
    return Number.isFinite(ms);
}
exports.isValidIsoTimestamp = isValidIsoTimestamp;
