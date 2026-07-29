"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const strict_1 = __importDefault(require("node:assert/strict"));
const briefing_js_1 = require("./briefing.js");
const quality_js_1 = require("../quality.js");
const contributor_js_1 = require("../contributor.js");
const TZ = "UTC";
const NOW = new Date("2026-07-11T10:07:00.000Z");
const SLOT_START = "2026-07-11T10:00:00.000Z";
const SLOT_END = "2026-07-11T10:15:00.000Z";
function allocation(over) {
    return {
        contributionId: "immersion_heater.mandatory",
        contributor: (0, contributor_js_1.addonContributorRef)("immersion_heater"),
        slot: { startIso: SLOT_START, endIso: SLOT_END },
        status: "allocated",
        energySource: "pv_surplus",
        requestedPowerW: 2000,
        allocatedPowerW: 2000,
        requestedEnergyKwh: 0.5,
        allocatedEnergyKwh: 0.5,
        gridPowerW: 0,
        pvPowerW: 2000,
        mandatory: false,
        priorityRank: 1,
        deadlineIso: null,
        estimatedCostCt: null,
        reasonDe: "test",
        ...over,
    };
}
function slot(over) {
    return {
        slot: { startIso: SLOT_START, endIso: SLOT_END },
        pvForecastPowerW: 3000,
        fixedHouseLoadPowerW: 500,
        fixedBalancePowerW: 2500,
        gridPriceCtPerKwh: 25,
        gridImportAllowed: true,
        configuredGridImportLimitW: null,
        remainingGridImportPowerW: null,
        availablePvSurplusPowerW: 2500,
        allocatedFlexiblePowerW: 0,
        allocatedPvPowerW: 0,
        allocatedGridPowerW: 0,
        allocatedBatteryPowerW: 0,
        remainingPvSurplusPowerW: 2500,
        remainingGridImportPowerWAfterAlloc: null,
        remainingBatteryDischargePowerW: null,
        allocations: [],
        quality: (0, quality_js_1.operatorQuality)("valid", "ok"),
        reasonDe: "Slot ok.",
        ...over,
    };
}
function plan(over) {
    return {
        generatedAt: NOW.toISOString(),
        validUntil: null,
        revision: 1,
        date: "2026-07-11",
        timezone: TZ,
        slotMinutes: 15,
        globalMode: "balanced",
        status: "ready",
        policySnapshot: {},
        constraintSnapshot: {},
        activeContributionIds: [],
        excludedContributions: [],
        slots: [],
        allocations: [],
        unallocated: [],
        totals: {
            pvForecastEnergyKwh: null,
            fixedHouseLoadEnergyKwh: null,
            fixedRenewableBalanceKwh: null,
            flexibleRequestedEnergyKwh: null,
            flexibleAllocatedEnergyKwh: 0,
            flexibleUnallocatedEnergyKwh: null,
            pvAllocatedEnergyKwh: 0,
            gridAllocatedEnergyKwh: 0,
            batteryChargeEnergyKwh: 0,
            wallboxEnergyKwh: 0,
            immersionHeaterEnergyKwh: 0,
            airConditioningEnergyKwh: 0,
            estimatedGridCostCt: null,
            mandatoryRequestedEnergyKwh: null,
            mandatoryAllocatedEnergyKwh: 0,
            mandatoryUnallocatedEnergyKwh: null,
        },
        quality: (0, quality_js_1.operatorQuality)("valid", "ok"),
        reasonDe: "Daily Plan ok.",
        ...over,
    };
}
(0, node_test_1.describe)("buildOperatorBriefingDe (Roadmap Block 3.3)", () => {
    (0, node_test_1.it)("missing plan -> generic Missing-Text, kein Crash", () => {
        const text = (0, briefing_js_1.buildOperatorBriefingDe)(null, NOW, TZ);
        strict_1.default.match(text, /noch nicht initialisiert/);
    });
    (0, node_test_1.it)("plan ohne aktuellen Slot -> Plan-Reason als Fallback", () => {
        const p = plan({ slots: [] });
        const text = (0, briefing_js_1.buildOperatorBriefingDe)(p, NOW, TZ);
        strict_1.default.match(text, /Daily Plan \(ready\)/);
        strict_1.default.match(text, /Daily Plan ok\./);
    });
    (0, node_test_1.it)("aktueller Slot ohne Allocation -> nur Status + Slot-Reason, keine Addon-Zeilen", () => {
        const p = plan({ slots: [slot({ allocations: [] })] });
        const text = (0, briefing_js_1.buildOperatorBriefingDe)(p, NOW, TZ);
        strict_1.default.match(text, /Slot ok\./);
        strict_1.default.ok(!/Heizstab|Batterie|Wallbox|Klima/.test(text));
    });
    (0, node_test_1.it)("aktueller Slot mit Heizstab- und Batterie-Allocation -> beide Highlights, Pflicht-Kennzeichnung korrekt", () => {
        const p = plan({
            slots: [
                slot({
                    allocations: [
                        allocation({ contributionId: "immersion_heater.mandatory", allocatedPowerW: 2000, mandatory: true }),
                        allocation({ contributionId: "battery.charge", allocatedPowerW: 1500, mandatory: false, contributor: (0, contributor_js_1.addonContributorRef)("battery") }),
                    ],
                }),
            ],
        });
        const text = (0, briefing_js_1.buildOperatorBriefingDe)(p, NOW, TZ);
        strict_1.default.match(text, /Heizstab 2000 W \(Pflicht\)/);
        strict_1.default.match(text, /Batterie 1500 W\./);
        strict_1.default.ok(!/Batterie 1500 W \(Pflicht\)/.test(text));
    });
    (0, node_test_1.it)("0 W im aktuellen Slot wird ignoriert; Allocation eines anderen (nicht-aktuellen) Slots bleibt unberücksichtigt", () => {
        const otherSlotStart = "2026-07-11T09:00:00.000Z";
        const otherSlotEnd = "2026-07-11T09:15:00.000Z";
        const p = plan({
            slots: [
                slot({
                    slot: { startIso: otherSlotStart, endIso: otherSlotEnd },
                    allocations: [
                        allocation({
                            contributionId: "air_conditioning.unit_1",
                            allocatedPowerW: 800,
                            slot: { startIso: otherSlotStart, endIso: otherSlotEnd },
                            contributor: (0, contributor_js_1.addonContributorRef)("air_conditioning"),
                        }),
                    ],
                }),
                slot({
                    allocations: [
                        allocation({ contributionId: "wallbox.ev_session", allocatedPowerW: 0, contributor: (0, contributor_js_1.addonContributorRef)("wallbox") }),
                    ],
                }),
            ],
        });
        const text = (0, briefing_js_1.buildOperatorBriefingDe)(p, NOW, TZ);
        strict_1.default.ok(!/Wallbox/.test(text));
        strict_1.default.ok(!/Klima/.test(text));
    });
    (0, node_test_1.it)("Klima-Learning-Prognose erscheint auch ohne Slot-Allocation", () => {
        const p = plan({ slots: [slot({ allocations: [] })] });
        const text = (0, briefing_js_1.buildOperatorBriefingDe)(p, NOW, TZ, {
            contributions: [
                {
                    contributionId: "air_conditioning.unit_1",
                    contributor: (0, contributor_js_1.addonContributorRef)("air_conditioning"),
                    flow: "consume",
                    roles: ["demand_flex"],
                    generatedAt: NOW.toISOString(),
                    validUntil: null,
                    revision: 1,
                    enabled: true,
                    flexible: true,
                    gridEligible: true,
                    priorityBand: null,
                    deadlineIso: null,
                    quality: (0, quality_js_1.operatorQuality)("valid", "ok"),
                    reasonDe: "test",
                    details: {
                        unitName: "Wohnzimmer EG",
                        likelyActive: true,
                        expectedHoursToday: 2.83,
                        expectedKwhToday: 2.406,
                    },
                    slots: [],
                },
            ],
        });
        strict_1.default.match(text, /Klima laut Learning:/);
        strict_1.default.match(text, /Wohnzimmer EG ~2\.8 h \/ 2\.4 kWh/);
    });
    (0, node_test_1.it)("Text bleibt innerhalb der Längenbegrenzung (480 Zeichen)", () => {
        const longReason = "x".repeat(600);
        const p = plan({ slots: [slot({ reasonDe: longReason })] });
        const text = (0, briefing_js_1.buildOperatorBriefingDe)(p, NOW, TZ);
        strict_1.default.ok(text.length <= 480);
    });
});
