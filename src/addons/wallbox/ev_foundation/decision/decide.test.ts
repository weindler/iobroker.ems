import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import { isLiveWriteAllowed } from "../../../../execution_mode";
import { addonMode, GLOBAL } from "../../../../tree_paths";
import type { EvModelV1 } from "../types";
import type { EvSmartPlanSlot } from "../external/types";
import { EV_FOUNDATION_PHASE1_PLANNER_WRITES_ENABLED } from "../write_allowlist";
import { WALLBOX_EV_FOUNDATION_STATES } from "../ensure_states";
import {
	applyEvTakeoverDiagnosis,
	chargingMinutesForEnergy,
	energyForSocDeltaKwh,
	evaluateEvTakeoverDecision,
	type EvPriceWindow,
	type EvTakeoverDecisionInput,
} from "./index";

const SRC = join(__dirname, "..", "..", "..", "..", "..", "src", "addons", "wallbox");
const DECISION_SRC = join(SRC, "ev_foundation", "decision");
const NOW_ISO = "2026-08-13T10:00:00.000Z";
const NOW = Date.parse(NOW_ISO);

function slot(start: string, end: string, powerKw = 11, energyKWh: number | null = null): EvSmartPlanSlot {
	return {
		start,
		end,
		plannedPowerKw: powerKw,
		plannedEnergyKWh: energyKWh,
		source: "external",
		quality: "ok",
	};
}

function hourWindow(startIso: string, hours: number, ct: number): EvPriceWindow {
	const startMs = Date.parse(startIso);
	return { startMs, endMs: startMs + hours * 3_600_000, importCtPerKwh: ct };
}

function baseModel(over: Partial<EvModelV1> = {}): EvModelV1 {
	const minimumDepartureSocPct =
		over.minimumDepartureSocPct !== undefined ? over.minimumDepartureSocPct : null;
	return {
		evccConnected: true,
		vehicleConnected: true,
		charging: false,
		chargePowerW: 0,
		evccMode: "pv",
		phasesConfigured: 3,
		phasesActive: 0,
		maxCurrentA: 16,
		minCurrentA: 6,
		effectiveMaxCurrentA: 16,
		offeredCurrentA: 16,
		vehicleSocPct: 50,
		targetSocPct: 90,
		minimumDepartureSocPct,
		departureAt: null,
		batteryCapacityKWh: 77,
		maxAcChargePowerKw: 11,
		chargingEfficiency: 0.9,
		safetyMarginMin: 15,
		vehicleAvailableUntil: null,
		externalControlEnabled: true,
		externalControlType: "vehicle",
		externalControlActive: true,
		externalControlConfigured: true,
		externalSmartPlanAvailable: false,
		externalSmartPlanSlots: null,
		externalPlanRemainingEnergyKWh: null,
		externalPlanRemainingMinutes: null,
		externalPlanDeadlineUsed: false,
		gridRewardsActive: false,
		smartChargingActive: true,
		externalSourceQuality: "ok",
		externalSourceUpdatedAt: NOW_ISO,
		externalSourceHealthy: true,
		manualOverrideActive: null,
		emsTakeoverActive: false,
		preparedEvState: "pv",
		recommendedEvState: "pv",
		externalAuthorityState: "unknown",
		takeoverSeverity: "none",
		takeoverRecommended: false,
		takeoverRequired: false,
		takeoverReason: null,
		vehicleDetectionActive: true,
		dataQuality: "ok",
		vehicleSocQuality: "valid",
		externalSmartChargingMinSocPct: 25,
		externalSmartChargingMinSocQuality: "valid",
		vehicleModelSource: "ev_model_v1",
		vehicleModelReady: true,
		controlContractModel: "evcc_buttons",
		evccControlContractReady: true,
		legacyDirectControlPresent: false,
		evccModeControlVariant: "buttons",
		evccModeFeedbackState: "evcc.0.loadpoint.1.status.mode",
		evccModeButtonsReady: true,
		evccModeOffTargetReady: true,
		evccModePvTargetReady: true,
		evccModeMinTargetReady: true,
		evccModeNowTargetReady: true,
		...over,
		departureMinSocConfigured:
			over.departureMinSocConfigured ??
			(over.minimumDepartureSocPct !== undefined
				? over.minimumDepartureSocPct != null
				: minimumDepartureSocPct != null),
	};
}

