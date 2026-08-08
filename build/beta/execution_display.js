"use strict";
/**
 * Operator-/VIS-Darstellung Plan ≠ reale Ausführung.
 *
 * Keine Write-Gates — nur kombinierte Semantik für Badges/Agenda:
 * - GEPLANT: zukünftige (oder noch unbestätigte) Planner-Allocation
 * - DRYRUN: aktuelle Allocation > 0, aber effectiveLiveWriteAllowed == false
 * - LÄUFT: nur Global Live ∧ Addon Live ∧ bestätigter Runtime-Istzustand
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.resolveClimateUnitDisplay = exports.classifyClimateDemand = exports.buildAgendaExecutionHints = exports.formatAgendaSlotMetaDe = exports.formatExecutionNowLineDe = exports.agendaStatusLabelDe = exports.executionDisplayBadge = exports.resolveExecutionDisplayPhase = exports.isImmersionHardwareActive = exports.isPowerActive = exports.isEffectiveLiveWriteAllowed = void 0;
const execution_mode_1 = require("../execution_mode");
const DEFAULT_ON_W = 50;
/** Hierarchie wie Execution-Gate: nur Global Live ∧ Addon Live → echte Writes. */
function isEffectiveLiveWriteAllowed(globalMode, addonMode) {
    return (0, execution_mode_1.parseMode)(globalMode) === "live" && (0, execution_mode_1.parseMode)(addonMode) === "live";
}
exports.isEffectiveLiveWriteAllowed = isEffectiveLiveWriteAllowed;
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
            currentAllocatedW: ih.allocatedPowerW ?? null,
        },
        battery: {
            liveWriteAllowed: batLive,
            hardwareActive: isPowerActive(bat.chargingPowerW, thr),
            currentAllocatedW: bat.allocatedChargePowerW ?? null,
        },
        wallbox: {
            liveWriteAllowed: wbLive,
            hardwareActive: wb.charging === true || isPowerActive(wb.chargePowerW, thr),
            currentAllocatedW: wb.allocatedPowerW ?? null,
        },
        climate: {
            liveWriteAllowed: acLive,
            hardwareActive: acRunning,
            currentAllocatedW: ac.allocatedPowerW ?? null,
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
function climateHeuteLineDe(input) {
    if (input.likelyActiveToday === true &&
        input.expectedHoursToday != null &&
        Number.isFinite(input.expectedHoursToday) &&
        input.expectedKwhToday != null &&
        Number.isFinite(input.expectedKwhToday)) {
        const h = input.expectedHoursToday;
        const k = input.expectedKwhToday;
        return `~${h.toFixed(1).replace(/\.0$/, "")} h / ${k.toFixed(1).replace(".", ",")} kWh heute`;
    }
    return "kein Kühlbedarf geplant";
}
function climatePlanLineDe(allocatedPowerW) {
    if (isPowerActive(allocatedPowerW))
        return `Budget ${Math.round(allocatedPowerW)} W`;
    return "kein Budget";
}
/**
 * Klima-Unit-Karte: Hardware-Ist + Runtime-Bedarf + Planner-Budget — ohne Widerspruch.
 *
 * - Hardware on + Bedarf → LÄUFT · Kühlbedarf aktiv
 * - Hardware on + kein neuer Bedarf (Hysterese/Restlauf) → LÄUFT · läuft wegen &lt;Grund&gt; weiter
 * - Hardware off + Budget + kein Bedarf → Bereit · aktuell kein Kühlbedarf
 * - Dryrun: niemals LÄUFT allein aus Allocation
 */
function resolveClimateUnitDisplay(input) {
    const allocOn = isPowerActive(input.allocatedPowerW);
    const demand = classifyClimateDemand({
        hardwareRunning: input.hardwareRunning,
        decisionSource: input.decisionSource,
        reasonDe: input.reasonDe,
    });
    const heuteLineDe = climateHeuteLineDe(input);
    const planLineDe = climatePlanLineDe(input.allocatedPowerW ?? null);
    const reason = String(input.reasonDe ?? "").trim();
    if (!input.liveWriteAllowed) {
        const phase = resolveExecutionDisplayPhase({
            currentPlannedActive: allocOn,
            hasFuturePlan: input.hasFuturePlan === true,
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
        const noteDe = demand === "none" && allocOn
            ? `Dryrun · Budget freigegeben, aktuell kein Kühlbedarf.`
            : reason || (phase === "dryrun" ? "Dryrun — keine realen Klima-Writes." : "Klima im Dryrun.");
        return { phase, badge, demand, nowLineDe, noteDe, planLineDe, heuteLineDe };
    }
    if (input.hardwareRunning) {
        const badge = executionDisplayBadge("running");
        if (demand === "active") {
            return {
                phase: "running",
                badge,
                demand,
                nowLineDe: "Läuft · Kühlbedarf aktiv",
                noteDe: reason || "Kühlbedarf aktiv.",
                planLineDe,
                heuteLineDe,
            };
        }
        const hold = climateHoldReasonDe(input.reasonDe);
        return {
            phase: "running",
            badge,
            demand: "hold",
            nowLineDe: `Läuft · kein neuer Kühlbedarf, läuft wegen ${hold} weiter`,
            noteDe: reason || `Kein neuer Kühlbedarf — läuft wegen ${hold} weiter.`,
            planLineDe,
            heuteLineDe,
        };
    }
    if (allocOn && demand === "none") {
        return {
            phase: "planned",
            badge: { phase: "planned", cls: "plan", labelDe: "Bereit" },
            demand,
            nowLineDe: "aktuell kein Kühlbedarf",
            noteDe: reason ||
                `Daily Plan stellt ${Math.round(input.allocatedPowerW)} W bereit, aktuell kein Kühlbedarf.`,
            planLineDe,
            heuteLineDe,
        };
    }
    if (allocOn || input.hasFuturePlan === true || input.likelyActiveToday === true) {
        const phase = "planned";
        return {
            phase,
            badge: executionDisplayBadge(phase),
            demand,
            nowLineDe: demand === "active" ? "Kühlbedarf — Start ausstehend" : "aus",
            noteDe: reason || "Klima geplant.",
            planLineDe,
            heuteLineDe,
        };
    }
    return {
        phase: "idle",
        badge: { phase: "idle", cls: "idle", labelDe: "Aus" },
        demand,
        nowLineDe: "aus",
        noteDe: reason || "Klima aus.",
        planLineDe,
        heuteLineDe,
    };
}
exports.resolveClimateUnitDisplay = resolveClimateUnitDisplay;
