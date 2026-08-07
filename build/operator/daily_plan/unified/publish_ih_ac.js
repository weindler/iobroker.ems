"use strict";
/**
 * Publiziert Unified-IH/AC-Dispatch ausschließlich auf planner.intent.allocation.*
 * Der Planner schreibt keine Geräte-States.
 *
 * Produktions-Tick nutzt bevorzugt applyUnifiedIhAcAuthority + einmaligen Plan-Publish.
 * Diese Hilfsfunktion bleibt für gezielte Slice-Writes/Tests.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.publishUnifiedIhAcDispatch = void 0;
const state_write_1 = require("../../../policy/core/state_write");
const daily_plan_1 = require("../../../addons/immersion_heater/runtime/daily_plan");
const daily_plan_2 = require("../../../addons/air_conditioning/runtime/daily_plan");
const states_1 = require("../states");
const dispatch_bridge_1 = require("./dispatch_bridge");
/**
 * Überschreibt nur Immersion- und Klima-Allocation-Slices.
 * Battery/Wallbox bleiben unberührt.
 */
async function publishUnifiedIhAcDispatch(host, plan) {
    const pub = (0, dispatch_bridge_1.buildUnifiedIhAcDispatchPublish)(plan);
    const ih = states_1.ALLOCATION_ADDON_STATE_IDS.immersion_heater;
    const ac = states_1.ALLOCATION_ADDON_STATE_IDS.air_conditioning;
    // setStateIfChanged braucht formal StateHost; Overlay nutzt nur get/setState.
    const writeHost = host;
    await (0, state_write_1.setStateIfChanged)(writeHost, ih.status, pub.immersionStatus);
    await (0, state_write_1.setStateIfChanged)(writeHost, ih.planJson, JSON.stringify(pub.immersionEntries));
    await (0, state_write_1.setStateIfChanged)(writeHost, ih.reasonDe, pub.immersionReasonDe);
    await (0, state_write_1.setStateIfChanged)(writeHost, ac.status, pub.climateStatus);
    await (0, state_write_1.setStateIfChanged)(writeHost, ac.planJson, JSON.stringify(pub.climateEntries));
    await (0, state_write_1.setStateIfChanged)(writeHost, ac.reasonDe, pub.climateReasonDe);
    // Slice geändert ohne Daily-Plan-Revision → Runtime-Caches invalidieren.
    (0, daily_plan_1.resetImmersionDailyPlanCache)();
    (0, daily_plan_2.resetAcDailyPlanCache)();
    host.log?.debug?.(`unified ih/ac dispatch: ih=${pub.immersionEntries.length} ac=${pub.climateEntries.length}`);
    return { immersionCount: pub.immersionEntries.length, climateCount: pub.climateEntries.length };
}
exports.publishUnifiedIhAcDispatch = publishUnifiedIhAcDispatch;
