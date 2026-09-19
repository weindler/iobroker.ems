"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.fetchBrightSkyLocation = exports.fetchBrightSkyRegions = exports.fetchSmardPriceHistory = exports.smardCacheFresh = void 0;
const SMARD_BASE = "https://www.smard.de/app/chart_data";
const SMARD_PRICE_FILTER = 4169;
const THREE_HOURS_MS = 3 * 60 * 60 * 1000;
const TWO_YEARS_MS = 730 * 86_400_000;
async function fetchJson(fetchFn, url) {
    const response = await fetchFn(url, { headers: { accept: "application/json" }, signal: AbortSignal.timeout(15_000) });
    if (!response.ok)
        throw new Error(`HTTP ${response.status} für ${new URL(url).hostname}`);
    return response.json();
}
function smardCacheFresh(cache, nowMs) {
    const fetched = cache ? Date.parse(cache.fetchedAtIso) : Number.NaN;
    return Number.isFinite(fetched) && nowMs - fetched < THREE_HOURS_MS;
}
exports.smardCacheFresh = smardCacheFresh;
async function fetchSmardPriceHistory(cache, nowMs = Date.now(), fetchFn = fetch) {
    if (smardCacheFresh(cache, nowMs))
        return cache;
    const index = (await fetchJson(fetchFn, `${SMARD_BASE}/${SMARD_PRICE_FILTER}/DE/index_quarterhour.json`));
    const cutoff = nowMs - TWO_YEARS_MS;
    const chunks = Array.isArray(index.timestamps)
        ? index.timestamps.filter((value) => typeof value === "number" && value >= cutoff - 8 * 86_400_000)
        : [];
    if (chunks.length === 0)
        throw new Error("SMARD liefert keine aktuellen Preisblöcke.");
    const retained = new Map();
    for (const point of cache?.points ?? []) {
        if (point.ts >= cutoff)
            retained.set(point.ts, point.ctPerKwh);
    }
    const loadedChunks = new Set(cache?.chunkTimestamps ?? []);
    const latest = chunks[chunks.length - 1];
    const wanted = chunks.filter((chunk) => !loadedChunks.has(chunk) || chunk === latest);
    for (let offset = 0; offset < wanted.length; offset += 6) {
        const batch = wanted.slice(offset, offset + 6);
        const payloads = await Promise.all(batch.map((chunk) => fetchJson(fetchFn, `${SMARD_BASE}/${SMARD_PRICE_FILTER}/DE/${SMARD_PRICE_FILTER}_DE_quarterhour_${chunk}.json`)));
        for (const payload of payloads) {
            const series = payload.series;
            if (!Array.isArray(series))
                continue;
            for (const row of series) {
                if (!Array.isArray(row) || row.length < 2)
                    continue;
                const ts = Number(row[0]);
                const eurPerMwh = Number(row[1]);
                if (!Number.isFinite(ts) || !Number.isFinite(eurPerMwh) || ts < cutoff)
                    continue;
                retained.set(ts, eurPerMwh / 10);
            }
        }
    }
    return {
        fetchedAtIso: new Date(nowMs).toISOString(),
        chunkTimestamps: chunks,
        points: [...retained.entries()]
            .map(([ts, ctPerKwh]) => ({ ts, ctPerKwh }))
            .sort((a, b) => a.ts - b.ts),
    };
}
exports.fetchSmardPriceHistory = fetchSmardPriceHistory;
const GERMAN_REGIONS = [
    { region: "Nord", lat: 53.55, lon: 9.99 },
    { region: "West", lat: 51.23, lon: 6.78 },
    { region: "Mitte", lat: 50.11, lon: 8.68 },
    { region: "Ost", lat: 52.52, lon: 13.4 },
    { region: "Süd", lat: 48.14, lon: 11.58 },
];
function isoDate(ms) {
    return new Date(ms).toISOString().slice(0, 10);
}
function finite(value) {
    const n = typeof value === "number" ? value : Number(value);
    return Number.isFinite(n) ? n : null;
}
function parseWeather(payload) {
    const rows = payload?.weather;
    if (!Array.isArray(rows))
        return [];
    return rows.flatMap((row) => {
        if (!row || typeof row !== "object")
            return [];
        const value = row;
        const ts = Date.parse(String(value.timestamp ?? ""));
        if (!Number.isFinite(ts))
            return [];
        return [{
                ts,
                temperatureC: finite(value.temperature),
                windKmh: finite(value.wind_speed),
                solarKwhM2: finite(value.solar),
                cloudPct: finite(value.cloud_cover),
            }];
    });
}
async function fetchBrightSkyRegions(cache, nowMs = Date.now(), fetchFn = fetch) {
    const fetched = cache ? Date.parse(cache.fetchedAtIso) : Number.NaN;
    if (Number.isFinite(fetched) && nowMs - fetched < THREE_HOURS_MS)
        return cache;
    const firstDate = isoDate(nowMs);
    const lastDate = isoDate(nowMs + 7 * 86_400_000);
    const regions = await Promise.all(GERMAN_REGIONS.map(async ({ region, lat, lon }) => {
        const url = `https://api.brightsky.dev/weather?lat=${lat}&lon=${lon}&date=${firstDate}&last_date=${lastDate}`;
        return { region, points: parseWeather(await fetchJson(fetchFn, url)) };
    }));
    if (!regions.some((region) => region.points.length > 0)) {
        throw new Error("Bright Sky liefert keine Wetterprognose.");
    }
    return { fetchedAtIso: new Date(nowMs).toISOString(), regions };
}
exports.fetchBrightSkyRegions = fetchBrightSkyRegions;
async function fetchBrightSkyLocation(latitude, longitude, cache, nowMs = Date.now(), fetchFn = fetch) {
    const fetched = cache ? Date.parse(cache.fetchedAtIso) : Number.NaN;
    if (Number.isFinite(fetched) && nowMs - fetched < THREE_HOURS_MS)
        return cache;
    const firstDate = isoDate(nowMs);
    const lastDate = isoDate(nowMs + 7 * 86_400_000);
    const url = `https://api.brightsky.dev/weather?lat=${latitude}&lon=${longitude}&date=${firstDate}&last_date=${lastDate}`;
    const points = parseWeather(await fetchJson(fetchFn, url));
    if (points.length === 0)
        throw new Error("Bright Sky liefert keine lokale Anlagenprognose.");
    return { fetchedAtIso: new Date(nowMs).toISOString(), regions: [{ region: "Anlagenstandort", points }] };
}
exports.fetchBrightSkyLocation = fetchBrightSkyLocation;
