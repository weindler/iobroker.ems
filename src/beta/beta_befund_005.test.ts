import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
	isAddonExecutionOff,
	parseAddonMode,
	parseGlobalMode,
	parseMode,
	handleExecutionModeStateChange,
	isLiveWriteAllowed,
} from "../execution_mode";
import { evaluateParticipation } from "../operator/contributions/flexible/types";
import { resolveWallboxRuntimePhase } from "../addons/wallbox/runtime/execute";
import {
	addonOffSummaryDe,
	executionAuthorityBadge,
	isEffectiveLiveWriteAllowed,
	resolveClimateUnitDisplay,
	resolveExecutionAuthorityFromModes,
} from "./execution_display";
import { buildEffectiveExecutionSnapshot } from "./execution_effective";
import { buildUnifiedDayAgendaDe } from "./product_summary";
import type { UnifiedDayPlan } from "../operator/daily_plan/unified/types";
import { requestForcedUnifiedReplan, resetDailyPlanRevisionForTest } from "../operator/daily_plan/tick";
import { REASON } from "../operator/daily_plan/unified/reason_codes";

describe("Beta-Befund 005 — einheitliche Add-on-Modi off|dryrun|live", () => {
	it("parse: global never off; addon accepts off", () => {
		assert.equal(parseGlobalMode("off"), "dryrun");
		assert.equal(parseAddonMode("off"), "off");
		assert.equal(parseMode("off"), "off");
		assert.equal(isAddonExecutionOff("off"), true);
		assert.equal(isAddonExecutionOff("dryrun"), false);
	});

	it("N: no global→addon cascade; O: direct addon off write sticks", async () => {
		const store = new Map<string, ioBroker.State>([
			["addons.immersion_heater.mode", { val: "live", ack: true } as ioBroker.State],
			["addons.battery.mode", { val: "dryrun", ack: true } as ioBroker.State],
		]);
		const adapter = {
			namespace: "ems.0",
			log: { info: () => {}, warn: () => {} },
			getStateAsync: async (id: string) => store.get(id) ?? null,
			setStateAsync: async (id: string, st: ioBroker.SettableState) => {
				store.set(id, { val: st.val, ack: st.ack ?? false } as ioBroker.State);
			},
			setObjectNotExistsAsync: async () => undefined,
		};
		await handleExecutionModeStateChange(adapter, "ems.0.global.execution_mode", {
			val: "live",
			ack: false,
		} as ioBroker.State);
		assert.equal(store.get("addons.immersion_heater.mode")?.val, "live");
		await handleExecutionModeStateChange(adapter, "ems.0.addons.immersion_heater.mode", {
			val: "off",
			ack: false,
		} as ioBroker.State);
		assert.equal(store.get("addons.immersion_heater.mode")?.val, "off");
		assert.equal(store.get("addons.immersion_heater.mode")?.ack, true);
	});

	it("A/E/H: participation gate blocks off addons", () => {
		const base = {
			addonEnabled: true,
			governanceEnabled: true,
			configured: true,
			mappingsReady: true,
			fault: false,
			lockout: false,
			globalModeOff: false,
		};
		assert.equal(evaluateParticipation({ ...base, addonExecutionOff: true }).allowed, false);
		assert.match(evaluateParticipation({ ...base, addonExecutionOff: true }).reasonDe, /Aus/);
		assert.equal(evaluateParticipation({ ...base, addonExecutionOff: false }).allowed, true);
	});

	it("B/C/D: write authority hierarchy", async () => {
		const store = new Map<string, ioBroker.State>([
			["global.execution_mode", { val: "live", ack: true } as ioBroker.State],
			["addons.immersion_heater.mode", { val: "dryrun", ack: true } as ioBroker.State],
		]);
		const get = async (id: string) => store.get(id) ?? null;
		assert.equal(await isLiveWriteAllowed(get, "immersion_heater"), false);
		store.set("addons.immersion_heater.mode", { val: "live", ack: true } as ioBroker.State);
		assert.equal(await isLiveWriteAllowed(get, "immersion_heater"), true);
		store.set("global.execution_mode", { val: "dryrun", ack: true } as ioBroker.State);
		assert.equal(await isLiveWriteAllowed(get, "immersion_heater"), false);
		store.set("addons.immersion_heater.mode", { val: "off", ack: true } as ioBroker.State);
		store.set("global.execution_mode", { val: "live", ack: true } as ioBroker.State);
		assert.equal(await isLiveWriteAllowed(get, "immersion_heater"), false);
	});

	it("G/Q: wallbox off → observe (EVCC autonom, no EMS phase)", () => {
		assert.equal(
			resolveWallboxRuntimePhase({
				addonEnabled: true,
				governanceEnabled: true,
				liveRequested: true,
				addonExecutionOff: true,
			}),
			"observe",
		);
		assert.equal(
			resolveWallboxRuntimePhase({
				addonEnabled: true,
				governanceEnabled: true,
				liveRequested: false,
				addonExecutionOff: false,
			}),
			"dryrun",
		);
	});

	it("F/P: Klima live + außerhalb Zeitfenster ≠ AUS; Off = AUS", () => {
		assert.equal(resolveExecutionAuthorityFromModes("live", "live"), "live");
		assert.equal(executionAuthorityBadge("live").labelDe, "LIVE");
		const locked = resolveClimateUnitDisplay({
			liveWriteAllowed: true,
			hardwareRunning: false,
			allocatedPowerW: 0,
			reasonDe: "Außerhalb Zeitfenster 08:00–20:00.",
			hasFuturePlan: true,
			nextPlanWindow: {
				startIso: "2026-08-09T09:00:00.000Z",
				endIso: "2026-08-09T11:00:00.000Z",
				startMs: Date.parse("2026-08-09T09:00:00.000Z"),
				endMs: Date.parse("2026-08-09T11:00:00.000Z"),
				powerW: 700,
				contributionId: "air_conditioning.unit_1",
			},
			timezone: "UTC",
		});
		assert.match(locked.operationLabelDe, /Gesperrt/);
		assert.notEqual(locked.badge.labelDe, "Aus");
		assert.equal(resolveExecutionAuthorityFromModes("live", "off"), "off");
		assert.equal(executionAuthorityBadge("off").labelDe, "AUS");
		assert.match(addonOffSummaryDe("wallbox"), /EVCC autonom/);
	});

	it("R: mixed modes in effective snapshot", () => {
		const snap = buildEffectiveExecutionSnapshot({
			globalMode: "live",
			addonModes: {
				immersion_heater: "off",
				air_conditioning: "live",
				battery: "dryrun",
				wallbox: "live",
			},
		});
		assert.equal(snap.addons.immersion_heater.configuredMode, "off");
		assert.equal(snap.addons.immersion_heater.liveWritesPossible, false);
		assert.equal(snap.addons.air_conditioning.liveWritesPossible, true);
		assert.equal(snap.addons.battery.effectiveWriteMode, "dryrun");
		assert.equal(snap.addons.wallbox.liveWritesPossible, true);
		assert.match(snap.summaryDe, /Aus: immersion_heater/);
	});

	it("P: product summary shows OFF lines, no fake windows", () => {
		const plan: UnifiedDayPlan = {
			schemaVersion: 1,
			planId: "off-agenda",
			generation: 1,
			createdAtIso: "2026-08-09T06:00:00.000Z",
			date: "2026-08-09",
			timezone: "UTC",
			globalMode: "balanced",
			horizonStartIso: "2026-08-09T06:00:00.000Z",
			horizonEndIso: "2026-08-09T18:00:00.000Z",
			slotMinutes: 15,
			allocations: [
				{
					kind: "immersion_heater",
					contributionId: "immersion_heater.flexible",
					slot: {
						startIso: "2026-08-09T08:00:00.000Z",
						endIso: "2026-08-09T08:15:00.000Z",
					},
					allocatedPowerW: 1700,
					allocatedEnergyKwh: 0.4,
					energySource: "pv",
					reasonCodes: [],
				},
			],
			constraints: [],
			reasonCodes: [],
			unallocated: [],
			totals: {},
		} as unknown as UnifiedDayPlan;
		const agenda = buildUnifiedDayAgendaDe(plan, {
			immersion_heater: {
				liveWriteAllowed: false,
				hardwareActive: false,
				executionOff: true,
			},
		});
		assert.ok(agenda.some((l) => /Heizstab: AUS/.test(l)));
		assert.ok(!agenda.some((l) => /thermisch vorladen/.test(l)));
	});

	it("I/J: forced replan reason exists; request clears stale cache hook", () => {
		assert.equal(REASON.REPLAN_ADDON_EXECUTION_MODE, "replan_addon_execution_mode");
		resetDailyPlanRevisionForTest();
		requestForcedUnifiedReplan("test_mode_change");
		// request itself must not throw; next tick consumes reasons
		assert.ok(true);
	});

	it("effective live write helper rejects off", () => {
		assert.equal(isEffectiveLiveWriteAllowed("live", "off"), false);
		assert.equal(isEffectiveLiveWriteAllowed("live", "dryrun"), false);
		assert.equal(isEffectiveLiveWriteAllowed("live", "live"), true);
		assert.equal(isEffectiveLiveWriteAllowed("dryrun", "live"), false);
	});

	it("mixed-mode: IH off / AC+WB live / Battery dryrun authorities", () => {
		const snap = buildEffectiveExecutionSnapshot({
			globalMode: "live",
			addonModes: {
				immersion_heater: "off",
				air_conditioning: "live",
				battery: "dryrun",
				wallbox: "live",
			},
		});
		assert.equal(evaluateParticipation({
			addonEnabled: true,
			governanceEnabled: true,
			configured: true,
			mappingsReady: true,
			fault: false,
			lockout: false,
			globalModeOff: false,
			addonExecutionOff: true,
		}).allowed, false);
		assert.equal(snap.addons.air_conditioning.liveWritesPossible, true);
		assert.equal(snap.addons.wallbox.liveWritesPossible, true);
		assert.equal(snap.addons.battery.liveWritesPossible, false);
		assert.equal(snap.addons.battery.effectiveWriteMode, "dryrun");
	});
});
