"use strict";
/**
 * Deterministische Produkt-Zusammenfassung für Beta (kein KI-Zwang).
 * Baut auf UnifiedDayPlan + Day-Explanation-Fakten auf.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildProductSummaryDe = exports.buildUnifiedDayAgendaDe = void 0;
const explain_1 = require("../learning/day_evaluation/explain");
const MAX_LEN = 900;
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
function windowLine(label, w, timezone) {
    const a = fmtClock(w.startIso, timezone);
    const b = fmtClock(w.endIso, timezone);
    const e = fmtKwh(w.energyKwh);
    if (a && b)
        return `${label} ${a}–${b}${e ? ` (${e} kWh)` : ""}`;
    return `${label} geplant${e ? ` (${e} kWh)` : ""}`;
}
/**
 * Kompakte, nutzerlesbare Tagesagenda aus Unified-Allocationen.
 * Kein Debug-Dump — nur zeitliche Hauptaktionen.
 */
function buildUnifiedDayAgendaDe(plan) {
    const tz = plan.timezone || "Europe/Berlin";
    const lines = [];
    const bat = mergeWindows(plan.allocations, "battery_charge");
    const ih = mergeWindows(plan.allocations, "immersion_heater");
    const ac = mergeWindows(plan.allocations, "climate");
    const wb = mergeWindows(plan.allocations, "wallbox");
    for (const w of bat.slice(0, 2))
        lines.push(windowLine("Batterie laden", w, tz));
    for (const w of ih.slice(0, 2))
        lines.push(windowLine("Heizstab thermisch vorladen", w, tz));
    if (ac.length > 0) {
        const first = ac[0];
        const a = fmtClock(first.startIso, tz);
        const total = fmtKwh(ac.reduce((s, w) => s + w.energyKwh, 0));
        lines.push(a
            ? `Klima ab ${a} freigegeben${total ? ` (~${total} kWh)` : ""}`
            : `Klima geplant${total ? ` (~${total} kWh)` : ""}`);
    }
    for (const w of wb.slice(0, 2)) {
        const cells = plan.allocations.filter((a) => a.kind === "wallbox" && a.slot.startIso >= w.startIso && a.slot.endIso <= w.endIso);
        const gridOptimal = cells.some((a) => a.energySource === "grid" && a.reasonCodes.includes("grid_import_cost_optimal"));
        const dead = fmtClock(plan.vehicleChargeEconomics?.deadlineIso ?? null, tz);
        let label = gridOptimal ? "Fahrzeugladung (günstiger Netzbezug)" : "Fahrzeugladung";
        if (dead && gridOptimal)
            label = `Fahrzeugladung — Abfahrt/Ziel ${dead}, günstiges Preisfenster`;
        else if (dead)
            label = `Fahrzeugladung — Ziel bis ${dead}`;
        lines.push(windowLine(label, w, tz));
    }
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
            lines.push(`Puffer leer voraussichtlich ~${clock}`);
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
    const agenda = buildUnifiedDayAgendaDe(plan);
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
    if (req !== null && !agenda.some((l) => l.startsWith("Fahrzeugladung"))) {
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
