"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const strict_1 = __importDefault(require("node:assert/strict"));
const types_1 = require("../day_telemetry/types");
const exogenous_load_1 = require("./exogenous_load");
const simulate_1 = require("./simulate");
function fixtureDay(slotCount = 2) {
    return (0, types_1.emptyDayRecord)("2026-08-30", "Europe/Berlin", 0, slotCount * 15 * 60_000, slotCount);
}
(0, node_test_1.describe)("splitExogenousLoad — keine Doppelzählung steuerbarer Last", () => {
    (0, node_test_1.it)("exogen = Haus − Klima/Heizstab/EV; no_ems-Last = nicht Haus + extra", () => {
        const day = fixtureDay(2);
        day.buckets.houseTotalKwh = [5, 5];
        day.buckets.climateElecSharedKwh = [1, 1];
        day.buckets.immersionKwh = [0.5, 0.5];
        day.buckets.evChargedKwh = [1, 1];
        const split = (0, exogenous_load_1.splitExogenousLoad)(day);
        strict_1.default.equal(split.exogenousKwh[0], 2.5);
        strict_1.default.equal(split.controllableKwh[0], 2.5);
        strict_1.default.equal(split.noEmsTotalLoadKwh[0], 5);
        strict_1.default.ok((split.noEmsTotalLoadKwh[0] ?? 0) < 5 + 1, "keine Doppelzählung");
    });
    (0, node_test_1.it)("fehlt eine Steuerbare, wird sie nicht als 0 erfunden", () => {
        const day = fixtureDay(1);
        day.buckets.houseTotalKwh = [4];
        day.buckets.climateElecSharedKwh = [1];
        day.buckets.immersionKwh = [null];
        day.buckets.evChargedKwh = [null];
        const split = (0, exogenous_load_1.splitExogenousLoad)(day);
        strict_1.default.equal(split.exogenousKwh[0], 3);
        strict_1.default.equal(split.controllableKwh[0], 1);
        strict_1.default.equal(split.noEmsTotalLoadKwh[0], 4);
    });
    (0, node_test_1.it)("nutzt climateElecSharedKwh statt climateKwh (keine Indoor-Doppelzählung)", () => {
        const day = fixtureDay(1);
        day.buckets.houseTotalKwh = [3];
        day.buckets.climateKwh = [2];
        day.buckets.climateElecSharedKwh = [0.7];
        const split = (0, exogenous_load_1.splitExogenousLoad)(day);
        strict_1.default.equal(split.controllableKwh[0], 0.7);
        strict_1.default.equal(split.exogenousKwh[0], 2.3);
    });
    (0, node_test_1.it)("klemmt exogen auf 0 bei Messinkonsistenz (Steuerbare > Haus)", () => {
        const day = fixtureDay(1);
        day.buckets.houseTotalKwh = [1];
        day.buckets.evChargedKwh = [3];
        const split = (0, exogenous_load_1.splitExogenousLoad)(day);
        strict_1.default.equal(split.exogenousKwh[0], 0);
        strict_1.default.equal(split.noEmsTotalLoadKwh[0], 3);
    });
});
(0, node_test_1.describe)("simulateReferenceNoEms verwendet exogene Last, nicht Haus+Steuerbare", () => {
    (0, node_test_1.it)("Batterie sieht dieselbe Last wie die Hauslast, nicht Haus plus EV extra", () => {
        const day = fixtureDay(2);
        day.buckets.pvKwh = [0, 0];
        day.buckets.houseTotalKwh = [1, 1];
        day.buckets.evChargedKwh = [0.4, 0.4];
        day.buckets.priceCtPerKwh = [20, 20];
        const r = (0, simulate_1.simulateReferenceNoEms)(day, {
            usableCapacityKwh: 10,
            minSocPct: 5,
            maxSocPct: 100,
            maxChargeW: null,
            maxDischargeW: null,
            startSocPct: 50,
        }, null);
        strict_1.default.equal(r.evaluable, true);
        strict_1.default.match(r.assumptionsDe.join(" "), /Exogene Grundlast/);
    });
});
