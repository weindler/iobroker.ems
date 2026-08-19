"use strict";
/**
 * Deterministische Produkt-Zusammenfassung für Beta (kein KI-Zwang).
 * Baut auf UnifiedDayPlan + Day-Explanation-Fakten auf.
 *
 * Befund 003: Agenda priorisiert Rest-heute / Nacht / morgen / Goals —
 * vergangene Fenster verdrängen keine Zukunft. Strategische Bat/Wb-Zeilen
 * ohne Fake-Leistungs-Allocations.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildProductSummaryDe = exports.buildUnifiedDayAgendaDe = exports.selectRelevantAgendaWindows = exports.mergeWindows = exports.agendaBucketForWindow = void 0;
const explain_1 = require("../learning/day_evaluation/explain");
const execution_display_1 = require("./execution_display");
const MAX_LEN = 900;
const AGENDA_ON_W = 50;
/** Max. Leistungsfenster je Consumer in der Produkt-Agenda (nur current+future). */
const MAX_WINDOWS_PER_KIND = 3;
function fmtKwh(n) {
    if (n === null || !Number.isFinite(n))
        return null;
    return n.toFixed(1).replace(".", ",");
}
function fmtEuroFromCt(ct) {
    if (ct === null || !Number.isFinite(ct))
        return null;
    return (ct / 100).toFixed(2).replace(".", ",");
}
function fmtClock(iso, timezone) {
    if (!iso)
        return null;
    const ms = Date.parse(iso);
    if (!Number.isFinite(ms))
        return null;
    try {
        return new Intl.DateTimeFormat("de-DE", {
            timeZone: timezone || "Europe/Berlin",
            hour: "2-digit",
            minute: "2-digit",
        }).format(new Date(ms));
    }
    catch {
        return iso.slice(11, 16);
    }
}
function fmtDayClock(iso, timezone) {
    const ms = Date.parse(iso);
    if (!Number.isFinite(ms))
        return null;
    try {
        return new Intl.DateTimeFormat("de-DE", {
            timeZone: timezone || "Europe/Berlin",
            weekday: "short",
            hour: "2-digit",
            minute: "2-digit",
        }).format(new Date(ms));
    }
    catch {
        return fmtClock(iso, timezone);
    }
}
function localDateKey(ms, timezone) {
    try {
        return new Intl.DateTimeFormat("en-CA", {
            timeZone: timezone || "Europe/Berlin",
            year: "numeric",
            month: "2-digit",
            day: "2-digit",
        }).format(new Date(ms));
    }
    catch {
        return new Date(ms).toISOString().slice(0, 10);
    }
}
function localHour(ms, timezone) {
    try {
        const parts = new Intl.DateTimeFormat("en-GB", {
            timeZone: timezone || "Europe/Berlin",
            hour: "2-digit",
            hourCycle: "h23",
        }).formatToParts(new Date(ms));
        return Number(parts.find((p) => p.type === "hour")?.value ?? "0");
    }
    catch {
        return new Date(ms).getUTCHours();
    }
}
function agendaBucketForWindow(w, nowMs, timezone) {
    const start = Date.parse(w.startIso);
    const end = Date.parse(w.endIso);
    if (nowMs >= start && nowMs < end)
        return "now";
    const today = localDateKey(nowMs, timezone);
    const startDay = localDateKey(start, timezone);
    const hour = localHour(start, timezone);
    if (startDay === today) {
        if (hour >= 18)
            return "tonight";
        return "rest_today";
    }
    const tomorrowMs = nowMs + 24 * 3600_000;
    const tomorrow = localDateKey(tomorrowMs, timezone);
    if (startDay === tomorrow)
        return "tomorrow";
    return "later";
}
exports.agendaBucketForWindow = agendaBucketForWindow;
function mergeWindows(cells, kind) {
    const sorted = cells
        .filter((a) => a.kind === kind && a.allocatedEnergyKwh > 0.02)
        .slice()
        .sort((a, b) => a.slot.startIso.localeCompare(b.slot.startIso));
    const out = [];
    for (const c of sorted) {
        const last = out[out.length - 1];
        if (last && last.endIso === c.slot.startIso) {
            last.endIso = c.slot.endIso;
            last.energyKwh += c.allocatedEnergyKwh;
        }
        else {
            out.push({
                startIso: c.slot.startIso,
                endIso: c.slot.endIso,
                energyKwh: c.allocatedEnergyKwh,
            });
        }
    }
    return out;
}
exports.mergeWindows = mergeWindows;
/**
 * Nur current+future; priorisiert now → rest_today → tonight → tomorrow → goal/deadline → later.
 * Vergangene Fenster verdrängen Zukunft nicht.
 */
