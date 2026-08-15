import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { immersionDeviceConfigFromAdapter } from "../../../addons/immersion_heater/device_config";
import {
	resolveImmersionDailyPlanFromData,
	resetImmersionDailyPlanCache,
} from "../../../addons/immersion_heater/runtime/daily_plan";
import {
	evaluateAcCoolingPermission,
	resolveAcUnitDailyPlanFromData,
	resetAcDailyPlanCache,
} from "../../../addons/air_conditioning/runtime/daily_plan";
import { localDateKeyInTimezone } from "../../time";
import { allocateUnifiedDayPlan } from "./allocate";
import { buildUnifiedIhAcDispatchPublish } from "./dispatch_bridge";
import { publishUnifiedIhAcDispatch } from "./publish_ih_ac";
import { alloc001Input, alloc006Input, alloc007Input } from "./alloc_fixtures";
import type { UnifiedDayPlannerInput } from "./types";
import { CONTRIBUTION_IDS } from "../../contribution_ids";

function metaFor(now: Date, timezone: string) {
	return {
		status: "ready",
		date: localDateKeyInTimezone(now, timezone),
		revision: 42,
		validUntil: new Date(now.getTime() + 6 * 3600_000).toISOString(),
		timezone,
	};
}

function alignNowToFirstAllocSlot(plan: ReturnType<typeof allocateUnifiedDayPlan>): Date {
	const cell = plan.allocations.find(
		(a) =>
			(a.kind === "immersion_heater" || a.kind === "climate") && a.allocatedPowerW >= 50,
	);
	assert.ok(cell, "expected at least one IH/climate allocation");
	/** Bevorzuge volle Heizstab-Mindeststufe, damit Runtime stage > 0 liefert. */
	const fullIh = plan.allocations.find(
		(a) => a.kind === "immersion_heater" && a.allocatedPowerW >= 1700,
	);
	const pick = fullIh ?? cell;
	return new Date(Date.parse(pick.slot.startIso) + 60_000);
}

describe("LIVE-IH-001 unified IH dispatch via existing daily-plan path", () => {
	it("produces immersion allocations that resolve to commanded stage > 0", () => {
		resetImmersionDailyPlanCache();
		const input = alloc006Input();
		const plan = allocateUnifiedDayPlan(input);
		const pub = buildUnifiedIhAcDispatchPublish(plan);
		assert.ok(pub.immersionEntries.length > 0);
		const now = alignNowToFirstAllocSlot(plan);
		const tz = input.time.timezone;
		const resolved = resolveImmersionDailyPlanFromData({
			now,
			timezone: tz,
			meta: metaFor(now, tz),
			entries: pub.immersionEntries,
			config: immersionDeviceConfigFromAdapter({
				ih_stage_count: 1,
				ih_stage_1_set_state: "relay.0.heater",
				ih_stage_1_nominal_power_w: 1700,
				ih_buffer_temp_c_target: "sensor.0.temp",
				ih_buffer_temp_c_enabled: true,
			}),
		});
		assert.equal(resolved.useDailyPlan, true);
		assert.equal(resolved.decisionSource, "daily_plan");
		assert.ok((resolved.commandedStage ?? 0) > 0);
		assert.ok((resolved.allocatedPowerW ?? 0) >= 50);
	});
});

