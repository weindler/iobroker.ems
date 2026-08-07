import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { CONTRIBUTION_IDS } from "../../contribution_ids";
import { addonAllocationPublishView } from "../addon_plan_publish";
import type { DailyAllocationEntry, DailyPlan } from "../types";
import { allocateUnifiedDayPlan } from "./allocate";
import { alloc001Input, alloc006Input, alloc007Input } from "./alloc_fixtures";
import {
	applyUnifiedIhAcAuthority,
	clearIhAcAuthority,
	isIhAcContributionId,
} from "./authority";
import { buildUnifiedIhAcDispatchPublish } from "./dispatch_bridge";

function classicEntry(
	contributionId: string,
	allocatedPowerW: number,
	startIso: string,
	endIso: string,
): DailyAllocationEntry {
	return {
		contributionId,
		contributor: {
			type: "addon",
			id: contributionId.startsWith("air_conditioning") ? "air_conditioning" : "immersion_heater",
			addonId: contributionId.startsWith("air_conditioning") ? "air_conditioning" : "immersion_heater",
		},
		slot: { startIso, endIso },
		status: "allocated",
		energySource: "pv_surplus",
		requestedPowerW: allocatedPowerW,
		allocatedPowerW,
		requestedEnergyKwh: allocatedPowerW / 4000,
		allocatedEnergyKwh: allocatedPowerW / 4000,
		gridPowerW: 0,
		pvPowerW: allocatedPowerW,
		batteryPowerW: 0,
		mandatory: false,
		priorityRank: 1,
		deadlineIso: null,
		estimatedCostCt: null,
		reasonDe: "classic",
	};
}

function basePlan(classicIh: DailyAllocationEntry[], classicAc: DailyAllocationEntry[] = []): DailyPlan {
	const bat = classicEntry("battery.charge", 2000, "2026-08-04T10:00:00.000Z", "2026-08-04T10:15:00.000Z");
	bat.contributor = { type: "addon", id: "battery", addonId: "battery" };
	const wb = classicEntry("wallbox.ev_session", 5000, "2026-08-04T11:00:00.000Z", "2026-08-04T11:15:00.000Z");
	wb.contributor = { type: "addon", id: "wallbox", addonId: "wallbox" };
	const allocations = [bat, wb, ...classicIh, ...classicAc];
	return {
		generatedAt: "2026-08-04T08:00:00.000Z",
		validUntil: "2026-08-05T00:00:00.000Z",
		revision: 17,
		date: "2026-08-04",
		timezone: "Europe/Berlin",
		slotMinutes: 15,
		globalMode: "balanced",
		status: "ready",
		policySnapshot: {},
		constraintSnapshot: {},
		activeContributionIds: [],
		excludedContributions: [],
		slots: [
			{
				slot: { startIso: "2026-08-04T10:00:00.000Z", endIso: "2026-08-04T10:15:00.000Z" },
				pvForecastPowerW: 3000,
				fixedHouseLoadPowerW: 500,
				fixedBalancePowerW: 2500,
				gridPriceCtPerKwh: 20,
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
				allocations: [...allocations],
				quality: { status: "valid", confidencePct: 80, reasonDe: "t" },
				reasonDe: "t",
			},
		],
		allocations,
		unallocated: [],
		totals: {
			pvForecastEnergyKwh: 10,
			fixedHouseLoadEnergyKwh: 2,
			fixedRenewableBalanceKwh: 8,
			flexibleRequestedEnergyKwh: 5,
			flexibleAllocatedEnergyKwh: 5,
			flexibleUnallocatedEnergyKwh: 0,
			pvAllocatedEnergyKwh: 5,
			gridAllocatedEnergyKwh: 0,
			batteryChargeEnergyKwh: 0.5,
			wallboxEnergyKwh: 1.25,
			immersionHeaterEnergyKwh: 9,
			airConditioningEnergyKwh: 9,
			estimatedGridCostCt: null,
			mandatoryRequestedEnergyKwh: null,
			mandatoryAllocatedEnergyKwh: 0,
			mandatoryUnallocatedEnergyKwh: null,
		},
		quality: { status: "valid", confidencePct: 80, reasonDe: "t" },
		reasonDe: "classic daily plan",
	};
}

describe("AUTH-001 Unified gültig ist einzige IH/AC-Wahrheit", () => {
	it("ersetzt klassische IH/AC in allocations; Battery/Wallbox bleiben", () => {
		const classicIh = [
			classicEntry(
				CONTRIBUTION_IDS.IMMERSION_FLEXIBLE,
				1700,
				"2026-08-04T10:00:00.000Z",
				"2026-08-04T10:15:00.000Z",
			),
		];
		const plan = basePlan(classicIh);
		const unified = allocateUnifiedDayPlan(alloc006Input());
		const pub = buildUnifiedIhAcDispatchPublish(unified);
		assert.ok(pub.immersionEntries.length > 0);
		const merged = applyUnifiedIhAcAuthority(plan, pub.immersionEntries, pub.climateEntries, {
			dailyPlanRevision: plan.revision,
			unifiedPlanId: unified.planId,
		});

		const ih = merged.allocations.filter((a) => a.contributionId.startsWith("immersion_heater."));
		const ac = merged.allocations.filter((a) => a.contributionId.startsWith("air_conditioning."));
		const bat = merged.allocations.filter((a) => a.contributionId.startsWith("battery."));
		const wb = merged.allocations.filter((a) => a.contributionId.startsWith("wallbox."));

		assert.equal(bat.length, 1);
		assert.equal(wb.length, 1);
		assert.equal(ih.every((e) => e.reasonDe.includes("classic")), false);
		assert.ok(ih.every((e) => e.reasonDe.includes(`daily_plan_rev=${plan.revision}`)));
		assert.ok(ih.every((e) => e.reasonDe.includes(`planId=${unified.planId}`)));

		const ihView = addonAllocationPublishView(merged, "immersion_heater");
		assert.deepEqual(
			ihView.runnable.map((e) => `${e.contributionId}|${e.slot.startIso}|${e.allocatedPowerW}`),
			pub.immersionEntries.map((e) => `${e.contributionId}|${e.slot.startIso}|${e.allocatedPowerW}`),
		);
		assert.equal(ac.length, pub.climateEntries.length);
	});
});

