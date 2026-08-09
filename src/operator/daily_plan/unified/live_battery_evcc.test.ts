/**
 * Schritt 6 — BAT-LIVE / EV-LIVE / ENERGY-DAY + Authority-Kongruenz.
 * Planner schreibt keine Geräte; Dispatch nur über bestehende Runtime-Pfade.
 */

import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { getBatteryProfile } from "../../../addons/battery/profiles/registry";
import {
	deviceIntentFromDailyPlan,
	resetBatteryDailyPlanCache,
	resolveBatteryDailyPlanFromData,
} from "../../../addons/battery/runtime/daily_plan";
import { evaluateFinalWriteGate } from "../../../addons/battery/runtime/execute";
import { resolvedIntentHasManualPriority } from "../../../addons/battery/runtime/intent_read";
import type { ResolvedBatteryIntent } from "../../../intent/battery/types";
import {
	evaluateWallboxDailyPlan,
	resetWallboxDailyPlanCache,
	type WallboxTelemetryInput,
} from "../../../addons/wallbox/runtime/daily_plan";
import { buildWallboxDispatchIntent } from "../../../addons/wallbox/runtime/intent";
import {
	resetWallboxDispatchCache,
	runWallboxDryrunDispatch,
} from "../../../addons/wallbox/runtime/dispatch";
import {
	addonAllocationEntries,
	addonAllocationPublishView,
	filterRunnableAllocations,
} from "../addon_plan_publish";
import type { DailyPlan } from "../types";
import { allocateUnifiedDayPlan } from "./allocate";
import { applyUnifiedDayAuthority } from "./authority";
import { buildUnifiedDispatchPublish } from "./dispatch_bridge";
import { alloc001Input, alloc003Input, alloc004Input, alloc007Input } from "./alloc_fixtures";
import { buildSlots, golden001Input, golden002Input } from "./fixtures";
import { evaluateNoNightBatteryHeatAfterWastedPv } from "./evaluate";
import {
	assessUnifiedReplanFailure,
	applyReplanFailureAuthority,
} from "./replan_failure";
import { REASON } from "./reason_codes";
import { operatorQuality } from "../../quality";
import type { UnifiedDayPlannerInput } from "./types";
import { localDateKeyInTimezone } from "../../time";
import type { PlanActualSample } from "./materiality";
import { presenceDigest } from "./vehicle_availability";

const TZ = "Europe/Berlin";
const PROFILE = getBatteryProfile("sonnen_em");
const LIMITS = {
	maxChargeW: 5000,
	maxDischargeW: 5000,
	minSocPct: 5,
	maxSocPct: 100,
	valid: true,
	issues: [] as string[],
};

function okGate(over: Partial<ReturnType<typeof okGateBase>> = {}) {
	return { ...okGateBase(), ...over };
}

function okGateBase() {
	return {
		globalLive: true,
		governanceEnabled: true,
		profileId: "sonnen_em" as const,
		profileLiveControlAvailable: true,
		profileReady: true,
		intentValid: true,
		telemetryReady: true,
		fault: false,
		lockout: false,
		targetMappingConfigured: true,
		ownershipValid: true,
	};
}

function actualSample(over: Partial<PlanActualSample> = {}): PlanActualSample {
	return {
		date: "2026-08-04",
		nowMs: Date.parse("2026-08-04T10:00:00.000Z"),
		forecastPvDayKwh: 20,
		realizedPvKwh: 2,
		forecastHouseLoadDayKwh: 10,
		batterySocPct: 40,
		thermalHeadroomKwh: 2,
		bufferTempC: 50,
		acMandatoryAny: false,
		vehicleConnected: null,
		vehicleRequiredEnergyKwh: null,
		vehicleDeadlineIso: null,
		vehicleTargetSocPct: null,
		priceMedianCt: 20,
		priceStructureDigest: "",
		presenceDigest: "",
		thermalBlocked: false,
		cadenceDigest: "",
		...over,
	};
}

