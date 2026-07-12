"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.readDailyPlanJsonRaw = void 0;
const plan_store_1 = require("../plan_store");
const states_1 = require("./states");
async function readStr(host, relId) {
    try {
        const st = await host.getStateAsync(relId);
        if (st?.val == null || st.val === "")
            return null;
        return String(st.val);
    }
    catch {
        return null;
    }
}
/** Full daily plan JSON — file first, legacy ioBroker state fallback for migration. */
async function readDailyPlanJsonRaw(host) {
    const fromFile = await (0, plan_store_1.readDailyPlanFile)(host);
    if (fromFile)
        return fromFile;
    return readStr(host, states_1.DAILY_PLAN_STATE_IDS.planJson);
}
exports.readDailyPlanJsonRaw = readDailyPlanJsonRaw;
