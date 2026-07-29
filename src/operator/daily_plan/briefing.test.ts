import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildOperatorBriefingDe } from "./briefing.js";
import { operatorQuality } from "../quality.js";
import { addonContributorRef } from "../contributor.js";
import type { DailyAllocationEntry, DailyPlan, DailyPlanSlot } from "./types.js";

const TZ = "UTC";
const NOW = new Date("2026-07-11T10:07:00.000Z");
const SLOT_START = "2026-07-11T10:00:00.000Z";
const SLOT_END = "2026-07-11T10:15:00.000Z";

function allocation(over: Partial<DailyAllocationEntry>): DailyAllocationEntry {
	return {
		contributionId: "immersion_heater.mandatory",
		contributor: addonContributorRef("immersion_heater"),
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

function slot(over: Partial<DailyPlanSlot>): DailyPlanSlot {
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
		quality: operatorQuality("valid", "ok"),
		reasonDe: "Slot ok.",
		...over,
	};
}

function plan(over: Partial<DailyPlan>): DailyPlan {
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
		quality: operatorQuality("valid", "ok"),
		reasonDe: "Daily Plan ok.",
		...over,
	};
}

describe("buildOperatorBriefingDe (Roadmap Block 3.3)", () => {
	it("missing plan -> generic Missing-Text, kein Crash", () => {
		const text = buildOperatorBriefingDe(null, NOW, TZ);
		assert.match(text, /noch nicht initialisiert/);
	});

	it("plan ohne aktuellen Slot -> Plan-Reason als Fallback", () => {
		const p = plan({ slots: [] });
		const text = buildOperatorBriefingDe(p, NOW, TZ);
		assert.match(text, /Daily Plan \(ready\)/);
		assert.match(text, /Daily Plan ok\./);
	});

	it("aktueller Slot ohne Allocation -> nur Status + Slot-Reason, keine Addon-Zeilen", () => {
		const p = plan({ slots: [slot({ allocations: [] })] });
		const text = buildOperatorBriefingDe(p, NOW, TZ);
		assert.match(text, /Slot ok\./);
		assert.ok(!/Heizstab|Batterie|Wallbox|Klima/.test(text));
	});

	it("aktueller Slot mit Heizstab- und Batterie-Allocation -> beide Highlights, Pflicht-Kennzeichnung korrekt", () => {
		const p = plan({
			slots: [
				slot({
					allocations: [
						allocation({ contributionId: "immersion_heater.mandatory", allocatedPowerW: 2000, mandatory: true }),
						allocation({ contributionId: "battery.charge", allocatedPowerW: 1500, mandatory: false, contributor: addonContributorRef("battery") }),
					],
				}),
			],
		});
		const text = buildOperatorBriefingDe(p, NOW, TZ);
		assert.match(text, /Heizstab 2000 W \(Pflicht\)/);
		assert.match(text, /Batterie 1500 W\./);
		assert.ok(!/Batterie 1500 W \(Pflicht\)/.test(text));
	});

	it("0 W im aktuellen Slot wird ignoriert; Allocation eines anderen (nicht-aktuellen) Slots bleibt unberücksichtigt", () => {
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
							contributor: addonContributorRef("air_conditioning"),
						}),
					],
				}),
				slot({
					allocations: [
						allocation({ contributionId: "wallbox.ev_session", allocatedPowerW: 0, contributor: addonContributorRef("wallbox") }),
					],
				}),
			],
		});
		const text = buildOperatorBriefingDe(p, NOW, TZ);
		assert.ok(!/Wallbox/.test(text));
		assert.ok(!/Klima/.test(text));
	});

	it("Klima-Learning-Prognose erscheint auch ohne Slot-Allocation", () => {
		const p = plan({ slots: [slot({ allocations: [] })] });
		const text = buildOperatorBriefingDe(p, NOW, TZ, {
			contributions: [
				{
					contributionId: "air_conditioning.unit_1",
					contributor: addonContributorRef("air_conditioning"),
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
					quality: operatorQuality("valid", "ok"),
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
		assert.match(text, /Klima laut Learning:/);
		assert.match(text, /Wohnzimmer EG ~2\.8 h \/ 2\.4 kWh/);
	});

	it("Text bleibt innerhalb der Längenbegrenzung (480 Zeichen)", () => {
		const longReason = "x".repeat(600);
		const p = plan({ slots: [slot({ reasonDe: longReason })] });
		const text = buildOperatorBriefingDe(p, NOW, TZ);
		assert.ok(text.length <= 480);
	});
});
