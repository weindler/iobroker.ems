"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.maybeUpdatePlanCompareOnDailyPlanChange = exports.ensureCompareStateTree = exports.resetPlanCompareHookForTest = exports.runPlanCompare = exports.COMPARE_ELIGIBLE_GOVERNED_IDS = exports.buildCompareResult = exports.COMPARE_STATES = exports.ensureCompareStates = void 0;
const ensure_states_1 = require("./ensure_states");
const run_1 = require("./run");
var ensure_states_2 = require("./ensure_states");
Object.defineProperty(exports, "ensureCompareStates", { enumerable: true, get: function () { return ensure_states_2.ensureCompareStates; } });
var ensure_states_3 = require("./ensure_states");
Object.defineProperty(exports, "COMPARE_STATES", { enumerable: true, get: function () { return ensure_states_3.COMPARE_STATES; } });
var build_1 = require("./build");
Object.defineProperty(exports, "buildCompareResult", { enumerable: true, get: function () { return build_1.buildCompareResult; } });
Object.defineProperty(exports, "COMPARE_ELIGIBLE_GOVERNED_IDS", { enumerable: true, get: function () { return build_1.COMPARE_ELIGIBLE_GOVERNED_IDS; } });
var run_2 = require("./run");
Object.defineProperty(exports, "runPlanCompare", { enumerable: true, get: function () { return run_2.runPlanCompare; } });
let lastComparedRevision = -1;
function resetPlanCompareHookForTest() {
    lastComparedRevision = -1;
}
exports.resetPlanCompareHookForTest = resetPlanCompareHookForTest;
async function ensureCompareStateTree(host) {
    await (0, ensure_states_1.ensureCompareStates)(host);
}
exports.ensureCompareStateTree = ensureCompareStateTree;
/**
 * Aktualisiert den Plan-Vergleich nur bei tatsächlicher Daily-Plan-Änderung (neue Revision) —
 * analog zum KI-Hook, damit nicht bei jedem Tick unnötig geschrieben wird.
 */
async function maybeUpdatePlanCompareOnDailyPlanChange(host, plan) {
    if (plan.revision === lastComparedRevision) {
        return null;
    }
    lastComparedRevision = plan.revision;
    return (0, run_1.runPlanCompare)(host, plan);
}
exports.maybeUpdatePlanCompareOnDailyPlanChange = maybeUpdatePlanCompareOnDailyPlanChange;