describe("LIVE-IH-002 no PV thermal / no battery heat path", () => {
	it("zero immersion allocation → daily_plan owns OFF (no legacy planner)", () => {
		resetImmersionDailyPlanCache();
		const input: UnifiedDayPlannerInput = {
			...alloc007Input(),
			thermal: {
				...alloc007Input().thermal!,
				headroomEnergyKwh: 0,
				bufferTempC: 55,
				dayTargetTempC: 51,
			},
			pv: {
				...alloc007Input().pv,
				slots: alloc007Input().pv.slots.map((s) => ({
					...s,
					forecastPowerW: 0,
					energyKwh: 0,
				})),
				expectedDayEnergyKwh: 0,
			},
		};
		const plan = allocateUnifiedDayPlan(input);
		const pub = buildUnifiedIhAcDispatchPublish(plan);
		const batHeat = plan.allocations.filter(
			(a) => a.kind === "immersion_heater" && (a.energySource === "battery" || a.energySource === "mixed"),
		);
		assert.equal(batHeat.length, 0);
		const now = new Date(input.time.slots[0].startIso);
		const tz = input.time.timezone;
		const resolved = resolveImmersionDailyPlanFromData({
			now,
			timezone: tz,
			meta: metaFor(now, tz),
			entries: pub.immersionEntries,
			config: immersionDeviceConfigFromAdapter({
				ih_stage_count: 1,
				ih_stage_1_set_state: "relay.0.heater",
				ih_stage_1_nominal_power_w: 1700,
				ih_buffer_temp_c_target: "sensor.0.temp",
				ih_buffer_temp_c_enabled: true,
			}),
		});
		assert.equal(resolved.useDailyPlan, true);
		assert.equal(resolved.commandedStage, 0);
		assert.ok(
			resolved.dailyPlanStatus === "daily_plan_zero_allocation" ||
				resolved.dailyPlanStatus === "daily_plan_valid",
		);
	});
});

describe("LIVE-AC-001 comfort breach uses existing permission path", () => {
	it("mandatory climate allocation allows start via daily_plan source", () => {
		resetAcDailyPlanCache();
		const base = alloc001Input();
		const slot0 = base.time.slots[0];
		const input: UnifiedDayPlannerInput = {
			...base,
			climate: {
				units: [
					{
						unitId: CONTRIBUTION_IDS.AC_UNIT(1),
						label: "Wohnzimmer",
						roomTempC: 28,
						comfortMinC: null,
						comfortMaxC: 24,
						targetTempC: 26,
						mandatoryComfort: true,
						expectedEnergyKwh: 2,
						typicalPowerW: 900,
						maxShiftHours: 0,
						uncertainty: { status: "valid", confidencePct: 80, reasonDe: "t" },
					},
				],
				freshness: base.pv.freshness,
			},
		};
		const plan = allocateUnifiedDayPlan(input);
		const pub = buildUnifiedIhAcDispatchPublish(plan);
		assert.ok(pub.climateEntries.length > 0);
		const climateSlot =
			plan.allocations.find((a) => a.kind === "climate")?.slot.startIso ?? slot0.startIso;
		const now = new Date(Date.parse(climateSlot) + 30_000);
		const tz = input.time.timezone;
		const dailyPlan = resolveAcUnitDailyPlanFromData({
			unitIndex: 1,
			now,
			timezone: tz,
			meta: metaFor(now, tz),
			entries: pub.climateEntries,
			expectedPower: {
				valid: true,
				powerW: 900,
				source: "config",
				sampleDays: 1,
				medianRuntimeSecPerDay: null,
			},
		});
		assert.equal(dailyPlan.useDailyPlan, true);
		assert.equal(dailyPlan.allocationAllowsStart, true);
		const perm = evaluateAcCoolingPermission({
			unitEnabled: true,
			governanceEnabled: true,
			addonEnabled: true,
			cleaningActive: false,
			startRetryReady: true,
			stopRetryReady: true,
			fsm: {
				state: "idle",
				demandStart: true,
				demandStop: false,
				modePurpose: "cooling",
				reasonDe: "Raum über Komfortgrenze.",
			},
			dailyPlan,
		});
		assert.equal(perm.decisionSource, "daily_plan");
		assert.equal(perm.allowStart, true);
		assert.equal(perm.deviceWritesAllowed, true);
	});
});

describe("LIVE-AC-002 shiftable cooling prefers PV-rich slots", () => {
	it("non-mandatory climate allocations land on higher-PV slots when possible", () => {
		const input = alloc001Input();
		input.climate = {
			units: [
				{
					unitId: CONTRIBUTION_IDS.AC_UNIT(2),
					label: "Josef",
					roomTempC: 24.5,
					comfortMinC: null,
					comfortMaxC: 26,
					targetTempC: 25,
					mandatoryComfort: false,
					expectedEnergyKwh: 1.5,
					typicalPowerW: 900,
					maxShiftHours: 3,
					uncertainty: { status: "valid", confidencePct: 80, reasonDe: "t" },
				},
			],
			freshness: input.pv.freshness,
		};
		// Make early slots weak PV, later strong
		input.pv.slots = input.pv.slots.map((s, i) => {
			const power = i < 8 ? 200 : 4000;
			return { ...s, forecastPowerW: power, energyKwh: (power / 1000) * 0.25 };
		});
		const plan = allocateUnifiedDayPlan(input);
		const climate = plan.allocations.filter((a) => a.kind === "climate");
		assert.ok(climate.length > 0);
		const firstIdx = input.pv.slots.findIndex((s) => s.slot.startIso === climate[0].slot.startIso);
		assert.ok(firstIdx >= 8, `expected PV-rich slot, got index ${firstIdx}`);
	});
});

