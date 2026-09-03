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
/**
 * Predictive Climate Foundation — Day-Telemetry: Slots, Segmente, alte Dateien, DST.
 */
const node_test_1 = require("node:test");
const strict_1 = __importDefault(require("node:assert/strict"));
const fs = __importStar(require("node:fs/promises"));
const os = __importStar(require("node:os"));
const path = __importStar(require("node:path"));
const ensure_states_js_1 = require("../../addons/air_conditioning/runtime/ensure_states.js");
const ensure_states_js_2 = require("../../addons/air_conditioning/runtime/ensure_states.js");
const record_js_1 = require("./record.js");
const persist_js_1 = require("./persist.js");
const types_js_1 = require("./types.js");
const slots_js_1 = require("./slots.js");
const climate_segments_js_1 = require("./climate_segments.js");
const math_js_1 = require("../climate_shared_power/math.js");
class FakeTelHost {
    states = new Map();
    dir;
    config = {
        timezone: "Europe/Berlin",
        ac_u1_enabled: true,
        ac_u1_mode_when_cooling: "cool",
        ac_u1_mode_when_heating: "",
        ac_u1_mode_when_dehumidify: "dry",
        ac_u1_on_temp_c: 26,
        ac_u1_off_temp_c: 24,
        ac_u1_max_humidity_pct: 60,
        ac_u1_shared_power_group_id: "outdoor_1",
        ac_u1_hard_off_at: "20:00",
        ac_u2_enabled: true,
        ac_u2_mode_when_cooling: "cool",
        ac_u2_mode_when_heating: "",
        ac_u2_shared_power_group_id: "outdoor_1",
        learning_weather_forecast_temp_state: "brightsky.0.daily.temperature_max",
        learning_weather_actual_temp_state: "brightsky.0.current.temperature",
        learning_weather_forecast_cloud_state: "brightsky.0.daily.cloud",
        learning_weather_actual_cloud_state: "brightsky.0.current.cloud",
    };
    log = { warn: () => undefined, debug: () => undefined, error: () => undefined };
    constructor(dir) {
        this.dir = dir;
    }
    getAbsolutePath = (category) => path.join(this.dir, category ?? "");
    getStateAsync = async (id) => {
        if (!this.states.has(id))
            return null;
        return { val: this.states.get(id), ack: true };
    };
    getForeignStateAsync = async (id) => this.getStateAsync(id);
    setStateAsync = async (id, state) => {
        this.states.set(id, state.val);
        return null;
    };
    set(id, val) {
        this.states.set(id, val);
    }
}
function setUnit(host, index, opts) {
    const ids = (0, ensure_states_js_1.acUnitRuntimeStates)(index);
    if (opts.running != null)
        host.set(ids.running, opts.running);
    if (opts.purpose != null)
        host.set(ids.modePurpose, opts.purpose);
    if (opts.roomTempC !== undefined)
        host.set(ids.roomTempC, opts.roomTempC);
    if (opts.humidity !== undefined)
        host.set(ids.roomHumidityPct, opts.humidity);
    if (opts.owner != null)
        host.set(ids.ownershipOwner, opts.owner);
    if (opts.overrideUntil != null)
        host.set(ids.ownershipOverrideUntilIso, opts.overrideUntil);
    if (opts.setpoint !== undefined)
        host.set(ids.setpointTempC, opts.setpoint);
}
(0, node_test_1.describe)("climate foundation — day telemetry", () => {
    (0, node_test_1.beforeEach)(() => {
        (0, record_js_1.__resetDayTelemetryRuntimeForTest)();
    });
    (0, node_test_1.it)("persistiert Multi-Unit-Slot: Temp, Feuchte, Außen, Thresholds, Modi, Ownership, Shared", async () => {
        const dir = await fs.mkdtemp(path.join(os.tmpdir(), "cf-tel-"));
        try {
            const host = new FakeTelHost(dir);
            host.set("brightsky.0.current.temperature", 31.2);
            host.set("brightsky.0.current.cloud", 40);
            host.set(ensure_states_js_2.AC_RUNTIME_SUMMARY_STATES.systemPowerW, 720);
            host.set(ensure_states_js_2.AC_RUNTIME_SUMMARY_STATES.systemSharedPowerUsed, true);
            setUnit(host, 1, {
                running: true,
                purpose: "cooling",
                roomTempC: 27.4,
                humidity: 52,
                owner: "ems",
                setpoint: 17,
            });
            setUnit(host, 2, {
                running: true,
                purpose: "cooling",
                roomTempC: 26.1,
                humidity: 48,
                owner: "user",
                setpoint: 18,
            });
            const t0 = new Date("2026-08-30T11:00:00+02:00");
            await (0, record_js_1.tickDayTelemetry)(host, t0);
            await (0, record_js_1.tickDayTelemetry)(host, new Date("2026-08-30T11:01:00+02:00"));
            const day = await (0, persist_js_1.readDayTelemetryDay)(path.join(dir, "learning/day_telemetry"), "2026-08-30");
            strict_1.default.ok(day);
            const layout = (0, slots_js_1.buildDaySlotLayout)("2026-08-30", "Europe/Berlin");
            const slot = layout.slots.find((s) => t0.getTime() >= s.startMs && t0.getTime() < s.endMs);
            strict_1.default.ok(slot);
            strict_1.default.equal(day.buckets.outdoorTempC[slot.index], 31.2);
            strict_1.default.equal(day.buckets.cloudPct[slot.index], 40);
            const units = day.buckets.climateUnitSlots[slot.index];
            strict_1.default.ok(units);
            strict_1.default.equal(units.length, 2);
            const u1 = units.find((u) => u.unitIndex === 1);
            const u2 = units.find((u) => u.unitIndex === 2);
            strict_1.default.ok(u1 && u2);
            strict_1.default.equal(u1.roomTempC, 27.4);
            strict_1.default.equal(u1.roomHumidityPct, 52);
            strict_1.default.equal(u1.targetTempC, 17);
            strict_1.default.equal(u1.coolingOnTempC, 26);
            strict_1.default.equal(u1.coolingOffTempC, 24);
            strict_1.default.equal(u1.heatingSetpointC, null);
            strict_1.default.equal(u1.maxHumidityPct, 60);
            strict_1.default.deepEqual(u1.modesAvailable, ["cooling", "dehumidify"]);
            strict_1.default.equal(u1.running, true);
            strict_1.default.equal(u1.modePurpose, "cooling");
            strict_1.default.equal(u1.hardOffAt, "20:00");
            strict_1.default.equal(u1.ownershipOwner, "ems");
            strict_1.default.equal(u1.overrideActive, false);
            strict_1.default.equal(u1.sharedPowerGroupId, "outdoor_1");
            strict_1.default.equal(u1.activeUnitCombination, "1+2");
            strict_1.default.equal(u2.ownershipOwner, "user");
            strict_1.default.equal(u2.overrideActive, true);
            strict_1.default.ok(!u1.modesAvailable.includes("heating"));
            const onSeg = day.climateRunSegments.find((s) => s.mode === "cooling" || s.valid);
            /* offenes Segment kann noch in mem sein — nach weiterem Idle schließen */
            host.set((0, ensure_states_js_1.acUnitRuntimeStates)(1).running, false);
            host.set((0, ensure_states_js_1.acUnitRuntimeStates)(2).running, false);
            await (0, record_js_1.tickDayTelemetry)(host, new Date("2026-08-30T11:02:00+02:00"));
            const day2 = await (0, persist_js_1.readDayTelemetryDay)(path.join(dir, "learning/day_telemetry"), "2026-08-30");
            const cooling = day2.climateRunSegments.find((s) => s.mode === "cooling" || s.mode === "cool");
            strict_1.default.ok(cooling, "Cooling-Segment fehlt");
            strict_1.default.equal(cooling.activeUnitCombination, "1+2");
            strict_1.default.equal(cooling.sharedPowerGroupId, "outdoor_1");
            strict_1.default.ok(cooling.unitObservations?.some((o) => o.unitIndex === 1 && o.roomTempStartC === 27.4));
            strict_1.default.equal(cooling.outdoorTempStartC, 31.2);
            strict_1.default.ok(cooling.energyKwh > 0);
        }
        finally {
            await fs.rm(dir, { recursive: true, force: true });
        }
    });
    (0, node_test_1.it)("fehlende Werte bleiben null/unknown — keine erfundenen 0", async () => {
        const dir = await fs.mkdtemp(path.join(os.tmpdir(), "cf-miss-"));
        try {
            const host = new FakeTelHost(dir);
            host.config.learning_weather_forecast_temp_state = "";
            host.config.learning_weather_actual_temp_state = "";
            host.config.learning_weather_forecast_cloud_state = "";
            host.config.learning_weather_actual_cloud_state = "";
            setUnit(host, 1, { running: false, purpose: "off", roomTempC: null, humidity: null });
            const t0 = new Date("2026-08-30T11:00:00+02:00");
            await (0, record_js_1.tickDayTelemetry)(host, t0);
            await (0, record_js_1.tickDayTelemetry)(host, new Date("2026-08-30T11:01:00+02:00"));
            const day = await (0, persist_js_1.readDayTelemetryDay)(path.join(dir, "learning/day_telemetry"), "2026-08-30");
            const layout = (0, slots_js_1.buildDaySlotLayout)("2026-08-30", "Europe/Berlin");
            const slot = layout.slots.find((s) => t0.getTime() >= s.startMs && t0.getTime() < s.endMs);
            strict_1.default.equal(day.buckets.outdoorTempC[slot.index], null);
            const u1 = day.buckets.climateUnitSlots[slot.index]?.find((u) => u.unitIndex === 1);
            strict_1.default.ok(u1);
            strict_1.default.equal(u1.roomTempC, null);
            strict_1.default.equal(u1.roomHumidityPct, null);
            strict_1.default.equal(u1.demandUrgency01, null);
            strict_1.default.equal(u1.modePurpose, "off");
        }
        finally {
            await fs.rm(dir, { recursive: true, force: true });
        }
    });
    (0, node_test_1.it)("alte Tagesdateien ohne Climate-Felder bleiben lesbar", () => {
        const layout = (0, slots_js_1.buildDaySlotLayout)("2026-06-15", "Europe/Berlin");
        const day = (0, types_js_1.emptyDayRecord)("2026-06-15", "Europe/Berlin", layout.startMs, layout.endMs, layout.slotCount);
        const raw = JSON.parse(JSON.stringify(day));
        const buckets = raw.buckets;
        delete buckets.outdoorTempC;
        delete buckets.cloudPct;
        delete buckets.climateUnitSlots;
        const n = (0, persist_js_1.normalizeDayRecord)(raw, "2026-06-15");
        strict_1.default.ok(n);
        strict_1.default.equal(n.buckets.outdoorTempC.length, n.slotCount);
        strict_1.default.equal(n.buckets.cloudPct.length, n.slotCount);
        strict_1.default.equal(n.buckets.climateUnitSlots.length, n.slotCount);
        strict_1.default.ok(n.buckets.outdoorTempC.every((v) => v === null));
        strict_1.default.ok(n.buckets.climateUnitSlots.every((v) => v === null));
    });
    (0, node_test_1.it)("DST-Tage behalten 92/96/100 Slots inkl. neuer Climate-Arrays", () => {
        const spring = (0, slots_js_1.buildDaySlotLayout)("2026-03-29", "Europe/Berlin");
        const normal = (0, slots_js_1.buildDaySlotLayout)("2026-06-15", "Europe/Berlin");
        const fall = (0, slots_js_1.buildDaySlotLayout)("2026-10-25", "Europe/Berlin");
        strict_1.default.equal(spring.slotCount, 92);
        strict_1.default.equal(normal.slotCount, 96);
        strict_1.default.equal(fall.slotCount, 100);
        const rec = (0, types_js_1.emptyDayRecord)("2026-03-29", "Europe/Berlin", spring.startMs, spring.endMs, spring.slotCount);
        strict_1.default.equal(rec.buckets.outdoorTempC.length, 92);
        strict_1.default.equal(rec.buckets.climateUnitSlots.length, 92);
    });
    (0, node_test_1.it)("Idle-Segmente sind thermisch nutzbar und elektrisch nicht lernfähig", () => {
        let list = [];
        const step = (0, climate_segments_js_1.advanceClimateSegment)(null, 1_000, { sharedPowerGroupId: null, mode: "off", activeUnitCombination: "none", valid: false }, 0, 900, "climate_idle", list, {
            outdoorTempC: 22,
            units: [{ unitIndex: 1, roomTempC: 24, roomHumidityPct: 50, ownershipOwner: "ems", overrideActive: false }],
        });
        list = (0, climate_segments_js_1.closeClimateSegment)(step.open, 1_000 + 1_800_000, step.list);
        strict_1.default.equal(list.length, 1);
        strict_1.default.equal(list[0].mode, "off");
        strict_1.default.equal(list[0].valid, false);
        strict_1.default.equal(list[0].rejectReason, "climate_idle");
        strict_1.default.equal(list[0].unitObservations?.[0]?.roomTempStartC, 24);
        strict_1.default.equal(list[0].thermalUsable, true);
        const stats = (0, math_js_1.computeClimateSharedPowerStats)([{ ...list[0], endTs: list[0].endTs }], Date.now());
        strict_1.default.deepEqual(stats, {});
    });
    (0, node_test_1.it)("Heating- und Cooling-Segmente werden nicht vermischt; fehlende Startwerte nicht geschätzt", () => {
        let list = [];
        const cool = (0, climate_segments_js_1.advanceClimateSegment)(null, 1_000, { sharedPowerGroupId: "outdoor_1", mode: "cooling", activeUnitCombination: "1", valid: true }, 0.1, 60, null, list, {
            outdoorTempC: 30,
            units: [{ unitIndex: 1, roomTempC: 27, roomHumidityPct: null, ownershipOwner: "ems", overrideActive: false }],
        });
        const heat = (0, climate_segments_js_1.advanceClimateSegment)(cool.open, 2_000, { sharedPowerGroupId: "outdoor_1", mode: "heating", activeUnitCombination: "1", valid: true }, 0.1, 60, null, cool.list, {
            outdoorTempC: 5,
            units: [{ unitIndex: 1, roomTempC: 18, roomHumidityPct: 40, ownershipOwner: "ems", overrideActive: false }],
        });
        list = (0, climate_segments_js_1.closeClimateSegment)(heat.open, 3_000, heat.list);
        strict_1.default.equal(list.length, 2);
        strict_1.default.equal(list[0].mode, "cooling");
        strict_1.default.equal(list[1].mode, "heating");
        strict_1.default.equal(list[0].unitObservations?.[0]?.roomTempStartC, 27);
        strict_1.default.equal(list[1].unitObservations?.[0]?.roomHumidityStartPct, 40);
    });
});
