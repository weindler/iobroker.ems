"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.applyLiveNowFromSurplusResult = exports.buildOperatorLiveSurplus = exports.slotBalanceIsConsistent = exports.LIVE_NOW_MAX_AGE_SEC = exports.isPlausibleLivePowerW = exports.isLiveNowTelemetryUsable = exports.computeLiveNowBalanceW = exports.applyLiveSurplusFloorToCurrentSlot = exports.applyLiveNowBalanceToCurrentSlot = void 0;
const battery_1 = require("../planning/battery");
const surplus_1 = require("../planning/surplus");
const slots_1 = require("./slots");
const live_now_balance_1 = require("./live_now_balance");
var live_now_balance_2 = require("./live_now_balance");
Object.defineProperty(exports, "applyLiveNowBalanceToCurrentSlot", { enumerable: true, get: function () { return live_now_balance_2.applyLiveNowBalanceToCurrentSlot; } });
Object.defineProperty(exports, "applyLiveSurplusFloorToCurrentSlot", { enumerable: true, get: function () { return live_now_balance_2.applyLiveSurplusFloorToCurrentSlot; } });
Object.defineProperty(exports, "computeLiveNowBalanceW", { enumerable: true, get: function () { return live_now_balance_2.computeLiveNowBalanceW; } });
Object.defineProperty(exports, "isLiveNowTelemetryUsable", { enumerable: true, get: function () { return live_now_balance_2.isLiveNowTelemetryUsable; } });
Object.defineProperty(exports, "isPlausibleLivePowerW", { enumerable: true, get: function () { return live_now_balance_2.isPlausibleLivePowerW; } });
Object.defineProperty(exports, "LIVE_NOW_MAX_AGE_SEC", { enumerable: true, get: function () { return live_now_balance_2.LIVE_NOW_MAX_AGE_SEC; } });
Object.defineProperty(exports, "slotBalanceIsConsistent", { enumerable: true, get: function () { return live_now_balance_2.slotBalanceIsConsistent; } });
function buildOperatorLiveSurplus(input) {
    const { pvPowerW, houseLoadW, now, timezone } = input;
    const slotStartIso = (0, slots_1.slotStartIsoFloored)(now, timezone);
    return {
        pvPowerW,
        houseLoadW,
        surplusW: (0, surplus_1.computePvSurplusW)(pvPowerW, houseLoadW),
        deficitW: (0, battery_1.computeDeficitW)(pvPowerW, houseLoadW),
        slotStartIso: slotStartIso || null,
        status: pvPowerW !== null && houseLoadW !== null ? "valid" : "missing",
    };
}
exports.buildOperatorLiveSurplus = buildOperatorLiveSurplus;
/** Convenience: Live-NOW-Bilanz auf Daily-Plan-Slots anwenden. */
function applyLiveNowFromSurplusResult(slots, nowMs, live) {
    const telemetry = {
        pvPowerW: live.pvPowerW,
        houseLoadW: live.houseLoadW,
        pvAgeSec: live.pvAgeSec,
        houseAgeSec: live.houseAgeSec,
    };
    return (0, live_now_balance_1.applyLiveNowBalanceToCurrentSlot)(slots, nowMs, telemetry);
}
exports.applyLiveNowFromSurplusResult = applyLiveNowFromSurplusResult;