describe("LIVE-IH ownership vs classic fullPlan", () => {
	it("idle unified slice blocks classic fullPlan immersion entries", async () => {
		const { resolveImmersionDailyPlanAllocation } = await import(
			"../../../addons/immersion_heater/runtime/daily_plan.js"
		);
		resetImmersionDailyPlanCache();
		const now = new Date("2026-08-04T12:07:00.000Z");
		const classicEntry = {
			contributionId: CONTRIBUTION_IDS.IMMERSION_FLEXIBLE,
			contributor: { type: "addon", id: "immersion_heater", addonId: "immersion_heater" },
			slot: {
				startIso: "2026-08-04T12:00:00.000Z",
				endIso: "2026-08-04T12:15:00.000Z",
			},
			status: "allocated",
			energySource: "pv_surplus",
			requestedPowerW: 1700,
			allocatedPowerW: 1700,
			requestedEnergyKwh: 0.425,
			allocatedEnergyKwh: 0.425,
			gridPowerW: 0,
			pvPowerW: 1700,
			mandatory: false,
			priorityRank: 1,
			deadlineIso: null,
			estimatedCostCt: null,
			reasonDe: "classic",
		};
		const localDate = localDateKeyInTimezone(now, "Europe/Berlin");
		const states = new Map<string, unknown>([
			["planner.intent.daily_plan.status", "ready"],
			["planner.intent.daily_plan.date", localDate],
			["planner.intent.daily_plan.revision", 7],
			["planner.intent.daily_plan.valid_until", "2026-08-05T00:00:00.000Z"],
			["planner.intent.allocation.immersion_heater.status", "idle"],
			["planner.intent.allocation.immersion_heater.plan_json", "[]"],
			[
				"planner.intent.daily_plan.plan_json",
				JSON.stringify({
					date: localDate,
					allocations: [classicEntry],
				}),
			],
		]);
		const host = {
			config: {},
			async getStateAsync(id: string) {
				return states.has(id) ? { val: states.get(id) } : null;
			},
		};
		const resolved = await resolveImmersionDailyPlanAllocation(
			host as never,
			immersionDeviceConfigFromAdapter({
				ih_stage_count: 1,
				ih_stage_1_set_state: "relay.0.heater",
				ih_stage_1_nominal_power_w: 1700,
				ih_buffer_temp_c_target: "sensor.0.temp",
				ih_buffer_temp_c_enabled: true,
			}),
			now,
		);
		assert.equal(resolved.useDailyPlan, true);
		assert.equal(resolved.commandedStage, 0);
		assert.equal(resolved.dailyPlanStatus, "daily_plan_zero_allocation");
	});
});

describe("publishUnifiedIhAcDispatch safety surface", () => {
	it("writes only planner.intent.allocation immersion/climate keys — never device states", async () => {
		const written: string[] = [];
		const host = {
			async getStateAsync() {
				return null;
			},
			async setStateAsync(id: string) {
				written.push(id);
			},
		};
		const plan = allocateUnifiedDayPlan(alloc001Input());
		await publishUnifiedIhAcDispatch(host, plan);
		assert.ok(written.length > 0);
		for (const id of written) {
			assert.ok(
				id.startsWith("planner.intent.allocation.immersion_heater.") ||
					id.startsWith("planner.intent.allocation.air_conditioning."),
				`unexpected write target ${id}`,
			);
			assert.equal(id.includes("cmd_"), false);
			assert.equal(id.includes("relay"), false);
		}
	});
});
