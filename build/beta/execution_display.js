"use strict";
/**
 * Operator-/VIS-Darstellung Plan ≠ reale Ausführung.
 *
 * Befund 003 — zwei getrennte Ebenen:
 * - Execution-Authority: LIVE | DRYRUN (nur aus global∧addon mode)
 * - Operation/Plan: läuft / geplant / hold / wartet / … (strategischer Status + Runtime)
 *
 * Legacy `resolveExecutionDisplayPhase` bleibt für Heizstab-Agenda-Meta kompatibel.
 * Keine Write-Gates.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.resolveClimateUnitDisplay = exports.classifyClimateDemand = exports.buildAgendaExecutionHints = exports.formatAgendaSlotMetaDe = exports.formatExecutionNowLineDe = exports.agendaStatusLabelDe = exports.executionDisplayBadge = exports.resolveExecutionDisplayPhase = exports.isImmersionHardwareActive = exports.isPowerActive = exports.operationFromWallboxStrategy = exports.operationFromBatteryStrategy = exports.addonOffSummaryDe = exports.executionAuthorityBadge = exports.resolveExecutionAuthority = exports.resolveExecutionAuthorityFromModes = exports.isEffectiveLiveWriteAllowed = void 0;
const execution_mode_1 = require("../execution_mode");
const plan_visibility_1 = require("./plan_visibility");
const DEFAULT_ON_W = 50;
/** Hierarchie wie Execution-Gate: nur Global Live ∧ Addon Live → echte Writes. */
function isEffectiveLiveWriteAllowed(globalMode, addonModeVal) {
    return (0, execution_mode_1.parseGlobalMode)(globalMode) === "live" && (0, execution_mode_1.parseAddonMode)(addonModeVal) === "live";
}
exports.isEffectiveLiveWriteAllowed = isEffectiveLiveWriteAllowed;
/**
 * Execution-Badge aus Modes — unabhängig von Operation (Gesperrt/Hold/…).
 * Add-on off → AUS; sonst LIVE nur bei global∧addon live, sonst DRYRUN.
 */