describe("AUTH-002 Unified idle [] — kein klassischer Fallback", () => {
	it("clearIhAcAuthority entfernt klassische IH/AC vollständig", () => {
		const classicIh = [
			classicEntry(
				CONTRIBUTION_IDS.IMMERSION_FLEXIBLE,
				1700,
				"2026-08-04T10:00:00.000Z",
				"2026-08-04T10:15:00.000Z",
			),
		];
		const classicAc = [
			classicEntry(
				CONTRIBUTION_IDS.AC_UNIT(1),
				900,
				"2026-08-04T10:00:00.000Z",
				"2026-08-04T10:15:00.000Z",
			),
		];
		const plan = basePlan(classicIh, classicAc);
		const cleared = clearIhAcAuthority(plan);
		assert.equal(cleared.allocations.filter((a) => isIhAcContributionId(a.contributionId)).length, 0);
		assert.equal(addonAllocationPublishView(cleared, "immersion_heater").status, "idle");
		assert.equal(addonAllocationPublishView(cleared, "air_conditioning").status, "idle");
		assert.equal(addonAllocationPublishView(cleared, "battery").status, "ready");
		assert.equal(addonAllocationPublishView(cleared, "wallbox").status, "ready");

		const noPv = alloc007Input();
		noPv.thermal = { ...noPv.thermal!, headroomEnergyKwh: 0 };
		noPv.pv.slots = noPv.pv.slots.map((s) => ({ ...s, forecastPowerW: 0, energyKwh: 0 }));
		const pub = buildUnifiedIhAcDispatchPublish(allocateUnifiedDayPlan(noPv));
		const merged = applyUnifiedIhAcAuthority(plan, pub.immersionEntries, pub.climateEntries, {
			dailyPlanRevision: 17,
			unifiedPlanId: "unified-idle-test",
		});
		assert.equal(merged.allocations.filter((a) => a.contributionId.startsWith("immersion_heater.")).length, 0);
		assert.ok(merged.allocations.some((a) => a.contributionId.startsWith("battery.")));
	});
});

describe("AUTH-003 Unified Fehler → idle, nicht classic", () => {
	it("clearIhAcAuthority ist das definierte Failure-Verhalten", () => {
		const classicIh = [
			classicEntry(
				CONTRIBUTION_IDS.IMMERSION_FLEXIBLE,
				1700,
				"2026-08-04T10:00:00.000Z",
				"2026-08-04T10:15:00.000Z",
			),
		];
		const plan = basePlan(classicIh);
		const failed = clearIhAcAuthority(plan);
		assert.equal(failed.allocations.some((a) => a.reasonDe === "classic" && isIhAcContributionId(a.contributionId)), false);
		assert.equal(failed.totals.immersionHeaterEnergyKwh, 0);
		assert.equal(failed.totals.airConditioningEnergyKwh, 0);
		assert.ok(failed.allocations.some((a) => a.contributionId === "battery.charge"));
	});
});

describe("AUTH-004 Battery/Wallbox unverändert", () => {
	it("Battery/Wallbox-Einträge bleiben byte-gleich nach Authority-Merge", () => {
		const plan = basePlan([
			classicEntry(
				CONTRIBUTION_IDS.IMMERSION_FLEXIBLE,
				1700,
				"2026-08-04T10:00:00.000Z",
				"2026-08-04T10:15:00.000Z",
			),
		]);
		const beforeBat = plan.allocations.filter((a) => a.contributionId.startsWith("battery."));
		const beforeWb = plan.allocations.filter((a) => a.contributionId.startsWith("wallbox."));
		const pub = buildUnifiedIhAcDispatchPublish(allocateUnifiedDayPlan(alloc001Input()));
		const merged = applyUnifiedIhAcAuthority(plan, pub.immersionEntries, pub.climateEntries, {
			dailyPlanRevision: plan.revision,
			unifiedPlanId: "x",
		});
		assert.deepEqual(
			merged.allocations.filter((a) => a.contributionId.startsWith("battery.")),
			beforeBat,
		);
		assert.deepEqual(
			merged.allocations.filter((a) => a.contributionId.startsWith("wallbox.")),
			beforeWb,
		);
	});
});

describe("allocations_json vs addon slices congruence", () => {
	it("IH/AC runnable views match merged plan allocations", () => {
		const plan = basePlan([]);
		const unified = allocateUnifiedDayPlan(alloc006Input());
		const pub = buildUnifiedIhAcDispatchPublish(unified);
		const merged = applyUnifiedIhAcAuthority(plan, pub.immersionEntries, pub.climateEntries, {
			dailyPlanRevision: 17,
			unifiedPlanId: unified.planId,
		});
		const ihView = addonAllocationPublishView(merged, "immersion_heater");
		const fromAllocations = merged.allocations.filter(
			(a) => a.contributionId.startsWith("immersion_heater.") && (a.allocatedPowerW ?? 0) >= 50,
		);
		assert.equal(ihView.runnable.length, fromAllocations.length);
		assert.equal(ihView.runnable.length, pub.immersionEntries.length);
	});
});