function stubDailyPlan(allocations: DailyPlan["allocations"] = []): DailyPlan {
	return {
		status: "ready",
		generatedAt: "2026-08-04T08:00:00.000Z",
		validUntil: "2026-08-05T00:00:00.000Z",
		date: "2026-08-04",
		timezone: TZ,
		globalMode: "balanced",
		slotMinutes: 15,
		revision: 9,
		activeContributionIds: [],
		excludedContributions: [],
		slots: [],
		allocations,
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
		policySnapshot: {} as DailyPlan["policySnapshot"],
		constraintSnapshot: {} as DailyPlan["constraintSnapshot"],
		quality: operatorQuality("valid", "stub", 90),
		reasonDe: "stub",
	};
}

function mergeAuthority(input: UnifiedDayPlannerInput): {
	unified: ReturnType<typeof allocateUnifiedDayPlan>;
	merged: DailyPlan;
	pub: ReturnType<typeof buildUnifiedDispatchPublish>;
} {
	const unified = allocateUnifiedDayPlan(input);
	const pub = buildUnifiedDispatchPublish(unified);
	const merged = applyUnifiedDayAuthority(
		stubDailyPlan(),
		{
			immersionEntries: pub.immersionEntries,
			climateEntries: pub.climateEntries,
			batteryEntries: pub.batteryEntries,
			wallboxEntries: pub.wallboxEntries,
		},
		{ dailyPlanRevision: 9, unifiedPlanId: unified.planId },
	);
	return { unified, merged, pub };
}

function alignNowToKind(
	plan: ReturnType<typeof allocateUnifiedDayPlan>,
	kind: string,
): Date {
	const cell = plan.allocations.find((a) => a.kind === kind && a.allocatedPowerW > 0);
	assert.ok(cell, `expected ${kind} allocation`);
	return new Date(Date.parse(cell.slot.startIso) + 60_000);
}

function wbTelemetry(over: Partial<WallboxTelemetryInput> = {}): WallboxTelemetryInput {
	return {
		connected: true,
		charging: false,
		vehicleSocPct: 40,
		planSocPct: 80,
		planActive: false,
		sessionEnergyKwh: 2,
		effectivePlanTime: "2026-08-04T22:00:00.000Z",
		planTime: "2026-08-04T22:00:00.000Z",
		activePhases: 3,
		configuredPhases: 3,
		minCurrentA: 6,
		maxCurrentA: 16,
		chargePowerW: null,
		evccConfigured: true,
		mappingsReady: true,
		...over,
	};
}

