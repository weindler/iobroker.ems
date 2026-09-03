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
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const strict_1 = __importDefault(require("node:assert/strict"));
const fs = __importStar(require("node:fs/promises"));
const os = __importStar(require("node:os"));
const path = __importStar(require("node:path"));
const time_js_1 = require("../../operator/time.js");
const index_js_1 = require("./index.js");
const persist_js_1 = require("./persist.js");
const slots_js_1 = require("./slots.js");
const types_js_1 = require("./types.js");
(0, node_test_1.describe)("day_telemetry persist retention", () => {
    (0, node_test_1.it)("14/15) 90 Tage Retention — Tag 91 löscht ältesten", () => {
        let store = (0, types_js_1.emptyDayTelemetryStore)();
        const start = "2026-01-01";
        for (let i = 0; i < 91; i++) {
            const dk = (0, time_js_1.addDaysToDateKey)(start, i);
            const layout = (0, slots_js_1.buildDaySlotLayout)(dk, "Europe/Berlin");
            store.days[dk] = (0, types_js_1.emptyDayRecord)(dk, "Europe/Berlin", layout.startMs, layout.endMs, layout.slotCount);
        }
        strict_1.default.equal(Object.keys(store.days).length, 91);
        const today = (0, time_js_1.addDaysToDateKey)(start, 90);
        store = (0, persist_js_1.pruneDayTelemetryStore)(store, index_js_1.DAY_TELEMETRY_RETENTION_DAYS, today);
        const keys = Object.keys(store.days).sort();
        strict_1.default.equal(keys.length, 90);
        strict_1.default.equal(keys[0], (0, time_js_1.addDaysToDateKey)(start, 1));
        strict_1.default.equal(keys[keys.length - 1], today);
        strict_1.default.equal(store.days[start], undefined);
    });
    (0, node_test_1.it)("18) nur minimale neue States", () => {
        strict_1.default.equal(index_js_1.DAY_TELEMETRY_STATE_IDS.length, 3);
        strict_1.default.ok(index_js_1.DAY_TELEMETRY_STATE_IDS.every((id) => id.startsWith("learning.day_telemetry.")));
    });
    (0, node_test_1.it)("alte Tagesdateien ohne GB-Economics-Felder bleiben lesbar (Cold Start / Migration)", async () => {
        const layout = (0, slots_js_1.buildDaySlotLayout)("2026-06-15", "Europe/Berlin");
        const day = (0, types_js_1.emptyDayRecord)("2026-06-15", "Europe/Berlin", layout.startMs, layout.endMs, layout.slotCount);
        const raw = JSON.parse(JSON.stringify(day));
        delete raw.gridBalanceRunSegments;
        delete raw.gridBalanceOffWindows;
        const buckets = raw.buckets;
        delete buckets.batteryChargeSource;
        delete buckets.outdoorTempC;
        delete buckets.cloudPct;
        delete buckets.climateUnitSlots;
        const n = (0, persist_js_1.normalizeDayRecord)(raw, "2026-06-15");
        strict_1.default.ok(n);
        strict_1.default.ok(Array.isArray(n.gridBalanceRunSegments));
        strict_1.default.ok(Array.isArray(n.gridBalanceOffWindows));
        strict_1.default.equal(n.buckets.batteryChargeSource.length, n.slotCount);
        strict_1.default.equal(n.buckets.outdoorTempC.length, n.slotCount);
        strict_1.default.equal(n.buckets.climateUnitSlots.length, n.slotCount);
        strict_1.default.ok(n.buckets.outdoorTempC.every((v) => v === null));
    });
    (0, node_test_1.it)("atomic write roundtrip", async () => {
        const dir = await fs.mkdtemp(path.join(os.tmpdir(), "daytel-"));
        try {
            const store = (0, types_js_1.emptyDayTelemetryStore)();
            const layout = (0, slots_js_1.buildDaySlotLayout)("2026-06-15", "Europe/Berlin");
            store.days["2026-06-15"] = (0, types_js_1.emptyDayRecord)("2026-06-15", "Europe/Berlin", layout.startMs, layout.endMs, layout.slotCount);
            await (0, persist_js_1.writeDayTelemetryPersist)(dir, store);
            const loaded = await (0, persist_js_1.readDayTelemetryPersist)(dir);
            strict_1.default.ok(loaded);
            strict_1.default.equal(loaded.days["2026-06-15"].slotCount, 96);
            const dayFile = path.join(dir, "2026-06-15.json");
            const st = await fs.stat(dayFile);
            strict_1.default.ok(st.size > 100);
        }
        finally {
            await fs.rm(dir, { recursive: true, force: true });
        }
    });
});