function resolveExecutionAuthorityFromModes(globalMode, addonModeVal) {
    if ((0, execution_mode_1.parseAddonMode)(addonModeVal) === "off")
        return "off";
    return isEffectiveLiveWriteAllowed(globalMode, addonModeVal) ? "live" : "dryrun";
}
exports.resolveExecutionAuthorityFromModes = resolveExecutionAuthorityFromModes;
/** @deprecated Prefer resolveExecutionAuthorityFromModes — liveWriteAllowed allein kennt Off nicht. */
function resolveExecutionAuthority(liveWriteAllowed) {
    return liveWriteAllowed ? "live" : "dryrun";
}
exports.resolveExecutionAuthority = resolveExecutionAuthority;
function executionAuthorityBadge(authority) {
    if (authority === "live")
        return { authority: "live", cls: "live", labelDe: "LIVE" };
    if (authority === "off")
        return { authority: "off", cls: "idle", labelDe: "AUS" };
    return { authority: "dryrun", cls: "dryrun", labelDe: "DRYRUN" };
}
exports.executionAuthorityBadge = executionAuthorityBadge;
function addonOffSummaryDe(addonId) {
    switch (addonId) {
        case "wallbox":
            return "Wallbox: AUS · EVCC autonom";
        case "immersion_heater":
            return "Heizstab: AUS · EMS-Steuerung deaktiviert";
        case "battery":
            return "Batterie: AUS · EMS-Steuerung deaktiviert";
        case "air_conditioning":
            return "Klima: AUS · EMS-Steuerung deaktiviert";
        default:
            return `${addonId}: AUS · EMS-Steuerung deaktiviert`;
    }
}
exports.addonOffSummaryDe = addonOffSummaryDe;
function operationFromBatteryStrategy(status, hardwareActive) {
    if (hardwareActive) {
        return { kind: "running", labelDe: "Läuft", detailDe: "Hardware lädt." };
    }
    switch (status) {
        case "charge":
            return { kind: "planned", labelDe: "Geplant", detailDe: "Ladung im Unified-Plan." };
        case "hold":
            return {
                kind: "hold",
                labelDe: "Hold",
                detailDe: "Strategie: Hold · aktuell keine Ladeaktion",
            };
        case "reserve_protected":
            return {
                kind: "reserve_protected",
                labelDe: "Reserve geschützt",
                detailDe: "Strategie: Reserve/Hold · aktuell keine Ladeaktion",
            };
        case "available_for_discharge":
            return {
                kind: "ready",
                labelDe: "Bereit",
                detailDe: "Entladung/Defizitdeckung im Plan vorgesehen (kein neuer Write).",
            };
        default:
            return { kind: "idle", labelDe: "Kein Bedarf", detailDe: "Kein strategischer Ladebedarf." };
    }
}
exports.operationFromBatteryStrategy = operationFromBatteryStrategy;
function operationFromWallboxStrategy(status, hardwareActive) {
    if (hardwareActive && (status === "charging" || status === "scheduled")) {
        return { kind: "running", labelDe: "Läuft", detailDe: "Fahrzeug lädt." };
    }
    if (hardwareActive) {
        return { kind: "running", labelDe: "Läuft", detailDe: "Fahrzeug lädt (Hardware)." };
    }
    switch (status) {
        case "charging":
            return { kind: "planned", labelDe: "Geplant", detailDe: "Plan-Allocation aktiv." };
        case "scheduled":
            return { kind: "planned", labelDe: "Geplant", detailDe: "Ladung in späteren Fenstern." };
        case "waiting_for_vehicle":
            return {
                kind: "waiting",
                labelDe: "Wartet auf Fahrzeug",
                detailDe: "Kein Ladeplan erforderlich",
            };
        case "waiting_for_goal":
            return { kind: "waiting", labelDe: "Wartet auf Ladeziel", detailDe: "Ziel/Deadline fehlt." };
        case "goal_satisfied":
            return { kind: "ready", labelDe: "Ziel erreicht", detailDe: "Kein weiterer Ladebedarf." };
        default:
            return { kind: "idle", labelDe: "Kein Bedarf", detailDe: "Kein Wallbox-Ladebedarf." };
    }
}
exports.operationFromWallboxStrategy = operationFromWallboxStrategy;
function isPowerActive(powerW, thresholdW = DEFAULT_ON_W) {
    return powerW != null && Number.isFinite(powerW) && powerW >= thresholdW;
}
exports.isPowerActive = isPowerActive;
/**
 * Immersion: Feedback/Messung sind verlässlicher Istzustand.
 * Commanded allein zählt nur unter Live-Write-Authority (Dryrun setzt commanded ebenfalls).
 */
function isImmersionHardwareActive(input) {
    const thr = input.thresholdW ?? DEFAULT_ON_W;
    if ((input.feedbackStage ?? 0) > 0)
        return true;
    if (isPowerActive(input.measuredPowerW, thr))
        return true;
    if (input.liveWriteAllowed && isPowerActive(input.commandedPowerW, thr))
        return true;
    return false;
}
exports.isImmersionHardwareActive = isImmersionHardwareActive;
function resolveExecutionDisplayPhase(input) {
    if (input.liveWriteAllowed && input.hardwareActive)
        return "running";
    if (input.currentPlannedActive && !input.liveWriteAllowed)
        return "dryrun";
    if (input.currentPlannedActive || input.hasFuturePlan)
        return "planned";
    return "idle";
}
exports.resolveExecutionDisplayPhase = resolveExecutionDisplayPhase;
function executionDisplayBadge(phase) {
    switch (phase) {
        case "running":
            return { phase, cls: "on", labelDe: "Läuft" };
        case "dryrun":
            return { phase, cls: "dryrun", labelDe: "Dryrun" };
        case "planned":
            return { phase, cls: "plan", labelDe: "Geplant" };
        default:
            return { phase: "idle", cls: "idle", labelDe: "Pausiert" };
    }
}
exports.executionDisplayBadge = executionDisplayBadge;
/** Agenda-/Timeline-Status in Großbuchstaben (GEPLANT / DRYRUN / LÄUFT). */
function agendaStatusLabelDe(phase) {
    switch (phase) {
        case "running":
            return "LÄUFT";
        case "dryrun":
            return "DRYRUN";
        case "planned":
            return "GEPLANT";
        default:
            return null;
    }
}
exports.agendaStatusLabelDe = agendaStatusLabelDe;
/**
 * „Jetzt“-Zeile: bei Dryrun Planner und Hardware getrennt; LÄUFT nur realer Ist.
 */