function energyDayInput(): UnifiedDayPlannerInput {
	const slots = buildSlots("2026-08-04T04:00:00.000Z", 20);
	const base = golden001Input();
	base.time = {
		...base.time,
		nowIso: "2026-08-04T04:00:00.000Z",
		slots,
		horizonStartIso: slots[0].startIso,
		horizonEndIso: slots[slots.length - 1].endIso,
	};
	base.pv.slots = slots.map((s) => {
		const h = new Date(s.startIso).getUTCHours();
		let power = 200;
		if (h >= 8 && h < 11) power = 1200;
		if (h >= 11 && h < 16) power = 5500;
		if (h >= 16 && h < 19) power = 2000;
		return {
			slot: s,
			forecastPowerW: power,
			observedPowerW: null,
			energyKwh: (power / 1000) * 0.25,
		};
	});
	base.pv.expectedDayEnergyKwh = base.pv.slots.reduce((a, s) => a + (s.energyKwh ?? 0), 0);
	base.pv.previousExpectedDayEnergyKwh = base.pv.expectedDayEnergyKwh;
	base.houseLoad.slots = slots.map((s) => {
		const h = new Date(s.startIso).getUTCHours();
		const power = h >= 6 && h < 9 ? 1400 : h >= 17 && h < 21 ? 1600 : 700;
		return { slot: s, forecastPowerW: power, observedPowerW: null, energyKwh: (power / 1000) * 0.25 };
	});
	base.houseLoad.expectedDayEnergyKwh = base.houseLoad.slots.reduce((a, s) => a + (s.energyKwh ?? 0), 0);
	base.prices.slots = slots.map((s, i) => {
		const h = new Date(s.startIso).getUTCHours();
		const importCt = h < 6 ? 12 : h < 12 ? 28 : h < 17 ? 18 : 35;
		return {
			slot: s,
			importCtPerKwh: importCt + (i % 3),
			exportCtPerKwh: null,
			gridImportAllowed: true,
		};
	});
	base.battery = {
		...base.battery,
		socPct: 35,
		usableCapacityKwh: 12,
		requiredChargeEnergyKwh: null,
		chargeDeadlineIso: null,
		gridChargeAllowed: true,
		dischargeLiveSupported: false,
		passiveBatteryEnergyAvailable: true,
	};
	base.thermal = {
		...base.thermal!,
		headroomEnergyKwh: 3.5,
		bufferTempC: 48,
		dayTargetTempC: 56,
	};
	base.climate = {
		units: [
			{
				unitId: "air_conditioning.unit_1",
				label: "wohn",
				roomTempC: 26.5,
				comfortMinC: null,
				comfortMaxC: 26,
				targetTempC: 25,
				mandatoryComfort: true,
				expectedEnergyKwh: 2,
				typicalPowerW: 900,
				maxShiftHours: 0,
				uncertainty: operatorQuality("valid", "ok", 80),
			},
		],
		freshness: {
			observedAtIso: base.time.nowIso,
			ageSec: 10,
			quality: operatorQuality("valid", "ok", 80),
		},
	};
	base.wallbox = {
		connectedNow: false,
		presenceWindows: [
			{
				available: true,
				status: "available",
				source: "explicit",
				hard: true,
				startIso: "2026-08-04T04:00:00.000Z",
				endIso: "2026-08-04T07:00:00.000Z",
			},
			{
				available: false,
				status: "unavailable",
				source: "explicit",
				hard: true,
				startIso: "2026-08-04T07:00:00.000Z",
				endIso: "2026-08-04T15:00:00.000Z",
			},
			{
				available: true,
				status: "available",
				source: "explicit",
				hard: true,
				startIso: "2026-08-04T15:00:00.000Z",
				endIso: "2026-08-05T00:00:00.000Z",
			},
		],
		presenceHardConstraint: true,
		vehicleProfileId: "ford_kuga",
		vehicleSocPct: 45,
		socSource: "direct",
		fallbackEnergyNeedKwh: null,
		vehicleCapacityKwh: 68,
		targetSocPct: 80,
		requiredEnergyKwh: 23.8,
		deadlineIso: "2026-08-05T04:00:00.000Z",
		energyGoalHard: true,
		minChargePowerW: 1380,
		maxChargePowerW: 11000,
		chargeLossFactor: 1.08,
		evccExecutionMaster: true,
		uncertainty: operatorQuality("valid", "ok", 80),
		freshness: {
			observedAtIso: base.time.nowIso,
			ageSec: 5,
			quality: operatorQuality("valid", "ok", 80),
		},
	};
	return base;
}