function selectRelevantAgendaWindows(windows, nowMs, timezone, opts) {
    const max = opts?.max ?? MAX_WINDOWS_PER_KIND;
    const deadlineMs = opts?.deadlineIso ? Date.parse(opts.deadlineIso) : NaN;
    const active = windows.filter((w) => {
        const end = Date.parse(w.endIso);
        return Number.isFinite(end) && end > nowMs;
    });
    const rank = (w) => {
        const bucket = agendaBucketForWindow(w, nowMs, timezone);
        const base = bucket === "now"
            ? 0
            : bucket === "rest_today"
                ? 1
                : bucket === "tonight"
                    ? 2
                    : bucket === "tomorrow"
                        ? 3
                        : 4;
        const start = Date.parse(w.startIso);
        const nearDeadline = Number.isFinite(deadlineMs) &&
            Number.isFinite(start) &&
            start <= deadlineMs &&
            deadlineMs - start < 36 * 3600_000
            ? -0.5
            : 0;
        return base + nearDeadline;
    };
    return active
        .slice()
        .sort((a, b) => {
        const ra = rank(a);
        const rb = rank(b);
        if (ra !== rb)
            return ra - rb;
        return a.startIso.localeCompare(b.startIso);
    })
        .slice(0, max);
}
exports.selectRelevantAgendaWindows = selectRelevantAgendaWindows;
function windowLine(label, w, timezone, statusPrefix, nowMs) {
    const startMs = Date.parse(w.startIso);
    const sameDay = nowMs != null && Number.isFinite(startMs)
        ? localDateKey(startMs, timezone) === localDateKey(nowMs, timezone)
        : true;
    const a = sameDay ? fmtClock(w.startIso, timezone) : fmtDayClock(w.startIso, timezone);
    const b = sameDay ? fmtClock(w.endIso, timezone) : fmtDayClock(w.endIso, timezone);
    const e = fmtKwh(w.energyKwh);
    const prefix = statusPrefix ? `${statusPrefix} · ` : "";
    if (a && b)
        return `${prefix}${label} ${a}–${b}${e ? ` (${e} kWh)` : ""}`;
    return `${prefix}${label} geplant${e ? ` (${e} kWh)` : ""}`;
}
function windowContainsNow(w, nowMs) {
    const a = Date.parse(w.startIso);
    const b = Date.parse(w.endIso);
    return Number.isFinite(a) && Number.isFinite(b) && nowMs >= a && nowMs < b;
}
function currentAllocatedWFromPlan(plan, kind, nowMs) {
    let sum = 0;
    let any = false;
    for (const c of plan.allocations) {
        if (c.kind !== kind)
            continue;
        const a = Date.parse(c.slot.startIso);
        const b = Date.parse(c.slot.endIso);
        if (!Number.isFinite(a) || !Number.isFinite(b) || nowMs < a || nowMs >= b)
            continue;
        if (c.allocatedPowerW != null && Number.isFinite(c.allocatedPowerW)) {
            sum += c.allocatedPowerW;
            any = true;
        }
    }
    return any ? sum : null;
}
function agendaPhaseForKind(windows, exec, plan, kind, nowMs) {
    const currentWin = windows.find((w) => windowContainsNow(w, nowMs));
    const hasFuture = windows.some((w) => Date.parse(w.startIso) > nowMs);
    const fromPlan = currentAllocatedWFromPlan(plan, kind, nowMs);
    const plannerW = exec?.currentAllocatedW != null && Number.isFinite(exec.currentAllocatedW)
        ? exec.currentAllocatedW
        : fromPlan;
    const currentPlannedActive = Boolean(currentWin) || (0, execution_display_1.isPowerActive)(plannerW, AGENDA_ON_W);
    const phase = (0, execution_display_1.resolveExecutionDisplayPhase)({
        currentPlannedActive,
        hasFuturePlan: hasFuture,
        liveWriteAllowed: exec?.liveWriteAllowed === true,
        hardwareActive: exec?.hardwareActive === true,
    });
    if (!exec)
        return { phase: "planned", plannerW, statusMeta: null };
    const statusMeta = currentPlannedActive || phase === "running"
        ? (0, execution_display_1.formatAgendaSlotMetaDe)({ phase, plannerPowerW: plannerW })
        : phase === "planned" && hasFuture
            ? (0, execution_display_1.formatAgendaSlotMetaDe)({ phase, plannerPowerW: null })
            : null;
    return { phase, plannerW, statusMeta };
}
function strategyAgendaLines(battery, wallbox, batWindows, wbWindows, execution) {
    const lines = [];
    if (battery && batWindows.length === 0) {
        const auth = execution?.battery != null
            ? (0, execution_display_1.resolveExecutionAuthority)(execution.battery.liveWriteAllowed === true)
            : null;
        const prefix = auth === "dryrun" ? "DRYRUN · " : auth === "live" ? "LIVE · " : "";
        lines.push(`${prefix}Batterie: ${battery.summaryDe}`);
    }
    if (wallbox && wbWindows.length === 0) {
        const auth = execution?.wallbox != null
            ? (0, execution_display_1.resolveExecutionAuthority)(execution.wallbox.liveWriteAllowed === true)
            : null;
        const prefix = auth === "dryrun" ? "DRYRUN · " : auth === "live" ? "LIVE · " : "";
        lines.push(`${prefix}Wallbox: ${wallbox.summaryDe}`);
    }
    return lines;
}
/**
 * Kompakte, nutzerlesbare Tagesagenda aus Unified-Allocationen + Strategie.
 */
