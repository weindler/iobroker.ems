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
const persist_1 = require("../day_telemetry/persist");
const types_1 = require("../day_telemetry/types");
const slots_1 = require("../day_telemetry/slots");
const run_1 = require("./run");
(0, node_test_1.describe)("Netzausgleich-Wirtschaft: Tages-Cache", () => {
    (0, node_test_1.it)("abgeschlossene Tage kommen beim zweiten Lauf aus dem Cache, nicht aus den Tagesdateien", async () => {
        const root = await fs.mkdtemp(path.join(os.tmpdir(), "gbe-cache-"));
        try {
            const telemetryDir = path.join(root, "learning/day_telemetry");
            await fs.mkdir(telemetryDir, { recursive: true });
            for (const key of ["2026-11-01", "2026-11-02", "2026-11-16"]) {
                const layout = (0, slots_1.buildDaySlotLayout)(key, "Europe/Berlin");
                await (0, persist_1.writeDayTelemetryDay)(telemetryDir, (0, types_1.emptyDayRecord)(key, "Europe/Berlin", layout.startMs, layout.endMs, layout.slotCount));
            }
            const host = {
                getAbsolutePath: (category) => path.join(root, category ?? ""),
                setStateAsync: async () => undefined,
            };
            const now = new Date("2026-11-17T12:00:00Z");
            await (0, run_1.runGridBalanceEconomicsLearning)(host, { now, timezone: "Europe/Berlin" });
            const cacheFile = path.join(root, "learning/grid_balance_economics/days_cache_v1.json");
            const cache = JSON.parse(await fs.readFile(cacheFile, "utf8"));
            strict_1.default.deepEqual(Object.keys(cache.days).sort(), ["2026-11-01", "2026-11-02"], "nur Tage älter als 2 Tage");
            await fs.writeFile(path.join(telemetryDir, "2026-11-01.json"), "kaputt", "utf8");
            await (0, run_1.runGridBalanceEconomicsLearning)(host, { now, timezone: "Europe/Berlin" });
            const again = JSON.parse(await fs.readFile(cacheFile, "utf8"));
            strict_1.default.ok("2026-11-01" in again.days, "defekte Tagesdatei ändert den Cache nicht");
        }
        finally {
            await fs.rm(root, { recursive: true, force: true });
        }
    });
});