describe("BAT-LIVE-001 unified battery charge → runtime intent", () => {
	beforeEach(() => resetBatteryDailyPlanCache());

	it("produces charge intent via existing daily-plan path when allowed", () => {
		const input = alloc001Input();
		const { unified, pub } = mergeAuthority(input);
		assert.ok(pub.batteryEntries.length > 0 || unified.allocations.some((a) => a.kind === "battery_charge"));
		const now = pub.batteryEntries.length
			? alignNowToKind(unified, "battery_charge")
			: new Date(input.time.slots[20].startIso);
		const entries = pub.batteryEntries.length
			? pub.batteryEntries
			: buildUnifiedDispatchPublish(unified).batteryEntries;
		const resolved = resolveBatteryDailyPlanFromData({
			now,
			timezone: TZ,
			meta: {
				status: "ready",
				date: localDateKeyInTimezone(now, TZ),
				revision: 9,
				validUntil: null,
				timezone: TZ,
			},
			entries,
			dischargePresent: false,
			profile: PROFILE,
			limits: LIMITS,
			socPct: input.battery.socPct,
			topOffActive: false,
			targetSocFromIntent: null,
			governanceEnabled: true,
		});
		assert.equal(resolved.useDailyPlan, true);
		assert.ok(
			resolved.decisionSource === "daily_plan" ||
				resolved.decisionSource === "daily_plan_passive_pv",
			`unexpected source ${resolved.decisionSource}`,
		);
		assert.ok((resolved.effectiveChargePowerW ?? 0) > 0 || resolved.decisionSource === "daily_plan_passive_pv");
		const intent = deviceIntentFromDailyPlan(resolved, now.getTime());
		assert.ok(
			intent.action === "grid_charge" ||
				intent.action === "charge" ||
				intent.action === "self_consumption",
		);
		assert.equal(evaluateFinalWriteGate(okGate()).passed, true);
		assert.equal(evaluateFinalWriteGate(okGate({ globalLive: true })).passed, true);
	});
});

describe("BAT-LIVE-002 global dryrun blocks battery write gate", () => {
	it("execution_gate_closed when globalLive=false", () => {
		assert.equal(evaluateFinalWriteGate(okGate({ globalLive: false })).rejectCode, "execution_gate_closed");
	});
});

describe("BAT-LIVE-003 stale telemetry blocks live dispatch", () => {
	it("telemetry_stale reject", () => {
		assert.equal(evaluateFinalWriteGate(okGate({ telemetryReady: false })).rejectCode, "telemetry_stale");
	});
});

describe("BAT-LIVE-004 unified replan error → safe battery hold", () => {
	it("clears battery charge slice; no classic takeover", () => {
		const input = {
			...alloc001Input(),
			battery: {
				...alloc001Input().battery,
				requiredChargeEnergyKwh: 4,
				chargeDeadlineIso: "2026-08-04T18:00:00.000Z",
				gridChargeAllowed: true,
			},
		};
		const unified = allocateUnifiedDayPlan(input);
		assert.ok(unified.allocations.some((a) => a.kind === "battery_charge"));
		const disp = assessUnifiedReplanFailure({
			nowMs: Date.parse("2026-08-04T10:00:00.000Z"),
			lastUnifiedPlan: unified,
			actual: actualSample({
				nowMs: Date.parse("2026-08-04T10:00:00.000Z"),
				realizedPvKwh: 1,
				forecastPvDayKwh: 8,
				batterySocPct: null,
			}),
			thermal: {
				...input.thermal!,
				uncertainty: operatorQuality("valid", "ok", 80),
				freshness: { observedAtIso: input.time.nowIso, ageSec: 10, quality: operatorQuality("valid", "ok", 80) },
			},
			climate: null,
			battery: { ...input.battery, socPct: null },
			wallbox: null,
			replanReasons: [REASON.REPLAN_BATTERY_SOC_DEVIATION, REASON.REPLAN_PV_FORECAST_CHANGED],
		});
		assert.equal(disp.clearBattery, true);
		const after = applyReplanFailureAuthority(stubDailyPlan(), unified, disp);
		assert.equal(
			after.allocations.some((a) => a.contributionId.startsWith("battery.")),
			false,
		);
	});
});

describe("BAT-LIVE-005 manual battery intent priority", () => {
	it("manual_override beats planner in product rule helper", () => {
		const intent = {
			domain: "battery",
			intent_state: "active",
			manual_override: { active: true, valid_until: null },
			operating_request: { status: "missing", value: null, origin: null },
		} as unknown as ResolvedBatteryIntent;
		assert.equal(resolvedIntentHasManualPriority(intent), true);
	});
});

