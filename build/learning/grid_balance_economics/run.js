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
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.runGridBalanceEconomicsLearning = runGridBalanceEconomicsLearning;
const fs = __importStar(require("node:fs/promises"));
const path = __importStar(require("node:path"));
const atomic_write_1 = require("../../persistence/atomic_write");
const constants_1 = require("../day_telemetry/constants");
const persist_1 = require("../day_telemetry/persist");
const time_1 = require("../../operator/time");
const alpha_beta_1 = require("./alpha_beta");
const constants_2 = require("./constants");
const eta_balance_1 = require("./eta_balance");
const config_1 = require("../../addons/battery/config");
const eta_path_1 = require("./eta_path");
const ensure_states_1 = require("./ensure_states");
const persist_2 = require("./persist");
const windows_from_day_1 = require("./windows_from_day");
async function publish(host, id, val) {
    try {
        await host.setStateAsync(id, { val, ack: true });
    }
    catch {
        /* best-effort */
    }
}
const DAYS_CACHE_FILE = "days_cache_v1.json";
/** Tage ab dieser Tiefe (in Tagen vor heute) gelten als abgeschlossen. */
const CACHE_SETTLED_DAYS = 2;
async function readDaysCache(file) {
    const empty = { version: 1, days: {} };
    try {
        const parsed = JSON.parse(await fs.readFile(file, "utf8"));
        if (parsed?.version === 1 && parsed.days && typeof parsed.days === "object")
            return parsed;
    }
    catch {
        /* kein oder defekter Cache: neu aufbauen */
    }
    return empty;
}
function deriveDay(day, key, includeBalance) {
    let balance = null;
    if (includeBalance) {
        const sum = (a) => {
            let t = 0;
            let n = 0;
            for (const v of a)
                if (typeof v === "number" && Number.isFinite(v)) {
                    t += v;
                    n += 1;
                }
            return n ? t : null;
        };
        const soc = day.buckets.batterySocEndPct ?? [];
        const socVals = soc.filter((v) => typeof v === "number" && Number.isFinite(v));
        balance = {
            dateKey: key,
            chargedKwh: sum(day.buckets.batteryChargedKwh),
            dischargedKwh: sum(day.buckets.batteryDischargedKwh),
            socFirstPct: socVals.length ? socVals[0] : null,
            socLastPct: socVals.length ? socVals[socVals.length - 1] : null,
            socCoverage: soc.length ? socVals.length / soc.length : 0,
        };
    }
    return {
        windows: (0, windows_from_day_1.collectMatchWindows)(day),
        sessions: (0, eta_path_1.sessionsFromChargeSlots)({
            chargedKwh: day.buckets.batteryChargedKwh,
            dischargedKwh: day.buckets.batteryDischargedKwh,
            source: (day.buckets.batteryChargeSource ?? []),
        }),
        balance,
    };
}
async function runGridBalanceEconomicsLearning(host, opts = {}) {
    const now = opts.now ?? new Date();
    const timezone = opts.timezone ?? "Europe/Berlin";
    const generatedAt = now.toISOString();
    const dir = (0, persist_2.gridBalanceEconomicsDirFromHost)(host.getAbsolutePath);
    const telemetryDir = host.getAbsolutePath?.(constants_1.DAY_TELEMETRY_CATEGORY);
    if (!dir || !telemetryDir) {
        const cold = (0, persist_2.coldStartPersist)(generatedAt);
        if (dir)
            await (0, persist_2.writeGridBalanceEconomicsPersist)(dir, cold);
        await publishLearning(host, cold);
        return;
    }
    const todayKey = (0, time_1.localDateKeyInTimezone)(now, timezone);
    const oldestKey = (0, time_1.addDaysToDateKey)(todayKey, -(constants_2.LOOKBACK_DAYS - 1));
    let keys = [];
    try {
        keys = (await (0, persist_1.listDayTelemetryDateKeys)(telemetryDir)).filter((k) => k >= oldestKey && k <= todayKey);
    }
    catch (e) {
        host.log?.warn?.(`grid_balance_economics: day_telemetry nicht lesbar (${e instanceof Error ? e.message : String(e)})`);
    }
    const windows = [];
    const sessions = [];
    const balanceDays = [];
    const cacheFile = path.join(dir, DAYS_CACHE_FILE);
    const cache = await readDaysCache(cacheFile);
    const settledKey = (0, time_1.addDaysToDateKey)(todayKey, -CACHE_SETTLED_DAYS);
    let cacheDirty = false;
    for (const key of keys) {
        const settled = key <= settledKey;
        let derived = settled ? cache.days[key] : undefined;
        if (!derived) {
            const day = await (0, persist_1.readDayTelemetryDay)(telemetryDir, key);
            if (!day)
                continue;
            derived = deriveDay(day, key, key < todayKey);
            if (settled) {
                cache.days[key] = derived;
                cacheDirty = true;
            }
        }
        if (derived.balance)
            balanceDays.push(derived.balance);
        windows.push(...derived.windows);
        sessions.push(...derived.sessions);
    }
    for (const k of Object.keys(cache.days)) {
        if (k < oldestKey) {
            delete cache.days[k];
            cacheDirty = true;
        }
    }
    if (cacheDirty) {
        try {
            await fs.mkdir(dir, { recursive: true });
            await (0, atomic_write_1.atomicWriteFile)(cacheFile, JSON.stringify(cache));
        }
        catch (e) {
            host.log?.debug?.(`grid_balance_economics: Cache nicht geschrieben (${e instanceof Error ? e.message : String(e)})`);
        }
    }
    const alphaBeta = (0, alpha_beta_1.learnAlphaBeta)((0, alpha_beta_1.filterWindowsByLookback)(windows, now.getTime()));
    let eta = (0, eta_path_1.learnEtaPaths)(sessions);
    if (!eta.etaPvUsable || !eta.etaGridUsable) {
        const bal = (0, eta_balance_1.etaFromBalance)(balanceDays, (0, config_1.batteryConfigFromAdapter)(host.config).capacityManualKwh);
        if (bal.eta !== null) {
            eta = {
                ...eta,
                etaPvPath: eta.etaPvUsable ? eta.etaPvPath : bal.eta,
                etaGridPath: eta.etaGridUsable ? eta.etaGridPath : bal.eta,
                etaPvUsable: true,
                etaGridUsable: true,
                reasonDe: bal.reasonDe,
            };
        }
        else {
            eta = { ...eta, reasonDe: `${eta.reasonDe} ${bal.reasonDe}` };
        }
    }
    const persist = {
        module: "grid_balance_economics",
        schemaVersion: 1,
        generatedAt,
        alphaBeta,
        eta,
    };
    await (0, persist_2.writeGridBalanceEconomicsPersist)(dir, persist);
    await publishLearning(host, persist);
}
async function publishLearning(host, persist) {
    const a = persist.alphaBeta;
    const e = persist.eta;
    const S = ensure_states_1.GRID_BALANCE_ECONOMICS_STATE_IDS;
    await publish(host, S.status, a.usable ? "usable" : "not_usable");
    await publish(host, S.lastRun, persist.generatedAt);
    await publish(host, S.usable, a.usable);
    await publish(host, S.alpha, a.alpha);
    await publish(host, S.beta, a.beta);
    await publish(host, S.confidence, a.confidence);
    await publish(host, S.pairCount, a.pairCount);
    await publish(host, S.reasonDe, a.reasonDe);
    await publish(host, S.etaPvPath, e.etaPvPath);
    await publish(host, S.etaGridPath, e.etaGridPath);
    await publish(host, S.etaPvUsable, e.etaPvUsable);
    await publish(host, S.etaGridUsable, e.etaGridUsable);
    await publish(host, S.etaReasonDe, e.reasonDe);
}
