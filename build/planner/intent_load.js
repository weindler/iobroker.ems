"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.readPlannerIntentJsonRaw = void 0;
const plan_store_1 = require("../operator/plan_store");
const PLANNER_INTENT_STATE_ID = "planner.intent.last_json";
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
/** Planner intent JSON — file first, legacy ioBroker state fallback for migration. */
async function readPlannerIntentJsonRaw(host) {
    const fromFile = await (0, plan_store_1.readPlannerIntentFile)(host);
    if (fromFile)
        return fromFile;
    return readStr(host, PLANNER_INTENT_STATE_ID);
}
exports.readPlannerIntentJsonRaw = readPlannerIntentJsonRaw;