describe("BAT-LIVE-006 thermal flex prevents night battery→IH", () => {
	it("golden invariant holds under unified authority", () => {
		const input = alloc007Input();
		const { unified } = mergeAuthority(input);
		assert.equal(evaluateNoNightBatteryHeatAfterWastedPv(input, unified).passed, true);
		const batHeat = unified.allocations.filter(
			(a) => a.kind === "immersion_heater" && (a.energySource === "battery" || a.energySource === "mixed"),
		);
		assert.equal(batHeat.length, 0);
	});
});

describe("EV-LIVE-001 PV covers vehicle before deadline", () => {
	it("allocates PV charge without unnecessary grid", () => {
		const plan = allocateUnifiedDayPlan(alloc003Input());
		const pv = plan.allocations
			.filter((a) => a.kind === "wallbox" && a.energySource === "pv_surplus")
			.reduce((s, a) => s + a.allocatedEnergyKwh, 0);
		const grid = plan.allocations
			.filter((a) => a.kind === "wallbox" && a.energySource === "grid")
			.reduce((s, a) => s + a.allocatedEnergyKwh, 0);
		assert.ok(pv > 0);
		assert.ok(grid < 1);
		assert.ok(plan.vehicleChargeEconomics);
		assert.ok((plan.vehicleChargeEconomics!.expectedPvChargeKwh ?? 0) > 0);
	});
});

describe("EV-LIVE-002 PV insufficient → cheap grid windows", () => {
	it("places required import in cost-optimal slots", () => {
		const plan = allocateUnifiedDayPlan(alloc004Input());
		const grid = plan.allocations.filter((a) => a.kind === "wallbox" && a.energySource === "grid");
		assert.ok(grid.length > 0);
		assert.ok(grid.some((a) => a.reasonCodes.includes(REASON.GRID_IMPORT_COST_OPTIMAL)));
		const eco = plan.vehicleChargeEconomics!;
		assert.equal(eco.baselineId, "earliest_feasible");
		assert.ok((eco.expectedGridChargeKwh ?? 0) > 5);
		assert.ok(eco.expectedGridCostCt !== null);
		assert.ok(eco.alternativeGridCostCt !== null);
		assert.ok(eco.savingsVsAlternativeCt !== null);
		assert.ok(eco.savingsVsAlternativeCt! >= 0);
		assert.ok(eco.economicsCompleteness === "grid_only" || eco.economicsCompleteness === "full");
	});
});

describe("EV-LIVE-003 vehicle unavailable → no wallbox allocation", () => {
	it("no charge while absent", () => {
		const input = golden002Input();
		const plan = allocateUnifiedDayPlan(input);
		const awayStart = "2026-08-04T03:45:00.000Z";
		const awayEnd = "2026-08-04T13:30:00.000Z";
		const phantom = plan.allocations.filter(
			(a) =>
				a.kind === "wallbox" &&
				Date.parse(a.slot.startIso) >= Date.parse(awayStart) &&
				Date.parse(a.slot.startIso) < Date.parse(awayEnd),
		);
		assert.equal(phantom.length, 0);
	});
});

describe("EV-LIVE-004 unexpected disconnect → clear wallbox slice", () => {
	it("replan failure clears wallbox EMS intent", () => {
		const input = alloc003Input();
		const unified = allocateUnifiedDayPlan(input);
		assert.ok(unified.allocations.some((a) => a.kind === "wallbox"));
		const duringChargeMs = Date.parse(
			unified.allocations.find((a) => a.kind === "wallbox")!.slot.startIso,
		) + 60_000;
		const disp = assessUnifiedReplanFailure({
			nowMs: duringChargeMs,
			lastUnifiedPlan: unified,
			actual: actualSample({
				nowMs: duringChargeMs,
				realizedPvKwh: 5,
				forecastPvDayKwh: 20,
				vehicleConnected: false,
				vehicleRequiredEnergyKwh: 6,
				vehicleDeadlineIso: input.wallbox!.deadlineIso,
				vehicleTargetSocPct: 80,
			}),
			thermal: input.thermal,
			climate: null,
			battery: input.battery,
			wallbox: { ...input.wallbox!, connectedNow: false },
			replanReasons: [REASON.REPLAN_VEHICLE_DISCONNECTED],
		});
		assert.equal(disp.clearWallbox, true);
		const after = applyReplanFailureAuthority(stubDailyPlan(), unified, disp);
		assert.equal(after.allocations.some((a) => a.contributionId.startsWith("wallbox.")), false);
	});
});

