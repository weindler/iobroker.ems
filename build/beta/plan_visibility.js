"use strict";
/**
 * Autoritativer Plan-Sichtbarkeit (Beta Plan vs Runtime).
 *
 * plan_json = Zeit-/Leistungsfenster für Agenda/Karte.
 * Chart/Contribution dürfen keine nicht vorhandenen Allocations als GEPLANT erfinden.
 * Keine Write-Gates, kein Planner-/FSM-Umbau.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.climateHeuteLineFromPlanDe = exports.climatePlanLineFromWindowsDe = exports.formatPlanWindowClockDe = exports.isOutsideClockWindowReason = exports.chartStartsAbsentFromPlan = exports.firstOpenPlanVisWindow = exports.nextPlanVisWindow = exports.currentPlanVisWindow = exports.climateUnitTimelineWindowsFromPlanJson = exports.immersionTimelineWindowsFromPlanJson = exports.collapsePlanVisWindows = exports.collectPlanVisSlots = exports.PLAN_SLOT_MS = exports.PLAN_VIS_ON_W = void 0;
exports.PLAN_VIS_ON_W = 50;
exports.PLAN_SLOT_MS = 15 * 60 * 1000;
function parseJsonArray(raw) {
    if (Array.isArray(raw))
        return raw;
    if (typeof raw === "string" && raw.trim()) {
        try {
            const v = JSON.parse(raw);
            return Array.isArray(v) ? v : [];
        }
        catch {
            return [];
        }
    }
    return [];
}
function finiteMs(iso) {
    if (typeof iso !== "string" || !iso.trim())
        return null;
    const ms = Date.parse(iso);
    return Number.isFinite(ms) ? ms : null;
}
/**
 * Flache Allocation-Slots aus plan_json (Power ≥ floor, Slotende > now).
 */
function collectPlanVisSlots(planJson, opts) {
    const nowMs = opts?.nowMs ?? Date.now();
    const minW = opts?.minW ?? exports.PLAN_VIS_ON_W;
    const exact = opts?.contributionId ?? null;
    const prefix = opts?.contributionIdPrefix ?? null;
    const out = [];
    for (const row of parseJsonArray(planJson)) {
        if (!row || typeof row !== "object")
            continue;
        const a = row;
        const cid = typeof a.contributionId === "string" ? a.contributionId : "";
        if (exact && cid !== exact)
            continue;
        if (prefix && !cid.startsWith(prefix))
            continue;
        const w = typeof a.allocatedPowerW === "number" ? a.allocatedPowerW : Number(a.allocatedPowerW);
        if (!Number.isFinite(w) || w < minW)
            continue;
        const startIso = typeof a.slot?.startIso === "string" ? a.slot.startIso : "";
        const startMs = finiteMs(startIso);
        if (startMs === null)
            continue;
        const endIsoRaw = typeof a.slot?.endIso === "string" ? a.slot.endIso : "";
        const endParsed = finiteMs(endIsoRaw);
        const endMs = endParsed ?? startMs + exports.PLAN_SLOT_MS;
        const endIso = endIsoRaw && Number.isFinite(endParsed) ? endIsoRaw : new Date(endMs).toISOString();
        /** Nur kanonische 15-Min-Executable-Slots — Multi-Hour-Leaks nicht als Fenster zeigen. */
        if (endMs - startMs !== exports.PLAN_SLOT_MS)
            continue;
        if (endMs <= nowMs)
            continue;
        out.push({
            startIso,
            endIso,
            startMs,
            endMs,
            powerW: w,
            contributionId: cid,
        });
    }
    out.sort((a, b) => a.startMs - b.startMs || a.contributionId.localeCompare(b.contributionId));
    return out;
}
exports.collectPlanVisSlots = collectPlanVisSlots;
/**
 * Benachbarte Slots → Fenster; powerW = Max nur innerhalb dieses Fensters (kein globaler maxW).
 */