function decide(
	over: Partial<EvModelV1> = {},
	extra: Partial<EvTakeoverDecisionInput> = {},
) {
	const model = baseModel(over);
	const decision = evaluateEvTakeoverDecision({
		model,
		nowMs: extra.nowMs ?? NOW,
		priceWindows: extra.priceWindows,
		externalDeadlineIso: extra.externalDeadlineIso,
	});
	const diagnosed = applyEvTakeoverDiagnosis(model, decision);
	return { model, decision, diagnosed };
}

function noActuation(diagnosed: EvModelV1): void {
	assert.equal(diagnosed.emsTakeoverActive, false);
	assert.equal(diagnosed.preparedEvState, "pv");
	assert.ok(!["external", "ems_takeover", "manual_override"].includes(diagnosed.preparedEvState));
}

describe("EV foundation Phase 3 takeover decision (diagnostic)", () => {
	it("T1: external active + sufficient smart plan → no takeover", () => {
		const { decision, diagnosed } = decide({
			vehicleSocPct: 30,
			minimumDepartureSocPct: 70,
			departureAt: "2026-08-13T18:00:00.000Z",
			gridRewardsActive: true,
			smartChargingActive: true,
			externalSmartPlanAvailable: true,
			externalSmartPlanSlots: [slot("2026-08-13T10:00:00.000Z", "2026-08-13T16:00:00.000Z", 11)],
		});
		assert.equal(decision.externalAuthorityState, "active");
		assert.equal(decision.externalPlanCoversDepartureMinimum, true);
		assert.equal(decision.takeoverRequired, false);
		assert.equal(decision.takeoverRecommended, false);
		assert.equal(decision.takeoverSeverity, "none");
		assert.equal(decision.takeoverReason, null);
		assert.equal(decision.outcome, "external");
		assert.equal(diagnosed.recommendedEvState, "external");
		noActuation(diagnosed);
	});

	it("T2: Grid Rewards false alone → no takeover", () => {
		const { decision, diagnosed } = decide({
			gridRewardsActive: false,
			smartChargingActive: true,
			externalControlActive: true,
			externalSmartPlanAvailable: false,
		});
		assert.equal(decision.takeoverRequired, false);
		assert.equal(decision.takeoverRecommended, false);
		assert.notEqual(decision.takeoverReason, "external_unavailable");
		assert.notEqual(decision.outcome, "ems_takeover_required");
		noActuation(diagnosed);
	});

	it("T3: smart plan missing + no deadline → no takeover", () => {
		const { decision, diagnosed } = decide({
			externalSmartPlanAvailable: false,
			externalSmartPlanSlots: null,
			departureAt: null,
			minimumDepartureSocPct: 70,
			vehicleSocPct: 30,
		});
		assert.equal(decision.latestRequiredStart, null);
		assert.equal(decision.deadlineRisk, false);
		assert.equal(decision.takeoverRequired, false);
		assert.notEqual(decision.outcome, "ems_takeover_required");
		noActuation(diagnosed);
	});

	it("T4: departure-minimum null → no fake hard requirement", () => {
		const { decision } = decide({
			minimumDepartureSocPct: null,
			vehicleSocPct: 30,
			targetSocPct: 90,
		});
		assert.equal(decision.energyToDepartureMinimumKWh, null);
		assert.notEqual(decision.energyToDepartureMinimumKWh, 0);
	});

	it("T5: departureAt null → latestRequiredStart null", () => {
		const { decision } = decide({
			departureAt: null,
			vehicleAvailableUntil: null,
			minimumDepartureSocPct: 70,
			vehicleSocPct: 30,
		});
		assert.equal(decision.latestRequiredStart, null);
	});

	it("T6: target 90% alone creates no deadline", () => {
		const { decision } = decide({
			vehicleSocPct: 40,
			targetSocPct: 90,
			minimumDepartureSocPct: null,
			departureAt: null,
		});
		assert.equal(decision.deadlineIso, null);
		assert.equal(decision.latestRequiredStart, null);
		assert.equal(decision.deadlineRisk, false);
		assert.equal(decision.takeoverRequired, false);
		assert.ok(decision.energyToTargetKWh != null && decision.energyToTargetKWh > 0);
	});

	it("T7: Tibber-minimum 25% is not departure-minimum", () => {
		const { decision } = decide({
			externalSmartChargingMinSocPct: 25,
			minimumDepartureSocPct: null,
			vehicleSocPct: 40,
		});
		assert.equal(decision.energyToDepartureMinimumKWh, null);
		assert.equal(decision.explain.externalSmartChargingMinSocPct, 25);
		assert.equal(decision.explain.minimumDepartureSocPct, null);
		assert.notEqual(decision.energyToTargetKWh, decision.energyToDepartureMinimumKWh);
	});

	it("T8: external plan covers departure-minimum → no required takeover", () => {
		const { decision, diagnosed } = decide({
			vehicleSocPct: 30,
			minimumDepartureSocPct: 70,
			departureAt: "2026-08-13T18:00:00.000Z",
			externalSmartPlanAvailable: true,
			gridRewardsActive: true,
			externalSmartPlanSlots: [slot("2026-08-13T10:00:00.000Z", "2026-08-13T16:00:00.000Z", 11)],
		});
		assert.equal(decision.externalPlanCoversDepartureMinimum, true);
		assert.equal(decision.takeoverRequired, false);
		assert.notEqual(decision.takeoverReason, "insufficient_external_plan");
		noActuation(diagnosed);
	});

	it("T9: external plan does not cover real requirement → insufficient_external_plan", () => {
		const { decision, diagnosed } = decide({
			vehicleSocPct: 30,
			minimumDepartureSocPct: 70,
			departureAt: "2026-08-13T18:00:00.000Z",
			externalSmartPlanAvailable: true,
			externalSmartPlanSlots: [slot("2026-08-13T10:00:00.000Z", "2026-08-13T10:30:00.000Z", 11)],
		});
		assert.equal(decision.externalPlanCoversDepartureMinimum, false);
		assert.equal(decision.takeoverReason, "insufficient_external_plan");
		assert.equal(decision.takeoverRequired, true);
		assert.equal(decision.takeoverSeverity, "required");
		assert.equal(diagnosed.recommendedEvState, "ems_takeover");
		assert.equal(diagnosed.preparedEvState, "pv");
		assert.equal(diagnosed.emsTakeoverActive, false);
	});

	it("T10: deadline physically at risk → deadline_risk / required", () => {
		const nowMs = Date.parse("2026-08-13T04:00:00.000Z");
		const { decision, diagnosed } = decide(
			{
				vehicleSocPct: 30,
				minimumDepartureSocPct: 70,
				departureAt: "2026-08-13T06:00:00.000Z",
				batteryCapacityKWh: 77,
				maxAcChargePowerKw: 11,
				chargingEfficiency: 0.9,
				externalSmartPlanAvailable: false,
			},
			{ nowMs },
		);
		assert.equal(decision.deadlineRisk, true);
		assert.equal(decision.takeoverSeverity, "required");
		assert.equal(decision.takeoverReason, "deadline_risk");
		assert.equal(decision.takeoverRequired, true);
		assert.equal(diagnosed.recommendedEvState, "ems_takeover");
		assert.equal(diagnosed.emsTakeoverActive, false);
	});

	it("T11: cheap window about to be lost → economic_window_loss / recommended", () => {
		const nowMs = Date.parse("2026-08-12T21:00:00.000Z");
		const { decision, diagnosed } = decide(
			{
				vehicleSocPct: 30,
				minimumDepartureSocPct: 70,
				departureAt: "2026-08-13T06:00:00.000Z",
				externalSmartPlanAvailable: false,
			},
			{
				nowMs,
				priceWindows: [
					hourWindow("2026-08-12T21:00:00.000Z", 1, 40),
					hourWindow("2026-08-12T22:00:00.000Z", 3, 10),
					hourWindow("2026-08-13T01:00:00.000Z", 5, 40),
				],
			},
		);
		assert.equal(decision.deadlineRisk, false);
		assert.equal(decision.economicWindowLossRisk, true);
		assert.equal(decision.takeoverReason, "economic_window_loss");
		assert.equal(decision.takeoverSeverity, "recommended");
		assert.equal(decision.takeoverRequired, false);
		assert.equal(decision.takeoverRecommended, true);
		assert.equal(diagnosed.preparedEvState, "pv");
		assert.equal(diagnosed.emsTakeoverActive, false);
	});

	it("T12: physically reachable, economically bad → recommended, not required", () => {
		const nowMs = Date.parse("2026-08-12T21:00:00.000Z");
		const { decision } = decide(
			{
				vehicleSocPct: 30,
				minimumDepartureSocPct: 70,
				departureAt: "2026-08-13T06:00:00.000Z",
				externalSmartPlanAvailable: false,
			},
			{
				nowMs,
				priceWindows: [
					hourWindow("2026-08-12T21:00:00.000Z", 1, 40),
					hourWindow("2026-08-12T22:00:00.000Z", 3, 10),
					hourWindow("2026-08-13T01:00:00.000Z", 5, 40),
				],
			},
		);
		assert.equal(decision.deadlineRisk, false);
		assert.ok((decision.remainingFeasibleEnergyKWh ?? 0) > (decision.energyToDepartureMinimumKWh ?? 0));
		assert.equal(decision.takeoverSeverity, "recommended");
		assert.equal(decision.takeoverRequired, false);
		assert.equal(decision.outcome, "ems_takeover_recommended");
	});

	it("T13: no smart-plan, but enough time → observe", () => {
		const nowMs = Date.parse("2026-08-12T22:00:00.000Z");
		const { decision, diagnosed } = decide(
			{
				vehicleSocPct: 30,
				minimumDepartureSocPct: 70,
				departureAt: "2026-08-13T06:00:00.000Z",
				externalSmartPlanAvailable: false,
			},
			{ nowMs },
		);
		assert.equal(decision.deadlineRisk, false);
		assert.equal(decision.takeoverRequired, false);
		assert.equal(decision.takeoverRecommended, false);
		assert.equal(decision.takeoverSeverity, "observe");
		assert.equal(decision.outcome, "external");
		noActuation(diagnosed);
	});

	it("T14: external source missing despite expected authority → external_unavailable", () => {
		const { decision, diagnosed } = decide({
			externalControlConfigured: true,
			externalControlEnabled: true,
			externalControlType: "vehicle",
			externalSourceQuality: "stale",
			externalSourceHealthy: false,
			gridRewardsActive: null,
			smartChargingActive: null,
			externalControlActive: null,
			externalSmartPlanAvailable: false,
		});
		assert.equal(decision.externalAuthorityState, "unavailable");
		assert.equal(decision.takeoverReason, "external_unavailable");
		assert.equal(decision.takeoverRequired, false);
		assert.equal(decision.takeoverSeverity, "observe");
		noActuation(diagnosed);
	});

	it("T15: vehicle SOC unknown → no invented energy", () => {
		const { decision } = decide({
			vehicleSocPct: null,
			vehicleSocQuality: "unknown",
			targetSocPct: 90,
			minimumDepartureSocPct: 70,
		});
		assert.equal(decision.energyToTargetKWh, null);
		assert.equal(decision.energyToDepartureMinimumKWh, null);
		assert.notEqual(decision.energyToTargetKWh, 0);
	});

	it("T16: capacity unknown → no fake kWh", () => {
		const { decision } = decide({
			batteryCapacityKWh: null,
			vehicleSocPct: 30,
			targetSocPct: 90,
		});
		assert.equal(decision.energyToTargetKWh, null);
		assert.notEqual(decision.energyToTargetKWh, 0);
	});

	it("T17: max AC unknown → no fake charge time", () => {
		const { decision } = decide({
			maxAcChargePowerKw: null,
			maxCurrentA: null,
			effectiveMaxCurrentA: null,
			offeredCurrentA: null,
			phasesConfigured: null,
			phasesActive: null,
			vehicleSocPct: 30,
			targetSocPct: 90,
		});
		assert.equal(decision.chargePower.chargePowerKw, null);
		assert.equal(decision.requiredChargingMinutes, null);
		assert.equal(decision.latestRequiredStart, null);
	});

	it("T18: running smart-plan slot counted only in remaining fraction", () => {
		const nowMs = Date.parse("2026-08-13T13:00:00.000Z");
		const { decision } = decide(
			{
				externalSmartPlanAvailable: true,
				externalSmartPlanSlots: [
					slot("2026-08-13T12:00:00.000Z", "2026-08-13T14:00:00.000Z", 11, 22),
				],
			},
			{ nowMs },
		);
		assert.equal(decision.explain.externalPlanRemainingEnergyKWh, 11);
	});

	it("T19: overlapping slots are not double-counted", () => {
		const nowMs = Date.parse("2026-08-13T12:00:00.000Z");
		const { decision } = decide(
			{
				externalSmartPlanAvailable: true,
				externalSmartPlanSlots: [
					slot("2026-08-13T12:00:00.000Z", "2026-08-13T14:00:00.000Z", 11),
					slot("2026-08-13T13:00:00.000Z", "2026-08-13T15:00:00.000Z", 11),
				],
			},
			{ nowMs },
		);
		assert.equal(decision.explain.externalPlanRemainingEnergyKWh, 33);
	});

	it("T20: safety margin is included in latestRequiredStart", () => {
		const nowMs = Date.parse("2026-08-13T00:00:00.000Z");
		const energy = energyForSocDeltaKwh({
			vehicleSocPct: 30,
			targetSocPct: 70,
			batteryCapacityKWh: 77,
			chargingEfficiency: 0.9,
		});
		const minutes = chargingMinutesForEnergy(energy, 11);
		assert.ok(minutes != null);
		const deadline = Date.parse("2026-08-13T06:00:00.000Z");
		const { decision } = decide(
			{
				vehicleSocPct: 30,
				minimumDepartureSocPct: 70,
				departureAt: "2026-08-13T06:00:00.000Z",
				safetyMarginMin: 15,
			},
			{ nowMs },
		);
		assert.ok(decision.latestRequiredStart);
		const latest = Date.parse(decision.latestRequiredStart as string);
		const withoutMargin = deadline - minutes * 60_000;
		assert.equal(withoutMargin - latest, 15 * 60_000);
	});

	it("T21: no EVCC write from decision / refresh path", () => {
		assert.equal(EV_FOUNDATION_PHASE1_PLANNER_WRITES_ENABLED, false);
		const executeSrc = readFileSync(join(SRC, "runtime", "execute.ts"), "utf8");
		assert.equal(executeSrc.includes("prepareEvccButtonTrigger"), false);
		for (const file of [
			"decide.ts",
			"authority.ts",
			"energy.ts",
			"latest_start.ts",
			"plan_coverage.ts",
			"price_windows.ts",
			"index.ts",
		]) {
			const src = readFileSync(join(DECISION_SRC, file), "utf8");
			assert.equal(src.includes("setForeignState"), false);
			assert.equal(src.includes("writeForeignIfChanged"), false);
			assert.equal(src.includes("prepareEvccButtonTrigger"), false);
			assert.equal(src.includes("control.off"), false);
		}
	});

	it("T22: no Sonnen write", () => {
		for (const file of ["decide.ts", "authority.ts", "index.ts"]) {
			const src = readFileSync(join(DECISION_SRC, file), "utf8");
			assert.equal(src.includes("setForeignState"), false);
			assert.equal(src.includes("writeForeignIfChanged"), false);
			assert.equal(/sonnen\.\d/i.test(src), false);
		}
	});

	it("T23: no go-e write", () => {
		for (const file of ["decide.ts", "authority.ts", "index.ts"]) {
			const src = readFileSync(join(DECISION_SRC, file), "utf8");
			assert.equal(src.includes("setForeignState"), false);
			assert.equal(/go[-_]?e\.\d/i.test(src), false);
		}
	});

	it("T24: governance unchanged", async () => {
		const store: Record<string, string> = {
			[GLOBAL.executionMode]: "dryrun",
			[addonMode("wallbox")]: "live",
		};
		const get = async (id: string) => ({ val: store[id] } as ioBroker.State);
		assert.equal(await isLiveWriteAllowed(get, "wallbox"), false);
		store[GLOBAL.executionMode] = "live";
		store[addonMode("wallbox")] = "dryrun";
		assert.equal(await isLiveWriteAllowed(get, "wallbox"), false);
		store[addonMode("wallbox")] = "live";
		assert.equal(await isLiveWriteAllowed(get, "wallbox"), true);
	});

	it("T25: real install — no artificial deadline, Tibber min ≠ departure min, no writes", () => {
		for (const gridRewardsActive of [true, false]) {
			const { decision, diagnosed } = decide({
				batteryCapacityKWh: 77,
				maxAcChargePowerKw: 11,
				targetSocPct: 90,
				externalSmartChargingMinSocPct: 25,
				minimumDepartureSocPct: null,
				departureAt: null,
				externalControlConfigured: true,
				externalControlEnabled: true,
				gridRewardsActive,
				externalSmartPlanAvailable: false,
				externalSmartPlanSlots: null,
			});
			assert.equal(decision.latestRequiredStart, null);
			assert.equal(decision.deadlineRisk, false);
			assert.equal(decision.takeoverRequired, false);
			assert.notEqual(decision.takeoverReason, "deadline_risk");
			assert.equal(decision.energyToDepartureMinimumKWh, null);
			assert.equal(decision.explain.externalSmartChargingMinSocPct, 25);
			assert.equal(diagnosed.emsTakeoverActive, false);
			assert.equal(diagnosed.preparedEvState, "pv");
		}
		assert.equal(EV_FOUNDATION_PHASE1_PLANNER_WRITES_ENABLED, false);
		assert.ok(WALLBOX_EV_FOUNDATION_STATES.takeoverDecisionJson.endsWith("takeover_decision_json"));
		assert.ok(WALLBOX_EV_FOUNDATION_STATES.recommendedEvState.endsWith("recommended_ev_state"));
	});

	it("reliable smart plan covering the requirement suppresses price-heuristic takeover", () => {
		const nowMs = Date.parse("2026-08-12T21:00:00.000Z");
		const { decision } = decide(
			{
				vehicleSocPct: 30,
				minimumDepartureSocPct: 70,
				departureAt: "2026-08-13T06:00:00.000Z",
				gridRewardsActive: true,
				externalSmartPlanAvailable: true,
				externalSmartPlanSlots: [
					slot("2026-08-12T22:00:00.000Z", "2026-08-13T02:00:00.000Z", 11),
				],
			},
			{
				nowMs,
				priceWindows: [
					hourWindow("2026-08-12T21:00:00.000Z", 1, 40),
					hourWindow("2026-08-12T22:00:00.000Z", 3, 10),
					hourWindow("2026-08-13T01:00:00.000Z", 5, 40),
				],
			},
		);
		assert.equal(decision.externalPlanCoversDepartureMinimum, true);
		assert.equal(decision.takeoverRecommended, false);
		assert.equal(decision.takeoverRequired, false);
		assert.equal(decision.takeoverSeverity, "none");
		assert.notEqual(decision.takeoverReason, "economic_window_loss");
	});
});