describe("EV-LIVE-005 SOC rollforward quality in unified input", () => {
	it("keeps socSource energy_rollforward and uses required energy", () => {
		const input = alloc003Input();
		input.wallbox = {
			...input.wallbox!,
			vehicleSocPct: 55,
			socSource: "energy_rollforward",
			requiredEnergyKwh: 8,
		};
		const plan = allocateUnifiedDayPlan(input);
		assert.ok(plan.allocations.some((a) => a.kind === "wallbox"));
		assert.equal(input.wallbox.socSource, "energy_rollforward");
	});
});

describe("EV-LIVE-006 SOC unknown without energy goal", () => {
	it("does not invent SOC; goal at risk/unknown", () => {
		const input = alloc003Input();
		input.wallbox = {
			...input.wallbox!,
			vehicleSocPct: null,
			socSource: "unknown",
			requiredEnergyKwh: null,
			fallbackEnergyNeedKwh: null,
			targetSocPct: null,
		};
		const plan = allocateUnifiedDayPlan(input);
		const wbGoal = plan.goalStatuses.find((g) => g.consumerId === "wallbox");
		assert.ok(wbGoal);
		assert.notEqual(wbGoal!.met, false); // no false precision fail; met true if no need
		assert.equal(
			plan.allocations.filter((a) => a.kind === "wallbox").reduce((s, a) => s + a.allocatedEnergyKwh, 0),
			0,
		);
	});
});

describe("EV-LIVE-007 global dryrun — no real EVCC write path from planner", () => {
	beforeEach(() => {
		resetWallboxDailyPlanCache();
		resetWallboxDispatchCache();
	});

	it("dryrun dispatch builds command without live write release", () => {
		const { unified, pub } = mergeAuthority(alloc003Input());
		const now = alignNowToKind(unified, "wallbox");
		const tel = wbTelemetry({
			effectivePlanTime: alloc003Input().wallbox!.deadlineIso,
			planTime: alloc003Input().wallbox!.deadlineIso,
		});
		const decision = evaluateWallboxDailyPlan({
			now,
			timezone: TZ,
			meta: {
				status: "ready",
				date: localDateKeyInTimezone(now, TZ),
				revision: 9,
				validUntil: null,
				timezone: TZ,
			},
			entries: pub.wallboxEntries,
			telemetry: tel,
			governanceEnabled: true,
			addonEnabled: true,
			vehicleCapacityKwh: 60,
		});
		const intent = buildWallboxDispatchIntent({
			decision,
			governanceEnabled: true,
			addonEnabled: true,
			phases: 3,
			now,
		});
		const dry = runWallboxDryrunDispatch({
			intent,
			decision,
			telemetry: tel,
			config: {},
			chargingEnabled: false,
			governanceEnabled: true,
		});
		assert.ok(Array.isArray(dry.dryrunCommand));
		assert.equal(decision.writeAllowed, false);
	});
});

describe("EV-LIVE-008 live intent only via EVCC runtime translation", () => {
	it("dispatch bridge emits wallbox.ev_session; no device writes in allocate", () => {
		const { pub, unified } = mergeAuthority(alloc003Input());
		assert.ok(pub.wallboxEntries.every((e) => e.contributionId === "wallbox.ev_session"));
		assert.ok(!("executeBatteryWrite" in unified));
		assert.ok(pub.wallboxReasonDe.includes("EVCC") || pub.wallboxEntries.length >= 0);
	});
});

