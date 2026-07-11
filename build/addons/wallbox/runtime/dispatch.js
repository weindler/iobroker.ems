"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.runWallboxDryrunDispatch = exports.powerToTargetCurrentA = exports.evaluateWallboxDispatchReadiness = exports.resetWallboxDispatchCache = exports.WALLBOX_AC_VOLTAGE_V = exports.WALLBOX_CURRENT_STEP_A = void 0;
const mapping_config_1 = require("../../../mapping_config");
const evcc_control_config_1 = require("../evcc_control_config");
/** EVCC/go-e typischerweise ganzzahlige Ampere — dokumentiert in EMS_LIGHT_WALLBOX_DRYRUN_DISPATCH.md */
exports.WALLBOX_CURRENT_STEP_A = 1;
exports.WALLBOX_AC_VOLTAGE_V = 230;
let lastCacheKey = null;
let lastResult = null;
function resetWallboxDispatchCache() {
    lastCacheKey = null;
    lastResult = null;
}
exports.resetWallboxDispatchCache = resetWallboxDispatchCache;
function mappingTarget(config, prefix) {
    const t = config[`${prefix}_target`];
    return typeof t === "string" ? t.trim() : "";
}
function mappingEnabled(config, prefix) {
    const en = config[`${prefix}_enabled`];
    return en !== false;
}
function evaluateWallboxDispatchReadiness(config) {
    const c = config && typeof config === "object" ? config : {};
    const controlModel = (0, evcc_control_config_1.resolveWallboxControlModel)(c);
    if (controlModel === "none") {
        return {
            controlMappingComplete: false,
            enableMappingAvailable: false,
            currentMappingAvailable: false,
            powerMappingAvailable: false,
            modeMappingAvailable: false,
            liveDispatchSupported: false,
            missingMappings: ["control_model_not_selected"],
            reasonDe: "Steuerpfad nicht ausgewählt — wb_control_model setzen (evcc oder legacy_direct).",
        };
    }
    if (controlModel === "evcc") {
        const modeMappingAvailable = (0, evcc_control_config_1.evccControlTargetForRole)(c, "set_mode").length > 0;
        const maxCurrentMappingAvailable = (0, evcc_control_config_1.evccControlTargetForRole)(c, "set_max_current_a").length > 0;
        const chargeModeValue = (0, evcc_control_config_1.evccModeChargeValue)(c);
        const missing = [];
        if (!modeMappingAvailable)
            missing.push("set_mode");
        if (!maxCurrentMappingAvailable)
            missing.push("set_max_current_a");
        if (!chargeModeValue)
            missing.push("evcc_charge_mode_value");
        const controlMappingComplete = modeMappingAvailable && maxCurrentMappingAvailable && chargeModeValue.length > 0;
        return {
            controlMappingComplete,
            enableMappingAvailable: false,
            currentMappingAvailable: maxCurrentMappingAvailable,
            powerMappingAvailable: false,
            modeMappingAvailable,
            liveDispatchSupported: false,
            missingMappings: missing,
            reasonDe: controlMappingComplete
                ? "EVCC-Control-Mapping grundsätzlich vorhanden; Live-Dispatch weiterhin gesperrt."
                : `Fehlende EVCC-Steuer-Mappings: ${missing.join(", ")}.`,
        };
    }
    const legacy = (0, mapping_config_1.legacyWallboxMappingFromConfig)(c);
    const enableMappingAvailable = mappingEnabled(c, mapping_config_1.WALLBOX_FLAT_PREFIX.set_enabled) &&
        (Boolean(legacy.set_enabled?.target_state) || mappingTarget(c, mapping_config_1.WALLBOX_FLAT_PREFIX.set_enabled).length > 0);
    const currentMappingAvailable = mappingEnabled(c, mapping_config_1.WALLBOX_FLAT_PREFIX.set_current_a) &&
        (Boolean(legacy.set_current_a?.target_state) || mappingTarget(c, mapping_config_1.WALLBOX_FLAT_PREFIX.set_current_a).length > 0);
    const powerMappingAvailable = mappingEnabled(c, mapping_config_1.WALLBOX_FLAT_PREFIX.set_charge_power_w) &&
        (Boolean(legacy.set_charge_power_w?.target_state) ||
            mappingTarget(c, mapping_config_1.WALLBOX_FLAT_PREFIX.set_charge_power_w).length > 0);
    const modeMappingAvailable = false;
    const missing = [];
    if (!enableMappingAvailable)
        missing.push("set_enabled");
    if (!currentMappingAvailable && !powerMappingAvailable)
        missing.push("set_current_a|set_charge_power_w");
    if (!modeMappingAvailable)
        missing.push("evcc_mode_write");
    const controlMappingComplete = enableMappingAvailable && (currentMappingAvailable || powerMappingAvailable);
    return {
        controlMappingComplete,
        enableMappingAvailable,
        currentMappingAvailable,
        powerMappingAvailable,
        modeMappingAvailable,
        liveDispatchSupported: false,
        missingMappings: missing,
        reasonDe: controlMappingComplete
            ? "Legacy-Write-Mapping grundsätzlich vorhanden; Live-Dispatch in v0.1.133 weiterhin gesperrt."
            : `Fehlende Steuer-Mappings: ${missing.join(", ")}.`,
    };
}
exports.evaluateWallboxDispatchReadiness = evaluateWallboxDispatchReadiness;
function powerToTargetCurrentA(powerW, phases, minCurrentA, maxCurrentA) {
    if (phases === null || phases <= 0) {
        return { currentA: null, reasonDe: "Phasenanzahl unbekannt — Strom nicht berechenbar." };
    }
    const denom = phases * exports.WALLBOX_AC_VOLTAGE_V;
    if (denom <= 0) {
        return { currentA: null, reasonDe: "Ungültige Phasenkonfiguration." };
    }
    let amps = powerW / denom;
    if (exports.WALLBOX_CURRENT_STEP_A >= 1) {
        amps = Math.round(amps / exports.WALLBOX_CURRENT_STEP_A) * exports.WALLBOX_CURRENT_STEP_A;
    }
    if (minCurrentA !== null && amps < minCurrentA) {
        return {
            currentA: null,
            reasonDe: `Berechneter Strom ${amps} A liegt unter Minimum ${minCurrentA} A.`,
        };
    }
    if (maxCurrentA !== null && amps > maxCurrentA) {
        amps = maxCurrentA;
        if (exports.WALLBOX_CURRENT_STEP_A >= 1) {
            amps = Math.floor(amps / exports.WALLBOX_CURRENT_STEP_A) * exports.WALLBOX_CURRENT_STEP_A;
        }
    }
    if (amps <= 0) {
        return { currentA: null, reasonDe: "Berechneter Strom ist null oder negativ." };
    }
    return { currentA: amps, reasonDe: `Zielstrom ${amps} A bei ${phases} Phasen.` };
}
exports.powerToTargetCurrentA = powerToTargetCurrentA;
function resolveDesiredEvccMode(readiness, _action) {
    if (!readiness.modeMappingAvailable)
        return null;
    return null;
}
function resolveDeadlineStatus(decision) {
    if (decision.deadlineReachable === true)
        return "ok";
    if (decision.deadlineReachable === false)
        return "at_risk";
    return "unknown";
}
function clampTargetPower(intent, decision) {
    if (intent.targetPowerW === null || intent.targetPowerW <= 0) {
        return { powerW: 0, capped: false, reasonDe: "" };
    }
    let power = intent.targetPowerW;
    let capped = false;
    if (decision.maxChargePowerW !== null && power > decision.maxChargePowerW) {
        power = decision.maxChargePowerW;
        capped = true;
    }
    if (decision.minChargePowerW !== null &&
        power > 0 &&
        power < decision.minChargePowerW) {
        return {
            powerW: null,
            capped: false,
            reasonDe: "Die allozierte Leistung liegt unter der technisch möglichen Mindestladeleistung.",
        };
    }
    return {
        powerW: power,
        capped,
        reasonDe: capped ? `Leistung auf technisches Maximum ${power} W begrenzt.` : "",
    };
}
function buildDryrunCommand(target, telemetry, chargingEnabled) {
    const entries = [];
    entries.push({
        role: "set_enabled",
        desiredValue: target.enableCharging,
        currentValue: chargingEnabled,
        writeRequired: target.enableCharging !== chargingEnabled,
    });
    if (target.targetCurrentA !== null) {
        entries.push({
            role: "set_current_a",
            desiredValue: target.targetCurrentA,
            currentValue: null,
            writeRequired: true,
        });
    }
    if (target.targetPowerW !== null && target.targetPowerW > 0) {
        entries.push({
            role: "set_charge_power_w",
            desiredValue: target.targetPowerW,
            currentValue: telemetry.chargePowerW,
            writeRequired: true,
        });
    }
    if (target.desiredEvccMode) {
        entries.push({
            role: "evcc_mode",
            desiredValue: target.desiredEvccMode,
            currentValue: null,
            writeRequired: true,
        });
    }
    return entries;
}
function runWallboxDryrunDispatch(input) {
    const cacheKey = {
        revision: input.intent.dailyPlanRevision,
        connected: input.decision.connected,
        action: input.intent.action,
        targetPowerW: input.intent.targetPowerW,
        phases: input.intent.phases,
        governance: input.governanceEnabled,
    };
    if (lastCacheKey &&
        lastResult &&
        lastCacheKey.revision === cacheKey.revision &&
        lastCacheKey.connected === cacheKey.connected &&
        lastCacheKey.action === cacheKey.action &&
        lastCacheKey.targetPowerW === cacheKey.targetPowerW &&
        lastCacheKey.phases === cacheKey.phases &&
        lastCacheKey.governance === cacheKey.governance) {
        return lastResult;
    }
    const readiness = evaluateWallboxDispatchReadiness(input.config);
    const deadlineStatus = resolveDeadlineStatus(input.decision);
    if (input.intent.action === "none") {
        const result = {
            dispatchStatus: "none",
            dispatchReasonDe: `Dryrun — keine Wallbox-Kommandos ausgeführt. ${input.intent.reasonDe}`,
            intent: input.intent,
            target: {
                action: "none",
                enableCharging: false,
                targetPowerW: 0,
                targetCurrentA: null,
                phases: input.intent.phases,
                desiredEvccMode: null,
                source: input.intent.source,
                valid: true,
                reasonDe: input.intent.reasonDe,
            },
            readiness,
            deadlineStatus,
            dryrunCommand: [],
        };
        lastCacheKey = cacheKey;
        lastResult = result;
        return result;
    }
    if (input.intent.action === "hold") {
        const result = {
            dispatchStatus: "hold",
            dispatchReasonDe: `Dryrun — Hold-Ziel; es wurde kein EVCC-Kommando ausgeführt. ${input.intent.reasonDe}`,
            intent: input.intent,
            target: {
                action: "hold",
                enableCharging: false,
                targetPowerW: 0,
                targetCurrentA: null,
                phases: input.intent.phases,
                desiredEvccMode: null,
                source: input.intent.source,
                valid: true,
                reasonDe: input.intent.reasonDe,
            },
            readiness,
            deadlineStatus,
            dryrunCommand: buildDryrunCommand({
                action: "hold",
                enableCharging: false,
                targetPowerW: 0,
                targetCurrentA: null,
                phases: input.intent.phases,
                desiredEvccMode: null,
                source: input.intent.source,
                valid: true,
                reasonDe: input.intent.reasonDe,
            }, input.telemetry, input.chargingEnabled),
        };
        lastCacheKey = cacheKey;
        lastResult = result;
        return result;
    }
    const clamp = clampTargetPower(input.intent, input.decision);
    if (clamp.powerW === null) {
        const holdIntent = { ...input.intent, action: "hold", enabled: false, targetPowerW: 0 };
        const result = {
            dispatchStatus: "degraded",
            dispatchReasonDe: `Dryrun — ${clamp.reasonDe} Kein EVCC-Kommando ausgeführt.`,
            intent: holdIntent,
            target: {
                action: "hold",
                enableCharging: false,
                targetPowerW: 0,
                targetCurrentA: null,
                phases: input.intent.phases,
                desiredEvccMode: null,
                source: input.intent.source,
                valid: false,
                reasonDe: clamp.reasonDe,
            },
            readiness,
            deadlineStatus,
            dryrunCommand: [],
        };
        lastCacheKey = cacheKey;
        lastResult = result;
        return result;
    }
    const phases = input.intent.phases ?? input.telemetry.activePhases ?? input.telemetry.configuredPhases;
    const current = powerToTargetCurrentA(clamp.powerW, phases, input.telemetry.minCurrentA, input.telemetry.maxCurrentA);
    if (current.currentA === null) {
        const result = {
            dispatchStatus: "degraded",
            dispatchReasonDe: `Dryrun — ${current.reasonDe} Kein EVCC-Kommando ausgeführt.`,
            intent: { ...input.intent, enabled: false, action: "hold", targetPowerW: 0 },
            target: {
                action: "hold",
                enableCharging: false,
                targetPowerW: 0,
                targetCurrentA: null,
                phases,
                desiredEvccMode: null,
                source: input.intent.source,
                valid: false,
                reasonDe: current.reasonDe,
            },
            readiness,
            deadlineStatus,
            dryrunCommand: [],
        };
        lastCacheKey = cacheKey;
        lastResult = result;
        return result;
    }
    const desiredMode = resolveDesiredEvccMode(readiness, input.intent.source);
    let targetReason = input.intent.reasonDe;
    if (clamp.capped)
        targetReason = `${clamp.reasonDe} ${targetReason}`;
    if (deadlineStatus === "at_risk") {
        targetReason = `${targetReason} Deadline voraussichtlich nicht erreichbar (Diagnose).`;
    }
    targetReason = `Dryrun-Ziel: Laden mit ${current.currentA} A (${clamp.powerW} W); es wurde kein EVCC-Kommando ausgeführt. ${targetReason}`;
    const target = {
        action: "charge",
        enableCharging: true,
        targetPowerW: clamp.powerW,
        targetCurrentA: current.currentA,
        phases,
        desiredEvccMode: desiredMode,
        source: input.intent.source,
        valid: true,
        reasonDe: targetReason,
    };
    const result = {
        dispatchStatus: "charge_planned",
        dispatchReasonDe: targetReason,
        intent: {
            ...input.intent,
            targetPowerW: clamp.powerW,
            targetCurrentA: current.currentA,
            phases,
        },
        target,
        readiness,
        deadlineStatus,
        dryrunCommand: buildDryrunCommand(target, input.telemetry, input.chargingEnabled),
    };
    lastCacheKey = cacheKey;
    lastResult = result;
    return result;
}
exports.runWallboxDryrunDispatch = runWallboxDryrunDispatch;
