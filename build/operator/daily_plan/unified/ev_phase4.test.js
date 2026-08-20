"use strict";
/**
 * EMS-Light v0.1.277 — Phase 4: EV as Unified flexible consumer (planning-only).
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const strict_1 = __importDefault(require("node:assert/strict"));
const node_fs_1 = require("node:fs");
const node_path_1 = require("node:path");
const execution_mode_1 = require("../../../execution_mode");
const tree_paths_1 = require("../../../tree_paths");
const write_allowlist_1 = require("../../../addons/wallbox/ev_foundation/write_allowlist");
const ensure_states_1 = require("../../../addons/wallbox/ev_foundation/ensure_states");
const quality_1 = require("../../quality");
const allocate_1 = require("./allocate");
const dispatch_bridge_1 = require("./dispatch_bridge");
const ev_energy_1 = require("./ev_energy");
const fixtures_1 = require("./fixtures");
const materiality_1 = require("./materiality");
const reason_codes_1 = require("./reason_codes");
const TZ = "Europe/Berlin";
const Q = (0, quality_1.operatorQuality)("valid", "ev-p4", 85);
const FRESH = { observedAtIso: "2026-08-08T22:00:00.000Z", ageSec: 5, quality: Q };
const SRC_ROOT = (0, node_path_1.join)(__dirname, "..", "..", "..", "..", "src");
function sumKind(plan, kind, pred) {
    return plan.allocations
        .filter((a) => a.kind === kind && (!pred || pred(a)))
        .reduce((s, a) => s + a.allocatedEnergyKwh, 0);
}
function presenceAll(startIso, endIso) {
    return [
        {
            available: true,
            status: "available",
            source: "explicit",
            hard: true,
            startIso,
            endIso,
        },
    ];
}
function wb(overrides = {}) {
    return {
        connectedNow: true,
        presenceWindows: presenceAll("2026-08-08T22:00:00.000Z", "2026-08-09T10:00:00.000Z"),
        presenceHardConstraint: true,
        vehicleProfileId: "explorer",
        vehicleSocPct: 50,
        socSource: "direct",
        fallbackEnergyNeedKwh: null,
        vehicleCapacityKwh: 77,
        targetSocPct: 90,
        requiredEnergyKwh: 30,
        deadlineIso: null,
        energyGoalHard: false,
        minChargePowerW: 1380,
        maxChargePowerW: 11000,
        chargeLossFactor: 1,
        evccExecutionMaster: true,
        evccChargeMode: null,
        batteryHoldRequested: false,
        minimumDepartureSocPct: null,
        externalSmartChargingMinSocPct: null,
        chargingEfficiency: 1,
        uncertainty: Q,
        freshness: FRESH,
        ...overrides,
    };
}
function gridHorizon(opts) {
    const nowIso = opts.nowIso ?? "2026-08-08T22:00:00.000Z";
    const hours = opts.hours ?? 8;
    const slots = (0, fixtures_1.buildSlots)(nowIso, hours);
    const cheapEnd = Date.parse(nowIso) + (opts.cheapHours ?? 2) * 3600_000;
    const base = (0, fixtures_1.golden001Input)();
    base.time = {
        ...base.time,
        nowIso,
        timezone: TZ,
        slots,
        horizonStartIso: slots[0].startIso,
        horizonEndIso: slots[slots.length - 1].endIso,
    };
    const pvW = opts.pvW ?? 0;
    base.pv.slots = slots.map((s) => ({
        slot: s,
        forecastPowerW: pvW,
        observedPowerW: null,
        energyKwh: (pvW / 1000) * 0.25,
    }));
    base.pv.expectedDayEnergyKwh = pvW > 0 ? (pvW / 1000) * hours : 0;
    base.pv.uncertainty = Q;
    base.houseLoad.slots = slots.map((s) => ({
        slot: s,
        forecastPowerW: 200,
        observedPowerW: null,
        energyKwh: 0.05,
    }));
    base.prices.slots = slots.map((s) => ({
        slot: s,
        importCtPerKwh: Date.parse(s.startIso) < cheapEnd ? (opts.cheapCt ?? 11) : (opts.expCt ?? 19),
        exportCtPerKwh: opts.exportCt === undefined ? 8 : opts.exportCt,
        gridImportAllowed: true,
    }));
    base.battery = {
        ...base.battery,
        socPct: 70,
        usableCapacityKwh: 10,
        maxChargePowerW: 4500,
        nightReserveKwh: 1,
        reserveSocPct: 10,
        minSocPct: 10,
        requiredChargeEnergyKwh: 0,
        endSocTargetPct: 70,
        gridChargeAllowed: true,
        uncertainty: Q,
        freshness: FRESH,
    };
    base.thermal = null;
    base.climate = null;
    base.wallbox = wb();
    base.globalMode = "balanced";
    return base;
}
function gridCost(plan, kind, input) {
    let ct = 0;
    for (const a of plan.allocations) {
        if (a.kind !== kind)
            continue;
        if (a.energySource !== "grid" && a.energySource !== "mixed")
            continue;
        const p = input.prices.slots.find((s) => s.slot.startIso === a.slot.startIso);
        if (p?.importCtPerKwh != null)
            ct += a.allocatedEnergyKwh * p.importCtPerKwh;
    }
    return ct;
}
(0, node_test_1.describe)("Phase 4 EV energy classes", () => {
    (0, node_test_1.it)("T2: SOC unknown → no fake kWh", () => {
        const classes = (0, ev_energy_1.resolveEvEnergyClasses)(wb({ vehicleSocPct: null, socSource: "unknown", requiredEnergyKwh: null, targetEnergyKwh: null }));
        strict_1.default.equal(classes.insufficientData, true);
        strict_1.default.equal(classes.targetEnergyKwh, null);
        strict_1.default.equal(classes.hardRequiredEnergyKwh, 0);
    });
    (0, node_test_1.it)("T3: target reached → no target need", () => {
        const classes = (0, ev_energy_1.resolveEvEnergyClasses)(wb({ vehicleSocPct: 90, targetSocPct: 90, requiredEnergyKwh: 0 }));
        strict_1.default.equal(classes.targetEnergyKwh, 0);
        strict_1.default.equal(classes.targetFlexEnergyKwh, 0);
    });
    (0, node_test_1.it)("T4: no deadline → target energy soft, hard 0", () => {
        const classes = (0, ev_energy_1.resolveEvEnergyClasses)(wb({ deadlineIso: null, minimumDepartureSocPct: null }));
        strict_1.default.equal(classes.hardRequiredEnergyKwh, 0);
        strict_1.default.equal(classes.energyGoalHard, false);
        strict_1.default.ok((classes.targetEnergyKwh ?? 0) > 0);
    });
    (0, node_test_1.it)("T5: real departure min + deadline → hard energy", () => {
        const classes = (0, ev_energy_1.resolveEvEnergyClasses)(wb({
            vehicleSocPct: 30,
            minimumDepartureSocPct: 70,
            targetSocPct: 90,
            deadlineIso: "2026-08-09T04:00:00.000Z",
            requiredEnergyKwh: null,
            chargingEfficiency: 1,
            vehicleCapacityKwh: 77,
        }));
        strict_1.default.ok(classes.hardRequiredEnergyKwh > 29 && classes.hardRequiredEnergyKwh < 32);
        strict_1.default.equal(classes.energyGoalHard, true);
        strict_1.default.ok((classes.targetEnergyKwh ?? 0) > classes.hardRequiredEnergyKwh);
    });
    (0, node_test_1.it)("T6: Tibber minimum is not hard", () => {
        const classes = (0, ev_energy_1.resolveEvEnergyClasses)(wb({
            externalSmartChargingMinSocPct: 25,
            minimumDepartureSocPct: null,
            deadlineIso: null,
            vehicleSocPct: 40,
        }));
        strict_1.default.equal(classes.hardRequiredEnergyKwh, 0);
        strict_1.default.equal(classes.energyGoalHard, false);
    });
    (0, node_test_1.it)("T8: efficiency applied once (no chargeLossFactor double)", () => {
        const classes = (0, ev_energy_1.resolveEvEnergyClasses)(wb({
            vehicleSocPct: 50,
            targetSocPct: 90,
            vehicleCapacityKwh: 10,
            requiredEnergyKwh: null,
            chargingEfficiency: 0.9,
            chargeLossFactor: 1.05,
        }));
        strict_1.default.equal(classes.targetEnergyKwh, 4.444);
    });
});
(0, node_test_1.describe)("Phase 4 management mode", () => {
    (0, node_test_1.it)("T1/T10 modes: unavailable / externally_managed / takeover_candidate", () => {
        strict_1.default.equal((0, ev_energy_1.resolveEvManagementMode)({ connectedNow: false, hasAllocatablePresence: false }), "unavailable");
        strict_1.default.equal((0, ev_energy_1.resolveEvManagementMode)({
            connectedNow: true,
            hasAllocatablePresence: true,
            externalAuthorityState: "active",
            takeoverSeverity: "none",
        }), "externally_managed");
        strict_1.default.equal((0, ev_energy_1.resolveEvManagementMode)({
            connectedNow: true,
            hasAllocatablePresence: true,
            externalAuthorityState: "planned",
            takeoverSeverity: "observe",
        }), "externally_managed");
        strict_1.default.equal((0, ev_energy_1.resolveEvManagementMode)({
            connectedNow: true,
            hasAllocatablePresence: true,
            externalAuthorityState: "active",
            takeoverSeverity: "recommended",
        }), "takeover_candidate");
        strict_1.default.equal((0, ev_energy_1.resolveEvManagementMode)({
            connectedNow: true,
            hasAllocatablePresence: true,
            externalAuthorityState: "active_without_plan",
            takeoverSeverity: "required",
        }), "takeover_candidate");
    });
});
(0, node_test_1.describe)("Phase 4 basic allocation", () => {
    (0, node_test_1.it)("T1: not connected and not available → no EV plan", () => {
        const input = gridHorizon({});
        input.wallbox = wb({
            connectedNow: false,
            presenceWindows: [
                {
                    available: false,
                    status: "unavailable",
                    source: "live_disconnected",
                    hard: true,
                    startIso: input.time.horizonStartIso,
                    endIso: input.time.horizonEndIso,
                },
            ],
        });
        const plan = (0, allocate_1.allocateUnifiedDayPlan)(input);
        strict_1.default.equal(sumKind(plan, "wallbox"), 0);
        strict_1.default.equal(plan.evPlanner?.managementMode, "unavailable");
        strict_1.default.equal(plan.evPlanner?.participating, false);
    });
    (0, node_test_1.it)("T2b: SOC unknown → no wallbox energy", () => {
        const input = gridHorizon({});
        input.wallbox = wb({
            vehicleSocPct: null,
            socSource: "unknown",
            requiredEnergyKwh: null,
            targetEnergyKwh: null,
            hardRequiredEnergyKwh: null,
        });
        const plan = (0, allocate_1.allocateUnifiedDayPlan)(input);
        strict_1.default.equal(sumKind(plan, "wallbox"), 0);
        strict_1.default.equal(plan.evPlanner?.targetEnergyKwh, null);
    });
    (0, node_test_1.it)("T3b: target reached → no target allocation", () => {
        const input = gridHorizon({});
        input.wallbox = wb({ vehicleSocPct: 90, targetSocPct: 90, requiredEnergyKwh: 0, targetEnergyKwh: 0 });
        const plan = (0, allocate_1.allocateUnifiedDayPlan)(input);
        strict_1.default.equal(sumKind(plan, "wallbox"), 0);
    });
    (0, node_test_1.it)("T4b: no deadline → soft, no fake urgency reason", () => {
        const input = gridHorizon({});
        const plan = (0, allocate_1.allocateUnifiedDayPlan)(input);
        strict_1.default.equal(plan.evPlanner?.hardEnergyKwh, 0);
        strict_1.default.ok((plan.evPlanner?.targetEnergyKwh ?? 0) > 0);
        strict_1.default.ok(plan.reasonCodes.includes(reason_codes_1.REASON.VEHICLE_TARGET_SOFT));
        strict_1.default.equal(plan.reasonCodes.includes(reason_codes_1.REASON.VEHICLE_DEADLINE_REQUIRED), false);
        strict_1.default.ok(plan.evPlanner?.explain.energyGoalHard === false);
    });
    (0, node_test_1.it)("T5b: hard deadline energy is allocated", () => {
        const input = gridHorizon({ hours: 6, cheapHours: 6 });
        input.wallbox = wb({
            vehicleSocPct: 30,
            minimumDepartureSocPct: 70,
            deadlineIso: "2026-08-09T04:00:00.000Z",
            requiredEnergyKwh: null,
            energyGoalHard: false,
        });
        const plan = (0, allocate_1.allocateUnifiedDayPlan)(input);
        strict_1.default.ok((plan.evPlanner?.hardEnergyKwh ?? 0) > 20);
        strict_1.default.ok(sumKind(plan, "wallbox") > 20);
        strict_1.default.ok(plan.reasonCodes.includes(reason_codes_1.REASON.VEHICLE_DEADLINE_REQUIRED) || plan.evPlanner?.hardEnergyKwh);
    });
    (0, node_test_1.it)("T7: EV slot respects 11 kW (2.75 kWh / 15 min)", () => {
        const input = gridHorizon({ cheapHours: 8 });
        const plan = (0, allocate_1.allocateUnifiedDayPlan)(input);
        for (const a of plan.allocations.filter((x) => x.kind === "wallbox")) {
            strict_1.default.ok(a.allocatedEnergyKwh <= 2.75 + 1e-6, `${a.slot.startIso} ${a.allocatedEnergyKwh}`);
            strict_1.default.ok(a.allocatedPowerW <= 11000 + 1e-6);
        }
    });
    (0, node_test_1.it)("T9: availability bounds slots", () => {
        const input = gridHorizon({ hours: 4, cheapHours: 4 });
        const availEnd = "2026-08-08T23:00:00.000Z";
        input.wallbox = wb({
            presenceWindows: [
                {
                    available: true,
                    status: "available",
                    source: "explicit",
                    hard: true,
                    startIso: "2026-08-08T22:00:00.000Z",
                    endIso: availEnd,
                },
                {
                    available: false,
                    status: "unavailable",
                    source: "explicit",
                    hard: true,
                    startIso: availEnd,
                    endIso: "2026-08-09T06:00:00.000Z",
                },
            ],
        });
        const plan = (0, allocate_1.allocateUnifiedDayPlan)(input);
        for (const a of plan.allocations.filter((x) => x.kind === "wallbox")) {
            strict_1.default.ok(a.slot.startIso < availEnd, a.slot.startIso);
        }
    });
});
(0, node_test_1.describe)("Phase 4 external authority", () => {
    (0, node_test_1.it)("T10/T11/T13: externally_managed → no competing EMS EV energy / dispatch", () => {
        const input = gridHorizon({});
        input.wallbox = wb({
            externalAuthorityState: "active",
            takeoverSeverity: "none",
            externalReservations: [
                {
                    startIso: "2026-08-09T00:00:00.000Z",
                    endIso: "2026-08-09T02:00:00.000Z",
                    powerW: 11000,
                    energyKwh: 22,
                    quality: "ok",
                },
            ],
            externalPlanQuality: "ok",
        });
        const plan = (0, allocate_1.allocateUnifiedDayPlan)(input);
        strict_1.default.equal(plan.evPlanner?.managementMode, "externally_managed");
        strict_1.default.equal(sumKind(plan, "wallbox"), 0);
        strict_1.default.equal((0, dispatch_bridge_1.unifiedPlanToWallboxAllocations)(plan).length, 0);
        strict_1.default.ok(plan.reasonCodes.includes(reason_codes_1.REASON.VEHICLE_EXTERNALLY_MANAGED));
        strict_1.default.ok(plan.reasonCodes.includes(reason_codes_1.REASON.VEHICLE_EXTERNAL_RESERVATION));
    });
    (0, node_test_1.it)("T12: reserved external slot occupies grid vs battery", () => {
        const input = gridHorizon({ cheapHours: 8, hours: 8 });
        input.battery = {
            ...input.battery,
            socPct: 20,
            requiredChargeEnergyKwh: 4,
            maxChargePowerW: 4500,
            gridChargeAllowed: true,
        };
        input.wallbox = wb({
            externalAuthorityState: "planned",
            takeoverSeverity: "observe",
            externalReservations: [
                {
                    startIso: "2026-08-08T22:00:00.000Z",
                    endIso: "2026-08-09T00:00:00.000Z",
                    powerW: 11000,
                    energyKwh: 22,
                    quality: "ok",
                },
            ],
        });
        const plan = (0, allocate_1.allocateUnifiedDayPlan)(input);
        const reserved = new Set(input.prices.slots
            .filter((s) => s.slot.startIso < "2026-08-09T00:00:00.000Z")
            .map((s) => s.slot.startIso));
        for (const a of plan.allocations) {
            if (a.kind !== "battery_charge")
                continue;
            if (a.energySource !== "grid" && a.energySource !== "mixed")
                continue;
            strict_1.default.equal(reserved.has(a.slot.startIso), false, `battery grid in reserved ${a.slot.startIso}`);
        }
    });
    (0, node_test_1.it)("T14: degraded external plan quality is marked", () => {
        const input = gridHorizon({});
        input.wallbox = wb({
            externalAuthorityState: "active",
            takeoverSeverity: "none",
            externalPlanQuality: "degraded",
            externalReservations: [
                {
                    startIso: "2026-08-09T00:00:00.000Z",
                    endIso: "2026-08-09T01:00:00.000Z",
                    powerW: 11000,
                    energyKwh: 11,
                    quality: "degraded",
                },
            ],
        });
        const plan = (0, allocate_1.allocateUnifiedDayPlan)(input);
        strict_1.default.equal(plan.evPlanner?.planQuality, "degraded");
        strict_1.default.equal(plan.evPlanner?.managementMode, "externally_managed");
    });
    (0, node_test_1.it)("T15: takeover recommended → candidate plan, no dispatch", () => {
        const input = gridHorizon({ cheapHours: 8 });
        input.wallbox = wb({
            externalAuthorityState: "active",
            takeoverSeverity: "recommended",
        });
        const plan = (0, allocate_1.allocateUnifiedDayPlan)(input);
        strict_1.default.equal(plan.evPlanner?.managementMode, "takeover_candidate");
        strict_1.default.ok(sumKind(plan, "wallbox") > 1);
        strict_1.default.equal((0, dispatch_bridge_1.unifiedPlanToWallboxAllocations)(plan).length, 0);
        strict_1.default.equal((0, ev_energy_1.evDispatchWallboxEntries)("takeover_candidate"), false);
        strict_1.default.ok(plan.reasonCodes.includes(reason_codes_1.REASON.VEHICLE_TAKEOVER_CANDIDATE));
    });
    (0, node_test_1.it)("T16: takeover required → candidate only", () => {
        const input = gridHorizon({ cheapHours: 8 });
        input.wallbox = wb({
            externalAuthorityState: "active_without_plan",
            takeoverSeverity: "required",
        });
        const plan = (0, allocate_1.allocateUnifiedDayPlan)(input);
        strict_1.default.equal(plan.evPlanner?.managementMode, "takeover_candidate");
        strict_1.default.ok(sumKind(plan, "wallbox") > 1);
        strict_1.default.equal((0, dispatch_bridge_1.unifiedPlanToWallboxAllocations)(plan).length, 0);
    });
});
(0, node_test_1.describe)("Phase 4 EV vs battery — no rigid priority", () => {
    (0, node_test_1.it)("T18/T20: EV 30 kWh @ 11 kW beats battery 4 kWh @ 4.5 kW on cheap slots", () => {
        const input = gridHorizon({ cheapHours: 2, hours: 8, cheapCt: 11, expCt: 19, pvW: 0 });
        input.battery = {
            ...input.battery,
            socPct: 50,
            usableCapacityKwh: 10,
            requiredChargeEnergyKwh: 4,
            maxChargePowerW: 4500,
            gridChargeAllowed: true,
            reserveSocPct: 10,
        };
        input.wallbox = wb({ requiredEnergyKwh: 30, maxChargePowerW: 11000, chargingEfficiency: 1 });
        const plan = (0, allocate_1.allocateUnifiedDayPlan)(input);
        const cheapEnd = Date.parse("2026-08-09T00:00:00.000Z");
        let evCheap = 0;
        let batCheap = 0;
        for (const a of plan.allocations) {
            if (Date.parse(a.slot.startIso) >= cheapEnd)
                continue;
            if (a.kind === "wallbox" && (a.energySource === "grid" || a.energySource === "mixed")) {
                evCheap += a.allocatedEnergyKwh;
            }
            if (a.kind === "battery_charge" && (a.energySource === "grid" || a.energySource === "mixed")) {
                batCheap += a.allocatedEnergyKwh;
            }
        }
        strict_1.default.ok(evCheap > batCheap, `EV cheap ${evCheap} vs battery cheap ${batCheap}`);
        strict_1.default.ok(evCheap > 8, `EV should fill cheap window, got ${evCheap}`);
        const evFirst = { ...input, battery: { ...input.battery, requiredChargeEnergyKwh: 0, endSocTargetPct: 50 } };
        const batFirst = {
            ...input,
            wallbox: wb({ requiredEnergyKwh: 0, vehicleSocPct: 90, targetSocPct: 90, targetEnergyKwh: 0 }),
        };
        const pEv = (0, allocate_1.allocateUnifiedDayPlan)(evFirst);
        const pBoth = plan;
        const costEvOnly = gridCost(pEv, "wallbox", evFirst);
        const costBoth = gridCost(pBoth, "wallbox", input) + gridCost(pBoth, "battery_charge", input);
        strict_1.default.ok(costBoth + 1 >= costEvOnly * 0.5);
        strict_1.default.equal(plan.evPlanner?.role, "electric_vehicle");
    });
    (0, node_test_1.it)("T19/T21: battery wins cheap slot when EV can wait for a later cheap window", () => {
        const nowIso = "2026-08-08T22:00:00.000Z";
        const slots = (0, fixtures_1.buildSlots)(nowIso, 10);
        const input = gridHorizon({ nowIso, hours: 10, cheapHours: 1, cheapCt: 11, expCt: 19, pvW: 0 });
        input.prices.slots = slots.map((s) => {
            const t = Date.parse(s.startIso);
            const firstCheap = t < Date.parse("2026-08-08T23:00:00.000Z");
            const secondCheap = t >= Date.parse("2026-08-09T04:00:00.000Z");
            return {
                slot: s,
                importCtPerKwh: firstCheap || secondCheap ? 11 : 19,
                exportCtPerKwh: 8,
                gridImportAllowed: true,
            };
        });
        input.time.slots = slots;
        input.pv.slots = slots.map((s) => ({ slot: s, forecastPowerW: 0, observedPowerW: null, energyKwh: 0 }));
        input.houseLoad.slots = slots.map((s) => ({
            slot: s,
            forecastPowerW: 200,
            observedPowerW: null,
            energyKwh: 0.05,
        }));
        input.battery = {
            ...input.battery,
            socPct: 20,
            requiredChargeEnergyKwh: 8,
            maxChargePowerW: 4500,
            chargeDeadlineIso: "2026-08-08T23:00:00.000Z",
            gridChargeAllowed: true,
        };
        input.wallbox = wb({
            requiredEnergyKwh: 12,
            targetEnergyKwh: 12,
            deadlineIso: "2026-08-09T08:00:00.000Z",
            energyGoalHard: false,
            maxChargePowerW: 11000,
        });
        const plan = (0, allocate_1.allocateUnifiedDayPlan)(input);
        const firstCheapEnd = Date.parse("2026-08-08T23:00:00.000Z");
        let batCheap = 0;
        let evCheap = 0;
        for (const a of plan.allocations) {
            if (Date.parse(a.slot.startIso) >= firstCheapEnd)
                continue;
            if (a.kind === "battery_charge" && a.energySource === "grid")
                batCheap += a.allocatedEnergyKwh;
            if (a.kind === "wallbox" && a.energySource === "grid")
                evCheap += a.allocatedEnergyKwh;
        }
        strict_1.default.ok(batCheap > evCheap, `battery should take first cheap window: bat ${batCheap} ev ${evCheap}`);
    });
    (0, node_test_1.it)("T22: no rigid battery-first on a single cheap window", () => {
        const input = gridHorizon({ cheapHours: 1, hours: 6, cheapCt: 11, expCt: 19 });
        input.battery = {
            ...input.battery,
            requiredChargeEnergyKwh: 4,
            maxChargePowerW: 4500,
        };
        input.wallbox = wb({ requiredEnergyKwh: 30 });
        const plan = (0, allocate_1.allocateUnifiedDayPlan)(input);
        const cheapEnd = Date.parse("2026-08-08T23:00:00.000Z");
        let evCheap = 0;
        let batCheap = 0;
        for (const a of plan.allocations) {
            if (Date.parse(a.slot.startIso) >= cheapEnd)
                continue;
            if (a.kind === "wallbox" && a.energySource === "grid")
                evCheap += a.allocatedEnergyKwh;
            if (a.kind === "battery_charge" && a.energySource === "grid")
                batCheap += a.allocatedEnergyKwh;
        }
        strict_1.default.ok(evCheap >= batCheap, `no battery-first: ev ${evCheap} bat ${batCheap}`);
    });
    (0, node_test_1.it)("T23: no parallel EV+battery grid in the same slot", () => {
        const input = gridHorizon({ cheapHours: 8 });
        input.battery = { ...input.battery, requiredChargeEnergyKwh: 4, maxChargePowerW: 4500 };
        const plan = (0, allocate_1.allocateUnifiedDayPlan)(input);
        const bySlot = new Map();
        for (const a of plan.allocations) {
            if (a.energySource !== "grid" && a.energySource !== "mixed")
                continue;
            if (a.kind !== "wallbox" && a.kind !== "battery_charge")
                continue;
            const set = bySlot.get(a.slot.startIso) ?? new Set();
            set.add(a.kind);
            bySlot.set(a.slot.startIso, set);
        }
        for (const [slot, kinds] of bySlot) {
            strict_1.default.ok(!(kinds.has("wallbox") && kinds.has("battery_charge")), slot);
        }
        strict_1.default.ok(plan.reasonCodes.includes(reason_codes_1.REASON.VEHICLE_GRID_MUTEX_BATTERY) || sumKind(plan, "wallbox") > 0);
    });
    (0, node_test_1.it)("T24: export tariff affects PV allocation", () => {
        const low = gridHorizon({ cheapHours: 0, hours: 4, expCt: 30, pvW: 8000, exportCt: 2 });
        low.wallbox = wb({ requiredEnergyKwh: 8, maxChargePowerW: 11000 });
        low.battery = { ...low.battery, requiredChargeEnergyKwh: 0, endSocTargetPct: 70 };
        const high = gridHorizon({ cheapHours: 0, hours: 4, expCt: 30, pvW: 8000, exportCt: 18 });
        high.wallbox = wb({ requiredEnergyKwh: 8, maxChargePowerW: 11000 });
        high.battery = { ...high.battery, requiredChargeEnergyKwh: 0, endSocTargetPct: 70 };
        const pLow = (0, allocate_1.allocateUnifiedDayPlan)(low);
        const pHigh = (0, allocate_1.allocateUnifiedDayPlan)(high);
        const evPvLow = sumKind(pLow, "wallbox", (a) => a.energySource === "pv_surplus");
        const evPvHigh = sumKind(pHigh, "wallbox", (a) => a.energySource === "pv_surplus");
        strict_1.default.ok(evPvHigh <= evPvLow + 0.05, `higher export should not increase EV-PV: low ${evPvLow} high ${evPvHigh}`);
    });
    (0, node_test_1.it)("T25: later cheap grid can beat immediate PV when export is high", () => {
        const input = gridHorizon({
            nowIso: "2026-08-08T10:00:00.000Z",
            hours: 16,
            cheapHours: 0,
            expCt: 28,
            pvW: 6000,
            exportCt: 16,
        });
        input.pv.slots = input.pv.slots.map((s) => {
            const h = new Date(s.slot.startIso).getUTCHours();
            const day = h >= 8 && h < 18;
            const power = day ? 6000 : 0;
            return { ...s, forecastPowerW: power, energyKwh: (power / 1000) * 0.25 };
        });
        input.prices.slots = input.prices.slots.map((s) => {
            const h = new Date(s.slot.startIso).getUTCHours();
            const night = h >= 22 || h < 5;
            return { ...s, importCtPerKwh: night ? 8 : 28, exportCtPerKwh: 16 };
        });
        input.wallbox = wb({
            requiredEnergyKwh: 10,
            targetEnergyKwh: 10,
            vehicleSocPct: 80,
            targetSocPct: 90,
            vehicleCapacityKwh: 77,
            chargingEfficiency: 1,
            presenceWindows: presenceAll("2026-08-08T10:00:00.000Z", "2026-08-09T08:00:00.000Z"),
        });
        const plan = (0, allocate_1.allocateUnifiedDayPlan)(input);
        const grid = sumKind(plan, "wallbox", (a) => a.energySource === "grid");
        const pv = sumKind(plan, "wallbox", (a) => a.energySource === "pv_surplus");
        strict_1.default.ok(grid + pv > 1, "some EV energy planned");
        strict_1.default.ok(grid > 1, `later cheap grid should take EV energy: grid ${grid} pv ${pv}`);
    });
});
(0, node_test_1.describe)("Phase 4 regression other consumers", () => {
    (0, node_test_1.it)("T26/T27: thermal hard/soft still planned with EV present", () => {
        const input = (0, fixtures_1.golden001Input)();
        input.thermal = {
            ...input.thermal,
            bufferTempC: 46,
            boilerTempC: 43,
            boilerMinTempC: 48,
            minTempC: 48,
            headroomEnergyKwh: 4,
            estimatedEmptyAtIso: "2026-08-04T16:00:00.000Z",
            deadlineIso: "2026-08-04T16:00:00.000Z",
            emptyAtSource: "learned",
            boilerEmptyAtUsable: true,
            hygieneDue: false,
        };
        input.wallbox = wb({
            presenceWindows: presenceAll(input.time.horizonStartIso, input.time.horizonEndIso),
            requiredEnergyKwh: 4,
            targetEnergyKwh: 4,
            deadlineIso: null,
            energyGoalHard: false,
            maxChargePowerW: 11000,
        });
        const plan = (0, allocate_1.allocateUnifiedDayPlan)(input);
        strict_1.default.ok(sumKind(plan, "immersion_heater") > 0.5, "thermal still allocated");
    });
    (0, node_test_1.it)("T28: climate still allocated", () => {
        const input = (0, fixtures_1.golden001Input)();
        input.wallbox = wb({
            presenceWindows: presenceAll(input.time.horizonStartIso, input.time.horizonEndIso),
            requiredEnergyKwh: 4,
            deadlineIso: null,
        });
        if (!input.climate) {
            input.climate = {
                units: [
                    {
                        unitId: "air_conditioning.unit_1",
                        label: "Wohnzimmer",
                        roomTempC: 27,
                        comfortMinC: null,
                        comfortMaxC: 25,
                        targetTempC: 24,
                        mandatoryComfort: true,
                        expectedEnergyKwh: 2,
                        typicalPowerW: 900,
                        maxShiftHours: 0,
                        uncertainty: Q,
                    },
                ],
                freshness: FRESH,
            };
        }
        const plan = (0, allocate_1.allocateUnifiedDayPlan)(input);
        strict_1.default.ok(sumKind(plan, "climate") > 0.2 || plan.goalStatuses.some((g) => g.consumerId.includes("air")));
    });
    (0, node_test_1.it)("T29: battery reserve still protected", () => {
        const input = gridHorizon({});
        input.battery = {
            ...input.battery,
            socPct: 8,
            usableCapacityKwh: 10,
            reserveSocPct: 20,
            nightReserveKwh: 2,
            requiredChargeEnergyKwh: 2,
            maxChargePowerW: 4500,
            gridChargeAllowed: true,
        };
        input.wallbox = wb({ requiredEnergyKwh: 8, deadlineIso: null });
        const plan = (0, allocate_1.allocateUnifiedDayPlan)(input);
        strict_1.default.ok(plan.reasonCodes.includes(reason_codes_1.REASON.BATTERY_RESERVE_PROTECTED) ||
            plan.reasonCodes.includes(reason_codes_1.REASON.BATTERY_NIGHT_RESERVE) ||
            sumKind(plan, "battery_charge") > 0.5);
    });
    (0, node_test_1.it)("T30: materiality replan threshold unchanged", () => {
        strict_1.default.equal(materiality_1.MATERIAL_VEHICLE_ENERGY_KWH, 1);
        const d = (0, materiality_1.evaluateMaterialReplan)({
            date: "2026-08-07",
            planId: "p",
            generation: 1,
            createdAtMs: Date.parse("2026-08-07T10:00:00.000Z"),
            expectedPvDayKwh: 30,
            realizedPvKwhAtPlan: 2,
            expectedHouseLoadDayKwh: 18,
            batterySocPct: 40,
            thermalHeadroomKwh: 3,
            bufferTempC: 50,
            thermalEmptyAtIso: null,
            acMandatoryAny: false,
            vehicleConnected: true,
            vehicleRequiredEnergyKwh: 10,
            vehicleDeadlineIso: null,
            vehicleTargetSocPct: 90,
            priceMedianCt: 22,
            priceStructureDigest: "p1",
            presenceDigest: "v1",
            cadenceDigest: "c1",
        }, {
            date: "2026-08-07",
            nowMs: Date.parse("2026-08-07T10:20:00.000Z"),
            forecastPvDayKwh: 30,
            realizedPvKwh: 2.1,
            forecastHouseLoadDayKwh: 18,
            batterySocPct: 40,
            thermalHeadroomKwh: 3,
            bufferTempC: 50,
            thermalEmptyAtIso: null,
            acMandatoryAny: false,
            vehicleConnected: true,
            vehicleRequiredEnergyKwh: 14,
            vehicleDeadlineIso: null,
            vehicleTargetSocPct: 90,
            priceMedianCt: 22,
            priceStructureDigest: "p1",
            presenceDigest: "v1",
            thermalBlocked: false,
            cadenceDigest: "c1",
        }, { lastReplanAtMs: Date.parse("2026-08-07T09:00:00.000Z") });
        strict_1.default.equal(d.shouldReplan, true);
    });
    (0, node_test_1.it)("T31: real install — Explorer 77 kWh, target 90%, no fake hard deadline", () => {
        const input = gridHorizon({ hours: 12, cheapHours: 4 });
        input.wallbox = wb({
            vehicleCapacityKwh: 77,
            maxChargePowerW: 11000,
            targetSocPct: 90,
            vehicleSocPct: 50,
            minimumDepartureSocPct: null,
            deadlineIso: null,
            externalSmartChargingMinSocPct: 25,
            requiredEnergyKwh: null,
            chargingEfficiency: 0.9,
        });
        const plan = (0, allocate_1.allocateUnifiedDayPlan)(input);
        strict_1.default.equal(plan.evPlanner?.hardEnergyKwh, 0);
        strict_1.default.ok((plan.evPlanner?.targetEnergyKwh ?? 0) > 0);
        strict_1.default.equal(plan.evPlanner?.explain.energyGoalHard, false);
        strict_1.default.ok(plan.reasonCodes.includes(reason_codes_1.REASON.VEHICLE_TARGET_SOFT));
        strict_1.default.equal(plan.reasonCodes.includes(reason_codes_1.REASON.VEHICLE_DEADLINE_REQUIRED), false);
        input.wallbox = {
            ...input.wallbox,
            externalAuthorityState: "active",
            takeoverSeverity: "none",
        };
        const ext = (0, allocate_1.allocateUnifiedDayPlan)(input);
        strict_1.default.equal(ext.evPlanner?.managementMode, "externally_managed");
        strict_1.default.equal((0, dispatch_bridge_1.unifiedPlanToWallboxAllocations)(ext).length, 0);
    });
});
(0, node_test_1.describe)("Phase 4 no productive writes / governance", () => {
    (0, node_test_1.it)("T17/T32/T33/T34: no EVCC buttons, Sonnen hold, go-e, or new writes", () => {
        strict_1.default.equal(write_allowlist_1.EV_FOUNDATION_PHASE1_PLANNER_WRITES_ENABLED, false);
        const files = [
            "operator/daily_plan/unified/ev_energy.ts",
            "operator/daily_plan/unified/ev_planner_publish.ts",
            "operator/daily_plan/unified/score_allocate.ts",
            "operator/daily_plan/unified/from_forecast_context.ts",
            "operator/daily_plan/unified/dispatch_bridge.ts",
            "addons/wallbox/runtime/execute.ts",
        ];
        for (const rel of files) {
            const src = (0, node_fs_1.readFileSync)((0, node_path_1.join)(SRC_ROOT, rel), "utf8");
            strict_1.default.equal(src.includes("prepareEvccButtonTrigger"), false, rel);
            strict_1.default.equal(/go[-_]?e\.\d/i.test(src), false, rel);
        }
        const exec = (0, node_fs_1.readFileSync)((0, node_path_1.join)(SRC_ROOT, "addons/wallbox/runtime/execute.ts"), "utf8");
        strict_1.default.equal(exec.includes("prepareEvccButtonTrigger"), false);
        strict_1.default.equal(ensure_states_1.WALLBOX_EV_FOUNDATION_STATES.evPlanJson.endsWith("ev_plan_json"), true);
        strict_1.default.equal(ensure_states_1.WALLBOX_EV_FOUNDATION_STATES.evManagementMode.endsWith("ev_management_mode"), true);
    });
    (0, node_test_1.it)("T35: governance unchanged — global dryrun blocks, addon dryrun blocks", async () => {
        const store = {
            [tree_paths_1.GLOBAL.executionMode]: "dryrun",
            [(0, tree_paths_1.addonMode)("wallbox")]: "live",
        };
        const get = async (id) => ({ val: store[id] });
        strict_1.default.equal(await (0, execution_mode_1.isLiveWriteAllowed)(get, "wallbox"), false);
        store[tree_paths_1.GLOBAL.executionMode] = "live";
        store[(0, tree_paths_1.addonMode)("wallbox")] = "dryrun";
        strict_1.default.equal(await (0, execution_mode_1.isLiveWriteAllowed)(get, "wallbox"), false);
        store[(0, tree_paths_1.addonMode)("wallbox")] = "live";
        strict_1.default.equal(await (0, execution_mode_1.isLiveWriteAllowed)(get, "wallbox"), true);
    });
});