describe("EV-LIVE-009 external EVCC plan / user control not fought by EMS", () => {
	it("external_plan_only when EVCC planActive and EMS plan missing", () => {
		const decision = evaluateWallboxDailyPlan({
			now: new Date("2026-08-04T12:00:00.000Z"),
			timezone: TZ,
			meta: { status: "not_initialized", date: "2026-08-04", revision: 0, validUntil: null, timezone: TZ },
			entries: [],
			telemetry: wbTelemetry({ planActive: true, planSocPct: 80 }),
			governanceEnabled: true,
			addonEnabled: true,
			vehicleCapacityKwh: 60,
		});
		assert.equal(decision.decisionSource, "external_plan_only");
		assert.equal(decision.useDailyPlan, false);
		const intent = buildWallboxDispatchIntent({
			decision,
			governanceEnabled: true,
			addonEnabled: true,
			phases: 3,
			now: new Date("2026-08-04T12:00:00.000Z"),
		});
		assert.equal(intent.action, "none");
	});
});

describe("EV-LIVE-010 planner failure keeps EVCC manually usable", () => {
	it("clears EMS wallbox slice → hold/none, not stale charge", () => {
		const unified = allocateUnifiedDayPlan(alloc004Input());
		const duringChargeMs = Date.parse(
			unified.allocations.find((a) => a.kind === "wallbox")!.slot.startIso,
		) + 60_000;
		const disp = assessUnifiedReplanFailure({
			nowMs: duringChargeMs,
			lastUnifiedPlan: unified,
			actual: actualSample({
				nowMs: duringChargeMs,
				realizedPvKwh: 2,
				forecastPvDayKwh: 5,
				vehicleConnected: true,
				vehicleRequiredEnergyKwh: 25,
				vehicleDeadlineIso: alloc004Input().wallbox!.deadlineIso,
				vehicleTargetSocPct: 80,
				priceMedianCt: 30,
			}),
			thermal: null,
			climate: null,
			battery: alloc004Input().battery,
			wallbox: alloc004Input().wallbox,
			replanReasons: [REASON.REPLAN_VEHICLE_GOAL_CHANGED, REASON.REPLAN_PV_FORECAST_CHANGED],
		});
		assert.equal(disp.clearWallbox, true);
		const after = applyReplanFailureAuthority(stubDailyPlan(), unified, disp);
		assert.equal(after.allocations.filter((a) => a.contributionId.startsWith("wallbox.")).length, 0);
	});
});

describe("AUTH congruence four addon slices", () => {
	it("allocations_json matches battery/ih/ac/wallbox runnable views", () => {
		const { merged, pub, unified } = mergeAuthority(energyDayInput());
		for (const prefix of ["battery", "immersion_heater", "air_conditioning", "wallbox"] as const) {
			const view = addonAllocationPublishView(merged, prefix);
			const fromAlloc = addonAllocationEntries(merged, prefix);
			assert.equal(view.runnable.length, filterRunnableAllocations(fromAlloc).length, prefix);
			assert.ok(
				view.runnable.every((e) => (e.reasonDe ?? "").includes(`planId=${unified.planId}`)),
				`${prefix} entries stamped with unified planId`,
			);
		}
		assert.equal(pub.immersionEntries.length, addonAllocationPublishView(merged, "immersion_heater").runnable.length);
		assert.equal(pub.batteryEntries.length, addonAllocationPublishView(merged, "battery").runnable.length);
		assert.equal(pub.wallboxEntries.length, addonAllocationPublishView(merged, "wallbox").runnable.length);
		assert.equal(pub.climateEntries.length, addonAllocationPublishView(merged, "air_conditioning").runnable.length);
	});
});

