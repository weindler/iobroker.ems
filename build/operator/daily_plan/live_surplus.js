"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildOperatorLiveSurplus = void 0;
const battery_1 = require("../planning/battery");
const surplus_1 = require("../planning/surplus");
const slots_1 = require("./slots");
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