function collapsePlanVisWindows(slots) {
    if (slots.length === 0)
        return [];
    const sorted = slots.slice().sort((a, b) => a.startMs - b.startMs);
    const ranges = [];
    let cur = {
        startIso: sorted[0].startIso,
        endIso: sorted[0].endIso,
        startMs: sorted[0].startMs,
        endMs: sorted[0].endMs,
        powerW: sorted[0].powerW,
        contributionId: sorted[0].contributionId,
    };
    for (let i = 1; i < sorted.length; i++) {
        const s = sorted[i];
        const sameAddon = cur.contributionId === null || s.contributionId === cur.contributionId || cur.contributionId === "";
        if (sameAddon && s.startMs <= cur.endMs + 1000) {
            if (s.endMs >= cur.endMs) {
                cur.endMs = s.endMs;
                cur.endIso = s.endIso;
            }
            cur.powerW = Math.max(cur.powerW, s.powerW);
            if (cur.contributionId && s.contributionId !== cur.contributionId)
                cur.contributionId = null;
        }
        else {
            ranges.push(cur);
            cur = {
                startIso: s.startIso,
                endIso: s.endIso,
                startMs: s.startMs,
                endMs: s.endMs,
                powerW: s.powerW,
                contributionId: s.contributionId,
            };
        }
    }
    ranges.push(cur);
    return ranges;
}
exports.collapsePlanVisWindows = collapsePlanVisWindows;
/** Autoritatives Immersion-Timeline: nur plan_json, nie Chart. */
function immersionTimelineWindowsFromPlanJson(planJson, nowMs = Date.now()) {
    // IH-Slice enthält nur Heizstab-Einträge; Prefix filtert Misch-JSON ab.
    const slots = collectPlanVisSlots(planJson, {
        nowMs,
        contributionIdPrefix: "immersion_heater",
    });
    return collapsePlanVisWindows(slots.length > 0 ? slots : collectPlanVisSlots(planJson, { nowMs }));
}
exports.immersionTimelineWindowsFromPlanJson = immersionTimelineWindowsFromPlanJson;
function climateUnitTimelineWindowsFromPlanJson(planJson, unitIndex, nowMs = Date.now()) {
    const cid = `air_conditioning.unit_${unitIndex}`;
    return collapsePlanVisWindows(collectPlanVisSlots(planJson, { nowMs, contributionId: cid }));
}
exports.climateUnitTimelineWindowsFromPlanJson = climateUnitTimelineWindowsFromPlanJson;
function currentPlanVisWindow(windows, nowMs) {
    return windows.find((w) => nowMs >= w.startMs && nowMs < w.endMs) ?? null;
}
exports.currentPlanVisWindow = currentPlanVisWindow;
function nextPlanVisWindow(windows, nowMs) {
    const future = windows
        .filter((w) => w.startMs > nowMs)
        .sort((a, b) => a.startMs - b.startMs);
    return future[0] ?? null;
}
exports.nextPlanVisWindow = nextPlanVisWindow;
function firstOpenPlanVisWindow(windows, nowMs) {
    const open = windows
        .filter((w) => w.endMs > nowMs)
        .sort((a, b) => a.startMs - b.startMs);
    return open[0] ?? null;
}
exports.firstOpenPlanVisWindow = firstOpenPlanVisWindow;
/** Chart-Starts, die nicht in plan_json vorkommen — dürfen keine GEPLANT-Zeile erzeugen. */
function chartStartsAbsentFromPlan(chartStartMs, planWindows, slotMs = exports.PLAN_SLOT_MS) {
    return chartStartMs.filter((start) => {
        const end = start + slotMs;
        return !planWindows.some((w) => start < w.endMs && end > w.startMs);
    });
}
exports.chartStartsAbsentFromPlan = chartStartsAbsentFromPlan;
function isOutsideClockWindowReason(reasonDe) {
    return /Außerhalb Zeitfenster|außerhalb Betriebszeit/i.test(String(reasonDe ?? ""));
}
exports.isOutsideClockWindowReason = isOutsideClockWindowReason;
function formatPlanWindowClockDe(startIso, endIso, timezone = "Europe/Berlin") {
    const fmt = (iso) => {
        try {
            return new Intl.DateTimeFormat("de-DE", {
                timeZone: timezone,
                hour: "2-digit",
                minute: "2-digit",
                hour12: false,
            }).format(new Date(iso));
        }
        catch {
            const d = new Date(iso);
            if (!Number.isFinite(d.getTime()))
                return "—";
            return `${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")}`;
        }
    };
    const a = fmt(startIso);
    const b = fmt(endIso);
    return a === b ? a : `${a}–${b}`;
}
exports.formatPlanWindowClockDe = formatPlanWindowClockDe;
function climatePlanLineFromWindowsDe(input) {
    const minW = input.minW ?? exports.PLAN_VIS_ON_W;
    const cur = input.currentAllocatedPowerW != null &&
        Number.isFinite(input.currentAllocatedPowerW) &&
        input.currentAllocatedPowerW >= minW
        ? Math.round(input.currentAllocatedPowerW)
        : null;
    if (cur != null)
        return `Budget ${cur} W`;
    if (input.nextWindow) {
        const range = formatPlanWindowClockDe(input.nextWindow.startIso, input.nextWindow.endIso, input.timezone ?? "Europe/Berlin");
        return `nächstes ${range} · ${Math.round(input.nextWindow.powerW)} W`;
    }
    return "kein Budget";
}
exports.climatePlanLineFromWindowsDe = climatePlanLineFromWindowsDe;
function climateHeuteLineFromPlanDe(input) {
    if (input.likelyActiveToday === true &&
        input.expectedHoursToday != null &&
        Number.isFinite(input.expectedHoursToday) &&
        input.expectedKwhToday != null &&
        Number.isFinite(input.expectedKwhToday)) {
        const h = input.expectedHoursToday;
        const k = input.expectedKwhToday;
        return `~${h.toFixed(1).replace(/\.0$/, "")} h / ${k.toFixed(1).replace(".", ",")} kWh heute`;
    }
    if (input.hasPlanToday)
        return "Klima im Tagesplan";
    return "heute keine geplante Klimaaktion";
}
exports.climateHeuteLineFromPlanDe = climateHeuteLineFromPlanDe;