function buildUnifiedDayAgendaDe(plan, execution, strategy) {
    const tz = plan.timezone || "Europe/Berlin";
    // Prefer explicit execution clock, then plan generation time (tests/replay), never bare wall-clock alone.
    const planNowMs = Date.parse(plan.createdAtIso);
    const nowMs = execution?.nowMs ??
        (Number.isFinite(planNowMs) ? planNowMs : Date.now());
    const lines = [];
    const batOff = execution?.battery?.executionOff === true;
    const ihOff = execution?.immersion_heater?.executionOff === true;
    const acOff = execution?.climate?.executionOff === true;
    const wbOff = execution?.wallbox?.executionOff === true;
    const batAll = batOff ? [] : mergeWindows(plan.allocations, "battery_charge");
    const ihAll = ihOff ? [] : mergeWindows(plan.allocations, "immersion_heater");
    const acAll = acOff ? [] : mergeWindows(plan.allocations, "climate");
    const wbAll = wbOff ? [] : mergeWindows(plan.allocations, "wallbox");
    const deadline = plan.vehicleChargeEconomics?.deadlineIso ?? null;
    const bat = selectRelevantAgendaWindows(batAll, nowMs, tz);
    const ih = selectRelevantAgendaWindows(ihAll, nowMs, tz);
    const ac = selectRelevantAgendaWindows(acAll, nowMs, tz, { max: 4 });
    const wb = selectRelevantAgendaWindows(wbAll, nowMs, tz, { deadlineIso: deadline });
    const batSt = agendaPhaseForKind(bat, execution?.battery, plan, "battery_charge", nowMs);
    const ihSt = agendaPhaseForKind(ih, execution?.immersion_heater, plan, "immersion_heater", nowMs);
    const acSt = agendaPhaseForKind(ac, execution?.climate, plan, "climate", nowMs);
    const wbSt = agendaPhaseForKind(wb, execution?.wallbox, plan, "wallbox", nowMs);
    if (ihOff)
        lines.push((0, execution_display_1.addonOffSummaryDe)("immersion_heater"));
    if (batOff)
        lines.push((0, execution_display_1.addonOffSummaryDe)("battery"));
    if (wbOff)
        lines.push((0, execution_display_1.addonOffSummaryDe)("wallbox"));
    if (acOff)
        lines.push((0, execution_display_1.addonOffSummaryDe)("air_conditioning"));
    for (const w of bat) {
        const active = windowContainsNow(w, nowMs);
        lines.push(windowLine("Batterie laden", w, tz, active ? batSt.statusMeta : null, nowMs));
    }
    for (const w of ih) {
        const active = windowContainsNow(w, nowMs);
        lines.push(windowLine("Heizstab thermisch vorladen", w, tz, active ? ihSt.statusMeta : null, nowMs));
    }
    if (ac.length > 0) {
        const first = ac[0];
        const a = localDateKey(Date.parse(first.startIso), tz) === localDateKey(nowMs, tz)
            ? fmtClock(first.startIso, tz)
            : fmtDayClock(first.startIso, tz);
        const total = fmtKwh(ac.reduce((s, w) => s + w.energyKwh, 0));
        const active = ac.some((w) => windowContainsNow(w, nowMs));
        const prefix = active && acSt.statusMeta ? `${acSt.statusMeta} · ` : "";
        lines.push(a
            ? `${prefix}Klima ab ${a} freigegeben${total ? ` (~${total} kWh)` : ""}`
            : `${prefix}Klima geplant${total ? ` (~${total} kWh)` : ""}`);
    }
    for (const w of wb) {
        const cells = plan.allocations.filter((a) => a.kind === "wallbox" && a.slot.startIso >= w.startIso && a.slot.endIso <= w.endIso);
        const gridOptimal = cells.some((a) => a.energySource === "grid" && a.reasonCodes.includes("grid_import_cost_optimal"));
        const dead = fmtClock(plan.vehicleChargeEconomics?.deadlineIso ?? null, tz);
        let label = gridOptimal ? "Fahrzeugladung (günstiger Netzbezug)" : "Fahrzeugladung";
        if (dead && gridOptimal)
            label = `Fahrzeugladung — Abfahrt/Ziel ${dead}, günstiges Preisfenster`;
        else if (dead)
            label = `Fahrzeugladung — Ziel bis ${dead}`;
        const active = windowContainsNow(w, nowMs);
        lines.push(windowLine(label, w, tz, active ? wbSt.statusMeta : null, nowMs));
    }
    lines.push(...strategyAgendaLines(batOff ? undefined : strategy?.battery, wbOff ? undefined : strategy?.wallbox, bat, wb, execution));
    const night = plan.constraints.find((c) => c.id === "battery.night_reserve");
    if (night)
        lines.push(night.descriptionDe.replace(/\.$/, ""));
    else if (plan.reasonCodes.includes("battery_night_reserve")) {
        lines.push("Batterie-Nachtreserve im Plan berücksichtigt");
    }
    const thermalDeadline = plan.constraints.find((c) => c.id === "thermal.deadline");
    if (thermalDeadline?.ref) {
        const clock = fmtClock(thermalDeadline.ref, tz);
        if (clock)
            lines.push(`Boiler leer voraussichtlich ~${clock}`);
    }
    return lines;
}
exports.buildUnifiedDayAgendaDe = buildUnifiedDayAgendaDe;
/** Kurze, nutzerlesbare Tageszusammenfassung. */
function buildProductSummaryDe(plan, opts) {
    const x = (0, explain_1.buildDeterministicDayExplanation)(plan, opts);
    const parts = [];
    const pv = fmtKwh(x.heute.pvExpectedKwh);
    parts.push(pv !== null ? `Heute ${pv} kWh PV erwartet.` : "Heute PV-Erwartung unbekannt.");
    const batEnd = x.heute.batteryEndSocPct;
    if (batEnd !== null && Number.isFinite(batEnd)) {
        parts.push(`Batterie zum Tagesende ~${Math.round(batEnd)} %.`);
    }
    const agenda = buildUnifiedDayAgendaDe(plan, opts?.execution, opts?.strategy ?? null);
    if (agenda.length > 0) {
        parts.push(`Plan: ${agenda.join("; ")}.`);
    }
    else {
        if (x.heizstab.windows.length > 0) {
            const w0 = x.heizstab.windows[0];
            const a = fmtClock(w0.startIso, x.timezone);
            const b = fmtClock(w0.endIso, x.timezone);
            const e = fmtKwh(x.heizstab.totalKwh);
            parts.push(a && b
                ? `Heizstab ${a}–${b}${e ? ` (${e} kWh)` : ""}.`
                : `Heizstab geplant${e ? ` (${e} kWh)` : ""}.`);
        }
        if (x.klima.totalKwh > 0) {
            parts.push(`Klima ~${fmtKwh(x.klima.totalKwh)} kWh geplant.`);
        }
    }
    const req = fmtKwh(x.fahrzeug.requiredEnergyKwh);
    if (req !== null && !agenda.some((l) => /Fahrzeugladung|Wallbox/i.test(l))) {
        const dead = fmtClock(x.fahrzeug.deadlineIso, x.timezone);
        const pvE = fmtKwh(x.fahrzeug.plannedPvKwh);
        const gridE = fmtKwh(x.fahrzeug.plannedGridKwh);
        const cost = fmtEuroFromCt(x.fahrzeug.expectedGridCostCt);
        const goal = x.goals.find((g) => g.consumerId === "wallbox");
        const goalTxt = goal?.met === true
            ? "Ziel erreichbar."
            : goal?.met === false
                ? "Ziel gefährdet."
                : "Zielstatus unklar.";
        let line = `Fahrzeug benötigt ${req} kWh`;
        if (dead)
            line += ` bis ${dead}`;
        line += ".";
        if (pvE !== null || gridE !== null) {
            line += ` ${pvE ?? "?"} kWh PV + ${gridE ?? "?"} kWh Grid geplant.`;
        }
        if (cost !== null)
            line += ` Grid-Kosten ${cost} €.`;
        else if (x.fahrzeug.economicsCompleteness !== "full") {
            line += " Kosten nicht vollständig berechenbar.";
        }
        line += ` ${goalTxt}`;
        parts.push(line);
    }
    if (x.risiken.length > 0) {
        parts.push(`Hinweise: ${x.risiken.slice(0, 3).join(", ")}.`);
    }
    return parts.join(" ").slice(0, MAX_LEN);
}
exports.buildProductSummaryDe = buildProductSummaryDe;
