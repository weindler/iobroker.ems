"use strict";
/**
 * Boiler/Puffer Separation — T1–T15 + Realfall + Invarianten.
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const strict_1 = __importDefault(require("node:assert/strict"));
const node_test_1 = require("node:test");
const next_reliable_pv_1 = require("./next_reliable_pv");
const thermal_boiler_buffer_1 = require("./thermal_boiler_buffer");
const hygiene_1 = require("../../../addons/immersion_heater/hygiene");
const immersion_heater_1 = require("../../contributions/flexible/immersion_heater");
const device_config_1 = require("../../../addons/immersion_heater/device_config");
const mode_policy_1 = require("../../../planner/mode_policy");
const NOW = Date.parse("2026-08-11T10:00:00.000Z");
const COVER = Date.parse("2026-08-11T16:00:00.000Z");
const NEXT_PV = Date.parse("2026-08-12T06:00:00.000Z");
function bridge(over = {}) {
    return (0, next_reliable_pv_1.resolveThermalPlannerEnergy)({
        nowMs: NOW,
        bufferTempC: 50,
        minTempC: 50,
        boilerTempC: 58,
        boilerMinTempC: 50,
        bufferMaxTempC: 63,
        headroomEnergyKwh: 4.94, // ~13 K * 0.38
        coolingRateCPerH: null,
        estimatedEmptyAtMs: null,
        boilerEmptyAtUsable: false,
        boilerSensorDegraded: false,
        hygieneMandatoryKwh: 0,
        nextReliablePvMs: NEXT_PV,
        currentWindowEndMs: COVER,
        pvConfidence01: 0.85,
        ...over,
    });
}
function immersionCfg() {
    return (0, device_config_1.immersionDeviceConfigFromAdapter)({
        ih_boiler_min_temp_c: 50,
        ih_planning_max_temp_c: 63,
        ih_hygiene_target_temp_c: 60,
        ih_stage_1_set_state: "r.0.on",
        ih_stage_1_nominal_power_w: 1700,
    });
}
(0, node_test_1.describe)("boiler/puffer separation — Realfall + T1–T15", () => {
    (0, node_test_1.it)("Realfall / T1: Boiler 58 / Puffer 50 → Hard≈0, Soft>0, kein Buffer-Hard", () => {
        const r = bridge();
        strict_1.default.ok(r.mandatoryEnergyKwh < 0.05, `hard=${r.mandatoryEnergyKwh}`);
        strict_1.default.ok(r.economicHeadroomKwh > 1, `soft=${r.economicHeadroomKwh}`);
        strict_1.default.match(r.reasonDe, /Soft aus Puffer|Boiler über Min/i);
    });
    (0, node_test_1.it)("T2: Boiler 49 / Puffer 55 → Hard Warmwasser trotz warmem Puffer", () => {
        const r = bridge({ boilerTempC: 49, bufferTempC: 55, headroomEnergyKwh: 3 });
        strict_1.default.ok(r.mandatoryEnergyKwh > 0.3, `hard=${r.mandatoryEnergyKwh}`);
    });
    (0, node_test_1.it)("T3: Boiler 52 / Puffer 63 → Soft 0", () => {
        const soft = (0, thermal_boiler_buffer_1.bufferSoftHeadroomKwh)({ bufferTempC: 63, bufferMaxTempC: 63 });
        strict_1.default.equal(soft, 0);
        const r = bridge({ boilerTempC: 52, bufferTempC: 63, headroomEnergyKwh: 0, bufferMaxTempC: 63 });
        strict_1.default.ok(r.economicHeadroomKwh < 0.05);
        strict_1.default.ok(r.mandatoryEnergyKwh < 0.05);
    });
    (0, node_test_1.it)("T4: Boiler 48 / Puffer 63 → Hard erkannt, Soft 0 (Max blockiert Laden)", () => {
        const r = bridge({ boilerTempC: 48, bufferTempC: 63, headroomEnergyKwh: 0, bufferMaxTempC: 63 });
        strict_1.default.ok(r.mandatoryEnergyKwh > 0.5);
        strict_1.default.ok(r.economicHeadroomKwh < 0.05);
        const hy = (0, hygiene_1.evaluateHygieneDuty)({
            nowMs: NOW,
            boilerTempC: 48,
            hygieneTargetTempC: 60,
            bufferTempC: 63,
            bufferMaxTempC: 63,
            lastBoilerHygieneAtIso: null,
            kwhPerDegreeC: 0.38,
        });
        strict_1.default.equal(hy.blockedByBufferMax, true);
        strict_1.default.equal(hy.mandatoryEnergyKwh, 0);
    });
    (0, node_test_1.it)("T5: Boiler-Learning degraded → keine Fake-emptyAt-Deadline", () => {
        const r = bridge({
            boilerTempC: 58,
            coolingRateCPerH: 0.8,
            estimatedEmptyAtMs: Date.parse("2026-08-11T18:00:00.000Z"),
            boilerEmptyAtUsable: false,
        });
        strict_1.default.ok(r.mandatoryEnergyKwh < 0.05);
    });
    (0, node_test_1.it)("T6: Boiler-Learning valid + emptyAt vor Cover → Hard möglich", () => {
        const r = (0, thermal_boiler_buffer_1.resolveBoilerBufferThermalEnergy)({
            nowMs: NOW,
            boilerTempC: 51,
            boilerMinTempC: 50,
            bufferTempC: 55,
            bufferMaxTempC: 63,
            softHeadroomEnergyKwh: 2,
            boilerCoolingRateCPerH: 0.6,
            boilerEstimatedEmptyAtMs: Date.parse("2026-08-11T14:00:00.000Z"),
            boilerEmptyAtUsable: true,
            nextReliablePvMs: NEXT_PV,
            currentWindowEndMs: COVER,
            pvConfidence01: 0.85,
        });
        strict_1.default.ok(r.mandatoryEnergyKwh > 0.1 || r.coversUntilNextPv === false || r.hardFromBoiler);
    });
    (0, node_test_1.it)("T7: Buffer-emptyAt darf keine Hard-Deadline erzeugen (I4)", () => {
        const r = bridge({
            boilerTempC: 58,
            /** Wenn fälschlich Buffer-emptyAt durchgereicht würde — usable=false blockt. */
            estimatedEmptyAtMs: Date.parse("2026-08-11T18:00:00.000Z"),
            boilerEmptyAtUsable: false,
            coolingRateCPerH: 1.2,
        });
        strict_1.default.ok(r.mandatoryEnergyKwh < 0.05);
    });
    (0, node_test_1.it)("T8: Soft-Headroom bei gutem PV-Tag messbar", () => {
        const soft = (0, thermal_boiler_buffer_1.bufferSoftHeadroomKwh)({ bufferTempC: 50, bufferMaxTempC: 63, softTargetTempC: 62 });
        strict_1.default.ok(soft > 3);
    });
    (0, node_test_1.it)("T9: Boiler warm → Contribution mandatory nicht wegen Puffer", () => {
        const [mand] = (0, immersion_heater_1.buildImmersionHeaterContributions)({
            now: new Date(NOW),
            addonEnabled: true,
            governanceEnabled: true,
            globalModeOff: false,
            addonExecutionOff: false,
            modePolicy: (0, mode_policy_1.plannerModePolicyFromGlobalMode)("balanced"),
            config: immersionCfg(),
            bufferTempC: 50,
            boilerTempC: 58,
            boilerSensorDegraded: false,
            thermalMode: "auto",
            fault: false,
            lockout: false,
            relayMapped: true,
            pvTodayKwh: 40,
            pvTomorrowKwh: 20,
            pvBiasStatus: "ready",
            forecastModeEnabled: true,
            aiOptimizationAllowed: false,
            thermalLearning: {
                status: "valid",
                health: "ok",
                samples: 10,
                coolingRateCPerHAvg: 1.2,
                coolingConstantPerH: null,
                coolingAsymptoteC: null,
                estimatedRemainingHours: 8,
                estimatedEmptyAt: "2026-08-11T18:00:00.000Z",
                currentDayTypeRuntimeHoursMedian: null,
                reasonDe: "Puffer learning",
            },
            boilerLearning: {
                status: "missing",
                health: null,
                samples: 0,
                coolingRateCPerHAvg: null,
                coolingConstantPerH: null,
                coolingAsymptoteC: null,
                estimatedRemainingHours: null,
                estimatedEmptyAt: null,
                currentDayTypeRuntimeHoursMedian: null,
                reasonDe: "lernt",
            },
            hygieneDue: false,
        });
        strict_1.default.equal(mand.enabled, false);
        strict_1.default.match(mand.reasonDe, /Kein Pflichtbedarf/i);
    });
    (0, node_test_1.it)("T10: Hygiene innerhalb 7 Tage → kein Hygiene-Hard", () => {
        const hy = (0, hygiene_1.evaluateHygieneDuty)({
            nowMs: NOW,
            boilerTempC: 55,
            hygieneTargetTempC: 60,
            bufferTempC: 50,
            bufferMaxTempC: 63,
            lastBoilerHygieneAtIso: new Date(NOW - 2 * 24 * 3600_000).toISOString(),
            kwhPerDegreeC: 0.38,
        });
        strict_1.default.equal(hy.due, false);
        strict_1.default.equal(hy.mandatoryEnergyKwh, 0);
    });
    (0, node_test_1.it)("T11: Hygiene-Deadline fällig → Hard", () => {
        const hy = (0, hygiene_1.evaluateHygieneDuty)({
            nowMs: NOW,
            boilerTempC: 55,
            hygieneTargetTempC: 60,
            bufferTempC: 50,
            bufferMaxTempC: 63,
            lastBoilerHygieneAtIso: new Date(NOW - 8 * 24 * 3600_000).toISOString(),
            kwhPerDegreeC: 0.38,
        });
        strict_1.default.equal(hy.due, true);
        strict_1.default.ok(hy.mandatoryEnergyKwh > 0);
    });
    (0, node_test_1.it)("T12: Boiler >60 → Hygiene erfüllt", () => {
        const p = (0, hygiene_1.recordBoilerHygieneIfMet)({
            boilerTempC: 61,
            hygieneTargetTempC: 60,
            nowIso: new Date(NOW).toISOString(),
            persist: { lastBoilerHygieneAtIso: null },
        });
        strict_1.default.ok(p.lastBoilerHygieneAtIso);
        const hy = (0, hygiene_1.evaluateHygieneDuty)({
            nowMs: NOW + 1000,
            boilerTempC: 61,
            hygieneTargetTempC: 60,
            bufferTempC: 50,
            bufferMaxTempC: 63,
            lastBoilerHygieneAtIso: p.lastBoilerHygieneAtIso,
            kwhPerDegreeC: 0.38,
        });
        strict_1.default.equal(hy.due, false);
    });
    (0, node_test_1.it)("T13: Hygiene fällig + Puffer Max → keine Überschreitung", () => {
        const hy = (0, hygiene_1.evaluateHygieneDuty)({
            nowMs: NOW,
            boilerTempC: 55,
            hygieneTargetTempC: 60,
            bufferTempC: 63,
            bufferMaxTempC: 63,
            lastBoilerHygieneAtIso: null,
            kwhPerDegreeC: 0.38,
        });
        strict_1.default.equal(hy.blockedByBufferMax, true);
        strict_1.default.equal(hy.mandatoryEnergyKwh, 0);
    });
    (0, node_test_1.it)("T14: Boiler-Sensor stale → kein Buffer-Hard-Pfad", () => {
        const r = bridge({ boilerTempC: null, boilerSensorDegraded: true, bufferTempC: 45 });
        strict_1.default.ok(r.mandatoryEnergyKwh < 0.05 || r.reasonDe.includes("Boiler"));
        strict_1.default.match(r.reasonDe, /kein Buffer-Hard|fehlt/i);
    });
    (0, node_test_1.it)("T15: Puffer-Max = Safety-Cap für Soft", () => {
        strict_1.default.equal((0, thermal_boiler_buffer_1.bufferSoftHeadroomKwh)({ bufferTempC: 63, bufferMaxTempC: 63 }), 0);
        strict_1.default.ok((0, thermal_boiler_buffer_1.bufferSoftHeadroomKwh)({ bufferTempC: 50, bufferMaxTempC: 63 }) > 0);
    });
});
(0, node_test_1.describe)("boiler/puffer invariants", () => {
    (0, node_test_1.it)("I1: Boiler warm => kein Hard nur wegen kaltem Puffer", () => {
        const r = bridge({ boilerTempC: 58, bufferTempC: 44, headroomEnergyKwh: 5 });
        strict_1.default.ok(r.mandatoryEnergyKwh < 0.05);
    });
    (0, node_test_1.it)("I4: Buffer-emptyAt never becomes hard when boilerEmptyAtUsable=false", () => {
        const r = bridge({
            estimatedEmptyAtMs: Date.parse("2026-08-11T20:00:00.000Z"),
            boilerEmptyAtUsable: false,
            coolingRateCPerH: 2,
            boilerTempC: 58,
        });
        strict_1.default.ok(r.mandatoryEnergyKwh < 0.05);
    });
});
