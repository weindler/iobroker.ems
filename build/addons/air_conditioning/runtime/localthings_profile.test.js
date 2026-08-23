"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const strict_1 = __importDefault(require("node:assert/strict"));
const registry_js_1 = require("../profiles/registry.js");
const localthings_payload_js_1 = require("../profiles/localthings_payload.js");
const localthings_power_js_1 = require("../profiles/localthings_power.js");
const localthings_filter_js_1 = require("../profiles/localthings_filter.js");
const validate_localthings_js_1 = require("../profiles/validate_localthings.js");
const localthings_prefill_js_1 = require("../profiles/localthings_prefill.js");
const localthings_presets_js_1 = require("../profiles/localthings_presets.js");
const sequences_js_1 = require("./sequences.js");
const time_js_1 = require("./time.js");
const cleaning_js_1 = require("./cleaning.js");
const UNIT = {
    index: 1,
    enabled: true,
    name: "Test",
    profileId: "samsung_localthings_hass",
    activeFrom: "08:00",
    activeUntil: "20:00",
    hardOffAt: "20:00",
    estimatedPowerW: 800,
    onTempC: 26,
    offTempC: 24,
    maxHumidityPct: null,
    humidityOffHysteresisPct: 3,
    coolingSetpointC: 23,
    modeWhenCooling: "cool",
    fanModeWhenCooling: "auto",
    fanSpeedWhenCooling: "",
    modeWhenDehumidify: "dry",
    fanModeWhenDehumidify: "auto",
    modeWhenFanOnly: "fan_only",
    fanModeWhenFanOnly: "auto",
    modeWhenHeating: "heat",
    fanModeWhenHeating: "auto",
    heatSetpointC: 21,
    cleaningAfterRun: true,
    cleaningAfterCooling: true,
    cleaningAfterDehumidify: true,
    cleaningAfterHeating: false,
    cleaningDelayMin: 5,
    cleaningDurationMin: 35,
    statsEnabled: true,
    statsTrackRuntime: true,
    statsTrackEnergy: true,
    statsRuntimeOffsetSec: 0,
    statsEnergyOffsetKwh: 0,
};
function hassTable() {
    return {
        unit_1_cmd_switch_on: { enabled: true, targetStateId: "hass.0.entities.climate.x.turn_on" },
        unit_1_cmd_switch_off: { enabled: true, targetStateId: "hass.0.entities.climate.x.turn_off" },
        unit_1_cmd_set_mode: { enabled: true, targetStateId: "hass.0.entities.climate.x.set_hvac_mode" },
        unit_1_cmd_set_cool_setpoint: {
            enabled: true,
            targetStateId: "hass.0.entities.climate.x.set_temperature",
        },
        unit_1_cmd_set_fan_mode: { enabled: true, targetStateId: "hass.0.entities.climate.x.set_fan_mode" },
        unit_1_cmd_cleaning_start: {
            enabled: true,
            targetStateId: "hass.0.entities.switch.x_clean.turn_on",
        },
        unit_1_cmd_cleaning_off: {
            enabled: true,
            targetStateId: "hass.0.entities.switch.x_clean.turn_off",
        },
    };
}
(0, node_test_1.describe)("AC LocalThings / SmartThings profile abstraction", () => {
    (0, node_test_1.it)("1) SmartThings profile unchanged (id + refresh in start)", () => {
        strict_1.default.equal(registry_js_1.SAMSUNG_SMARTTHINGS_PROFILE.id, "samsung_smartthings");
        const steps = registry_js_1.SAMSUNG_SMARTTHINGS_PROFILE.coolingStartSequence(UNIT, "cooling");
        strict_1.default.ok(steps.some((s) => s.kind === "toggle" && s.role === "cmd_refresh"));
        strict_1.default.ok(steps.some((s) => s.kind === "set" && s.role === "cmd_set_mode"));
        strict_1.default.ok(!steps.some((s) => s.kind === "set_json"));
    });
    (0, node_test_1.it)("2–6) LocalThings turn_on/off + HVAC/temp/fan JSON writes", async () => {
        const writes = [];
        const host = {
            getForeignStateAsync: async () => ({ val: false, ack: true, ts: 0, lc: 0, from: "t" }),
            setForeignStateAsync: async (id, state) => {
                if (state && typeof state === "object" && "val" in state) {
                    writes.push({ id, val: state.val });
                }
            },
        };
        const table = hassTable();
        const profile = (0, registry_js_1.getAcProfile)("samsung_localthings_hass");
        strict_1.default.equal(profile.id, registry_js_1.SAMSUNG_LOCALTHINGS_HASS_PROFILE.id);
        const steps = profile.coolingStartSequence(UNIT, "cooling").filter((s) => s.kind !== "delay_ms");
        await (0, sequences_js_1.executeAcWriteSteps)(host, 1, table, steps, true);
        const tempW = writes.find((w) => String(w.id).includes("set_temperature"));
        const modeW = writes.find((w) => String(w.id).includes("set_hvac_mode"));
        const fanW = writes.find((w) => String(w.id).includes("set_fan_mode"));
        const onW = writes.find((w) => String(w.id).includes("turn_on") && w.val === true);
        strict_1.default.equal(tempW?.val, (0, localthings_payload_js_1.stringifyLocalthingsPayload)((0, localthings_payload_js_1.localthingsTemperaturePayload)(23)));
        strict_1.default.equal(modeW?.val, (0, localthings_payload_js_1.stringifyLocalthingsPayload)((0, localthings_payload_js_1.localthingsHvacModePayload)("cool")));
        strict_1.default.equal(fanW?.val, (0, localthings_payload_js_1.stringifyLocalthingsPayload)((0, localthings_payload_js_1.localthingsFanModePayload)("auto")));
        strict_1.default.ok(onW);
        strict_1.default.ok(!writes.some((w) => w.id.includes("set_temperature") && w.val === true));
        strict_1.default.ok(!writes.some((w) => w.id.includes("set_hvac_mode") && w.val === true));
        writes.length = 0;
        await (0, sequences_js_1.executeAcWriteSteps)(host, 1, table, profile.coolingStopSequence?.() ?? [], true);
        strict_1.default.ok(writes.some((w) => String(w.id).includes("turn_off") && w.val === true));
    });
    (0, node_test_1.it)("7) Feedback off/cool via switchIsOn/Off", () => {
        strict_1.default.equal((0, time_js_1.switchIsOff)("off"), true);
        strict_1.default.equal((0, time_js_1.switchIsOn)("cool"), true);
        strict_1.default.equal((0, time_js_1.switchIsOn)("heat"), true);
        strict_1.default.equal((0, time_js_1.switchIsOn)(true), true);
        strict_1.default.equal((0, time_js_1.switchIsOff)(false), true);
        strict_1.default.equal((0, time_js_1.switchIsOn)("off"), false);
    });
    (0, node_test_1.it)("8) missing optional sensors do not invalidate core", () => {
        strict_1.default.equal((0, validate_localthings_js_1.localthingsMappingsValid)("samsung_localthings_hass", {
            feedback_switch: "hass.0.entities.climate.x.state_boolean",
            cmd_switch_on: "hass.0.entities.climate.x.turn_on",
            cmd_switch_off: "hass.0.entities.climate.x.turn_off",
            cmd_set_cool_setpoint: "hass.0.entities.climate.x.set_temperature",
            cmd_set_mode: "hass.0.entities.climate.x.set_hvac_mode",
            room_temp: "hass.0.entities.climate.x.current_temperature",
        }), true);
    });
    (0, node_test_1.it)("9) Power 0 while AC on → learned fallback (no measured)", () => {
        const d = (0, localthings_power_js_1.resolveLocalthingsMeasuredPowerW)({ rawPowerW: 0, acConfirmedOn: true });
        strict_1.default.equal(d.useMeasured, false);
        strict_1.default.equal(d.reason, "implausible_zero_while_on");
    });
    (0, node_test_1.it)("10) Power >0 → measured usable", () => {
        const d = (0, localthings_power_js_1.resolveLocalthingsMeasuredPowerW)({ rawPowerW: 720, acConfirmedOn: true });
        strict_1.default.equal(d.useMeasured, true);
        if (d.useMeasured)
            strict_1.default.equal(d.powerW, 720);
    });
    (0, node_test_1.it)("11) LocalThings without refresh is valid", () => {
        const issues = (0, validate_localthings_js_1.validateAcUnitMappings)({
            unitIndex: 1,
            profileId: "samsung_localthings_hass",
            targets: {
                feedback_switch: "h.state_boolean",
                cmd_switch_on: "h.turn_on",
                cmd_switch_off: "h.turn_off",
                cmd_set_cool_setpoint: "h.set_temperature",
                cmd_set_mode: "h.set_hvac_mode",
                room_temp: "h.current_temperature",
            },
        });
        strict_1.default.equal(issues.filter((i) => i.severity === "error").length, 0);
    });
    (0, node_test_1.it)("12) Auto-Clean switch sequences use toggle on/off roles", () => {
        const start = registry_js_1.SAMSUNG_LOCALTHINGS_HASS_PROFILE.cleaningStartSequence();
        const stop = registry_js_1.SAMSUNG_LOCALTHINGS_HASS_PROFILE.cleaningStopSequence();
        strict_1.default.deepEqual(start, [{ kind: "toggle", role: "cmd_cleaning_start" }]);
        strict_1.default.deepEqual(stop, [{ kind: "toggle", role: "cmd_cleaning_off" }]);
        strict_1.default.equal((0, cleaning_js_1.isCleaningOperatingActive)(true), true);
        strict_1.default.equal((0, cleaning_js_1.isCleaningOperatingActive)(false), false);
    });
    (0, node_test_1.it)("13) Filter status normal/wash/replace", () => {
        strict_1.default.equal((0, localthings_filter_js_1.parseLocalthingsFilterStatus)("normal"), "normal");
        strict_1.default.equal((0, localthings_filter_js_1.parseLocalthingsFilterStatus)("wash"), "wash");
        strict_1.default.equal((0, localthings_filter_js_1.parseLocalthingsFilterStatus)("replace"), "replace");
        strict_1.default.match((0, localthings_filter_js_1.formatLocalthingsFilterSummary)({ usagePct: 75, usageHours: 375, statusRaw: "normal" }), /75 %/);
        strict_1.default.match((0, localthings_filter_js_1.formatLocalthingsFilterSummary)({ usagePct: 75, usageHours: 375, statusRaw: "wash" }), /Reinigen/);
    });
    (0, node_test_1.it)("14) Prefill does not overwrite existing hass user config", () => {
        const cfg = {
            ac_u1_profile: "samsung_localthings_hass",
            ac_u1_enabled: true,
            ac_u1_feedback_switch_target: "hass.0.entities.climate.custom.state_boolean",
            ac_u1_cmd_switch_on_target: "hass.0.entities.climate.custom.turn_on",
            ac_u1_cmd_set_mode_target: "hass.0.entities.climate.custom.set_hvac_mode",
            ac_u1_cmd_set_cool_setpoint_target: "hass.0.entities.climate.custom.set_temperature",
        };
        strict_1.default.equal((0, localthings_prefill_js_1.buildLocalthingsPrefillPatch)(cfg), null);
    });
    (0, node_test_1.it)("15) Switching back to SmartThings restores SmartThings write contract", () => {
        const st = (0, registry_js_1.getAcProfile)("samsung_smartthings");
        const lt = (0, registry_js_1.getAcProfile)("samsung_localthings_hass");
        const stSteps = st.coolingStartSequence(UNIT, "cooling");
        const ltSteps = lt.coolingStartSequence(UNIT, "cooling");
        strict_1.default.ok(stSteps.some((s) => s.kind === "set"));
        strict_1.default.ok(ltSteps.some((s) => s.kind === "set_json"));
        strict_1.default.ok(stSteps.some((s) => s.kind === "toggle" && s.role === "cmd_refresh"));
        strict_1.default.ok(!ltSteps.some((s) => s.kind === "toggle" && s.role === "cmd_refresh"));
    });
    (0, node_test_1.it)("16) Installations without new profile start unchanged (generic fallback + SmartThings default id)", () => {
        strict_1.default.equal((0, registry_js_1.getAcProfile)("unknown_profile").id, registry_js_1.GENERIC_AC_PROFILE.id);
        strict_1.default.equal((0, registry_js_1.getAcProfile)("samsung_smartthings").id, "samsung_smartthings");
    });
    (0, node_test_1.it)("Prefill fills site presets when profile LocalThings and SmartThings paths present", () => {
        const cfg = {
            ac_u1_enabled: true,
            ac_u1_profile: "samsung_localthings_hass",
            ac_u1_feedback_switch_target: "smartthings.0.dev.status.switch.switch.value",
            ac_u1_cmd_switch_on_target: "smartthings.0.dev.capabilities.switch-on",
            ac_u2_enabled: true,
            ac_u2_profile: "samsung_localthings_hass",
            ac_u2_feedback_switch_target: "smartthings.0.other.status.switch.switch.value",
            ac_u2_cmd_switch_on_target: "smartthings.0.other.capabilities.switch-on",
        };
        const merged = (0, localthings_prefill_js_1.mergeLocalthingsPrefillIntoConfig)(cfg);
        strict_1.default.match(String(merged.ac_u1_cmd_switch_on_target), /wohnzimmer_eg.*turn_on/);
        strict_1.default.match(String(merged.ac_u2_cmd_switch_on_target), /josef_zimmer.*turn_on/);
        strict_1.default.match(String(merged.ac_u1_cmd_set_cool_setpoint_target), /set_temperature/);
        strict_1.default.equal(merged.ac_u1_cmd_cleaning_off_enabled, true);
    });
    (0, node_test_1.it)("scheduleLocalthingsPrefillPersist does not call updateConfig before bootstrap complete", async () => {
        const { resetBootstrapBarrierForTest, markBootstrapComplete } = await import("../../../bootstrap/barrier.js");
        const { scheduleLocalthingsPrefillPersist, clearLocalthingsPrefillPersistTimer } = await import("../profiles/localthings_prefill.js");
        resetBootstrapBarrierForTest();
        clearLocalthingsPrefillPersistTimer();
        let calls = 0;
        scheduleLocalthingsPrefillPersist({
            log: { info: () => undefined, warn: () => undefined },
            updateConfig: async () => {
                calls += 1;
            },
        }, { ac_u1_profile: "samsung_localthings_hass" });
        await new Promise((r) => setTimeout(r, 50));
        strict_1.default.equal(calls, 0, "kein updateConfig während Bootstrap");
        clearLocalthingsPrefillPersistTimer();
        markBootstrapComplete();
    });
    (0, node_test_1.it)("derive mappings from climate entity base", () => {
        const d = (0, localthings_presets_js_1.deriveLocalthingsMappingsFromClimateBase)("hass.0.entities.climate.foo_bar.state");
        strict_1.default.equal(d.cmd_switch_on, "hass.0.entities.climate.foo_bar.turn_on");
        strict_1.default.equal(d.cmd_set_mode, "hass.0.entities.climate.foo_bar.set_hvac_mode");
    });
    (0, node_test_1.it)("payload helpers", () => {
        strict_1.default.equal(JSON.stringify((0, localthings_payload_js_1.localthingsHvacModePayload)("cool")), '{"hvac_mode":"cool"}');
        strict_1.default.equal(JSON.stringify((0, localthings_payload_js_1.localthingsTemperaturePayload)(23)), '{"temperature":23}');
    });
});
