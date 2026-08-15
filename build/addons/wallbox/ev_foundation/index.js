"use strict";
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
exports.refreshEvFoundation = exports.publishEvFoundationDiagnosis = exports.ensureWallboxEvFoundationStates = exports.WALLBOX_EV_FOUNDATION_STATES = void 0;
const grid_read_1 = require("../../../operator/supply/grid_read");
const capabilities_1 = require("./capabilities");
const config_1 = require("./config");
const model_1 = require("./model");
const publish_1 = require("./publish");
const external_1 = require("./external");
const vehicle_model_1 = require("./vehicle_model");
const decision_1 = require("./decision");
__exportStar(require("./types"), exports);
__exportStar(require("./catalog"), exports);
__exportStar(require("./write_allowlist"), exports);
__exportStar(require("./config"), exports);
__exportStar(require("./capabilities"), exports);
__exportStar(require("./model"), exports);
__exportStar(require("./external"), exports);
__exportStar(require("./vehicle_model"), exports);
__exportStar(require("./decision"), exports);
var ensure_states_1 = require("./ensure_states");
Object.defineProperty(exports, "WALLBOX_EV_FOUNDATION_STATES", { enumerable: true, get: function () { return ensure_states_1.WALLBOX_EV_FOUNDATION_STATES; } });
Object.defineProperty(exports, "ensureWallboxEvFoundationStates", { enumerable: true, get: function () { return ensure_states_1.ensureWallboxEvFoundationStates; } });
var publish_2 = require("./publish");
Object.defineProperty(exports, "publishEvFoundationDiagnosis", { enumerable: true, get: function () { return publish_2.publishEvFoundationDiagnosis; } });
__exportStar(require("./execution"), exports);
async function refreshEvFoundation(host, snap, telemetryCfg) {
    const adapterConfig = host.config ?? {};
    const foundation = (0, config_1.evFoundationConfigFromAdapter)(adapterConfig);
    const hints = (0, config_1.resolveEvPlanningHints)(adapterConfig, snap.vehicle_name.status === "valid" ? snap.vehicle_name.value : null, snap.vehicle_title.status === "valid" ? snap.vehicle_title.value : null);
    const now = new Date(snap.observed_at);
    const external = await (0, external_1.readExternalEvInformation)(host, foundation, {
        now: Number.isFinite(now.getTime()) ? now : new Date(),
        fallbackMaxAcKw: hints.maxAcChargePowerKw,
        configDepartureAt: foundation.departureAt,
        timezone: (0, external_1.timezoneFromAdapterConfig)(adapterConfig),
    });
    const capabilities = (0, capabilities_1.resolveEvCapabilities)(telemetryCfg, snap, foundation, external);
    const built = (0, model_1.buildEvModelV1)({
        snap,
        foundation,
        capabilities,
        adapterConfig,
        external,
    });
    const model = (0, vehicle_model_1.applyEvFoundationIntegration)(built, capabilities, adapterConfig);
    const nowDate = Number.isFinite(now.getTime()) ? now : new Date();
    let priceWindows = [];
    try {
        const slots = await (0, grid_read_1.readDynamicTariffPrice15MinSlots)(host, nowDate);
        priceWindows = (0, decision_1.priceWindowsFrom15MinSlots)(slots);
    }
    catch {
        priceWindows = [];
    }
    const decision = (0, decision_1.evaluateEvTakeoverDecision)({
        model,
        nowMs: nowDate.getTime(),
        priceWindows,
        externalDeadlineIso: external.smartPlan.deadlineIso,
    });
    const diagnosed = (0, decision_1.applyEvTakeoverDiagnosis)(model, decision);
    await (0, publish_1.publishEvFoundationDiagnosis)(host, diagnosed, capabilities, snap.observed_at, external, decision);
    return { model: diagnosed };
}
exports.refreshEvFoundation = refreshEvFoundation;
