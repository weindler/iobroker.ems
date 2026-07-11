"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildWallboxDispatchIntent = void 0;
function mapSource(src) {
    if (src === "pv_surplus")
        return "pv_surplus";
    if (src === "grid")
        return "grid";
    if (src === "mixed")
        return "mixed";
    if (src === "none")
        return "none";
    return "unknown";
}
function noneIntent(reasonDe, now, revision = null) {
    return {
        action: "none",
        enabled: false,
        targetPowerW: 0,
        targetCurrentA: null,
        phases: null,
        source: "none",
        deadlineIso: null,
        requestedEnergyKwh: null,
        allocatedEnergyKwh: null,
        generatedAt: now.toISOString(),
        validUntil: null,
        dailyPlanRevision: revision,
        reasonDe,
    };
}
function holdIntent(decision, now, reasonDe) {
    return {
        action: "hold",
        enabled: false,
        targetPowerW: 0,
        targetCurrentA: null,
        phases: null,
        source: mapSource(decision.energySource),
        deadlineIso: decision.deadlineIso,
        requestedEnergyKwh: decision.requestedEnergyKwh,
        allocatedEnergyKwh: decision.allocatedEnergyKwh,
        generatedAt: now.toISOString(),
        validUntil: decision.slotEndIso,
        dailyPlanRevision: decision.dailyPlanRevision,
        reasonDe,
    };
}
function buildWallboxDispatchIntent(input) {
    const { decision, governanceEnabled, addonEnabled, phases, now } = input;
    const revision = decision.dailyPlanRevision;
    if (!addonEnabled) {
        return noneIntent("Wallbox-Add-on deaktiviert — kein Dispatch.", now, revision);
    }
    if (!governanceEnabled) {
        return noneIntent("Wallbox-Governance deaktiviert — kein Dispatch.", now, revision);
    }
    if (!decision.connected) {
        return noneIntent("Fahrzeug ist nicht verbunden; es wird kein Lade-Dispatch erzeugt.", now, revision);
    }
    if (decision.decisionSource === "missing_telemetry" || decision.decisionSource === "mapping_incomplete") {
        return noneIntent(decision.reasonDe, now, revision);
    }
    if (!decision.useDailyPlan || !decision.planValid) {
        return noneIntent("Kein gültiger EMS Daily Plan — Wallbox bleibt ohne Dispatch-Ziel.", now, revision);
    }
    if (decision.chargingAllowedByPlan && (decision.allocatedPowerW ?? 0) > 0) {
        const power = decision.allocatedPowerW;
        let reasonDe = decision.reasonDe;
        if (decision.energySource === "pv_surplus") {
            reasonDe = `Dryrun — PV-Überschussladung mit maximal ${power} W vorgesehen.`;
        }
        else if (decision.energySource === "grid") {
            reasonDe = `Dryrun — Netzladung mit ${power} W vorgesehen.`;
        }
        else if (decision.energySource === "mixed") {
            reasonDe = `Dryrun — gemischte Energiequelle; Zielgesamtleistung ${power} W.`;
        }
        else {
            reasonDe = `Dryrun — Ladung mit ${power} W laut Daily Plan vorgesehen.`;
        }
        return {
            action: "charge",
            enabled: true,
            targetPowerW: power,
            targetCurrentA: null,
            phases,
            source: mapSource(decision.energySource),
            deadlineIso: decision.deadlineIso,
            requestedEnergyKwh: decision.requestedEnergyKwh,
            allocatedEnergyKwh: decision.allocatedEnergyKwh,
            generatedAt: now.toISOString(),
            validUntil: decision.slotEndIso,
            dailyPlanRevision: revision,
            reasonDe,
        };
    }
    if (decision.dailyPlanStatus === "allocation_below_min_power") {
        return holdIntent(decision, now, "Die allozierte Leistung liegt unter der technisch möglichen Mindestladeleistung.");
    }
    if (decision.useDailyPlan) {
        return holdIntent(decision, now, "Daily Plan: im aktuellen Slot keine aktive Wallbox-Ladefreigabe (Hold).");
    }
    return noneIntent("Kein Dispatch-Ziel — sicherer Grundzustand.", now, revision);
}
exports.buildWallboxDispatchIntent = buildWallboxDispatchIntent;
