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
const run_1 = require("../../learning/energyforecast/run");
const grid_read_1 = require("./grid_read");
const TOKEN = "T-OKEN";
function rows(date, origin, total) {
    const start = new Date(`${date}T00:00:00`).getTime();
    return Array.from({ length: 96 }, (_, i) => ({
        start: new Date(start + i * 900_000).toISOString(),
        end: new Date(start + (i + 1) * 900_000).toISOString(),
        price_ct_kwh: total - 20,
        total_ct_kwh: total,
        price_origin: origin,
    }));
}
(0, node_test_1.describe)("Preisquelle: Tibber Vorrang, Energyforecast füllt auf", () => {
    let dir;
    (0, node_test_1.beforeEach)(async () => {
        dir = await fs.mkdtemp(path.join(os.tmpdir(), "efgrid-"));
        (0, run_1.resetEnergyforecastRunState)();
    });
    (0, node_test_1.afterEach)(async () => {
        (0, run_1.resetEnergyforecastRunState)();
        await fs.rm(dir, { recursive: true, force: true });
    });
    async function setup(efEnabled, tibberJson) {
        const config = {
            energyforecast_enabled: efEnabled,
            energyforecast_token: TOKEN,
            learning_price_forecast_today_json_state: tibberJson === null ? "" : "tibberlink.0.PricesToday.json",
        };
        const efHost = {
            config,
            getAbsolutePath: () => dir,
            setStateAsync: async () => undefined,
            getStateAsync: async () => null,
            setObjectNotExistsAsync: async () => undefined,
            log: { info: () => undefined, warn: () => undefined },
        };
        const body = { plan: "free", data: [...rows("2026-11-14", "market", 40), ...rows("2026-11-15", "forecast", 36)] };
        await (0, run_1.runEnergyforecast)(efHost, new Date("2026-11-14T09:20:00").getTime(), async () => new Response(JSON.stringify(body)));
        const gridHost = {
            config,
            getStateAsync: async () => null,
            getForeignStateAsync: async (id) => (id === "tibberlink.0.PricesToday.json" ? { val: tibberJson } : null),
        };
        return gridHost;
    }
    (0, node_test_1.it)("Tibber-Slots gewinnen, Energyforecast ergänzt nur Spätere und markiert Prognose", async () => {
        const tibber = JSON.stringify(Array.from({ length: 96 }, (_, i) => ({
            total: 0.5,
            startsAt: new Date(new Date("2026-11-14T00:00:00").getTime() + i * 900_000).toISOString(),
        })));
        const host = await setup(true, tibber);
        const slots = await (0, grid_read_1.readDynamicTariffPrice15MinSlots)(host, new Date("2026-11-14T09:20:00"));
        const today = slots.filter((s) => new Date(s.slotStartMs).getDate() === 14);
        const tomorrow = slots.filter((s) => new Date(s.slotStartMs).getDate() === 15);
        strict_1.default.ok(today.length > 0 && today.every((s) => s.priceCtPerKwh === 50 && s.origin === undefined), "heute Tibber (50 ct)");
        strict_1.default.equal(tomorrow.length, 96);
        strict_1.default.ok(tomorrow.every((s) => s.priceCtPerKwh === 36 && s.origin === "forecast"));
    });
    (0, node_test_1.it)("ohne Tibber-Konfiguration liefert Energyforecast die Preise", async () => {
        const host = await setup(true, null);
        const slots = await (0, grid_read_1.readDynamicTariffPrice15MinSlots)(host, new Date("2026-11-14T09:20:00"));
        strict_1.default.ok(slots.length > 96);
        strict_1.default.ok(slots.some((s) => s.priceCtPerKwh === 40 && s.origin === undefined), "Markt-Slots ohne Prognosemarke");
    });
    (0, node_test_1.it)("Energyforecast aus: unverändertes Verhalten (leer ohne Tibber)", async () => {
        const host = await setup(false, null);
        strict_1.default.deepEqual(await (0, grid_read_1.readDynamicTariffPrice15MinSlots)(host, new Date("2026-11-14T09:20:00")), []);
    });
    (0, node_test_1.it)("laufende Viertelstunde bleibt erhalten (Preis für jetzt)", async () => {
        const host = await setup(true, null);
        const slots = await (0, grid_read_1.readDynamicTariffPrice15MinSlots)(host, new Date("2026-11-14T09:20:00"));
        const quarterStart = new Date("2026-11-14T09:15:00").getTime();
        strict_1.default.ok(slots.some((s) => s.slotStartMs === quarterStart), "Slot 09:15 vorhanden");
        strict_1.default.equal(slots.some((s) => s.slotStartMs < quarterStart), false);
    });
});
