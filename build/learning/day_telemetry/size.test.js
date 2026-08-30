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
const persist_js_1 = require("./persist.js");
const slots_js_1 = require("./slots.js");
const types_js_1 = require("./types.js");
const quality_mask_js_1 = require("./quality_mask.js");
function round4(n) {
    return Math.round(n * 10000) / 10000;
}
/**
 * 16) Synthetischer 90-Tage-Größentest — realistische Füllung.
 * Ziel: möglichst < 2 MB.
 */
(0, node_test_1.describe)("day_telemetry 90-day size budget", () => {
    (0, node_test_1.it)("16) 90 realistische Tage — Dateigröße messen", async () => {
        const store = (0, types_js_1.emptyDayTelemetryStore)();
        const start = "2026-01-01";
        const tz = "Europe/Berlin";
        for (let d = 0; d < 90; d++) {
            const dk = (0, time_js_1.addDaysToDateKey)(start, d);
            const layout = (0, slots_js_1.buildDaySlotLayout)(dk, tz);
            const day = (0, types_js_1.emptyDayRecord)(dk, tz, layout.startMs, layout.endMs, layout.slotCount);
            /* Snapshots: ~3 pro Tag (Dedup-ähnlich, aber unterschiedlich) */
            for (let s = 0; s < 3; s++) {
                const snap = {
                    id: `snap-${dk}-${s}`,
                    tsIso: new Date(layout.startMs + s * 4 * 3600_000).toISOString(),
                    date: dk,
                    timezone: tz,
                    globalMode: "balanced",
                    contributionRevision: s,
                    pvExpectedDayKwh: 18 + s,
                    houseLoadExpectedDayKwh: 11,
                    batterySocPct: 40 + s * 5,
                    batteryCapacityKwh: 10,
                    batteryNightReserveKwh: 2,
                    priceSlots: Array.from({ length: 48 }, (_, i) => [
                        layout.startMs + i * 1_800_000,
                        20 + (i % 10),
                    ]),
                    pvSlotKwh: Array.from({ length: 24 }, (_, i) => [
                        layout.startMs + (32 + i) * 900_000,
                        0.2 + (i % 5) * 0.05,
                    ]),
                    wallboxRequiredEnergyKwh: 15,
                    wallboxDeadlineIso: null,
                    wallboxConnected: true,
                    wallboxPresenceDigest: "1:a:b",
                    thermalBufferTempC: 48,
                    thermalEmptyAtIso: null,
                    thermalHeadroomKwh: 3,
                    climateUnits: [
                        {
                            consumerId: "u1",
                            sharedPowerGroupId: "outdoor_1",
                            mandatory: false,
                            mode: "cool",
                            hardOffAtIso: new Date(layout.startMs + 20 * 3600_000).toISOString(),
                        },
                        {
                            consumerId: "u2",
                            sharedPowerGroupId: "outdoor_1",
                            mandatory: true,
                            mode: "cool",
                            hardOffAtIso: new Date(layout.startMs + 20 * 3600_000).toISOString(),
                        },
                    ],
                    wallboxTargetSocPct: 80,
                    wallboxMinimumDepartureSocPct: 60,
                    wallboxEnergyGoalHard: false,
                    wallboxManagementMode: "ems_candidate",
                    batteryDecision: {
                        action: "discharge_allowed",
                        dischargeAllowed: true,
                        requiredSocAtPvEndPct: 35,
                        holdActive: false,
                        reasonCode: "price_and_reserve_ok",
                    },
                };
                day.forecastSnapshots.push(snap);
            }
            /* Replans */
            for (let r = 0; r < 5; r++) {
                day.replanEvents.push({
                    tsIso: new Date(layout.startMs + (r + 1) * 2 * 3600_000).toISOString(),
                    generation: r + 1,
                    planId: `p-${dk}-${r}`,
                    reasonCodes: ["replan_pv_forecast_changed", "replan_price_revision"],
                    affectedSlotFrom: r * 8,
                    affectedSlotTo: layout.slotCount - 1,
                    snapshotId: `snap-${dk}-${r % 3}`,
                });
            }
            /* Climate segments */
            for (let c = 0; c < 8; c++) {
                day.climateRunSegments.push({
                    startTs: layout.startMs + c * 3600_000,
                    endTs: layout.startMs + c * 3600_000 + 1800_000,
                    sharedPowerGroupId: "outdoor_1",
                    mode: c % 2 === 0 ? "cool" : "dry",
                    activeUnitCombination: c % 3 === 0 ? "1+2" : "1",
                    energyKwh: 0.4 + c * 0.05,
                    runtimeSec: 1800,
                    valid: true,
                    rejectReason: null,
                });
            }
            day.statusEvents.push({
                tsIso: new Date(layout.startMs + 10 * 3600_000).toISOString(),
                kind: "ev_connected",
                detail: "",
            });
            /* Planned consumers table + refs */
            day.plannedConsumers.push([
                { consumerId: "battery", kind: "battery_charge", energyKwh: 0.4 },
                { consumerId: "outdoor_1", kind: "climate_shared_electric", energyKwh: 0.6 },
            ]);
            day.plannedConsumers.push([
                { consumerId: "immersion", kind: "immersion_heater", energyKwh: 0.3 },
            ]);
            for (let i = 0; i < layout.slotCount; i++) {
                const b = day.buckets;
                b.pvKwh[i] = i > 24 && i < 72 ? round4(0.15 + (i % 7) * 0.01) : null;
                b.houseTotalKwh[i] = round4(0.08 + (i % 5) * 0.01);
                b.gridImportKwh[i] = i < 20 || i > 80 ? 0.05 : null;
                b.gridExportKwh[i] = i > 40 && i < 60 ? 0.02 : null;
                b.priceCtPerKwh[i] = 18 + (i % 12);
                b.batterySocEndPct[i] = 40 + (i % 30);
                b.batteryChargedKwh[i] = i % 4 === 0 ? 0.1 : null;
                b.batteryDischargedKwh[i] = i % 5 === 0 ? 0.05 : null;
                b.evChargedKwh[i] = i > 50 && i < 60 ? 0.2 : null;
                b.evSocEndPct[i] = i > 50 && i < 60 ? 60 : null;
                b.immersionKwh[i] = i > 30 && i < 36 ? 0.25 : null;
                b.immersionRuntimeSec[i] = i > 30 && i < 36 ? 900 : null;
                b.boilerTempEndC[i] = i % 4 === 0 ? round4(50 + (i % 10) * 0.1) : null;
                b.climateKwh[i] = i > 40 && i < 70 ? 0.12 : null;
                b.climateElecSharedKwh[i] = i > 40 && i < 70 ? 0.12 : null;
                b.otherMeasuredConsumersKwh[i] = 0.03;
                b.plannedConsumersRef[i] = i % 2;
                b.snapshotIdRef[i] = `snap-${dk}-${i % 3}`;
                let mask = null;
                mask = (0, quality_mask_js_1.encodeDomainQuality)(0, quality_mask_js_1.TELEMETRY_DOMAIN.PV, quality_mask_js_1.DOMAIN_QUALITY.ok);
                mask = (0, quality_mask_js_1.encodeDomainQuality)(mask, quality_mask_js_1.TELEMETRY_DOMAIN.HOUSE, quality_mask_js_1.DOMAIN_QUALITY.ok);
                mask = (0, quality_mask_js_1.encodeDomainQuality)(mask, quality_mask_js_1.TELEMETRY_DOMAIN.GRID, quality_mask_js_1.DOMAIN_QUALITY.ok);
                mask = (0, quality_mask_js_1.encodeDomainQuality)(mask, quality_mask_js_1.TELEMETRY_DOMAIN.BATTERY, quality_mask_js_1.DOMAIN_QUALITY.ok);
                mask = (0, quality_mask_js_1.encodeDomainQuality)(mask, quality_mask_js_1.TELEMETRY_DOMAIN.PRICE, quality_mask_js_1.DOMAIN_QUALITY.ok);
                mask = (0, quality_mask_js_1.encodeDomainQuality)(mask, quality_mask_js_1.TELEMETRY_DOMAIN.PLANNER, quality_mask_js_1.DOMAIN_QUALITY.ok);
                b.qualityMask[i] = mask;
            }
            store.days[dk] = day;
        }
        const dir = await fs.mkdtemp(path.join(os.tmpdir(), "daytel-size-"));
        try {
            await (0, persist_js_1.writeDayTelemetryPersist)(dir, store);
            const names = await fs.readdir(dir);
            let total = 0;
            for (const n of names) {
                if (!n.endsWith(".json"))
                    continue;
                total += (await fs.stat(path.join(dir, n))).size;
            }
            const mb = total / (1024 * 1024);
            console.log(`day_telemetry 90-day synthetic size: ${total} bytes (${mb.toFixed(3)} MiB)`);
            strict_1.default.ok(total < 4 * 1024 * 1024, `90-Tage-Dateien zu groß: ${total} bytes (${mb.toFixed(3)} MiB)`);
            if (total >= 2 * 1024 * 1024) {
                console.warn(`WARN: 90-Tage-Größe ${mb.toFixed(3)} MiB ≥ 2 MiB Ziel — Schema weiter verdichten`);
            }
        }
        finally {
            await fs.rm(dir, { recursive: true, force: true });
        }
    });
});
