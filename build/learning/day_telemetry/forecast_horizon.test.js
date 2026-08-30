"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const strict_1 = __importDefault(require("node:assert/strict"));
const forecast_horizon_js_1 = require("./forecast_horizon.js");
const types_js_1 = require("./types.js");
const slots_js_1 = require("./slots.js");
const TZ = "Europe/Berlin";
const HORIZON_SLOTS = 192; /* 48h @ 15 Min — realistischer Multi-Tage-Preis-/PV-Horizont. */
function horizonSlots(horizonStartMs, value) {
    return Array.from({ length: HORIZON_SLOTS }, (_, i) => [
        horizonStartMs + i * 900_000,
        value(i),
    ]);
}
function baseSnapshot(tsIso, priceSlots, pvSlotKwh, overrides = {}) {
    return {
        id: `id-${tsIso}`,
        tsIso,
        date: "2026-08-30",
        timezone: TZ,
        globalMode: "balanced",
        contributionRevision: 1,
        pvExpectedDayKwh: 18,
        houseLoadExpectedDayKwh: 11,
        batterySocPct: 50,
        batteryCapacityKwh: 10,
        batteryNightReserveKwh: 2,
        priceSlots,
        pvSlotKwh,
        wallboxRequiredEnergyKwh: null,
        wallboxDeadlineIso: null,
        wallboxConnected: null,
        wallboxPresenceDigest: null,
        thermalBufferTempC: null,
        thermalEmptyAtIso: null,
        thermalHeadroomKwh: null,
        climateUnits: [],
        wallboxTargetSocPct: null,
        wallboxMinimumDepartureSocPct: null,
        wallboxEnergyGoalHard: null,
        wallboxManagementMode: null,
        batteryDecision: null,
        ...overrides,
    };
}
(0, node_test_1.describe)("day_telemetry forecast_horizon (Speicher-Kompaktierung)", () => {
    (0, node_test_1.it)("nahezu identische Snapshots (nur aktueller Slot ändert sich) → EINE Basisrevision + winzige Deltas", () => {
        const layout = (0, slots_js_1.buildDaySlotLayout)("2026-08-30", TZ);
        const day = (0, types_js_1.emptyDayRecord)("2026-08-30", TZ, layout.startMs, layout.endMs, layout.slotCount);
        const priceBase = horizonSlots(layout.startMs, () => 22);
        const pvBase = horizonSlots(layout.startMs, (i) => (i > 24 && i < 96 ? 1.5 : 0));
        /* 50 Replans, jeweils nur der "aktuelle" Slot (Live-PV-Override) unterschiedlich. */
        for (let r = 0; r < 50; r++) {
            const pv = pvBase.map((e) => [e[0], e[1]]);
            pv[30] = [pv[30][0], 1.5 + r * 0.01];
            day.forecastSnapshots.push(baseSnapshot(`2026-08-30T08:${String(r).padStart(2, "0")}:00.000Z`, priceBase, pv, {
                id: `snap-${r}`,
                batterySocPct: 40 + r,
            }));
        }
        const compacted = (0, forecast_horizon_js_1.compactForecastSnapshotsForPersist)(day);
        strict_1.default.equal(compacted.forecastRevisions?.length, 1, "genau eine Basisrevision erwartet");
        for (const snap of compacted.forecastSnapshots) {
            strict_1.default.equal(snap.priceSlots.length, 0);
            strict_1.default.equal(snap.pvSlotKwh.length, 0);
            strict_1.default.ok(snap.forecastRevisionId);
            strict_1.default.equal(snap.forecastPriceDelta, undefined, "Preis ändert sich in diesem Szenario nie");
            strict_1.default.ok((snap.forecastPvDelta?.length ?? 0) <= 1, "pro Snapshot nur der geänderte Slot als Delta");
        }
        /* day (In-Memory) bleibt unverändert — voller Inhalt, keine Mutation durch compact(). */
        strict_1.default.equal(day.forecastSnapshots[0].priceSlots.length, HORIZON_SLOTS);
        strict_1.default.equal(day.forecastSnapshots[0].pvSlotKwh.length, HORIZON_SLOTS);
    });
    (0, node_test_1.it)("materielle Preisrevision (>15% der Slots anders) → neue Basisrevision statt Delta", () => {
        const layout = (0, slots_js_1.buildDaySlotLayout)("2026-08-30", TZ);
        const day = (0, types_js_1.emptyDayRecord)("2026-08-30", TZ, layout.startMs, layout.endMs, layout.slotCount);
        const priceA = horizonSlots(layout.startMs, () => 22);
        const pv = horizonSlots(layout.startMs, () => 1);
        day.forecastSnapshots.push(baseSnapshot("t0", priceA, pv, { id: "s0" }));
        day.forecastSnapshots.push(baseSnapshot("t1", priceA, pv, { id: "s1" }));
        /* Echte Preisrevision: neue Tarif-Slots ab jetzt für die zweite Tageshälfte. */
        const priceB = priceA.map((e, i) => (i >= 96 ? [e[0], 40] : e));
        day.forecastSnapshots.push(baseSnapshot("t2", priceB, pv, { id: "s2" }));
        day.forecastSnapshots.push(baseSnapshot("t3", priceB, pv, { id: "s3" }));
        const compacted = (0, forecast_horizon_js_1.compactForecastSnapshotsForPersist)(day);
        strict_1.default.equal(compacted.forecastRevisions?.length, 2, "Preisrevision muss eine zweite Basisrevision erzeugen");
        const revIdOf = (id) => compacted.forecastSnapshots.find((s) => s.id === id)?.forecastRevisionId;
        strict_1.default.equal(revIdOf("s0"), revIdOf("s1"));
        strict_1.default.equal(revIdOf("s2"), revIdOf("s3"));
        strict_1.default.notEqual(revIdOf("s0"), revIdOf("s2"));
    });
    (0, node_test_1.it)("Rehydrierung liefert exakt die Original-Arrays zurück (verlustfrei)", () => {
        const layout = (0, slots_js_1.buildDaySlotLayout)("2026-08-30", TZ);
        const day = (0, types_js_1.emptyDayRecord)("2026-08-30", TZ, layout.startMs, layout.endMs, layout.slotCount);
        const priceBase = horizonSlots(layout.startMs, (i) => 20 + (i % 7));
        const pvBase = horizonSlots(layout.startMs, (i) => (i % 5) * 0.3);
        const originals = [];
        for (let r = 0; r < 30; r++) {
            const price = priceBase.map((e) => [e[0], e[1]]);
            const pv = pvBase.map((e) => [e[0], e[1]]);
            pv[40] = [pv[40][0], Math.round(Math.random() * 100) / 100];
            if (r === 20) {
                /* eine echte Revision mittendrin */
                for (let i = 100; i < 180; i++)
                    price[i] = [price[i][0], price[i][1] + 15];
            }
            day.forecastSnapshots.push(baseSnapshot(`t${r}`, price, pv, { id: `s${r}` }));
            originals.push({ id: `s${r}`, priceSlots: price, pvSlotKwh: pv });
        }
        const compacted = (0, forecast_horizon_js_1.compactForecastSnapshotsForPersist)(day);
        /* Simuliert Disk-Roundtrip: JSON-Serialisierung/Deserialisierung. */
        const reloaded = JSON.parse(JSON.stringify(compacted));
        (0, forecast_horizon_js_1.rehydrateForecastRevisions)(reloaded);
        for (const orig of originals) {
            const snap = reloaded.forecastSnapshots.find((s) => s.id === orig.id);
            strict_1.default.ok(snap, `Snapshot ${orig.id} fehlt nach Rehydrierung`);
            strict_1.default.deepEqual(snap.priceSlots, orig.priceSlots);
            strict_1.default.deepEqual(snap.pvSlotKwh, orig.pvSlotKwh);
        }
    });
    (0, node_test_1.it)("Rückwärtskompatibilität: Snapshot ohne forecastRevisionId (Altformat) bleibt bei Rehydrierung unverändert", () => {
        const layout = (0, slots_js_1.buildDaySlotLayout)("2026-08-30", TZ);
        const day = (0, types_js_1.emptyDayRecord)("2026-08-30", TZ, layout.startMs, layout.endMs, layout.slotCount);
        const price = horizonSlots(layout.startMs, () => 25);
        const pv = horizonSlots(layout.startMs, () => 0.5);
        day.forecastSnapshots.push(baseSnapshot("t0", price, pv, { id: "legacy-1" }));
        day.forecastRevisions = [];
        const before = JSON.parse(JSON.stringify(day.forecastSnapshots[0]));
        (0, forecast_horizon_js_1.rehydrateForecastRevisions)(day);
        strict_1.default.deepEqual(day.forecastSnapshots[0], before);
    });
    (0, node_test_1.it)("leere Preis-/PV-Arrays (kein Forecast bekannt) werden korrekt behandelt", () => {
        const layout = (0, slots_js_1.buildDaySlotLayout)("2026-08-30", TZ);
        const day = (0, types_js_1.emptyDayRecord)("2026-08-30", TZ, layout.startMs, layout.endMs, layout.slotCount);
        day.forecastSnapshots.push(baseSnapshot("t0", [], [], { id: "empty-1" }));
        day.forecastSnapshots.push(baseSnapshot("t1", [], [], { id: "empty-2" }));
        const compacted = (0, forecast_horizon_js_1.compactForecastSnapshotsForPersist)(day);
        strict_1.default.equal(compacted.forecastRevisions?.length, 1);
        const reloaded = JSON.parse(JSON.stringify(compacted));
        (0, forecast_horizon_js_1.rehydrateForecastRevisions)(reloaded);
        for (const snap of reloaded.forecastSnapshots) {
            strict_1.default.deepEqual(snap.priceSlots, []);
            strict_1.default.deepEqual(snap.pvSlotKwh, []);
        }
    });
    (0, node_test_1.it)("Konstanten sind sinnvoll (Dokumentation/Regressionsschutz)", () => {
        strict_1.default.ok(forecast_horizon_js_1.FORECAST_HORIZON_DELTA_MAX_RATIO > 0 && forecast_horizon_js_1.FORECAST_HORIZON_DELTA_MAX_RATIO < 1);
        strict_1.default.ok(forecast_horizon_js_1.FORECAST_HORIZON_DELTA_MIN_ABS >= 1);
    });
});
