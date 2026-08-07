"use strict";
/**
 * Unified Day Planner — Contract (Schritt 1) + Allocation Core (Schritt 2).
 * IH/AC: Dispatch nur über planner.intent.allocation.* → bestehende Runtimes.
 * Battery/Wallbox: kein Unified-Live-Takeover in dieser Beta-Stufe.
 */
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __exportStar = (this && this.__exportStar) || function(m, exports) {
    for (var p in m) if (p !== "default" && !Object.prototype.hasOwnProperty.call(exports, p)) __createBinding(exports, m, p);
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.golden005GoodDayPvHeat = exports.golden005BadNightBatteryHeat = exports.golden005Input = exports.golden004StalePlanNoReplan = exports.golden004ReplanPlan = exports.golden004Input = exports.golden003GoodPv = exports.golden003BadEarlyGrid = exports.golden003Input = exports.golden002GoodPlan = exports.golden002BadPlanAbsentCharge = exports.golden002Input = exports.golden001ScaledBadPlan = exports.golden001ScaledInput = exports.golden001GoodPlan = exports.golden001BadPlan = exports.golden001Input = exports.buildSlots = exports.publishUnifiedIhAcDispatch = exports.unifiedPlanToClimateAllocations = exports.unifiedPlanToImmersionAllocations = exports.buildUnifiedIhAcDispatchPublish = exports.unifiedPlanCadenceDigest = exports.summarizeUnifiedDayPlanForReason = exports.buildUnifiedInputFromForecastContext = exports.isIhAcContributionId = exports.clearIhAcAuthority = exports.applyUnifiedIhAcAuthority = exports.allocateUnifiedDayPlan = void 0;
__exportStar(require("./types"), exports);
__exportStar(require("./evaluate"), exports);
__exportStar(require("./reason_codes"), exports);
var allocate_1 = require("./allocate");
Object.defineProperty(exports, "allocateUnifiedDayPlan", { enumerable: true, get: function () { return allocate_1.allocateUnifiedDayPlan; } });
var authority_1 = require("./authority");
Object.defineProperty(exports, "applyUnifiedIhAcAuthority", { enumerable: true, get: function () { return authority_1.applyUnifiedIhAcAuthority; } });
Object.defineProperty(exports, "clearIhAcAuthority", { enumerable: true, get: function () { return authority_1.clearIhAcAuthority; } });
Object.defineProperty(exports, "isIhAcContributionId", { enumerable: true, get: function () { return authority_1.isIhAcContributionId; } });
var from_forecast_context_1 = require("./from_forecast_context");
Object.defineProperty(exports, "buildUnifiedInputFromForecastContext", { enumerable: true, get: function () { return from_forecast_context_1.buildUnifiedInputFromForecastContext; } });
Object.defineProperty(exports, "summarizeUnifiedDayPlanForReason", { enumerable: true, get: function () { return from_forecast_context_1.summarizeUnifiedDayPlanForReason; } });
var cadence_1 = require("./cadence");
Object.defineProperty(exports, "unifiedPlanCadenceDigest", { enumerable: true, get: function () { return cadence_1.unifiedPlanCadenceDigest; } });
var dispatch_bridge_1 = require("./dispatch_bridge");
Object.defineProperty(exports, "buildUnifiedIhAcDispatchPublish", { enumerable: true, get: function () { return dispatch_bridge_1.buildUnifiedIhAcDispatchPublish; } });
Object.defineProperty(exports, "unifiedPlanToImmersionAllocations", { enumerable: true, get: function () { return dispatch_bridge_1.unifiedPlanToImmersionAllocations; } });
Object.defineProperty(exports, "unifiedPlanToClimateAllocations", { enumerable: true, get: function () { return dispatch_bridge_1.unifiedPlanToClimateAllocations; } });
var publish_ih_ac_1 = require("./publish_ih_ac");
Object.defineProperty(exports, "publishUnifiedIhAcDispatch", { enumerable: true, get: function () { return publish_ih_ac_1.publishUnifiedIhAcDispatch; } });
var fixtures_1 = require("./fixtures");
Object.defineProperty(exports, "buildSlots", { enumerable: true, get: function () { return fixtures_1.buildSlots; } });
Object.defineProperty(exports, "golden001Input", { enumerable: true, get: function () { return fixtures_1.golden001Input; } });
Object.defineProperty(exports, "golden001BadPlan", { enumerable: true, get: function () { return fixtures_1.golden001BadPlan; } });
Object.defineProperty(exports, "golden001GoodPlan", { enumerable: true, get: function () { return fixtures_1.golden001GoodPlan; } });
Object.defineProperty(exports, "golden001ScaledInput", { enumerable: true, get: function () { return fixtures_1.golden001ScaledInput; } });
Object.defineProperty(exports, "golden001ScaledBadPlan", { enumerable: true, get: function () { return fixtures_1.golden001ScaledBadPlan; } });
Object.defineProperty(exports, "golden002Input", { enumerable: true, get: function () { return fixtures_1.golden002Input; } });
Object.defineProperty(exports, "golden002BadPlanAbsentCharge", { enumerable: true, get: function () { return fixtures_1.golden002BadPlanAbsentCharge; } });
Object.defineProperty(exports, "golden002GoodPlan", { enumerable: true, get: function () { return fixtures_1.golden002GoodPlan; } });
Object.defineProperty(exports, "golden003Input", { enumerable: true, get: function () { return fixtures_1.golden003Input; } });
Object.defineProperty(exports, "golden003BadEarlyGrid", { enumerable: true, get: function () { return fixtures_1.golden003BadEarlyGrid; } });
Object.defineProperty(exports, "golden003GoodPv", { enumerable: true, get: function () { return fixtures_1.golden003GoodPv; } });
Object.defineProperty(exports, "golden004Input", { enumerable: true, get: function () { return fixtures_1.golden004Input; } });
Object.defineProperty(exports, "golden004ReplanPlan", { enumerable: true, get: function () { return fixtures_1.golden004ReplanPlan; } });
Object.defineProperty(exports, "golden004StalePlanNoReplan", { enumerable: true, get: function () { return fixtures_1.golden004StalePlanNoReplan; } });
Object.defineProperty(exports, "golden005Input", { enumerable: true, get: function () { return fixtures_1.golden005Input; } });
Object.defineProperty(exports, "golden005BadNightBatteryHeat", { enumerable: true, get: function () { return fixtures_1.golden005BadNightBatteryHeat; } });
Object.defineProperty(exports, "golden005GoodDayPvHeat", { enumerable: true, get: function () { return fixtures_1.golden005GoodDayPvHeat; } });
