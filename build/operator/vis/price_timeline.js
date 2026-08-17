"use strict";
/**
 * Read-only VIS price board: reshape existing grid-supply prices + Daily-Plan
 * allocations. No second optimiser, no invented prices, no planner math.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildVisPriceTimeline = exports.emptyVisPriceTimeline = exports.VIS_PRICE_TIMEZONE = exports.VIS_PRICE_MAX_AHEAD_HOURS = exports.VIS_PRICE_MIN_AHEAD_HOURS = exports.VIS_PRICE_LOOKBACK_HOURS = exports.VIS_PRICE_TIMELINE_STATE_ID = void 0;
const contribution_ids_1 = require("../contribution_ids");
const time_1 = require("../time");
const addon_plan_publish_1 = require("../daily_plan/addon_plan_publish");
exports.VIS_PRICE_TIMELINE_STATE_ID = "operator.vis.price_timeline_json";
exports.VIS_PRICE_LOOKBACK_HOURS = 6;
exports.VIS_PRICE_MIN_AHEAD_HOURS = 18;
exports.VIS_PRICE_MAX_AHEAD_HOURS = 18;
exports.VIS_PRICE_TIMEZONE = "Europe/Berlin";
function finitePrice(v) {
    if (v === null || v === undefined || v === "")
        return null;
    const n = typeof v === "number" ? v : Number(v);
    return Number.isFinite(n) ? n : null;
}
function parseIsoMs(iso) {
    if (!iso || typeof iso !== "string")
        return null;
    const ms = Date.parse(iso);
    return Number.isFinite(ms) ? ms : null;
}
function hourKeyLocal(ms, timezone) {
    const d = new Date(ms);
    const key = (0, time_1.localDateKeyInTimezone)(d, timezone);
    const hour = new Intl.DateTimeFormat("en-US", {
        timeZone: timezone,
        hour: "2-digit",
        hour12: false,
    }).format(d);
    return `${key}T${hour}`;
}
function isRunnable(entry) {
    const w = finitePrice(entry.allocatedPowerW);
    return w !== null && w >= addon_plan_publish_1.RUNNABLE_ALLOCATION_FLOOR_W;
}
function isBatteryGridCharge(entry) {
    if (!isRunnable(entry))
        return false;
    const cid = String(entry.contributionId ?? "");
    if (cid !== contribution_ids_1.CONTRIBUTION_IDS.BATTERY_CHARGE && !cid.startsWith("battery.charge"))
        return false;
    if (entry.energySource === "grid")
        return true;
    const gridW = finitePrice(entry.gridPowerW) ?? 0;
    return gridW >= addon_plan_publish_1.RUNNABLE_ALLOCATION_FLOOR_W;
}
function classifyAlloc(entry) {
    if (!isRunnable(entry))
        return null;
    const cid = String(entry.contributionId ?? "");
    if (cid.startsWith("wallbox.") || cid === contribution_ids_1.CONTRIBUTION_IDS.WALLBOX_EV_SESSION)
        return "ev";
    if (cid.startsWith("immersion_heater.") || cid === contribution_ids_1.CONTRIBUTION_IDS.IMMERSION_MANDATORY || cid === contribution_ids_1.CONTRIBUTION_IDS.IMMERSION_FLEXIBLE) {
        return "immersion";
    }
    if (cid.startsWith("air_conditioning."))
        return "climate";
    if (isBatteryGridCharge(entry))
        return "battery_grid";
    return null;
}
function actionStarts(entries, kind) {
    const out = new Set();
    for (const entry of entries) {
        if (classifyAlloc(entry) !== kind)
            continue;
        const start = entry.slot?.startIso;
        if (start)
            out.add(start);
    }
    return out;
}
function pickExtreme(slots, which) {
    if (!slots.length)
        return null;
    let best = slots[0];
    for (const s of slots) {
        if (which === "min" ? s.priceCt < best.priceCt : s.priceCt > best.priceCt)
            best = s;
    }
    return { priceCt: best.priceCt, startIso: best.startIso };
}
function emptyVisPriceTimeline(now, timezone = exports.VIS_PRICE_TIMEZONE) {
    const nowIso = now.toISOString();
    return {
        generatedAt: nowIso,
        source: "grid_supply+allocation",
        nowIso,
        timezone,
        currentPriceCt: null,
        gbMinPriceCt: null,
        gbPriceAllowed: null,
        dayMin: null,
        dayMax: null,
        windowStartIso: nowIso,
        windowEndIso: nowIso,
        slots: [],
    };
}
exports.emptyVisPriceTimeline = emptyVisPriceTimeline;
/** Compact VIS payload from already-published prices + allocations. */
function buildVisPriceTimeline(input) {
    const timezone = input.timezone?.trim() || exports.VIS_PRICE_TIMEZONE;
    const nowMs = input.now.getTime();
    const nowIso = input.now.toISOString();
    const lookbackMs = exports.VIS_PRICE_LOOKBACK_HOURS * 3600_000;
    const minAheadMs = exports.VIS_PRICE_MIN_AHEAD_HOURS * 3600_000;
    const maxAheadMs = exports.VIS_PRICE_MAX_AHEAD_HOURS * 3600_000;
    const priced = [];
    for (const raw of input.gridSlots) {
        const startIso = typeof raw.startIso === "string" ? raw.startIso : "";
        const startMs = parseIsoMs(startIso);
        if (startMs === null)
            continue;
        const endIso = typeof raw.endIso === "string" && parseIsoMs(raw.endIso) !== null
            ? raw.endIso
            : new Date(startMs + 15 * 60_000).toISOString();
        const endMs = parseIsoMs(endIso) ?? startMs + 15 * 60_000;
        priced.push({
            startIso,
            endIso,
            startMs,
            endMs,
            priceCt: finitePrice(raw.priceCtPerKwh),
        });
    }
    priced.sort((a, b) => a.startMs - b.startMs);
    const windowStartMs = nowMs - lookbackMs;
    const windowEndMs = nowMs + Math.min(minAheadMs, maxAheadMs);
    const todayKey = (0, time_1.localDateKeyInTimezone)(input.now, timezone);
    const nowHourKey = hourKeyLocal(nowMs, timezone);
    const gbMin = finitePrice(input.gbMinPriceCt);
    const batStarts = actionStarts(input.batteryAlloc, "battery_grid");
    const evStarts = actionStarts(input.wallboxAlloc, "ev");
    const ihStarts = actionStarts(input.immersionAlloc, "immersion");
    const acStarts = actionStarts(input.climateAlloc, "climate");
    const dayPriced = [];
    const slots = [];
    for (const s of priced) {
        if (s.priceCt !== null && (0, time_1.localDateKeyInTimezone)(new Date(s.startMs), timezone) === todayKey) {
            dayPriced.push({ startIso: s.startIso, priceCt: s.priceCt });
        }
        if (s.endMs <= windowStartMs || s.startMs >= windowEndMs)
            continue;
        const actions = [];
        if (batStarts.has(s.startIso))
            actions.push("battery_grid");
        if (evStarts.has(s.startIso))
            actions.push("ev");
        if (ihStarts.has(s.startIso))
            actions.push("immersion");
        if (acStarts.has(s.startIso))
            actions.push("climate");
        const gbPriceOk = gbMin !== null && s.priceCt !== null && s.priceCt >= gbMin;
        slots.push({
            startIso: s.startIso,
            endIso: s.endIso,
            priceCt: s.priceCt,
            current: nowMs >= s.startMs && nowMs < s.endMs,
            currentHour: hourKeyLocal(s.startMs, timezone) === nowHourKey,
            gbPriceOk,
            actions,
        });
    }
    return {
        generatedAt: input.generatedAt ?? nowIso,
        source: "grid_supply+allocation",
        nowIso,
        timezone,
        currentPriceCt: finitePrice(input.currentPriceCt),
        gbMinPriceCt: gbMin,
        gbPriceAllowed: input.gbPriceAllowed,
        dayMin: pickExtreme(dayPriced, "min"),
        dayMax: pickExtreme(dayPriced, "max"),
        windowStartIso: new Date(windowStartMs).toISOString(),
        windowEndIso: new Date(windowEndMs).toISOString(),
        slots,
    };
}
exports.buildVisPriceTimeline = buildVisPriceTimeline;