function formatExecutionNowLineDe(input) {
    const plannerW = input.plannerPowerW != null && Number.isFinite(input.plannerPowerW) && input.plannerPowerW > 0
        ? Math.round(input.plannerPowerW)
        : null;
    if (input.phase === "running") {
        return input.hardwareLabelDe;
    }
    if (input.phase === "dryrun") {
        const planPart = plannerW != null ? `Planner: ${plannerW} W` : "Planner: aktiv";
        return `${planPart} · Hardware: ${input.hardwareLabelDe}`;
    }
    if (input.phase === "planned" && plannerW != null) {
        return `geplant ${plannerW} W · Hardware: ${input.hardwareLabelDe}`;
    }
    return input.hardwareLabelDe;
}
exports.formatExecutionNowLineDe = formatExecutionNowLineDe;
/** Agenda-Meta für den aktuellen Dryrun-/Plan-Slot. */
function formatAgendaSlotMetaDe(input) {
    const status = agendaStatusLabelDe(input.phase);
    if (!status)
        return null;
    const plannerW = input.plannerPowerW != null && Number.isFinite(input.plannerPowerW) && input.plannerPowerW > 0
        ? Math.round(input.plannerPowerW)
        : null;
    if (input.phase === "dryrun" && plannerW != null) {
        return `${status} · geplant ${plannerW} W`;
    }
    if (plannerW != null && (input.phase === "planned" || input.phase === "running")) {
        return `${status} · ${plannerW} W`;
    }
    return status;
}
exports.formatAgendaSlotMetaDe = formatAgendaSlotMetaDe;
function buildAgendaExecutionHints(input) {
    const thr = input.thresholdW ?? DEFAULT_ON_W;
    const ihOff = (0, execution_mode_1.parseAddonMode)(input.addonModes.immersion_heater) === "off";
    const batOff = (0, execution_mode_1.parseAddonMode)(input.addonModes.battery) === "off";
    const wbOff = (0, execution_mode_1.parseAddonMode)(input.addonModes.wallbox) === "off";
    const acOff = (0, execution_mode_1.parseAddonMode)(input.addonModes.air_conditioning) === "off";
    const ihLive = isEffectiveLiveWriteAllowed(input.globalMode, input.addonModes.immersion_heater);
    const batLive = isEffectiveLiveWriteAllowed(input.globalMode, input.addonModes.battery);
    const wbLive = isEffectiveLiveWriteAllowed(input.globalMode, input.addonModes.wallbox);
    const acLive = isEffectiveLiveWriteAllowed(input.globalMode, input.addonModes.air_conditioning);
    const ih = input.hardware.immersion ?? {};
    const bat = input.hardware.battery ?? {};
    const wb = input.hardware.wallbox ?? {};
    const ac = input.hardware.climate ?? {};
    const acRunning = (ac.unitRunning ?? []).some(Boolean);
    return {
        nowMs: input.nowMs ?? Date.now(),
        immersion_heater: {
            liveWriteAllowed: ihLive,
            hardwareActive: isImmersionHardwareActive({
                liveWriteAllowed: ihLive,
                feedbackStage: ih.feedbackStage,
                measuredPowerW: ih.measuredPowerW,
                commandedPowerW: ih.commandedPowerW,
                thresholdW: thr,
            }),
            currentAllocatedW: ihOff ? null : (ih.allocatedPowerW ?? null),
            executionOff: ihOff,
        },
        battery: {
            liveWriteAllowed: batLive,
            hardwareActive: isPowerActive(bat.chargingPowerW, thr),
            currentAllocatedW: batOff ? null : (bat.allocatedChargePowerW ?? null),
            executionOff: batOff,
        },
        wallbox: {
            liveWriteAllowed: wbLive,
            hardwareActive: wb.charging === true || isPowerActive(wb.chargePowerW, thr),
            currentAllocatedW: wbOff ? null : (wb.allocatedPowerW ?? null),
            executionOff: wbOff,
        },
        climate: {
            liveWriteAllowed: acLive,
            hardwareActive: acRunning,
            currentAllocatedW: acOff ? null : (ac.allocatedPowerW ?? null),
            executionOff: acOff,
        },
    };
}
exports.buildAgendaExecutionHints = buildAgendaExecutionHints;
function climateHoldReasonDe(reasonDe) {
    const r = String(reasonDe ?? "").trim();
    if (/Hysterese/i.test(r))
        return "Hysterese";
    if (/Mindes|min(?:imum)?[-\s]?runtime|Restlauf|minimum.?runtime/i.test(r))
        return "Mindeslaufzeit";
    if (/Reinigung|cleaning/i.test(r))
        return "Reinigung";
    if (/Rate-?Limit/i.test(r))
        return "Rate-Limit";
    if (/kein Kühlbedarf/i.test(r))
        return "Restlauf/Hysterese";
    const short = r.replace(/\.$/, "");
    return short.length > 0 && short.length <= 48 ? short : "Restlauf/Hysterese";
}
/**
 * Kühlbedarf aus Runtime-Entscheidung (decision_source + reason), nicht aus Allocation.
 * Allocation = Energiebudget; Feedback = Hardware-Ist.
 */
