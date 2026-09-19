"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || function (mod) {
    if (mod && mod.__esModule) return mod;
    var result = {};
    if (mod != null) for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
    __setModuleDefault(result, mod);
    return result;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.runPriceOutlook = void 0;
const fs = __importStar(require("node:fs/promises"));
const path = __importStar(require("node:path"));
const atomic_write_1 = require("../../persistence/atomic_write");
const config_1 = require("../../intent/config");
const tibber_parse_1 = require("../price_forecast/tibber_parse");
const config_2 = require("./config");
const math_1 = require("./math");
const sources_1 = require("./sources");
async function readJson(filePath) {
    try {
        return JSON.parse(await fs.readFile(filePath, "utf8"));
    }
    catch {
        return null;
    }
}
async function resolveSystemLocation(host) {
    const cfg = (0, config_2.priceOutlookConfigFromAdapter)(host.config);
    let latitude = cfg.latitude;
    let longitude = cfg.longitude;
    let timezone = cfg.timezone || (0, config_1.intentAdminConfigFromAdapter)(host.config).timezone || "Europe/Berlin";
    if ((latitude === null || longitude === null || !cfg.timezone) && host.getForeignObjectAsync) {
        const system = await host.getForeignObjectAsync("system.config");
        const common = (system?.common ?? {});
        const native = (system?.native ?? {});
        const number = (value) => {
            const parsed = typeof value === "number" ? value : Number(value);
            return Number.isFinite(parsed) ? parsed : null;
        };
        latitude ??= number(common.latitude ?? native.latitude);
        longitude ??= number(common.longitude ?? native.longitude);
        if (!cfg.timezone)
            timezone = String(common.timeZone ?? native.timezone ?? timezone);
    }
    return { cfg, latitude, longitude, timezone };
}
async function writeOutlook(host, outlook, error = "") {
    await host.setStateAsync("learning.price_outlook.status", { val: outlook.status, ack: true });
    await host.setStateAsync("learning.price_outlook.status_de", { val: outlook.statusDe, ack: true });
    await host.setStateAsync("learning.price_outlook.last_update", { val: outlook.generatedAtIso, ack: true });
    await host.setStateAsync("learning.price_outlook.horizon_json", { val: JSON.stringify(outlook), ack: true });
    await host.setStateAsync("learning.price_outlook.error", { val: error, ack: true });
    if (outlook.spread.expectedCtPerKwh !== null) {
        await host.setStateAsync("learning.price_outlook.spread_ct_per_kwh", { val: outlook.spread.expectedCtPerKwh, ack: true });
    }
    await host.setStateAsync("learning.price_outlook.spread_confidence_pct", { val: outlook.spread.confidencePct, ack: true });
}
async function persist(baseDir, outlook, smard, weather) {
    await fs.mkdir(baseDir, { recursive: true });
    await (0, atomic_write_1.atomicWriteFile)(path.join(baseDir, "price_outlook_latest_v1.json"), `${JSON.stringify(outlook, null, 2)}\n`);
    if (smard)
        await (0, atomic_write_1.atomicWriteFile)(path.join(baseDir, "smard_price_cache_v1.json"), `${JSON.stringify(smard)}\n`);
    if (weather)
        await (0, atomic_write_1.atomicWriteFile)(path.join(baseDir, "brightsky_forecast_cache_v1.json"), `${JSON.stringify(weather)}\n`);
    const snapshots = path.join(baseDir, "snapshots");
    await fs.mkdir(snapshots, { recursive: true });
    const dayKey = outlook.generatedAtIso.slice(0, 10);
    const snapshotPath = path.join(snapshots, `${dayKey}.json`);
    try {
        await fs.access(snapshotPath);
    }
    catch {
        await (0, atomic_write_1.atomicWriteFile)(snapshotPath, `${JSON.stringify(outlook, null, 2)}\n`);
    }
    const cutoff = new Date(Date.now() - 730 * 86_400_000).toISOString().slice(0, 10);
    for (const name of await fs.readdir(snapshots)) {
        if (/^\d{4}-\d{2}-\d{2}\.json$/.test(name) && name.slice(0, 10) < cutoff)
            await fs.unlink(path.join(snapshots, name));
    }
}
async function runPriceOutlook(host, now = new Date()) {
    const { cfg, latitude, longitude, timezone } = await resolveSystemLocation(host);
    if (!cfg.enabled) {
        await host.setStateAsync("learning.price_outlook.status", { val: "disabled", ack: true });
        return;
    }
    const baseDir = host.getAbsolutePath?.("learning/price_outlook") ?? "";
    let smard = baseDir ? await readJson(path.join(baseDir, "smard_price_cache_v1.json")) : null;
    let weather = baseDir ? await readJson(path.join(baseDir, "brightsky_forecast_cache_v1.json")) : null;
    let localWeather = baseDir ? await readJson(path.join(baseDir, "brightsky_local_cache_v1.json")) : null;
    let smardAvailable = false;
    let weatherAvailable = false;
    const errors = [];
    try {
        smard = await (0, sources_1.fetchSmardPriceHistory)(smard, now.getTime());
        smardAvailable = true;
    }
    catch (error) {
        errors.push(`SMARD: ${error instanceof Error ? error.message : String(error)}`);
        smardAvailable = Boolean(smard?.points.length);
    }
    try {
        weather = await (0, sources_1.fetchBrightSkyRegions)(weather, now.getTime());
        weatherAvailable = true;
    }
    catch (error) {
        errors.push(`Bright Sky: ${error instanceof Error ? error.message : String(error)}`);
        weatherAvailable = Boolean(weather?.regions.length);
    }
    if (latitude !== null && longitude !== null) {
        try {
            localWeather = await (0, sources_1.fetchBrightSkyLocation)(latitude, longitude, localWeather, now.getTime());
        }
        catch (error) {
            errors.push(`Bright Sky lokal: ${error instanceof Error ? error.message : String(error)}`);
        }
    }
    const read = async (id) => id ? (await host.getStateAsync(id))?.val : null;
    const tibber = [
        ...(0, tibber_parse_1.parseTibberPriceJsonTo15MinSlots)(await read(cfg.todayJsonStateId)),
        ...(0, tibber_parse_1.parseTibberPriceJsonTo15MinSlots)(await read(cfg.tomorrowJsonStateId)),
    ];
    const outlook = (0, math_1.buildPriceOutlook)({
        now,
        timezone,
        tibber,
        smard: smard?.points ?? [],
        weather: weather?.regions ?? [],
        smardAvailable,
        weatherAvailable,
    });
    let pvKwp = cfg.pvKwp;
    if (pvKwp === null && host.getForeignStateAsync) {
        let sum = 0;
        let found = false;
        for (const id of cfg.pvKwpStateIds) {
            const value = Number((await host.getForeignStateAsync(id))?.val);
            if (Number.isFinite(value) && value > 0) {
                sum += value;
                found = true;
            }
        }
        if (found)
            pvKwp = sum;
    }
    const localPvRaw = localWeather && pvKwp !== null && pvKwp > 0
        ? (0, math_1.buildLocalPvRawKwh)({ weather: localWeather.regions, pvKwp, timezone, now })
        : Array(7).fill(null);
    await host.setStateAsync("learning.price_outlook.local_pv_raw_json", { val: JSON.stringify(localPvRaw), ack: true });
    for (let index = 0; index < localPvRaw.length; index++) {
        await host.setStateAsync(`learning.price_outlook.local_pv_day${index + 1}_raw_kwh`, { val: localPvRaw[index], ack: true });
    }
    if (errors.length) {
        outlook.status = outlook.status === "unavailable" ? "unavailable" : "degraded";
        outlook.statusDe = errors.join(" ");
    }
    await writeOutlook(host, outlook, errors.join(" | "));
    if (baseDir)
        await persist(baseDir, outlook, smard, weather);
    if (baseDir && localWeather)
        await (0, atomic_write_1.atomicWriteFile)(path.join(baseDir, "brightsky_local_cache_v1.json"), `${JSON.stringify(localWeather)}\n`);
    host.log.debug?.(`Sieben-Tage-Preisprognose: ${outlook.status}, ${outlook.days.length} Tage`);
}
exports.runPriceOutlook = runPriceOutlook;
