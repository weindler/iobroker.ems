"use strict";
/**
 * Realer Beta-Replay ~10:55 lokal (08.08.2026) — Regression gegen Live-Snapshot.
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.betaReplay1055Input = void 0;
const node_test_1 = require("node:test");
const strict_1 = __importDefault(require("node:assert/strict"));
const quality_1 = require("../../quality");
const allocate_1 = require("./allocate");
const fixtures_1 = require("./fixtures");
const product_summary_1 = require("../../../beta/product_summary");
const fsm_1 = require("../../../addons/immersion_heater/runtime/fsm");
const device_config_1 = require("../../../addons/immersion_heater/device_config");
const persist_1 = require("../../../addons/immersion_heater/runtime/persist");
const TZ = "Europe/Berlin";
const Q = (0, quality_1.operatorQuality)("valid", "beta-1055", 80);
const FRESH = { observedAtIso: "2026-08-08T08:55:00.000Z", ageSec: 5, quality: Q };
/** ~10:55 CEST, PV≈5 kW, residual Export≈4,49 kW, Bat 100 %, Puffer 49 °C. */
function betaReplay1055Input() {
    const nowIso = "2026-08-08T08:55:00.000Z"; // 10:55 CEST
    const emptyAt = "2026-08-08T15:25:00.000Z"; // 17:25 CEST
    const slots = (0, fixtures_1.buildSlots)(nowIso, 48);
    const base = (0, fixtures_1.golden001Input)();
    base.time = {
        ...base.time,
        nowIso,
        timezone: TZ,
        slots,
        horizonStartIso: slots[0].startIso,
        horizonEndIso: slots[slots.length - 1].endIso,
    };
    const livePvW = 5000;
    const liveExportW = 4490;
    const liveHouseW = livePvW - liveExportW; // ≈510 W
    base.pv.slots = slots.map((s) => {
        const t = Date.parse(s.startIso);
        const h = new Date(s.startIso).getUTCHours();
        const day0 = t < Date.parse("2026-08-09T00:00:00.000Z");
        let power = 0;
        if (day0) {
            if (Math.abs(t - Date.parse(nowIso)) < 15 * 60_000)
                power = livePvW;
            else if (h >= 8 && h < 14)
                power = 4200;
            else if (h >= 14 && h < 16)
                power = 1600;
            else if (h >= 6 && h < 18)
                power = 800;
        }
        else if (h >= 7 && h < 16) {
            power = 3800;
        }
        return {
            slot: s,
            forecastPowerW: power,
            observedPowerW: Math.abs(t - Date.parse(nowIso)) < 15 * 60_000 ? livePvW : null,
            energyKwh: (power / 1000) * 0.25,
        };
    });
    base.pv.expectedDayEnergyKwh = 43.6;
    base.houseLoad.slots = slots.map((s) => {
        const t = Date.parse(s.startIso);
        const power = Math.abs(t - Date.parse(nowIso)) < 15 * 60_000 ? liveHouseW : 900;
        return {
            slot: s,
            forecastPowerW: power,
            observedPowerW: Math.abs(t - Date.parse(nowIso)) < 15 * 60_000 ? liveHouseW : null,
            energyKwh: (power / 1000) * 0.25,
        };
    });
    base.houseLoad.expectedDayEnergyKwh = 22.3;
    base.prices.slots = slots.map((s) => {
        const h = new Date(s.startIso).getUTCHours();
        const night = h >= 22 || h < 5;
        return {
            slot: s,
            importCtPerKwh: night ? 12 : 26,
            exportCtPerKwh: 8,
            gridImportAllowed: true,
        };
    });
    base.battery = {
        ...base.battery,
        socPct: 100,
        usableCapacityKwh: 10,
        minSocPct: 10,
        maxSocPct: 100,
        reserveSocPct: 10,
        nightReserveKwh: 2.5,
        maxChargePowerW: 4600,
        requiredChargeEnergyKwh: 0,
        endSocTargetPct: null,
        chargeDeadlineIso: null,
        gridChargeAllowed: true,
        uncertainty: Q,
        freshness: FRESH,
    };
    base.thermal = {
        bufferTempC: 49,
        minTempC: 44,
        maxTempC: 63,
        dayTargetTempC: 58,
        availablePowerW: 1700,
        minPowerW: 1700,
        headroomEnergyKwh: 3.8,
        estimatedEmptyAtIso: emptyAt,
        deadlineIso: emptyAt,
        emptyAtSource: "estimated",
        nightBridgeActive: true,
        coolingRateCPerH: 0.7,
        minimumRuntimeSec: 300,
        hysteresisK: 5,
        reheatHysteresisActive: true,
        uncertainty: (0, quality_1.operatorQuality)("degraded", "estimated empty_at", 55),
        freshness: FRESH,
    };
    base.climate = {
        units: [
            {
                unitId: "air_conditioning.unit_1",
                label: "Wohnzimmer",
                roomTempC: 26.2,
                comfortMinC: null,
                comfortMaxC: 25.5,
                targetTempC: 25.0,
                mandatoryComfort: true, // real laufend / Komfortbedarf jetzt
                expectedEnergyKwh: 2.8,
                typicalPowerW: 850, // Config-Nominal; learned ~727 W ist Runtime-Prognose
                maxShiftHours: 0,
                uncertainty: Q,
            },
            {
                unitId: "air_conditioning.unit_2",
                label: "Josef",
                roomTempC: 24.0,
                comfortMinC: null,
                comfortMaxC: 26.0,
                targetTempC: 25.5,
                mandatoryComfort: false,
                expectedEnergyKwh: 1.2,
                typicalPowerW: 700, // Config-Nominal; learned ~715 W
                maxShiftHours: 3,
                uncertainty: Q,
            },
        ],
        freshness: FRESH,
    };
    base.wallbox = null;
    base.globalMode = "balanced";
    return base;
}
exports.betaReplay1055Input = betaReplay1055Input;
function sumKind(plan, kind) {
    return plan.allocations
        .filter((a) => a.kind === kind)
        .reduce((s, a) => s + a.allocatedEnergyKwh, 0);
}
function byConsumer(plan, id) {
    return plan.allocations
        .filter((a) => a.consumerId === id)
        .reduce((s, a) => s + a.allocatedEnergyKwh, 0);
}
function formatSlotPlan(plan) {
    const tz = plan.timezone;
    const fmt = (iso) => new Intl.DateTimeFormat("de-DE", {
        timeZone: tz,
        hour: "2-digit",
        minute: "2-digit",
    }).format(new Date(iso));
    const bySlot = new Map();
    for (const a of plan.allocations) {
        if (a.allocatedEnergyKwh < 0.02)
            continue;
        const k = a.slot.startIso;
        const list = bySlot.get(k) ?? [];
        list.push(a);
        bySlot.set(k, list);
    }
    const lines = [];
    const keys = [...bySlot.keys()].sort();
    for (const k of keys) {
        const cells = bySlot.get(k);
        const end = cells[0].slot.endIso;
        const parts = cells.map((c) => `${c.consumerId.replace(/^air_conditioning\./, "klima.")}:${(c.allocatedPowerW / 1000).toFixed(2)}kW/${c.allocatedEnergyKwh.toFixed(2)}kWh(${c.energySource})`);
        lines.push(`${fmt(k)}–${fmt(end)}  ${parts.join(" | ")}`);
    }
    return lines;
}
(0, node_test_1.describe)("BETA-REPLAY-1055 real midday snapshot", () => {
    (0, node_test_1.it)("battery full → no charge; Wohnzimmer comfort now; thermal preload; wallbox idle", () => {
        const input = betaReplay1055Input();
        const plan = (0, allocate_1.allocateUnifiedDayPlan)(input);
        strict_1.default.equal(sumKind(plan, "battery_charge"), 0, "SOC 100% → keine Batterie-Ladeallocation");
        strict_1.default.ok(byConsumer(plan, "air_conditioning.unit_1") > 1.0, "Wohnzimmer muss freigegeben sein");
        strict_1.default.ok(byConsumer(plan, "air_conditioning.unit_2") > 0.3, "Josef (flex) muss bei hohem PV-Surplus mitgeplant werden — kein Planner-Artefakt-Block");
        strict_1.default.ok(sumKind(plan, "immersion_heater") > 1.5, "Heizstab muss thermisch vorplanen");
        const emptyAt = input.thermal.deadlineIso;
        const ihBefore = plan.allocations
            .filter((a) => a.kind === "immersion_heater" && Date.parse(a.slot.startIso) < Date.parse(emptyAt))
            .reduce((s, a) => s + a.allocatedEnergyKwh, 0);
        strict_1.default.ok(ihBefore > 1.0, `thermal vor empty_at, got ${ihBefore}`);
        strict_1.default.equal(sumKind(plan, "wallbox"), 0);
        strict_1.default.equal(plan.allocations.filter((a) => a.kind === "immersion_heater" && (a.energySource === "battery" || a.energySource === "mixed")).length, 0);
        // FSM: Unified 1700 W NOW trotz Hysterese-Band (Re-Enable 46,6 °C)
        const cfg = (0, device_config_1.immersionDeviceConfigFromAdapter)({
            ih_stage_count: 1,
            ih_stage_1_set_state: "relay.0.heater",
            ih_stage_1_nominal_power_w: 1700,
            ih_buffer_temp_c_target: "sensor.0.temp",
            ih_buffer_temp_c_enabled: true,
            ih_temperature_hysteresis_k: 5,
            ih_planning_min_temp_c: 44,
            ih_planning_max_temp_c: 63,
        });
        const fsm = (0, fsm_1.runImmersionFsm)({
            nowMs: Date.parse(input.time.nowIso),
            addonEnabled: true,
            addonAvailable: true,
            configValid: true,
            executionLive: true,
            failsafeActive: false,
            resolvedMode: "auto",
            forceTargetTempC: null,
            forceUntilMs: null,
            plannerCommandedStage: 1,
            plannerTargetTempC: 51.6,
            temperature: { valueC: 49, status: "valid", observedAtMs: Date.parse(input.time.nowIso) },
            measuredPowerW: 0,
            hasPowerMeasurement: false,
            persist: { ...(0, persist_1.emptyPersist)(), autoTargetReached: true, commandedStage: 0 },
            config: cfg,
            faultLockout: false,
            faultCode: "none",
        });
        strict_1.default.equal(fsm.commandedStage, 1);
        strict_1.default.equal(fsm.reason, "auto_planner_heating");
        const agenda = (0, product_summary_1.buildUnifiedDayAgendaDe)(plan);
        strict_1.default.ok(agenda.some((l) => /Heizstab|thermisch/i.test(l)));
        strict_1.default.ok(agenda.some((l) => /Klima/i.test(l)));
        strict_1.default.ok(!agenda.some((l) => /Batterie laden/i.test(l)), "keine Ladezeile bei SOC 100%");
        const summary = (0, product_summary_1.buildProductSummaryDe)(plan, { batteryStartSocPct: 100 });
        strict_1.default.match(summary, /43,6|Heute/);
        // Vollständiger Slotplan für manuelle Abnahme (stdout bei Testlauf)
        const slots = formatSlotPlan(plan);
        strict_1.default.ok(slots.length > 0);
        // eslint-disable-next-line no-console
        console.log("\n=== BETA-REPLAY-1055 SLOTPLAN ===\n" + slots.join("\n"));
        // eslint-disable-next-line no-console
        console.log("\nAGENDA:\n - " + agenda.join("\n - "));
        // eslint-disable-next-line no-console
        console.log("\nSUMMARY:\n" + summary);
        // eslint-disable-next-line no-console
        console.log("\nTOTALS kWh:", JSON.stringify({
            battery_charge: sumKind(plan, "battery_charge"),
            immersion: sumKind(plan, "immersion_heater"),
            wohnzimmer: byConsumer(plan, "air_conditioning.unit_1"),
            josef: byConsumer(plan, "air_conditioning.unit_2"),
            wallbox: sumKind(plan, "wallbox"),
            export: plan.expectedGridExportEnergyKwh,
        }));
    });
});