function classifyClimateDemand(input) {
    const src = String(input.decisionSource ?? "").toLowerCase();
    const reason = String(input.reasonDe ?? "");
    const noDemand = src === "temperature_no_demand" || /aktuell kein Kühlbedarf|kein cool\/dry-Bedarf/i.test(reason);
    const holdHint = /Hysterese|läuft weiter|Mindes|Restlauf|Reinigung/i.test(reason);
    if (input.hardwareRunning) {
        if (noDemand || holdHint)
            return "hold";
        if (/Läuft\s*\(|Einschalten|≥|Kühlbedarf aktiv/i.test(reason))
            return "active";
        return "active";
    }
    if (/Einschalten/i.test(reason) && !noDemand)
        return "active";
    if (noDemand)
        return "none";
    return "none";
}
exports.classifyClimateDemand = classifyClimateDemand;
/**
 * Klima-Unit-Karte: Hardware-Ist + Runtime-Bedarf + Planner-Budget — ohne Widerspruch.
 *
 * - Hardware on + Bedarf → LÄUFT · Kühlbedarf aktiv
 * - Außerhalb Zeitfenster ≠ Addon-Aus: „GESPERRT“, Future-Plan bleibt sichtbar
 * - Dryrun: niemals LÄUFT allein aus Allocation
 * - Execution-Authority (LIVE/DRYRUN) bleibt getrennt von Operation
 */
function resolveClimateUnitDisplay(input) {
    const allocOn = isPowerActive(input.allocatedPowerW);
    const hasFuture = input.hasFuturePlan === true || Boolean(input.nextPlanWindow);
    const demand = classifyClimateDemand({
        hardwareRunning: input.hardwareRunning,
        decisionSource: input.decisionSource,
        reasonDe: input.reasonDe,
    });
    const heuteLineDe = (0, plan_visibility_1.climateHeuteLineFromPlanDe)({
        likelyActiveToday: input.likelyActiveToday,
        expectedHoursToday: input.expectedHoursToday,
        expectedKwhToday: input.expectedKwhToday,
        hasPlanToday: allocOn || hasFuture,
    });
    const planLineDe = (0, plan_visibility_1.climatePlanLineFromWindowsDe)({
        currentAllocatedPowerW: input.allocatedPowerW,
        nextWindow: allocOn ? null : (input.nextPlanWindow ?? null),
        timezone: input.timezone,
    });
    const nextPlanLineDe = input.nextPlanWindow != null
        ? (0, plan_visibility_1.climatePlanLineFromWindowsDe)({
            currentAllocatedPowerW: null,
            nextWindow: input.nextPlanWindow,
            timezone: input.timezone,
        })
        : "keines";
    const reason = String(input.reasonDe ?? "").trim();
    const outsideWindow = (0, plan_visibility_1.isOutsideClockWindowReason)(reason);
    const finish = (partial) => ({
        ...partial,
        operationLabelDe: partial.operationLabelDe ?? partial.badge.labelDe,
        planLineDe,
        heuteLineDe,
        nextPlanLineDe,
    });
    if (!input.liveWriteAllowed) {
        const phase = resolveExecutionDisplayPhase({
            currentPlannedActive: allocOn,
            hasFuturePlan: hasFuture,
            liveWriteAllowed: false,
            hardwareActive: false,
        });
        const badge = executionDisplayBadge(phase);
        const hw = input.hardwareRunning ? "eingeschaltet" : "aus";
        const nowLineDe = formatExecutionNowLineDe({
            phase,
            plannerPowerW: input.allocatedPowerW,
            hardwareLabelDe: hw,
        });
        const operationLabelDe = outsideWindow
            ? "Gesperrt · außerhalb Zeitfenster"
            : badge.labelDe;
        const noteDe = demand === "none" && allocOn
            ? `Dryrun · Budget freigegeben, aktuell kein Kühlbedarf.`
            : reason || (phase === "dryrun" ? "Dryrun — keine realen Klima-Writes." : "Klima im Dryrun.");
        return finish({ phase, badge, demand, nowLineDe, noteDe, operationLabelDe });
    }
    if (input.hardwareRunning) {
        const badge = executionDisplayBadge("running");
        if (demand === "active") {
            return finish({
                phase: "running",
                badge,
                demand,
                operationLabelDe: "Läuft",
                nowLineDe: "Läuft · Kühlbedarf aktiv",
                noteDe: reason || "Kühlbedarf aktiv.",
            });
        }
        const hold = climateHoldReasonDe(input.reasonDe);
        return finish({
            phase: "running",
            badge,
            demand: "hold",
            operationLabelDe: "Läuft",
            nowLineDe: `Läuft · kein neuer Kühlbedarf, läuft wegen ${hold} weiter`,
            noteDe: reason || `Kein neuer Kühlbedarf — läuft wegen ${hold} weiter.`,
        });
    }
    if (outsideWindow) {
        const phase = resolveExecutionDisplayPhase({
            currentPlannedActive: allocOn,
            hasFuturePlan: hasFuture,
            liveWriteAllowed: true,
            hardwareActive: false,
        });
        const badge = hasFuture || allocOn
            ? { phase: phase === "idle" ? "planned" : phase, cls: "plan", labelDe: "Gesperrt" }
            : { phase: "idle", cls: "idle", labelDe: "Gesperrt" };
        return finish({
            phase: badge.phase,
            badge,
            demand,
            operationLabelDe: "Gesperrt · außerhalb Zeitfenster",
            nowLineDe: "gesperrt · außerhalb Zeitfenster",
            noteDe: reason || "Außerhalb Zeitfenster — kein Start.",
        });
    }
    if (allocOn && demand === "none") {
        return finish({
            phase: "planned",
            badge: { phase: "planned", cls: "plan", labelDe: "Bereit" },
            demand,
            operationLabelDe: "Bereit",
            nowLineDe: "aktuell kein Kühlbedarf",
            noteDe: reason ||
                `Daily Plan stellt ${Math.round(input.allocatedPowerW)} W bereit, aktuell kein Kühlbedarf.`,
        });
    }
    if (allocOn || hasFuture || input.likelyActiveToday === true) {
        const phase = "planned";
        return finish({
            phase,
            badge: executionDisplayBadge(phase),
            demand,
            operationLabelDe: "Geplant",
            nowLineDe: demand === "active" ? "Kühlbedarf — Start ausstehend" : "aus",
            noteDe: reason || "Klima geplant.",
        });
    }
    return finish({
        phase: "idle",
        badge: { phase: "idle", cls: "idle", labelDe: "Aus" },
        demand,
        operationLabelDe: "Aus",
        nowLineDe: "aus",
        noteDe: reason || "Klima aus.",
    });
}
exports.resolveClimateUnitDisplay = resolveClimateUnitDisplay;