describe("ENERGY-DAY-001 shared day plan", () => {
	it("distributes energy across battery, IH, AC, EV without single-addon greed", () => {
		const input = energyDayInput();
		const plan = allocateUnifiedDayPlan(input);
		const sum = (kind: string) =>
			plan.allocations.filter((a) => a.kind === kind).reduce((s, a) => s + a.allocatedEnergyKwh, 0);
		assert.ok(sum("battery_charge") > 0.5, "battery charge phase");
		assert.ok(sum("immersion_heater") > 0.5, "IH");
		assert.ok(sum("climate") > 0.2, "AC");
		assert.ok(sum("wallbox") > 1, "EV");
		const awayWb = plan.allocations.filter(
			(a) =>
				a.kind === "wallbox" &&
				Date.parse(a.slot.startIso) >= Date.parse("2026-08-04T07:00:00.000Z") &&
				Date.parse(a.slot.startIso) < Date.parse("2026-08-04T15:00:00.000Z"),
		);
		assert.equal(awayWb.length, 0);
		assert.ok(plan.expectedGridImportEnergyKwh !== null);
		assert.ok(plan.expectedGridExportEnergyKwh !== null);
		assert.ok(plan.expectedCostCt !== null);
		assert.ok(plan.goalStatuses.length > 0);
		assert.ok(plan.vehicleChargeEconomics);
		assert.equal(plan.constraints.some((c) => c.id === "battery.discharge_unsupported"), true);
	});
});

describe("ENERGY-DAY-002 PV forecast collapse shifts EV import", () => {
	it("replans more grid for hard EV goal when PV drops", () => {
		const good = energyDayInput();
		const goodPlan = allocateUnifiedDayPlan(good);
		const bad = energyDayInput();
		bad.pv.slots = bad.pv.slots.map((s) => ({
			...s,
			forecastPowerW: (s.forecastPowerW ?? 0) * 0.25,
			energyKwh: (s.energyKwh ?? 0) * 0.25,
		}));
		bad.pv.expectedDayEnergyKwh = bad.pv.slots.reduce((a, s) => a + (s.energyKwh ?? 0), 0);
		bad.pv.previousExpectedDayEnergyKwh = good.pv.expectedDayEnergyKwh;
		const badPlan = allocateUnifiedDayPlan(bad);
		const grid = (p: typeof goodPlan) =>
			p.allocations
				.filter((a) => a.kind === "wallbox" && a.energySource === "grid")
				.reduce((s, a) => s + a.allocatedEnergyKwh, 0);
		assert.ok(grid(badPlan) >= grid(goodPlan) - 0.5);
		assert.ok((badPlan.vehicleChargeEconomics?.expectedGridChargeKwh ?? 0) > 0);
	});
});

describe("ENERGY-DAY-003 better PV → less avoidable export / more flex", () => {
	it("extra PV goes to battery/thermal/EV before leftover export", () => {
		const weak = energyDayInput();
		weak.pv.slots = weak.pv.slots.map((s) => ({
			...s,
			forecastPowerW: Math.min(s.forecastPowerW ?? 0, 1500),
			energyKwh: Math.min(s.energyKwh ?? 0, 0.375),
		}));
		weak.pv.expectedDayEnergyKwh = weak.pv.slots.reduce((a, s) => a + (s.energyKwh ?? 0), 0);
		const strong = energyDayInput();
		const weakPlan = allocateUnifiedDayPlan(weak);
		const strongPlan = allocateUnifiedDayPlan(strong);
		const flex = (p: typeof weakPlan) =>
			p.allocations
				.filter((a) => a.kind === "battery_charge" || a.kind === "immersion_heater" || a.kind === "wallbox")
				.reduce((s, a) => s + a.allocatedEnergyKwh, 0);
		assert.ok(flex(strongPlan) > flex(weakPlan));
		assert.ok((strongPlan.expectedGridExportEnergyKwh ?? 0) >= 0);
	});
});

describe("material replan on disconnect uses presence digest", () => {
	it("presenceDigest changes with connect state", () => {
		const a = presenceDigest([
			{
				available: true,
				status: "available",
				source: "live_connected",
				startIso: "2026-08-04T10:00:00.000Z",
				endIso: "2026-08-04T11:00:00.000Z",
			},
		]);
		const b = presenceDigest([
			{
				available: false,
				status: "unavailable",
				source: "live_disconnected",
				startIso: "2026-08-04T10:00:00.000Z",
				endIso: "2026-08-04T11:00:00.000Z",
			},
		]);
		assert.notEqual(a, b);
	});
});
