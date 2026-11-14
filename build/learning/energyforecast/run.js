"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.EF_RETRY_429_MS = exports.EF_RETRY_MS = exports.EF_FETCH_INTERVAL_MS = void 0;
exports.energyforecastConfigFromAdapter = energyforecastConfigFromAdapter;
exports.fetchDue = fetchDue;
exports.frozenForecastFromSnapshots = frozenForecastFromSnapshots;
exports.getEnergyforecastFrozenForecast = getEnergyforecastFrozenForecast;
exports.getEnergyforecastPrice15MinSlots = getEnergyforecastPrice15MinSlots;
exports.runEnergyforecast = runEnergyforecast;
exports.resetEnergyforecastRunState = resetEnergyforecastRunState;
const client_1 = require("./client");
const compare_1 = require("./compare");
const persist_1 = require("./persist");
const parse_1 = require("./parse");
/** Erfolgreicher Abruf: alle 6 h (die Quelle aktualisiert zweimal täglich, Free-Tarif: 50 Abrufe/Tag). */
exports.EF_FETCH_INTERVAL_MS = 6 * 3_600_000 - 10 * 60_000;
/** Nach Fehlern frühestens nach 55 Minuten wieder; bei Tageslimit (429) 6 Stunden. */
exports.EF_RETRY_MS = 55 * 60_000;
exports.EF_RETRY_429_MS = 6 * 3_600_000;
function energyforecastConfigFromAdapter(config) {
    const c = config && typeof config === "object" ? config : {};
    const e = c.energyforecast_enabled;
    const enabled = e === true || e === "true" || e === 1 || e === "1";
    const token = typeof c.energyforecast_token === "string" ? c.energyforecast_token.trim() : "";
    return { enabled, token };
}
function fetchDue(cache, nowMs) {
    if (!cache.fetchedAtIso && cache.lastAttemptMs === 0)
        return true;
    const sinceAttempt = nowMs - cache.lastAttemptMs;
    if (cache.lastError) {
        return sinceAttempt >= (cache.lastErrorStatus === 429 ? exports.EF_RETRY_429_MS : exports.EF_RETRY_MS);
    }
    return sinceAttempt >= exports.EF_FETCH_INTERVAL_MS;
}
async function setState(host, id, val) {
    await host.setStateAsync(`learning.energyforecast.${id}`, { val, ack: true });
}
let comparedOnce = false;
let memorySlots = [];
let memoryFrozen = new Map();
/** Je Viertelstunde die zuletzt festgehaltene Prognose (ct/kWh) — für den Vergleich mit dem echten Preis. */
function frozenForecastFromSnapshots(snapshots) {
    const out = new Map();
    for (const snap of [...snapshots].sort((a, b) => a.atMs - b.atMs)) {
        for (const [start, ct] of snap.slots)
            out.set(start, ct);
    }
    return out;
}
function getEnergyforecastFrozenForecast() {
    return memoryFrozen;
}
/**
 * Preis-Slots für die Planung (Gesamtpreis ct/kWh, ab `fromMs`). Leer, solange Energyforecast aus ist,
 * kein Token da ist oder noch nichts abgerufen wurde. Prognose-Slots tragen `origin: "forecast"`.
 */
function getEnergyforecastPrice15MinSlots(fromMs) {
    const out = [];
    for (const s of memorySlots) {
        if (s.startMs < fromMs)
            continue;
        const slot = { slotStartMs: s.startMs, priceCtPerKwh: Math.round(s.totalCt * 1000) / 1000 };
        if (s.origin === "forecast")
            slot.origin = "forecast";
        out.push(slot);
    }
    return out;
}
async function runEnergyforecast(host, nowMs = Date.now(), fetchFn) {
    const cfg = energyforecastConfigFromAdapter(host.config);
    if (!cfg.enabled) {
        memorySlots = [];
        await setState(host, "status", "disabled");
        await setState(host, "status_de", "Energyforecast im Admin nicht aktiviert.");
        return;
    }
    if (!cfg.token) {
        memorySlots = [];
        await setState(host, "status", "no_token");
        await setState(host, "status_de", "Energyforecast aktiviert, aber kein API-Token eingetragen.");
        return;
    }
    if (typeof host.getAbsolutePath !== "function")
        return;
    const dir = host.getAbsolutePath("learning/energyforecast");
    let cache = await (0, persist_1.readCache)(dir);
    let fetched = false;
    if (fetchDue(cache, nowMs)) {
        cache = { ...cache, lastAttemptMs: nowMs };
        try {
            const parsed = (0, parse_1.parseEnergyforecastResponse)(await (0, client_1.fetchEnergyforecast)(cfg.token, fetchFn));
            if (parsed.slots.length === 0)
                throw new Error("Antwort ohne gültige Preise");
            cache = {
                version: 1,
                fetchedAtIso: new Date(nowMs).toISOString(),
                lastAttemptMs: nowMs,
                lastError: null,
                lastErrorStatus: null,
                plan: parsed.plan,
                generatedAtIso: parsed.generatedAtIso,
                validUntilIso: parsed.validUntilIso,
                slots: parsed.slots,
            };
            await (0, persist_1.writeCache)(dir, cache);
            await (0, persist_1.writeSnapshots)(dir, (0, persist_1.addFetchToSnapshots)(await (0, persist_1.readSnapshots)(dir), parsed, nowMs));
            fetched = true;
            host.log.debug?.(`Energyforecast: ${parsed.slots.length} Slots, Tarif ${parsed.plan ?? "?"}.`);
        }
        catch (e) {
            const msg = (0, parse_1.redactToken)(e instanceof Error ? e.message : String(e), cfg.token);
            cache = {
                ...cache,
                lastError: msg,
                lastErrorStatus: e instanceof client_1.EnergyforecastHttpError ? e.status : null,
            };
            await (0, persist_1.writeCache)(dir, cache);
            host.log.warn(`Energyforecast-Abruf fehlgeschlagen: ${msg}`);
        }
    }
    memorySlots = cache.slots;
    if (cache.lastError) {
        await setState(host, "status", "error");
        await setState(host, "status_de", `Abruf fehlgeschlagen: ${cache.lastError}`);
    }
    else if (cache.fetchedAtIso) {
        await setState(host, "status", "ok");
        await setState(host, "status_de", `Letzter Abruf ${cache.fetchedAtIso}.`);
    }
    if (cache.plan !== null)
        await setState(host, "plan", cache.plan);
    if (cache.slots.length > 0) {
        await setState(host, "days_ahead", (0, parse_1.fullDaysAhead)(cache.slots, nowMs));
        const cur = (0, parse_1.slotAt)(cache.slots, nowMs);
        if (cur)
            await setState(host, "price_now", Math.round(cur.totalCt * 100) / 100);
    }
    if (fetched || !comparedOnce) {
        comparedOnce = true;
        const file = await (0, persist_1.readSnapshots)(dir);
        memoryFrozen = frozenForecastFromSnapshots(file.snapshots);
        const result = (0, compare_1.compareSnapshots)(file.snapshots, file.actual);
        await setState(host, "compare_json", JSON.stringify({ updatedIso: new Date(nowMs).toISOString(), snapshots: file.snapshots.length, ...result }));
    }
}
/** Nur für Tests. */
function resetEnergyforecastRunState() {
    comparedOnce = false;
    memorySlots = [];
    memoryFrozen = new Map();
}
