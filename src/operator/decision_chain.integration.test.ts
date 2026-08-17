/**
 * Integration: Unified/Daily-Plan → Runtime-Intent → Safety → Execution-Desired → Hold → GB → Constraints.
 * Verhindert widersprüchliche Geräteentscheidungen zwischen Planner, Runtime, Execution und Hold/VIS-Inputs.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { CONTRIBUTION_IDS } from "./contribution_ids";
import { addonContributorRef } from "./contributor";
import { slotStartIsoFloored, DAILY_PLAN_SLOT_MS } from "./daily_plan/slots";
import { isoFromMs } from "./time";
import type { DailyAllocationEntry } from "./daily_plan/types";
import { evaluateWallboxDailyPlan, type WallboxTelemetryInput } from "../addons/wallbox/runtime/daily_plan";
import { buildWallboxDispatchIntent } from "../addons/wallbox/runtime/intent";
import { projectDesiredEvccMode } from "../addons/wallbox/ev_foundation/execution/desired_mode";
import { resolveWallboxBatteryHold } from "../addons/wallbox/charge_hold";
import { buildPlannerConstraints } from "./planning/battery";
import {
	classifyGridBalanceEvConflict,
	evaluateGridBalanceSafety,
	type GridBalanceEvConflictKind,
	type GridBalanceSafetyInput,
} from "../addons/battery/grid_balance_contract";
import { resolveGridBalanceHoldSignals } from "../addons/battery/hold_freshness";
import { adjustConsumptionForEv } from "../addons/battery/grid_balance_power";
import { computeAcCoolingDesired } from "../addons/air_conditioning/runtime/compute_desired";
import type { AcUnitDailyPlanResolution } from "../addons/air_conditioning/runtime/daily_plan";
import type { AcUnitFsmResult } from "../addons/air_conditioning/runtime/fsm";
import { resolveImmersionDailyPlanFromData } from "../addons/immersion_heater/runtime/daily_plan";
import { immersionDeviceConfigFromAdapter } from "../addons/immersion_heater/device_config";
import { deviceIntentFromDailyPlan } from "../addons/battery/runtime/daily_plan";
import type { BatteryDailyPlanRuntimeContext } from "../addons/battery/runtime/daily_plan";
import { derivePreparedEvModuleState } from "../addons/wallbox/ev_foundation/model";

const TZ = "UTC";
const NOW = new Date("2026-08-17T10:07:00.000Z");
const SLOT_START = slotStartIsoFloored(NOW, TZ);
const SLOT_END = isoFromMs(Date.parse(SLOT_START) + DAILY_PLAN_SLOT_MS);

function wbEntry(allocatedPowerW: number, energySource: DailyAllocationEntry["energySource"] = "grid"): DailyAllocationEntry {
	return {
		contributionId: CONTRIBUTION_IDS.WALLBOX_EV_SESSION,
		contributor: addonContributorRef("wallbox"),
		slot: { startIso: SLOT_START, endIso: SLOT_END },
		status: "allocated",
		energySource,
		requestedPowerW: allocatedPowerW,
		allocatedPowerW,
		requestedEnergyKwh: allocatedPowerW > 0 ? (allocatedPowerW * 0.25) / 1000 : 0,
		allocatedEnergyKwh: allocatedPowerW > 0 ? (allocatedPowerW * 0.25) / 1000 : 0,
		gridPowerW: energySource === "grid" ? allocatedPowerW : 0,
		pvPowerW: energySource === "pv_surplus" ? allocatedPowerW : 0,
		mandatory: false,
		priorityRank: 1,
		deadlineIso: null,
		estimatedCostCt: null,
		reasonDe: "test",
	};
}

function telemetry(over: Partial<WallboxTelemetryInput> = {}): WallboxTelemetryInput {
	return {
		connected: true as boolean | null,
		charging: false as boolean | null,
		vehicleSocPct: 40,
		planSocPct: 80,
		planActive: false,
		sessionEnergyKwh: 0,
		effectivePlanTime: null,
		planTime: null,
		activePhases: 3,
		configuredPhases: 3,
		minCurrentA: 6,
		maxCurrentA: 16,
		chargePowerW: 0,
		evccConfigured: true,
		mappingsReady: true,
		...over,
	};
}

function runEvChain(input: {
	connected: boolean;
	charging: boolean;
	chargePowerW: number;
	loadpointMode: string;
	batteryBoost?: boolean;
	allocatedPowerW: number;
	energySource?: DailyAllocationEntry["energySource"];
}) {
	const decision = evaluateWallboxDailyPlan({
		now: NOW,
		timezone: TZ,
		meta: { status: "ready", date: "2026-08-17", revision: 4, validUntil: null, timezone: TZ },
		entries: [wbEntry(input.allocatedPowerW, input.energySource ?? "grid")],
		telemetry: telemetry({
			connected: input.connected,
			charging: input.charging,
			chargePowerW: input.chargePowerW,
		}),
		governanceEnabled: true,
		addonEnabled: true,
		vehicleCapacityKwh: 60,
	});
	const intent = buildWallboxDispatchIntent({
		decision,
		governanceEnabled: true,
		addonEnabled: true,
		phases: 3,
		now: NOW,
	});
	const desired = projectDesiredEvccMode({
		intentAction: intent.action,
		energySource: intent.source !== "none" ? intent.source : decision.energySource,
		chargingAllowed: decision.chargingAllowedByPlan,
		allocatedPowerW: decision.allocatedPowerW,
		dailyPlanStatus: decision.dailyPlanStatus,
		decisionSource: decision.decisionSource,
		planValid: decision.planValid,
		useDailyPlan: decision.useDailyPlan,
		vehicleConnected: decision.connected,
	});
	const hold = resolveWallboxBatteryHold({
		vehicleConnected: input.connected,
		charging: input.charging,
		chargePowerW: input.chargePowerW,
		batteryBoost: input.batteryBoost ?? false,
		loadpointMode: input.loadpointMode,
		externalVehicleChargeRaw: null,
		tibberGridRewardsActive: false,
	});
	const constraints = buildPlannerConstraints({
		evccBatteryMode: "normal",
		evccBatteryDischargeControl: true,
		userIntentBatteryHold: false,
		wallboxChargeHold: hold.hold,
		wallboxChargeHoldReasonDe: hold.reasonDe,
	});
	const evConflict = classifyGridBalanceEvConflict({
		loadpointMode: input.loadpointMode,
		charging: input.charging,
		chargePowerW: input.chargePowerW,
		wallboxHold: hold.hold,
		batteryBoost: input.batteryBoost === true,
		externalAuthority: false,
		tibberRewardsActive: false,
		wallboxEnergySource: decision.energySource,
		wallboxAllocatedGridW: decision.gridPowerW,
		vehicleConnected: input.connected,
	});
	const gbHold = resolveGridBalanceHoldSignals({
		nowMs: NOW.getTime(),
		constraintHoldState: { val: constraints.battery_hold_active, ts: NOW.getTime() },
		deviceIntentHold: false,
		batteryHoldForEvCharge: hold.hold,
		evccBatteryMode: "normal",
	});
	const gbSafety = evaluateGridBalanceSafety(gbSafetyInput({
		holdActive: gbHold.holdActive,
		holdPlanned: gbHold.holdPlanned,
		evccBatteryModeHold: gbHold.evccBatteryModeHold,
		evConflictKind: evConflict.kind,
	}));
	return { decision, intent, desired, hold, constraints, evConflict, gbHold, gbSafety };
}

function gbSafetyInput(over: Partial<GridBalanceSafetyInput> = {}): GridBalanceSafetyInput {
	return {
		adminEnabled: true,
		emsMirrorEnabled: true,
		globalLive: true,
		addonLive: true,
		addonEnabled: true,
		governanceEnabled: true,
		faultActive: false,
		lockoutActive: false,
		restoreInProgress: false,
		sourceStale: false,
		sourceOffline: false,
		holdPlanned: false,
		holdActive: false,
		evccBatteryModeHold: false,
		plannedBatteryAction: false,
		ownershipActive: false,
		dailyPlanAuthoritative: false,
		mode1Active: false,
		priceNowCt: 36.7,
		priceMinCt: 30,
		evConflictKind: "" as GridBalanceEvConflictKind,
		externalEvAuthority: false,
		...over,
	};
}

describe("decision chain — EV leftover now must not override planner", () => {
	it("vehicleConnected=false + EVCC now + leftover allocation → no EV action, no hold, no GB EV conflict", () => {
		const r = runEvChain({
			connected: false,
			charging: false,
			chargePowerW: 0,
			loadpointMode: "now",
			batteryBoost: true,
			allocatedPowerW: 11000,
		});
		assert.equal(r.decision.decisionSource, "vehicle_disconnected");
		assert.equal(r.decision.chargingAllowedByPlan, false);
		assert.equal(r.intent.action, "none");
		assert.equal(r.desired.desired, "noop");
		assert.equal(r.desired.reason, "vehicle_disconnected");
		assert.equal(r.hold.hold, false);
		assert.equal(r.constraints.battery_hold_active, false);
		assert.equal(r.evConflict.conflict, false);
		assert.equal(r.gbHold.holdDetected, false);
		assert.notEqual(r.gbSafety.blockReason, "battery_hold");
		assert.notEqual(r.gbSafety.blockReason, "ev_now_grid_charge");
		assert.equal(derivePreparedEvModuleState("now", false), "idle");
	});

	it("connected leftover now without charging → planner none, no hold from mode=now", () => {
		const r = runEvChain({
			connected: true,
			charging: false,
			chargePowerW: 0,
			loadpointMode: "now",
			allocatedPowerW: 0,
			energySource: "pv_surplus",
		});
		assert.equal(r.intent.action === "charge", false);
		assert.notEqual(r.desired.desired, "now");
		assert.equal(r.hold.hold, false);
		assert.equal(r.constraints.battery_hold_active, false);
		assert.equal(r.evConflict.conflict, false);
		assert.equal(r.gbHold.holdDetected, false);
	});

	it("connected + charging + now is observed hold (safety), EMS desired still follows the plan", () => {
		const r = runEvChain({
			connected: true,
			charging: true,
			chargePowerW: 11000,
			loadpointMode: "now",
			allocatedPowerW: 0,
		});
		assert.equal(r.decision.chargingAllowedByPlan, false);
		assert.notEqual(r.desired.desired, "now");
		assert.equal(r.hold.hold, true);
		assert.equal(r.constraints.battery_hold_active, true);
		assert.equal(r.evConflict.kind, "ev_now");
		assert.equal(r.gbHold.holdDetected, true);
		assert.equal(r.gbSafety.blockReason, "battery_hold");
	});

	it("connected + EMS grid allocation → charge desired now, hold from actual charging", () => {
		const r = runEvChain({
			connected: true,
			charging: true,
			chargePowerW: 7200,
			loadpointMode: "pv",
			allocatedPowerW: 7200,
			energySource: "grid",
		});
		assert.equal(r.decision.chargingAllowedByPlan, true);
		assert.equal(r.intent.action, "charge");
		assert.equal(r.desired.desired, "now");
		assert.equal(r.desired.reason, "planned_charge");
	});
});

describe("decision chain — Grid Balance EV subtract", () => {
	it("disconnected leftover charging flag does not treat EV as house load", () => {
		const ev = adjustConsumptionForEv({
			consumptionW: 4000,
			charging: true,
			chargePowerW: 3500,
			chargePowerAgeMs: 500,
			vehicleConnected: false,
		});
		assert.equal(ev.evActive, false);
		assert.equal(ev.adjustedConsumptionW, 4000);
		assert.equal(ev.blockReason, "");
	});
});

describe("decision chain — Klima / Heizstab / Batterie follow Daily Plan", () => {
	it("Klima: gültiger 0-W-Plan ist Planner-OFF, nicht climate_fallback", () => {
		const fsm: AcUnitFsmResult = {
			state: "running",
			demandStart: false,
			demandStop: false,
			modePurpose: "cooling",
			reasonDe: "läuft",
		};
		const dailyPlan: AcUnitDailyPlanResolution = {
			unitIndex: 1,
			contributionId: CONTRIBUTION_IDS.AC_UNIT(1),
			dailyPlanStatus: "daily_plan_zero_allocation",
			dailyPlanRevision: 2,
			slotStartIso: SLOT_START,
			slotEndIso: SLOT_END,
			allocatedPowerW: 0,
			expectedPowerW: 850,
			powerModelSource: "config",
			allocationStatus: "allocated",
			allocationReasonDe: "0 W im Slot",
			useDailyPlan: true,
			powerModelValid: true,
			allocationAllowsStart: false,
		};
		const d = computeAcCoolingDesired({
			unitEnabled: true,
			governanceEnabled: true,
			addonEnabled: true,
			cleaningActive: false,
			fsm,
			dailyPlan,
			feedbackOn: true,
			startRetryReady: true,
		});
		assert.equal(d.plannerOff, true);
		assert.equal(d.desired, "off");
		assert.equal(d.decisionSource, "daily_plan");
		assert.notEqual(d.decisionSource, "climate_fallback");
	});

	it("Heizstab: gültiger 0-W-Plan bleibt Daily Plan, kein Thermal-Fallback", () => {
		const cfg = immersionDeviceConfigFromAdapter({
			ih_stage_count: 1,
			ih_stage_1_nominal_power_w: 1700,
			ih_stage_1_set_state: "s1",
			ih_stage_1_enabled: true,
		});
		const r = resolveImmersionDailyPlanFromData({
			now: NOW,
			timezone: TZ,
			meta: { status: "ready", date: "2026-08-17", revision: 2, validUntil: null, timezone: TZ },
			entries: [],
			config: cfg,
		});
		assert.equal(r.useDailyPlan, true);
		assert.equal(r.dailyPlanStatus, "daily_plan_zero_allocation");
		assert.equal(r.commandedStage, 0);
		assert.equal(r.decisionSource, "daily_plan");
		assert.notEqual(r.decisionSource, "thermal_fallback");
	});

	it("Batterie: Daily-Plan 0 W → self_consumption, nicht leftover EV-Hold-Intent", () => {
		const ctx: BatteryDailyPlanRuntimeContext = {
			useDailyPlan: true,
			dailyPlanAuthoritative: true,
			dailyPlanStatus: "daily_plan_zero_allocation",
			decisionSource: "daily_plan_zero",
			dailyPlanRevision: 2,
			slotStartIso: SLOT_START,
			slotEndIso: SLOT_END,
			allocationStatus: "none",
			allocatedChargePowerW: 0,
			effectiveChargePowerW: 0,
			requestedChargePowerW: 0,
			allocatedEnergyKwh: 0,
			pvPowerW: 0,
			gridPowerW: 0,
			energySource: "none",
			estimatedCostCt: null,
			chargePowerCapped: false,
			targetSocPct: 90,
			topOffActive: false,
			chargingAllowed: false,
			allocationReasonDe: "kein Batterieladen",
			legacyFallbackActive: false,
			legacyFallbackSource: "",
			legacyFallbackReasonDe: "",
			dailyPlanBlocksGridBalance: false,
			runtimeControlAvailable: true,
			dischargeIgnored: false,
		};
		const intent = deviceIntentFromDailyPlan(ctx, NOW.getTime());
		assert.equal(intent.source, "daily_plan");
		assert.equal(intent.action, "self_consumption");
		assert.notEqual(intent.action, "hold");
		assert.equal(intent.maxChargeW, 0);
	});
});
