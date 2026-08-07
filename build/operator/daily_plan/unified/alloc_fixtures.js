"use strict";
/**
 * Fixtures für ALLOC-001…007 — rufen den echten Allocator auf.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.alloc007Input = exports.alloc006Input = exports.alloc005Input = exports.alloc004Input = exports.alloc003Input = exports.alloc002Input = exports.alloc001Input = void 0;
const fixtures_1 = require("./fixtures");
const Q = (confidencePct) => ({
    status: "valid",
    confidencePct,
    reasonDe: "alloc-fixture",
});
function withConfidence(input, pct) {
    return {
        ...input,
        pv: {
            ...input.pv,
            uncertainty: Q(pct),
            freshness: { ...input.pv.freshness, quality: Q(pct) },
        },
    };
}
/** ALLOC-001: hoher PV, Batterie teils leer, Thermal, keine Wallbox. */
function alloc001Input() {
    const input = (0, fixtures_1.golden001Input)();
    input.battery = { ...input.battery, socPct: 25, usableCapacityKwh: 18 };
    input.wallbox = null;
    input.thermal = {
        ...input.thermal,
        headroomEnergyKwh: 5,
        dayTargetTempC: 56,
    };
    return withConfidence(input, 85);
}
exports.alloc001Input = alloc001Input;
/** ALLOC-002: hohe PV während Abwesenheit. */
function alloc002Input() {
    return withConfidence((0, fixtures_1.golden002Input)(), 85);
}
exports.alloc002Input = alloc002Input;
/** ALLOC-003: PV reicht vor Deadline, billiger früher Netzslot. */
function alloc003Input() {
    return withConfidence((0, fixtures_1.golden003Input)(), 90);
}
exports.alloc003Input = alloc003Input;
/** ALLOC-004: harte Deadline, PV unzureichend. */
function alloc004Input() {
    const input = (0, fixtures_1.golden002Input)();
    input.wallbox = {
        ...input.wallbox,
        presenceWindows: [
            { available: true, startIso: "2026-08-04T00:00:00.000Z", endIso: "2026-08-05T00:00:00.000Z" },
        ],
        requiredEnergyKwh: 25,
        deadlineIso: "2026-08-04T18:00:00.000Z",
        energyGoalHard: true,
    };
    // Flatten PV to weak
    input.pv.slots = input.pv.slots.map((s) => ({
        ...s,
        forecastPowerW: 400,
        energyKwh: 0.1,
    }));
    input.pv.expectedDayEnergyKwh = input.pv.slots.reduce((a, s) => a + (s.energyKwh ?? 0), 0);
    return withConfidence(input, 80);
}
exports.alloc004Input = alloc004Input;
/** ALLOC-005: PV nominal genug, Confidence niedrig, harte Deadline. */
function alloc005Input() {
    const input = (0, fixtures_1.golden003Input)();
    input.wallbox = {
        ...input.wallbox,
        requiredEnergyKwh: 6,
        energyGoalHard: true,
    };
    return withConfidence(input, 40);
}
exports.alloc005Input = alloc005Input;
/** ALLOC-006: Batterie fast voll, Thermal Headroom, hoher Surplus. */
function alloc006Input() {
    const input = (0, fixtures_1.golden001Input)();
    input.battery = { ...input.battery, socPct: 92 };
    input.wallbox = null;
    input.thermal = {
        ...input.thermal,
        headroomEnergyKwh: 4,
    };
    return withConfidence(input, 85);
}
exports.alloc006Input = alloc006Input;
/** ALLOC-007: Thermal tagsüber aus PV, nicht abends Batterie. */
function alloc007Input() {
    const day = (0, fixtures_1.buildSlots)("2026-08-04T08:00:00.000Z", 8);
    const evening = (0, fixtures_1.buildSlots)("2026-08-04T20:00:00.000Z", 2);
    const slots = [...day, ...evening];
    const base = (0, fixtures_1.golden001Input)();
    base.time = {
        ...base.time,
        slots,
        horizonStartIso: slots[0].startIso,
        horizonEndIso: slots[slots.length - 1].endIso,
    };
    base.pv.slots = slots.map((s) => {
        const daySlot = Date.parse(s.startIso) < Date.parse("2026-08-04T18:00:00.000Z");
        const power = daySlot ? 3500 : 0;
        return {
            slot: s,
            forecastPowerW: power,
            observedPowerW: null,
            energyKwh: (power / 1000) * 0.25,
        };
    });
    base.pv.expectedDayEnergyKwh = base.pv.slots.reduce((a, s) => a + (s.energyKwh ?? 0), 0);
    base.pv.previousExpectedDayEnergyKwh = null;
    base.houseLoad.slots = slots.map((s) => ({
        slot: s,
        forecastPowerW: 600,
        observedPowerW: null,
        energyKwh: 0.15,
    }));
    base.prices.slots = slots.map((s) => ({
        slot: s,
        importCtPerKwh: 20,
        exportCtPerKwh: 9,
        gridImportAllowed: true,
    }));
    base.wallbox = null;
    base.thermal = {
        ...base.thermal,
        headroomEnergyKwh: 2.5,
    };
    base.battery = { ...base.battery, socPct: 70 };
    return withConfidence(base, 85);
}
exports.alloc007Input = alloc007Input;
