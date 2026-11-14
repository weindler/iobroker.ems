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
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const strict_1 = __importDefault(require("node:assert/strict"));
const fs = __importStar(require("node:fs/promises"));
const os = __importStar(require("node:os"));
const path = __importStar(require("node:path"));
const node_test_1 = require("node:test");
const compare_1 = require("./compare");
const parse_1 = require("./parse");
const persist_1 = require("./persist");
const run_1 = require("./run");
const persist_2 = require("./persist");
const TOKEN = "SECRET-TOKEN-123";
function dayRows(date, origin, base, shape = 1) {
    const rows = [];
    const start = new Date(`${date}T00:00:00`).getTime();
    for (let i = 0; i < 96; i++) {
        const s = start + i * 900_000;
        const total = base + shape * Math.sin((i / 96) * 2 * Math.PI) * 5;
        rows.push({
            start: new Date(s).toISOString(),
            end: new Date(s + 900_000).toISOString(),
            price_ct_kwh: total / 1.19 - 12,
            total_ct_kwh: total,
            price_origin: origin,
        });
    }
    return rows;
}
(0, node_test_1.describe)("energyforecast parse", () => {
    (0, node_test_1.it)("liest Slots, Tarif und Herkunft, verwirft Ungültiges", () => {
        const p = (0, parse_1.parseEnergyforecastResponse)({
            plan: "free",
            generated_at: "2026-11-14T08:00:00Z",
            data: [
                { start: "2026-11-14T00:00:00+01:00", end: "2026-11-14T00:15:00+01:00", price_ct_kwh: 20.2, total_ct_kwh: 39.3176, price_origin: "market" },
                { start: "2026-11-14T00:15:00+01:00", end: "2026-11-14T00:30:00+01:00", total_ct_kwh: "x" },
                { start: "kaputt", total_ct_kwh: 30 },
                { start: "2026-11-14T00:30:00+01:00", total_ct_kwh: 9999 },
                { start: "2026-11-15T00:00:00+01:00", end: "2026-11-15T00:15:00+01:00", total_ct_kwh: 36.5, price_origin: "forecast" },
            ],
        });
        strict_1.default.equal(p.slots.length, 2);
        strict_1.default.equal(p.plan, "free");
        strict_1.default.equal(p.slots[0].origin, "market");
        strict_1.default.equal(p.slots[1].origin, "forecast");
        strict_1.default.equal(p.generatedAtIso, "2026-11-14T08:00:00Z");
    });
    (0, node_test_1.it)("kaputte Antwort → keine Slots, kein Fehler", () => {
        strict_1.default.equal((0, parse_1.parseEnergyforecastResponse)(null).slots.length, 0);
        strict_1.default.equal((0, parse_1.parseEnergyforecastResponse)("nicht json").slots.length, 0);
        strict_1.default.equal((0, parse_1.parseEnergyforecastResponse)({ data: "x" }).slots.length, 0);
    });
    (0, node_test_1.it)("zählt volle Tage nach heute und findet den laufenden Slot", () => {
        const rows = [...dayRows("2026-11-14", "market", 38), ...dayRows("2026-11-15", "forecast", 38), ...dayRows("2026-11-16", "forecast", 38)];
        const p = (0, parse_1.parseEnergyforecastResponse)({ data: rows });
        const now = new Date("2026-11-14T09:20:00").getTime();
        strict_1.default.equal((0, parse_1.fullDaysAhead)(p.slots, now), 2);
        strict_1.default.equal((0, parse_1.slotAt)(p.slots, now)?.startMs, new Date("2026-11-14T09:15:00").getTime());
    });
    (0, node_test_1.it)("entfernt den Token aus Texten", () => {
        strict_1.default.equal((0, parse_1.redactToken)(`fail https://x/api?token=${TOKEN}&a=1`, TOKEN).includes(TOKEN), false);
        strict_1.default.equal((0, parse_1.redactToken)("fetch failed token=abc", "").includes("abc"), false);
    });
});
(0, node_test_1.describe)("energyforecast Vergleich", () => {
    (0, node_test_1.it)("hält Prognose fest und vergleicht später gegen echten Preis (Vorlauf 1)", () => {
        const day1 = "2026-11-15";
        // Abruf am 14.11. 12:00: 15.11. ist Prognose
        const f1 = (0, parse_1.parseEnergyforecastResponse)({ data: [...dayRows("2026-11-14", "market", 38), ...dayRows(day1, "forecast", 38, 1)] });
        const at1 = new Date("2026-11-14T12:00:00").getTime();
        let file = (0, persist_1.addFetchToSnapshots)((0, persist_1.emptySnapshotFile)(), f1, at1);
        strict_1.default.equal(file.snapshots.length, 1);
        // gleicher Stand erneut → kein zweiter Snapshot
        file = (0, persist_1.addFetchToSnapshots)(file, f1, at1 + 6 * 3_600_000);
        strict_1.default.equal(file.snapshots.length, 1);
        // Abruf am 15.11. 06:00: 15.11. ist jetzt Markt mit stärkerer Spreizung und +2 ct
        const f2 = (0, parse_1.parseEnergyforecastResponse)({ data: dayRows(day1, "market", 40, 2) });
        file = (0, persist_1.addFetchToSnapshots)(file, f2, new Date("2026-11-15T06:00:00").getTime());
        const res = (0, compare_1.compareSnapshots)(file.snapshots, file.actual);
        const lead1 = res.perLead.find((l) => l.leadDays === 1);
        if (!lead1)
            throw new Error("Vorlauf 1 fehlt");
        strict_1.default.equal(lead1.days, 1);
        strict_1.default.ok(lead1.biasCt < -1.5 && lead1.biasCt > -2.5, `Bias ${lead1.biasCt}`); // Prognose ~2 ct zu niedrig
        strict_1.default.ok(lead1.actualSpreadCt > lead1.forecastSpreadCt, "Spreizung unterschätzt");
        strict_1.default.ok(lead1.cheapHitPct >= 80, `Treffer ${lead1.cheapHitPct}`);
        strict_1.default.ok(res.biasByHour.length > 0);
    });
    (0, node_test_1.it)("ohne echte Preise kein Ergebnis", () => {
        const f = (0, parse_1.parseEnergyforecastResponse)({ data: dayRows("2026-11-15", "forecast", 38) });
        const file = (0, persist_1.addFetchToSnapshots)((0, persist_1.emptySnapshotFile)(), f, new Date("2026-11-14T12:00:00").getTime());
        strict_1.default.deepEqual((0, compare_1.compareSnapshots)(file.snapshots, file.actual).perLead, []);
    });
    (0, node_test_1.it)("unvollständige Tage zählen nicht", () => {
        const snap = { atMs: new Date("2026-11-14T12:00:00").getTime(), slots: [[new Date("2026-11-15T00:00:00").getTime(), 40]] };
        const actual = { [String(new Date("2026-11-15T00:00:00").getTime())]: 41 };
        strict_1.default.equal((0, compare_1.compareSnapshots)([snap], actual).perDay.length, 0);
    });
});
(0, node_test_1.describe)("energyforecast Lauf", () => {
    let dir;
    (0, node_test_1.beforeEach)(async () => {
        dir = await fs.mkdtemp(path.join(os.tmpdir(), "ef-"));
        (0, run_1.resetEnergyforecastRunState)();
    });
    (0, node_test_1.afterEach)(async () => {
        await fs.rm(dir, { recursive: true, force: true });
    });
    function makeHost(config) {
        const states = new Map();
        const logs = [];
        const host = {
            config,
            getAbsolutePath: () => dir,
            setStateAsync: async (id, st) => {
                states.set(id, st.val);
            },
            getStateAsync: async () => null,
            setObjectNotExistsAsync: async () => undefined,
            log: {
                info: (m) => logs.push(m),
                debug: (m) => logs.push(m),
                warn: (m) => logs.push(m),
            },
        };
        return { host, states, logs };
    }
    (0, node_test_1.it)("aus oder ohne Token: kein Abruf", async () => {
        let calls = 0;
        const fetchFn = async () => {
            calls++;
            return new Response("{}");
        };
        const off = makeHost({ energyforecast_enabled: false, energyforecast_token: TOKEN });
        await (0, run_1.runEnergyforecast)(off.host, Date.now(), fetchFn);
        strict_1.default.equal(off.states.get("learning.energyforecast.status"), "disabled");
        const noTok = makeHost({ energyforecast_enabled: true, energyforecast_token: "" });
        await (0, run_1.runEnergyforecast)(noTok.host, Date.now(), fetchFn);
        strict_1.default.equal(noTok.states.get("learning.energyforecast.status"), "no_token");
        strict_1.default.equal(calls, 0);
    });
    (0, node_test_1.it)("Abruf ok: States, Tarif, Tage, Preis jetzt; zweiter Lauf holt nicht erneut", async () => {
        const now = new Date("2026-11-14T09:20:00").getTime();
        let calls = 0;
        let url = "";
        const body = {
            plan: "free",
            data: [...dayRows("2026-11-14", "market", 38), ...dayRows("2026-11-15", "forecast", 38), ...dayRows("2026-11-16", "forecast", 38)],
        };
        const fetchFn = async (u) => {
            calls++;
            url = String(u);
            return new Response(JSON.stringify(body), { status: 200 });
        };
        const { host, states, logs } = makeHost({ energyforecast_enabled: true, energyforecast_token: TOKEN });
        await (0, run_1.runEnergyforecast)(host, now, fetchFn);
        strict_1.default.equal(states.get("learning.energyforecast.status"), "ok");
        strict_1.default.equal(states.get("learning.energyforecast.plan"), "free");
        strict_1.default.equal(states.get("learning.energyforecast.days_ahead"), 2);
        strict_1.default.equal(typeof states.get("learning.energyforecast.price_now"), "number");
        strict_1.default.ok(url.includes(encodeURIComponent(TOKEN)));
        await (0, run_1.runEnergyforecast)(host, now + 3_600_000, fetchFn);
        strict_1.default.equal(calls, 1, "innerhalb von 6 h kein neuer Abruf");
        await (0, run_1.runEnergyforecast)(host, now + 6 * 3_600_000, fetchFn);
        strict_1.default.equal(calls, 2);
        const all = JSON.stringify([...states.entries()]) + logs.join("|");
        strict_1.default.equal(all.includes(TOKEN), false, "Token nie in States oder Logs");
    });
    (0, node_test_1.it)("Fehler 401: Status error, Token nicht im Text, Wiederholung erst nach 55 min", async () => {
        const now = new Date("2026-11-14T09:20:00").getTime();
        let calls = 0;
        const fetchFn = async () => {
            calls++;
            return new Response("no", { status: 401 });
        };
        const { host, states, logs } = makeHost({ energyforecast_enabled: true, energyforecast_token: TOKEN });
        await (0, run_1.runEnergyforecast)(host, now, fetchFn);
        strict_1.default.equal(states.get("learning.energyforecast.status"), "error");
        strict_1.default.match(String(states.get("learning.energyforecast.status_de")), /Token ungültig/);
        await (0, run_1.runEnergyforecast)(host, now + 10 * 60_000, fetchFn);
        strict_1.default.equal(calls, 1);
        await (0, run_1.runEnergyforecast)(host, now + 56 * 60_000, fetchFn);
        strict_1.default.equal(calls, 2);
        strict_1.default.equal((JSON.stringify([...states.entries()]) + logs.join("|")).includes(TOKEN), false);
    });
    (0, node_test_1.it)("Netzwerkfehler mit Token im Text wird bereinigt", async () => {
        const fetchFn = async () => {
            throw new Error(`getaddrinfo failed for https://x/api?token=${TOKEN}`);
        };
        const { host, states, logs } = makeHost({ energyforecast_enabled: true, energyforecast_token: TOKEN });
        await (0, run_1.runEnergyforecast)(host, Date.now(), fetchFn);
        strict_1.default.equal((JSON.stringify([...states.entries()]) + logs.join("|")).includes(TOKEN), false);
        strict_1.default.equal(states.get("learning.energyforecast.status"), "error");
    });
    (0, node_test_1.it)("Config und Fälligkeit", () => {
        strict_1.default.deepEqual((0, run_1.energyforecastConfigFromAdapter)({}), { enabled: false, token: "" });
        strict_1.default.equal((0, run_1.energyforecastConfigFromAdapter)({ energyforecast_enabled: true, energyforecast_token: "  t " }).token, "t");
        const c = (0, persist_2.emptyCache)();
        strict_1.default.equal((0, run_1.fetchDue)(c, 1000), true);
        strict_1.default.equal((0, run_1.fetchDue)({ ...c, fetchedAtIso: "x", lastAttemptMs: 1000 }, 1000 + 3_600_000), false);
        strict_1.default.equal((0, run_1.fetchDue)({ ...c, fetchedAtIso: "x", lastAttemptMs: 1000 }, 1000 + 6 * 3_600_000), true);
        strict_1.default.equal((0, run_1.fetchDue)({ ...c, lastAttemptMs: 1000, lastError: "e", lastErrorStatus: 429 }, 1000 + 2 * 3_600_000), false);
        strict_1.default.equal((0, parse_1.localDay)(new Date("2026-11-14T09:20:00").getTime()), "2026-11-14");
    });
});
const run_2 = require("./run");
const price_timeline_1 = require("../../operator/vis/price_timeline");
(0, node_test_1.describe)("festgehaltene Prognose im Preisdiagramm", () => {
    (0, node_test_1.it)("nimmt je Viertelstunde den neuesten Snapshot", () => {
        const m = (0, run_2.frozenForecastFromSnapshots)([
            { atMs: 2, slots: [[100, 30]] },
            { atMs: 1, slots: [[100, 20], [200, 25]] },
        ]);
        strict_1.default.equal(m.get(100), 30);
        strict_1.default.equal(m.get(200), 25);
    });
    (0, node_test_1.it)("hängt forecastCt nur an echte Preise, nicht an Prognose-Slots", () => {
        const now = new Date("2026-11-14T12:00:00.000Z");
        const t0 = Date.parse("2026-11-14T13:00:00.000Z");
        const t1 = t0 + 15 * 60_000;
        const board = (0, price_timeline_1.buildVisPriceTimeline)({
            now,
            currentPriceCt: 30,
            gbMinPriceCt: null,
            gbPriceAllowed: null,
            gridSlots: [
                { startIso: new Date(t0).toISOString(), priceCtPerKwh: 33 },
                { startIso: new Date(t1).toISOString(), priceCtPerKwh: 34 },
            ],
            forecastStartsMs: new Set([t1]),
            frozenForecastCt: new Map([[t0, 30.123], [t1, 31]]),
            batteryAlloc: [],
            wallboxAlloc: [],
            immersionAlloc: [],
            climateAlloc: [],
        });
        const a = board.slots.find((s) => Date.parse(s.startIso) === t0);
        const b = board.slots.find((s) => Date.parse(s.startIso) === t1);
        strict_1.default.equal(a?.forecastCt, 30.12);
        strict_1.default.equal(b?.forecastCt, undefined);
    });
});
